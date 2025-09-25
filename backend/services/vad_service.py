import collections
from enum import Enum
from typing import Generator, Tuple

import webrtcvad


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
        padding_duration_ms=550,
    ):
        if sample_rate not in [8000, 16000, 32000, 48000]:
            raise ValueError(f"VAD unsupported sample rate: {sample_rate}")

        self.vad = webrtcvad.Vad(aggressiveness)
        self.sample_rate = sample_rate
        self.frame_duration_ms = frame_duration_ms
        self.frame_bytes = int(sample_rate * (frame_duration_ms / 1000.0) * 2)

        num_padding_frames = int(padding_duration_ms / frame_duration_ms)
        self.ring_buffer = collections.deque(maxlen=num_padding_frames)

        # Initialize the state
        self.reset()

    def reset(self):
        """Resets the VAD to its initial state."""
        print("VAD service has been reset.")
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

        is_speech = self.vad.is_speech(frame, self.sample_rate)
        self.ring_buffer.append((frame, is_speech))

        if self.state == VADState.WAITING:
            # Check if we should transition to SPEAKING
            if self._is_speech_ratio(is_speech=True) > 0.9:
                self.state = VADState.SPEAKING
                start_audio = b"".join([f for f, _ in self.ring_buffer])
                yield "start", start_audio
                self.utterance_buffer.extend(start_audio)
                self.ring_buffer.clear()

        elif self.state == VADState.SPEAKING:
            self.utterance_buffer.extend(frame)
            yield "speech", frame

            # Check if we should transition back to WAITING
            if self._is_speech_ratio(is_speech=False) > 0.9:
                yield "end", bytes(self.utterance_buffer)
                self.reset()  # Reset for the next utterance
