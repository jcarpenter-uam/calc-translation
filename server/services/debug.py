import os
import sys
import wave
from datetime import datetime
from typing import Dict, Iterable, List, Optional, TextIO, Union

DEBUG_MODE = os.getenv("DEBUG_MODE", "False").lower() == "true"


def _format_prefix(
    *, message_id: Optional[str], speaker: Optional[str], step: str
) -> str:
    timestamp = datetime.utcnow().isoformat(timespec="milliseconds")
    prefix_parts = [f"[{timestamp}] Debug Service", f"[{step}]"]
    if speaker:
        prefix_parts.append(f"[speaker={speaker}]")
    if message_id:
        prefix_parts.append(f"[message_id={message_id}]")
    return " ".join(prefix_parts)


def log_pipeline_step(
    step: str,
    message: str,
    *,
    message_id: Optional[str] = None,
    speaker: Optional[str] = None,
    extra: Optional[Dict[str, Union[str, int, float]]] = None,
    detailed: bool = True,
    stream: TextIO = sys.stdout,
) -> None:
    """Logs a pipeline step with contextual information.

    Args:
        step: Name of the pipeline stage (e.g. "VAD", "TRANSLATE").
        message: Human readable message summarising what happened.
        message_id: Optional utterance identifier.
        speaker: Optional speaker name associated with the utterance.
        extra: Optional dictionary with additional key/value details.
        detailed: Whether this message is considered detailed.
    """

    if detailed and not DEBUG_MODE:
        return

    prefix = _format_prefix(message_id=message_id, speaker=speaker, step=step)
    print(f"{prefix} {message}", file=stream)

    if DEBUG_MODE and extra:
        for key, value in extra.items():
            print(f"{prefix}    - {key}: {value}", file=stream)


def log_utterance_start(message_id: str, speaker: Optional[str]) -> None:
    """Logs when processing of an utterance begins."""

    log_pipeline_step(
        "UTTERANCE",
        "Starting pipeline for utterance.",
        message_id=message_id,
        speaker=speaker,
        detailed=False,
    )


def log_utterance_step(
    step: str,
    message_id: str,
    description: str,
    *,
    speaker: Optional[str] = None,
    extra: Optional[Dict[str, Union[str, int, float]]] = None,
    detailed: bool = True,
) -> None:
    """Helper to log a detailed step within an utterance pipeline."""

    log_pipeline_step(
        step,
        description,
        message_id=message_id,
        speaker=speaker,
        extra=extra,
        detailed=detailed,
    )


def log_utterance_end(message_id: str, speaker: Optional[str]) -> None:
    """Logs when processing of an utterance is complete."""

    log_pipeline_step(
        "UTTERANCE",
        "Finished pipeline for utterance.",
        message_id=message_id,
        speaker=speaker,
        detailed=False,
    )


def save_audio_to_wav(
    audio_data: Union[List[bytes], bytes], dir_path: str, file_name: str
):
    """
    Saves audio data to a specified WAV file in a given directory.

    Args:
        audio_data: A list of byte strings or a single bytes object.
        dir_path: The directory path where the file will be saved.
        file_name: The name of the file to save (e.g., "before.wav").
    """
    if not audio_data:
        log_pipeline_step(
            "AUDIO",
            f"No audio data provided for {file_name}.",
            detailed=False,
        )
        return

    os.makedirs(dir_path, exist_ok=True)
    filepath = os.path.join(dir_path, file_name)

    if isinstance(audio_data, Iterable) and not isinstance(
        audio_data, (bytes, bytearray)
    ):
        audio_bytes = b"".join(audio_data)
    else:
        audio_bytes = audio_data

    CHANNELS = 1
    SAMPLE_WIDTH = 2
    FRAME_RATE = 16000

    log_pipeline_step(
        "AUDIO",
        f"Saving audio to {filepath}...",
        detailed=False,
    )

    try:
        with wave.open(filepath, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(SAMPLE_WIDTH)
            wf.setframerate(FRAME_RATE)
            wf.writeframes(audio_bytes)
        log_pipeline_step(
            "AUDIO",
            f"Audio saved successfully to {filepath}.",
            extra={
                "channels": CHANNELS,
                "sample_width": SAMPLE_WIDTH,
                "frame_rate": FRAME_RATE,
                "bytes_written": len(audio_bytes),
            },
            detailed=True,
        )
    except Exception as e:
        log_pipeline_step(
            "AUDIO",
            f"Error saving .wav file at {filepath}: {e}",
            detailed=False,
        )
