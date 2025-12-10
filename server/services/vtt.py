import logging
import os
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Dict, List

from core import database
from core.database import SQL_INSERT_TRANSCRIPT
from core.logging_setup import log_step, message_id_var, session_id_var

logger = logging.getLogger(__name__)


class TimestampService:
    def __init__(self):
        """
        Initializes the timestamp service, setting the session's "zero point"
        to the current time.
        """
        self._session_start_time: datetime = datetime.now()
        self._utterance_start_times: Dict[str, datetime] = {}
        with log_step("TIMESTAMP"):
            logger.debug(
                f"TimestampService initialized. Session zero point set to {self._session_start_time}."
            )

    def _format_timedelta(self, td: timedelta) -> str:
        """
        Formats a timedelta object into a WebVTT timestamp string (HH:MM:SS.mmm).
        """
        total_seconds = td.total_seconds()

        if total_seconds < 0:
            total_seconds = 0

        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        milliseconds = td.microseconds // 1000

        return (
            f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}.{milliseconds:03d}"
        )

    def mark_utterance_start(self, message_id: str):
        """
        Records the start time of a new utterance, associated with its message_id.
        This should be called on the first partial result for a new utterance.
        """
        if message_id not in self._utterance_start_times:
            self._utterance_start_times[message_id] = datetime.now()

            token = message_id_var.set(message_id)
            try:
                with log_step("TIMESTAMP"):
                    logger.debug(f"Marked start for utterance: {message_id}")
            finally:
                message_id_var.reset(token)

    def complete_utterance(self, message_id: str) -> str:
        """
        Records the end time of an utterance and calculates the full
        VTT timestamp string (start --> end) relative to the session start.
        This should be called on the final result for an utterance.
        """
        token = message_id_var.set(message_id)
        try:
            with log_step("TIMESTAMP"):
                utterance_end_time = datetime.now()
                utterance_start_time = self._utterance_start_times.pop(message_id, None)

                if not utterance_start_time:
                    utterance_start_time = utterance_end_time
                    logger.warning(
                        f"Warning: Completed utterance '{message_id}' without a recorded start time. Using end time as start."
                    )

                start_delta = utterance_start_time - self._session_start_time
                end_delta = utterance_end_time - self._session_start_time

                if end_delta < start_delta:
                    end_delta = start_delta

                start_str = self._format_timedelta(start_delta)
                end_str = self._format_timedelta(end_delta)

                vtt_timestamp = f"{start_str} --> {end_str}"

                logger.debug(
                    f"Completed utterance '{message_id}'. Timestamp: {vtt_timestamp}"
                )

                return vtt_timestamp
        finally:
            message_id_var.reset(token)


async def create_vtt_file(
    session_id: str,
    integration: str,
    language_code: str,
    history: List[Dict[str, Any]],
):
    """
    Saves a session's transcript history for a specific language to a .vtt file.
    """
    session_token = session_id_var.set(session_id)
    with log_step("VTT"):
        try:
            if not history:
                logger.info(
                    f"No history to save for integration '{integration}' (Language: {language_code}), list is empty."
                )
                return

            safe_session_id = urllib.parse.quote(session_id, safe="")
            output_dir = os.path.join("output", integration, safe_session_id)
            os.makedirs(output_dir, exist_ok=True)

            filename = f"transcript_{language_code}.vtt"
            vtt_filepath = os.path.join(output_dir, filename)

            formatted_lines = ["WEBVTT", ""]

            for i, entry in enumerate(history):
                utterance_num = i + 1
                speaker = entry.get("speaker", "Unknown")
                transcription = entry.get("transcription", "").strip()
                translation = entry.get("translation", "").strip()
                timestamp_str = entry.get(
                    "vtt_timestamp", "00:00:00.000 --> 00:00:00.000"
                )

                primary_text = translation if translation else transcription

                formatted_lines.append(f"{utterance_num}")
                formatted_lines.append(f"{timestamp_str}")
                formatted_lines.append(f"{speaker}: {primary_text}")
                formatted_lines.append("")

            with open(vtt_filepath, "w", encoding="utf-8") as f:
                f.write("\n".join(formatted_lines))

            logger.info(
                f"Transcript VTT saved to {vtt_filepath}. {len(history)} entries."
            )

            async with database.DB_POOL.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        SQL_INSERT_TRANSCRIPT, session_id, language_code, filename
                    )
            logger.info(
                f"Saved transcript record to DB for meeting {session_id} (Lang: {language_code})."
            )

        except Exception as e:
            if "UNIQUE constraint failed" in str(e) or "unique_violation" in str(e):
                logger.warning(
                    f"Transcript record already exists in DB for meeting {session_id} (Lang: {language_code}). Skipping insert."
                )
            else:
                logger.error(
                    f"Failed to save VTT for integration '{integration}': {e}",
                    exc_info=True,
                )
        finally:
            session_id_var.reset(session_token)
