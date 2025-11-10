import os
from datetime import datetime, timedelta
from typing import Any, Dict, List

from .debug import log_pipeline_step


class TimestampService:
    """
    Manages all timestamp-related logic for a transcription session.

    This service is responsible for:
    1. Setting a "zero point" (session start time) when instantiated.
    2. Recording the start time of a new utterance (message_id).
    3. Calculating and formatting a WebVTT-compliant timestamp string
       (e.g., "00:01:10.500 --> 00:01:12.123") when an utterance is finalized.
    """

    def __init__(self):
        """
        Initializes the timestamp service, setting the session's "zero point"
        to the current time.
        """
        self._session_start_time: datetime = datetime.now()
        self._utterance_start_times: Dict[str, datetime] = {}
        log_pipeline_step(
            "TIMESTAMP",
            f"TimestampService initialized. Session zero point set to {self._session_start_time}.",
            detailed=True,
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
            log_pipeline_step(
                "TIMESTAMP",
                f"Marked start for utterance: {message_id}",
                extra={"message_id": message_id},
                detailed=True,
            )

    def complete_utterance(self, message_id: str) -> str:
        """
        Records the end time of an utterance and calculates the full
        VTT timestamp string (start --> end) relative to the session start.
        This should be called on the final result for an utterance.
        """
        utterance_end_time = datetime.now()

        utterance_start_time = self._utterance_start_times.pop(message_id, None)

        if not utterance_start_time:
            utterance_start_time = utterance_end_time
            log_pipeline_step(
                "TIMESTAMP",
                f"Warning: Completed utterance '{message_id}' without a recorded start time. Using end time as start.",
                extra={"message_id": message_id},
                detailed=True,
            )

        start_delta = utterance_start_time - self._session_start_time
        end_delta = utterance_end_time - self._session_start_time

        if end_delta < start_delta:
            end_delta = start_delta

        start_str = self._format_timedelta(start_delta)
        end_str = self._format_timedelta(end_delta)

        vtt_timestamp = f"{start_str} --> {end_str}"

        log_pipeline_step(
            "TIMESTAMP",
            f"Completed utterance '{message_id}'. Timestamp: {vtt_timestamp}",
            extra={"message_id": message_id, "vtt_timestamp": vtt_timestamp},
            detailed=True,
        )

        return vtt_timestamp


def create_vtt_file(session_id: str, integration: str, history: List[Dict[str, Any]]):
    """
    Saves a session's transcript history to a .vtt file.
    """
    try:
        if not history:
            log_pipeline_step(
                "VTT",
                f"No history to save for session {session_id}, list is empty.",
                extra={"session": session_id, "integration": integration},
                detailed=False,
            )
            return

        output_dir = os.path.join("..", "output", integration, session_id)
        os.makedirs(output_dir, exist_ok=True)

        vtt_filepath = os.path.join(output_dir, "transcript.vtt")

        formatted_lines = ["WEBVTT", ""]

        for i, entry in enumerate(history):
            utterance_num = i + 1
            speaker = entry.get("speaker", "Unknown")
            transcription = entry.get("transcription", "").strip()
            translation = entry.get("translation", "").strip()
            timestamp_str = entry.get("vtt_timestamp", "00:00:00.000 --> 00:00:00.000")

            formatted_lines.append(f"{utterance_num}")
            formatted_lines.append(f"{timestamp_str}")
            formatted_lines.append(f"{speaker}: {transcription}")
            if translation:
                formatted_lines.append(f"{translation}")
            formatted_lines.append("")

        with open(vtt_filepath, "w", encoding="utf-8") as f:
            f.write("\n".join(formatted_lines))

        log_pipeline_step(
            "VTT",
            f"Transcript VTT for session {session_id} saved.",
            extra={
                "path": vtt_filepath,
                "entries": len(history),
                "session": session_id,
                "integration": integration,
            },
            detailed=True,
        )

    except Exception as e:
        log_pipeline_step(
            "VTT",
            f"Failed to save VTT for session {session_id}: {e}",
            extra={"session": session_id, "integration": integration},
            detailed=False,
        )
