import asyncio
import base64
import json
import logging
from datetime import datetime
from typing import Dict, Optional

from core.logging_setup import (
    add_session_log_handler,
    log_step,
    message_id_var,
    remove_session_log_handler,
    session_id_var,
    speaker_var,
)
from fastapi import WebSocket, WebSocketDisconnect

from .backfill import BackfillService
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
        initial_utterance_count: int = 0,
    ):
        self.language_code = language_code
        self.session_id = session_id
        self.viewer_manager = viewer_manager
        self.loop = loop

        self.service: Optional[SonioxService] = None
        self.utterance_count = initial_utterance_count

        self.is_new_utterance = True
        self.await_next_utterance = False

        self.current_speaker = "Unknown"
        self.current_message_id = None

        self.timestamp_service = TimestampService(start_time=session_start_time)
        self.connect_time = None

        self.stream_ready = asyncio.Event()

    def update_speaker(self, speaker: str):
        self.current_speaker = speaker
        if self.service:
            self.service.current_speaker = speaker

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
        await self.stream_ready.wait()

        session_token = session_id_var.set(self.session_id)
        speaker_token = speaker_var.set(self.current_speaker)

        try:
            if self.await_next_utterance:
                if result.is_final:
                    with log_step("SESSION"):
                        logger.debug(
                            f"Stream {self.language_code} finished skipping mid-utterance. "
                            f"Now synced. Next ID will be #{self.utterance_count + 1}."
                        )
                    self.await_next_utterance = False
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
            session_id=self.session_id,
        )
        self.connect_time = datetime.now()
        await self.service.connect()

    async def send_audio(self, audio_chunk: bytes):
        if self.service:
            await self.service.send_chunk(audio_chunk)

    async def close(self):
        if self.service:
            await self.service.finalize_stream()
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

    active_backfill_tasks = set()
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

        async def add_language_stream(language_code: str):
            if language_code in active_handlers:
                return

            handler = StreamHandler(
                language_code=language_code,
                session_id=session_id,
                viewer_manager=viewer_manager,
                loop=loop,
                session_start_time=session_start_time,
                initial_utterance_count=0,
            )

            try:
                await handler.connect()

                async with handlers_lock:
                    if language_code in active_handlers:
                        await handler.close()
                        return

                    start_count = 0
                    backfill_target_id = None
                    should_wait_for_next = False

                    history_cutoff = 0

                    if "en" in active_handlers:
                        english_handler = active_handlers["en"]
                        current_en_count = english_handler.utterance_count
                        en_is_mid_utterance = not english_handler.is_new_utterance

                        if en_is_mid_utterance:
                            start_count = current_en_count
                            should_wait_for_next = True

                            backfill_target_id = current_en_count
                            history_cutoff = current_en_count - 1

                            with log_step("SESSION"):
                                logger.info(
                                    f"New stream {language_code} joining MID-UTTERANCE #{current_en_count}. "
                                    "Setting Standby Mode. Gap backfill scheduled."
                                )
                        else:
                            start_count = current_en_count
                            should_wait_for_next = False

                            backfill_target_id = None
                            history_cutoff = current_en_count

                            with log_step("SESSION"):
                                logger.info(
                                    f"New stream {language_code} joining at IDLE state (Last: #{current_en_count}). "
                                    f"History expected up to #{history_cutoff}."
                                )

                    handler.utterance_count = start_count
                    handler.await_next_utterance = should_wait_for_next
                    handler.stream_ready.set()

                    active_handlers[language_code] = handler

                    if language_code != "en" and backfill_service:

                        if history_cutoff > 0:
                            bf_task = asyncio.create_task(
                                backfill_service.run_session_backfill(
                                    session_id=session_id,
                                    target_lang=language_code,
                                    viewer_manager=viewer_manager,
                                    upto_count=history_cutoff,
                                )
                            )
                            active_backfill_tasks.add(bf_task)
                            bf_task.add_done_callback(active_backfill_tasks.discard)

                        if backfill_target_id is not None:
                            gap_task = asyncio.create_task(
                                backfill_service.backfill_gap(
                                    session_id=session_id,
                                    target_lang=language_code,
                                    gap_utterance_count=backfill_target_id,
                                    viewer_manager=viewer_manager,
                                )
                            )
                            active_backfill_tasks.add(gap_task)
                            gap_task.add_done_callback(active_backfill_tasks.discard)

            except Exception as e:
                logger.error(f"Failed to start stream for {language_code}: {e}")
                await handler.close()

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

        if active_backfill_tasks:
            for task in active_backfill_tasks:
                task.cancel()

        await viewer_manager.cache.save_history_and_clear(session_id, integration)

        end_payload = {"type": "session_end", "message": "Session concluded."}
        await viewer_manager.broadcast_to_session(session_id, end_payload)

        viewer_manager.deregister_transcription_session(session_id)
        if session_log_handler:
            remove_session_log_handler(session_log_handler)

        session_id_var.reset(session_token)
