import asyncio
import base64
import json
import logging
from datetime import datetime
from typing import Dict, Optional, List

from core import database
from core.database import (
    SQL_GET_MEETING_ATTENDEES_DETAILS,
    SQL_GET_MEETING_BY_ID,
    SQL_UPDATE_MEETING_END,
    SQL_UPDATE_MEETING_START,
)
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
from .email import EmailService
from .soniox import (
    SonioxConnectionError,
    SonioxError,
    SonioxFatalError,
    SonioxResult,
    SonioxService,
)
from .summary import SummaryService
from .vtt import TimestampService

logger = logging.getLogger(__name__)

ACTIVE_SESSIONS: Dict[str, "MeetingSession"] = {}
SESSION_LOCK = asyncio.Lock()


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
        enable_diarization: bool = False,
        language_hints: Optional[List[str]] = None,
        translation_config: Optional[dict] = None,
    ):
        self.language_code = language_code
        self.session_id = session_id
        self.viewer_manager = viewer_manager
        self.loop = loop

        self.service: Optional[SonioxService] = None
        self.utterance_count = initial_utterance_count
        self.enable_diarization = enable_diarization
        self.language_hints = language_hints
        self.translation_config = translation_config

        self.is_new_utterance = True
        self.await_next_utterance = False

        self.current_speaker = "Unknown"
        self.current_message_id = None

        self.timestamp_service = TimestampService(start_time=session_start_time)
        self.connect_time = None

        self.stream_ready = asyncio.Event()

        self.reconnect_task: Optional[asyncio.Task] = None
        self.is_reconnecting = False

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
                    f"Restartable Connection Error ({self.language_code}): {error}. Initiating reconnect..."
                )

            if not self.is_reconnecting:
                self.reconnect_task = asyncio.create_task(self.reconnect_service())

    async def reconnect_service(self):
        """Attempts to reconnect to Soniox with exponential backoff."""
        self.is_reconnecting = True
        attempt = 1
        max_retries = 5

        try:
            if self.service:
                await self.service.finalize_stream()

            while attempt <= max_retries:
                try:
                    logger.info(
                        f"Soniox Reconnect Attempt {attempt}/{max_retries} for {self.language_code}..."
                    )

                    await self.connect()

                    logger.info(
                        f"Soniox Reconnect Successful for {self.language_code}."
                    )
                    return

                except Exception as e:
                    wait_time = min(2**attempt, 30)
                    logger.warning(
                        f"Reconnect failed ({e}). Retrying in {wait_time}s..."
                    )
                    await asyncio.sleep(wait_time)
                    attempt += 1

            logger.error(
                f"Failed to reconnect Soniox ({self.language_code}) after {max_retries} attempts."
            )

        finally:
            self.is_reconnecting = False
            self.reconnect_task = None

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

            has_text = (result.transcription and result.transcription.strip()) or (
                result.translation and result.translation.strip()
            )

            if self.is_new_utterance and not result.is_final and has_text:
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

                final_speaker_name = (
                    result.speaker if result.speaker else self.current_speaker
                )

                payload = {
                    "message_id": self.current_message_id,
                    "transcription": result.transcription,
                    "translation": result.translation,
                    "source_language": result.source_language,
                    "target_language": result.target_language,
                    "speaker": final_speaker_name,
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
            enable_speaker_diarization=self.enable_diarization,
            language_hints=self.language_hints,
            translation_config=self.translation_config,
        )
        self.connect_time = datetime.now()
        await self.service.connect()

    async def send_audio(self, audio_chunk: bytes):
        if self.service:
            await self.service.send_chunk(audio_chunk)

    async def send_keepalive(self):
        """Sends a keepalive JSON message to prevent Soniox timeout."""
        if self.service:
            await self.service.send_json({"type": "keepalive"})

    async def close(self):
        if self.service:
            await self.service.finalize_stream()
            if self.service.receive_task:
                try:
                    await asyncio.wait_for(self.service.receive_task, timeout=2.0)
                except (asyncio.TimeoutError, Exception):
                    pass


class MeetingSession:
    """
    Encapsulates the persistent state of a meeting session.
    This survives across WebSocket disconnects/reconnects.
    """

    def __init__(self, session_id: str, integration: str, viewer_manager, loop):
        self.session_id = session_id
        self.integration = integration
        self.viewer_manager = viewer_manager
        self.loop = loop

        self.active_handlers: Dict[str, StreamHandler] = {}
        self.handlers_lock = asyncio.Lock()

        self.start_time = datetime.now()
        self.db_start_written = False
        self.session_log_handler = None

        self.backfill_service = BackfillService()
        self.active_backfill_tasks = set()

        self.cleanup_task: Optional[asyncio.Task] = None
        self.is_closed = False
        self.language_hints: Optional[List[str]] = None
        self.translation_type: str = "one_way"
        self.translation_language_a: Optional[str] = None
        self.translation_language_b: Optional[str] = None

    async def initialize(self):
        """Called only once when the session is first created."""
        self.session_log_handler = add_session_log_handler(
            self.session_id, self.integration
        )

        try:
            async with database.DB_POOL.acquire() as conn:
                current_meeting = await conn.fetchrow(
                    database.SQL_GET_MEETING_BY_ID, self.session_id
                )

                if current_meeting:
                    self.language_hints = current_meeting.get("language_hints")
                    self.translation_type = current_meeting.get("translation_type") or "one_way"
                    self.translation_language_a = current_meeting.get("translation_language_a")
                    self.translation_language_b = current_meeting.get("translation_language_b")
                    readable_id = current_meeting.get("readable_id")

                    if readable_id:
                        siblings = await conn.fetch(
                            """
                            SELECT id FROM MEETINGS 
                            WHERE readable_id = $1 AND platform = $2 AND id != $3
                            """,
                            readable_id,
                            self.integration,
                            self.session_id,
                        )

                        for row in siblings:
                            old_uuid = row["id"]
                            await self.viewer_manager.migrate_session(
                                old_uuid, self.session_id
                            )

        except Exception as e:
            logger.error(f"Failed to migrate waiting room sessions: {e}", exc_info=True)

        self.viewer_manager.register_transcription_session(
            self.session_id,
            self.integration,
            shared_two_way_mode=self._is_two_way_session(),
        )
        await self.viewer_manager.broadcast_to_session(
            self.session_id,
            {
                "type": "status",
                "status": "active",
                "shared_two_way_mode": self._is_two_way_session(),
            },
        )

        self.viewer_manager.register_language_callback(
            self.session_id, self._add_language_stream_wrapper
        )
        self.viewer_manager.register_language_removal_callback(
            self.session_id, self._remove_language_stream_wrapper
        )

        if self._is_two_way_session() and self.translation_language_a:
            waiting_languages = {self.translation_language_a}
        else:
            waiting_languages = self.viewer_manager.get_waiting_languages(self.session_id)
            waiting_languages.add("en")

        with log_step("SESSION"):
            logger.info(f"Initializing session with languages: {waiting_languages}")

        tasks = [self.add_language_stream(lang) for lang in waiting_languages]
        await asyncio.gather(*tasks)

    def _is_two_way_session(self) -> bool:
        return (
            self.integration == "standalone"
            and self.translation_type == "two_way"
            and bool(self.translation_language_a)
            and bool(self.translation_language_b)
        )

    def _get_translation_config(self) -> Optional[dict]:
        if not self._is_two_way_session():
            return None

        return {
            "type": "two_way",
            "language_a": self.translation_language_a,
            "language_b": self.translation_language_b,
        }

    async def _add_language_stream_wrapper(self, language_code: str):
        await self.add_language_stream(language_code)

    async def _remove_language_stream_wrapper(self, language_code: str):
        await self.remove_language_stream(language_code)

    async def add_language_stream(self, language_code: str):
        if self.is_closed:
            return

        if self._is_two_way_session() and language_code != self.translation_language_a:
            return

        async with self.handlers_lock:
            if language_code in self.active_handlers:
                return

        should_enable_diarization = self.integration == "standalone"

        handler = StreamHandler(
            language_code=language_code,
            session_id=self.session_id,
            viewer_manager=self.viewer_manager,
            loop=self.loop,
            session_start_time=self.start_time,
            initial_utterance_count=0,
            enable_diarization=should_enable_diarization,
            language_hints=self.language_hints,
            translation_config=self._get_translation_config(),
        )

        try:
            await handler.connect()

            async with self.handlers_lock:
                if language_code in self.active_handlers:
                    await handler.close()
                    return

                start_count = 0
                backfill_target_id = None
                should_wait_for_next = False
                history_cutoff = 0

                if "en" in self.active_handlers:
                    english_handler = self.active_handlers["en"]
                    current_en_count = english_handler.utterance_count
                    en_is_mid_utterance = not english_handler.is_new_utterance

                    if en_is_mid_utterance:
                        start_count = current_en_count
                        should_wait_for_next = True
                        backfill_target_id = current_en_count
                        history_cutoff = current_en_count - 1
                        with log_step("SESSION"):
                            logger.info(
                                f"New stream {language_code} joining MID-UTTERANCE #{current_en_count}. Gap backfill scheduled."
                            )
                    else:
                        start_count = current_en_count
                        should_wait_for_next = False
                        backfill_target_id = None
                        history_cutoff = current_en_count
                        with log_step("SESSION"):
                            logger.info(
                                f"New stream {language_code} joining at IDLE state (Last: #{current_en_count})."
                            )

                handler.utterance_count = start_count
                handler.await_next_utterance = should_wait_for_next
                handler.stream_ready.set()

                self.active_handlers[language_code] = handler

                if language_code != "en" and self.backfill_service:
                    if history_cutoff > 0:
                        bf_task = asyncio.create_task(
                            self.backfill_service.run_session_backfill(
                                session_id=self.session_id,
                                target_lang=language_code,
                                viewer_manager=self.viewer_manager,
                                upto_count=history_cutoff,
                            )
                        )
                        self.active_backfill_tasks.add(bf_task)
                        bf_task.add_done_callback(self.active_backfill_tasks.discard)

                    if backfill_target_id is not None:
                        gap_task = asyncio.create_task(
                            self.backfill_service.backfill_gap(
                                session_id=self.session_id,
                                target_lang=language_code,
                                gap_utterance_count=backfill_target_id,
                                viewer_manager=self.viewer_manager,
                            )
                        )
                        self.active_backfill_tasks.add(gap_task)
                        gap_task.add_done_callback(self.active_backfill_tasks.discard)

        except Exception as e:
            logger.error(f"Failed to start stream for {language_code}: {e}")
            await handler.close()

    async def remove_language_stream(self, language_code: str):
        async with self.handlers_lock:
            if language_code in self.active_handlers:
                handler = self.active_handlers.pop(language_code)
                await handler.close()

        if language_code != "en":
            self.viewer_manager.cache.clear_language_cache(
                self.session_id, language_code
            )

    def update_start_time(self, new_start_time: datetime):
        self.start_time = new_start_time
        for h in self.active_handlers.values():
            h.timestamp_service.start_time = new_start_time

    async def dispatch_audio(self, speaker, audio_chunk):
        async with self.handlers_lock:
            handlers = list(self.active_handlers.values())

        for handler in handlers:
            handler.update_speaker(speaker)
            await handler.send_audio(audio_chunk)

    async def close_session(self):
        """Performs final cleanup and database updates."""
        if self.is_closed:
            return
        self.is_closed = True

        logger.info(f"Closing session {self.session_id} permanently.")

        try:
            async with database.DB_POOL.acquire() as conn:
                await conn.execute(
                    SQL_UPDATE_MEETING_END, datetime.now(), self.session_id
                )
        except Exception as e:
            logger.error(f"Failed to update meeting end time: {e}")

        async with self.handlers_lock:
            close_tasks = [h.close() for h in self.active_handlers.values()]
            if close_tasks:
                await asyncio.gather(*close_tasks)
            self.active_handlers.clear()

        for task in self.active_backfill_tasks:
            task.cancel()

        await self.viewer_manager.cache.save_history_and_clear(
            self.session_id, self.integration
        )

        end_payload = {"type": "session_end", "message": "Session concluded."}
        await self.viewer_manager.broadcast_to_session(self.session_id, end_payload)

        async def run_post_processing():
            try:
                summary_service = SummaryService()
                await summary_service.generate_summaries_for_attendees(
                    self.session_id, self.integration
                )

                await self._email_attendees()

            except Exception as e:
                logger.error(
                    f"Post-processing error for session {self.session_id}: {e}",
                    exc_info=True,
                )

        asyncio.create_task(run_post_processing())

        self.viewer_manager.deregister_transcription_session(self.session_id)
        if self.session_log_handler:
            remove_session_log_handler(self.session_log_handler)

    async def _email_attendees(self):
        """Helper to fetch attendees and delegate email logic."""
        try:
            async with database.DB_POOL.acquire() as conn:
                attendees = await conn.fetch(
                    SQL_GET_MEETING_ATTENDEES_DETAILS, self.session_id
                )

                meeting_details = await conn.fetchrow(
                    SQL_GET_MEETING_BY_ID, self.session_id
                )

            if not attendees:
                logger.info(f"No attendees to email for session {self.session_id}.")
                return

            topic = meeting_details.get("topic") if meeting_details else None

            platform = (
                meeting_details.get("platform") if meeting_details else self.integration
            )

            started_at = meeting_details.get("started_at") if meeting_details else None

            email_service = EmailService()
            await email_service.send_session_transcripts(
                session_id=self.session_id,
                integration=platform,
                attendees=attendees,
                topic=topic,
                meeting_start_time=started_at,
            )

        except Exception as e:
            logger.error(f"Error in _email_attendees: {e}", exc_info=True)

    def schedule_cleanup(self, delay_seconds=15):
        """Schedules a forced close if no reconnect happens."""
        if self.cleanup_task:
            return

        async def _cleanup_job():
            try:
                logger.info(
                    f"Session {self.session_id} disconnected unexpectedly. "
                    f"Waiting {delay_seconds}s for reconnect..."
                )

                waited = 0
                step = 10

                while waited < delay_seconds:
                    wait_time = min(step, delay_seconds - waited)
                    await asyncio.sleep(wait_time)
                    waited += wait_time

                    if waited < delay_seconds:
                        async with self.handlers_lock:
                            for handler in self.active_handlers.values():
                                try:
                                    await handler.send_keepalive()
                                    logger.debug("Sending keep-alive to soniox")
                                except Exception as e:
                                    logger.warning(
                                        f"Failed to send keepalive for {handler.language_code}: {e}"
                                    )

                logger.warning(
                    f"Session {self.session_id} timed out waiting for reconnect. Destroying."
                )

                async with SESSION_LOCK:
                    if self.session_id in ACTIVE_SESSIONS:
                        del ACTIVE_SESSIONS[self.session_id]

                await self.close_session()

            except asyncio.CancelledError:
                logger.info(f"Session {self.session_id} reconnected. Cleanup aborted.")

        self.cleanup_task = asyncio.create_task(_cleanup_job())

    def cancel_cleanup(self):
        """Cancels any pending cleanup task."""
        if self.cleanup_task:
            self.cleanup_task.cancel()
            self.cleanup_task = None


async def handle_receiver_session(
    websocket: WebSocket, integration: str, session_id: str, viewer_manager
):
    session_token = session_id_var.set(session_id)
    loop = asyncio.get_running_loop()
    graceful_exit = False
    meeting_session = None

    try:
        async with SESSION_LOCK:
            if session_id in ACTIVE_SESSIONS:
                meeting_session = ACTIVE_SESSIONS[session_id]
                meeting_session.cancel_cleanup()
                logger.info(f"Resuming existing session: {session_id}")
            else:
                logger.info(f"Initializing new session: {session_id}")
                meeting_session = MeetingSession(
                    session_id, integration, viewer_manager, loop
                )
                await meeting_session.initialize()
                ACTIVE_SESSIONS[session_id] = meeting_session

        while True:
            raw_message = await websocket.receive_text()
            message = json.loads(raw_message)

            if "type" in message:
                msg_type = message["type"]

                if msg_type == "session_start":
                    new_zero_point = datetime.now()
                    logger.info(
                        f"Received session_start. Resetting session zero point to {new_zero_point}."
                    )

                    try:
                        async with database.DB_POOL.acquire() as conn:
                            await conn.execute(
                                SQL_UPDATE_MEETING_START, new_zero_point, session_id
                            )
                        meeting_session.db_start_written = True
                    except Exception as e:
                        logger.error(f"Failed to update meeting start time: {e}")

                    meeting_session.update_start_time(new_zero_point)
                    continue

                elif msg_type == "session_reconnected":
                    logger.info(
                        "Received session_reconnected. Resuming without time reset."
                    )
                    continue

                elif msg_type == "session_end":
                    logger.info("Received session_end. Closing connection gracefully.")
                    graceful_exit = True
                    break

            audio_b64 = message.get("audio")
            if not audio_b64:
                continue

            if not meeting_session.db_start_written:
                try:
                    fallback_time = meeting_session.start_time
                    logger.info(
                        f"Using fallback zero point (start message missing): {fallback_time}"
                    )
                    async with database.DB_POOL.acquire() as conn:
                        await conn.execute(
                            SQL_UPDATE_MEETING_START, fallback_time, session_id
                        )
                    meeting_session.db_start_written = True
                except Exception as e:
                    logger.error(f"Failed to update meeting start time (fallback): {e}")

            current_speaker = message.get("userName", "Unknown")
            speaker_var.set(current_speaker)
            audio_chunk = base64.b64decode(audio_b64)

            await meeting_session.dispatch_audio(current_speaker, audio_chunk)

    except WebSocketDisconnect:
        if not graceful_exit:
            logger.warning(
                f"WebSocket disconnected abruptly for {session_id}. Scheduling cleanup."
            )
    except Exception as e:
        logger.error(f"Error in transcribe endpoint: {e}", exc_info=True)
    finally:
        speaker_var.set(None)
        session_id_var.reset(session_token)

        if graceful_exit:
            async with SESSION_LOCK:
                if session_id in ACTIVE_SESSIONS:
                    del ACTIVE_SESSIONS[session_id]
            if meeting_session:
                await meeting_session.close_session()
        else:
            if meeting_session:
                meeting_session.schedule_cleanup(delay_seconds=45)
