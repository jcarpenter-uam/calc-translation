import collections
from enum import Enum
from typing import Generator, Tuple

import webrtcvad

from .debug_service import log_pipeline_step


# An Enum to make the VAD's state explicit and readable
class VADState(Enum):
    WAITING = 1
    SPEAKING = 2


class VADService:
    """
    A service to perform Voice Activity Detection (VAD) on a real-time audio stream.
    This class ingests audio frames and uses the WebRTC VAD engine to classify them
    as speech or non-speech, helping to identify the start and end of an utterance.
    """

    def __init__(
        self,
        sample_rate=16000,
        frame_duration_ms=30,
        aggressiveness=1,
        padding_duration_ms=150,
    ):
        if sample_rate not in [8000, 16000, 32000, 48000]:
            raise ValueError(f"VAD unsupported sample rate: {sample_rate}")

        self.vad = webrtcvad.Vad(aggressiveness)
        self.sample_rate = sample_rate
        self.frame_duration_ms = frame_duration_ms
        self.frame_bytes = int(sample_rate * (frame_duration_ms / 1000.0) * 2)

        num_padding_frames = int(padding_duration_ms / frame_duration_ms)
        self.ring_buffer = collections.deque(maxlen=num_padding_frames)
        log_pipeline_step(
            "VAD",
            "Initialized VAD service.",
            extra={
                "sample_rate": sample_rate,
                "frame_duration_ms": frame_duration_ms,
                "aggressiveness": aggressiveness,
                "padding_frames": num_padding_frames,
            },
            detailed=True,
        )

        # Initialize the state
        self.reset()

    def reset(self):
        """Resets the VAD to its initial state."""
        log_pipeline_step(
            "VAD",
            "VAD service has been reset.",
            extra={"padding_buffer_len": len(self.ring_buffer)},
            detailed=False,
        )
        self.state = VADState.WAITING
        self.ring_buffer.clear()
        self.utterance_buffer = bytearray()

    def _is_speech_ratio(self, is_speech: bool) -> float:
        """Calculates the ratio of speech/non-speech frames in the ring buffer."""
        if not self.ring_buffer:
            return 0.0

        num_voiced = sum(1 for _, speech in self.ring_buffer if speech == is_speech)
        return num_voiced / self.ring_buffer.maxlen

    def process_audio(self, frame: bytes) -> Generator[Tuple[str, bytes], None, None]:
        """
        Processes a single audio frame, classifies it, and yields utterance events.
        Args:
            frame (bytes): A single chunk of raw PCM audio data, perfectly sized
                           to the frame_duration_ms.
        Yields:
            A tuple containing the event type ('start', 'end', 'speech') and the
            associated audio data.
        """
        if len(frame) != self.frame_bytes:
            # This check is a safeguard; buffer_service should prevent this.
            return

        log_pipeline_step(
            "VAD",
            "Evaluating audio frame for speech.",
            extra={
                "frame_bytes": len(frame),
                "current_state": self.state.name,
            },
            detailed=True,
        )

        is_speech = self.vad.is_speech(frame, self.sample_rate)
        self.ring_buffer.append((frame, is_speech))

        if self.state == VADState.WAITING:
            # Check if we should transition to SPEAKING
            if self._is_speech_ratio(is_speech=True) > 0.9:
                self.state = VADState.SPEAKING
                start_audio = b"".join([f for f, _ in self.ring_buffer])
                log_pipeline_step(
                    "VAD",
                    "Speech onset detected.",
                    extra={
                        "prebuffer_frames": len(start_audio) // self.frame_bytes,
                        "prebuffer_bytes": len(start_audio),
                    },
                    detailed=False,
                )
                yield "start", start_audio
                self.utterance_buffer.extend(start_audio)
                self.ring_buffer.clear()

        elif self.state == VADState.SPEAKING:
            self.utterance_buffer.extend(frame)
            log_pipeline_step(
                "VAD",
                "Speech frame appended to utterance buffer.",
                extra={
                    "utterance_bytes": len(self.utterance_buffer),
                    "frame_bytes": len(frame),
                },
                detailed=True,
            )
            yield "speech", frame

            # Check if we should transition back to WAITING
            if self._is_speech_ratio(is_speech=False) > 0.9:
                utterance_length_ms = (
                    len(self.utterance_buffer)
                    / self.frame_bytes
                    * self.frame_duration_ms
                )
                log_pipeline_step(
                    "VAD",
                    "Speech offset detected.",
                    extra={
                        "utterance_bytes": len(self.utterance_buffer),
                        "approx_duration_ms": int(utterance_length_ms),
                    },
                    detailed=False,
                )
                yield "end", bytes(self.utterance_buffer)
                self.reset()  # Reset for the next utterance
