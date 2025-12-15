import asyncio
import base64
import json
import logging
import uuid
from datetime import datetime
from typing import Dict, Optional

from core.config import settings
from core.logging_setup import (
    add_session_log_handler,
    log_step,
    message_id_var,
    remove_session_log_handler,
    session_id_var,
    speaker_var,
)
from fastapi import WebSocket, WebSocketDisconnect

from .audio_processing import AudioProcessingService
from .backfill import BackfillService
from .correction import CorrectionService
from .soniox import (
    SonioxConnectionError,
    SonioxError,
    SonioxFatalError,
    SonioxResult,
    SonioxService,
)
from .vtt import TimestampService

logger = logging.getLogger(__name__)


class StreamHandler:
    """
    Manages the state and connection for a single Soniox stream (per target language).
    """

    def __init__(
        self,
        language_code: str,
        session_id: str,
        viewer_manager,
        loop,
        session_start_time: datetime,
        correction_service=None,
        active_correction_tasks=None,
        initial_utterance_count: int = 0,
        skip_first_utterance: bool = False,
    ):
        self.language_code = language_code
        self.session_id = session_id
        self.viewer_manager = viewer_manager
        self.loop = loop
        self.correction_service = correction_service
        self.active_correction_tasks = active_correction_tasks or set()

        self.service: Optional[SonioxService] = None
        self.utterance_count = initial_utterance_count
        self.skip_first_utterance = skip_first_utterance
        self.is_new_utterance = True
        self.current_speaker = "Unknown"

        self.timestamp_service = TimestampService(start_time=session_start_time)

    def update_speaker(self, speaker: str):
        self.current_speaker = speaker

    async def _on_service_error(self, error: SonioxError):
        if isinstance(error, SonioxFatalError):
            with log_step("SONIOX"):
                logger.error(
                    f"Fatal Transcription Error ({self.language_code}): {error}."
                )
        elif isinstance(error, SonioxConnectionError):
            with log_step("SONIOX"):
                logger.warning(
                    f"Restartable Connection Error ({self.language_code}): {error}."
                )

    async def _on_service_close(self, code: int, reason: str):
        with log_step("SONIOX"):
            logger.info(
                f"Transcription service ({self.language_code}) closed. Code: {code}, Reason: {reason}"
            )

    async def _on_transcription_message(self, result: SonioxResult):
        session_token = session_id_var.set(self.session_id)
        speaker_token = speaker_var.set(self.current_speaker)
        try:
            if self.skip_first_utterance:
                if result.is_final:
                    with log_step("SESSION"):
                        logger.debug(
                            f"Synced to stream end for {self.language_code}. "
                            f"Skipping complete. Next utterance will be #{self.utterance_count + 1}."
                        )
                    self.skip_first_utterance = False
                    self.is_new_utterance = True
                return

            if self.is_new_utterance and not result.is_final:
                self.utterance_count += 1
                self.current_message_id = f"{self.utterance_count}_{self.language_code}"
                self.is_new_utterance = False

                message_id_var.set(self.current_message_id)
                with log_step("UTTERANCE"):
                    logger.debug(
                        f"Starting pipeline for utterance ({self.language_code})."
                    )

            if not self.current_message_id:
                if result.is_final:
                    self.is_new_utterance = True
                return

            has_text = (result.transcription and result.transcription.strip()) or (
                result.translation and result.translation.strip()
            )

            if has_text:
                payload_type = "final" if result.is_final else "partial"

                vtt_timestamp = None
                if payload_type == "partial":
                    self.timestamp_service.mark_utterance_start(self.current_message_id)

                if payload_type == "final":
                    vtt_timestamp = self.timestamp_service.complete_utterance(
                        self.current_message_id
                    )

                payload = {
                    "message_id": self.current_message_id,
                    "transcription": result.transcription,
                    "translation": result.translation,
                    "source_language": result.source_language,
                    "target_language": result.target_language,
                    "speaker": self.current_speaker,
                    "type": payload_type,
                    "isfinalize": result.is_final,
                    "vtt_timestamp": vtt_timestamp,
                }
                await self.viewer_manager.broadcast_to_session(self.session_id, payload)

            if result.is_final:
                with log_step("UTTERANCE"):
                    logger.debug(
                        f"Finished pipeline for utterance ({self.language_code})."
                    )

                if (
                    self.correction_service
                    and result.transcription
                    and result.transcription.strip()
                    and result.source_language == "zh"
                ):
                    utterance_to_store = {
                        "message_id": self.current_message_id,
                        "speaker": self.current_speaker,
                        "transcription": result.transcription,
                    }
                    task = asyncio.create_task(
                        self.correction_service.process_final_utterance(
                            utterance_to_store
                        )
                    )
                    self.active_correction_tasks.add(task)
                    task.add_done_callback(self.active_correction_tasks.discard)

                self.is_new_utterance = True
                self.current_message_id = None
                message_id_var.set(None)

        finally:
            speaker_var.reset(speaker_token)
            session_id_var.reset(session_token)

    async def connect(self):
        self.service = SonioxService(
            on_message_callback=self._on_transcription_message,
            on_error_callback=self._on_service_error,
            on_close_callback=self._on_service_close,
            loop=self.loop,
            target_language=self.language_code,
        )
        await self.loop.run_in_executor(None, self.service.connect)

    async def send_audio(self, audio_chunk: bytes):
        if self.service:
            await self.loop.run_in_executor(None, self.service.send_chunk, audio_chunk)

    async def close(self):
        if self.service:
            await self.loop.run_in_executor(None, self.service.finalize_stream)
            if self.service.receive_task:
                try:
                    await asyncio.wait_for(self.service.receive_task, timeout=5.0)
                except asyncio.TimeoutError:
                    pass
                except Exception:
                    pass


async def handle_receiver_session(
    websocket: WebSocket, integration: str, session_id: str, viewer_manager
):
    session_token = session_id_var.set(session_id)
    active_handlers: Dict[str, StreamHandler] = {}
    handlers_lock = asyncio.Lock()

    correction_service = None
    active_correction_tasks = set()
    loop = asyncio.get_running_loop()
    session_log_handler = None
    registration_success = False

    session_start_time = datetime.now()
    backfill_service = BackfillService()

    try:
        registration_success = viewer_manager.register_transcription_session(
            session_id, integration
        )

        if not registration_success:
            await websocket.close(code=1008)
            return

        session_log_handler = add_session_log_handler(session_id, integration)

        if settings.OLLAMA_URL and settings.ALIBABA_API_KEY:
            correction_service = CorrectionService(
                viewer_manager=viewer_manager,
                session_id=session_id,
            )

        async def add_language_stream(language_code: str):
            async with handlers_lock:
                if language_code in active_handlers:
                    return

                start_count = 0
                skip_first = False
                pending_gap_id = None

                if "en" in active_handlers:
                    english_handler = active_handlers["en"]
                    start_count = english_handler.utterance_count

                    if not english_handler.is_new_utterance:
                        skip_first = True
                        pending_gap_id = start_count

                with log_step("SESSION"):
                    logger.info(
                        f"Starting stream for {language_code} at offset {start_count}. "
                        f"Skip partial: {skip_first}"
                    )

                if language_code != "en" and backfill_service:
                    asyncio.create_task(
                        backfill_service.run_session_backfill(
                            session_id=session_id,
                            target_lang=language_code,
                            viewer_manager=viewer_manager,
                        )
                    )

                    if skip_first and pending_gap_id:
                        asyncio.create_task(
                            backfill_service.backfill_gap(
                                session_id=session_id,
                                target_lang=language_code,
                                gap_utterance_count=pending_gap_id,
                                viewer_manager=viewer_manager,
                            )
                        )

                handler = StreamHandler(
                    language_code=language_code,
                    session_id=session_id,
                    viewer_manager=viewer_manager,
                    loop=loop,
                    session_start_time=session_start_time,
                    correction_service=correction_service,
                    active_correction_tasks=active_correction_tasks,
                    initial_utterance_count=start_count,
                    skip_first_utterance=skip_first,
                )

                try:
                    await handler.connect()
                    active_handlers[language_code] = handler
                except Exception as e:
                    logger.error(f"Failed to start stream for {language_code}: {e}")

        async def remove_language_stream(language_code: str):
            async with handlers_lock:
                if language_code in active_handlers:
                    handler = active_handlers.pop(language_code)
                    await handler.close()

            if language_code != "en":
                viewer_manager.cache.clear_language_cache(session_id, language_code)

        viewer_manager.register_language_callback(session_id, add_language_stream)
        viewer_manager.register_language_removal_callback(
            session_id, remove_language_stream
        )

        await add_language_stream("en")

        try:
            while True:
                raw_message = await websocket.receive_text()
                message = json.loads(raw_message)
                current_speaker = message.get("userName", "Unknown")
                speaker_var.set(current_speaker)

                audio_chunk = base64.b64decode(message.get("audio"))

                async with handlers_lock:
                    current_handlers_list = list(active_handlers.values())

                for handler in current_handlers_list:
                    handler.update_speaker(current_speaker)
                    await handler.send_audio(audio_chunk)

        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error(f"Error in transcribe endpoint: {e}", exc_info=True)

    finally:
        speaker_var.set(None)
        if not registration_success:
            session_id_var.reset(session_token)
            return

        async with handlers_lock:
            close_tasks = [handler.close() for handler in active_handlers.values()]
            if close_tasks:
                await asyncio.gather(*close_tasks)
            active_handlers.clear()

        if correction_service:
            await correction_service.finalize_session()

        if active_correction_tasks:
            await asyncio.gather(*active_correction_tasks)

        await viewer_manager.cache.save_history_and_clear(session_id, integration)

        end_payload = {"type": "session_end", "message": "Session concluded."}
        await viewer_manager.broadcast_to_session(session_id, end_payload)

        viewer_manager.deregister_transcription_session(session_id)
        if session_log_handler:
            remove_session_log_handler(session_log_handler)

        session_id_var.reset(session_token)
