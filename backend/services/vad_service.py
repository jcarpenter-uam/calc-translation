import collections

import webrtcvad


class VADService:
    """
    A service to perform Voice Activity Detection (VAD) on a real-time audio stream.

    This class ingests audio chunks and uses the WebRTC VAD engine to classify them
    as speech or non-speech, helping to identify the start and end of an utterance.
    """

    def __init__(
        self,
        sample_rate=16000,
        frame_duration_ms=30,
        aggressiveness=1,
        padding_duration_ms=300,
    ):
        """
        Initializes the VADService with tweakable parameters.

        Args:
            sample_rate (int): The sample rate of the audio stream. Must be 8000, 16000, 32000, or 48000.
                               Your transcription service requires 16000.
            frame_duration_ms (int): The duration of each audio frame in milliseconds. Must be 10, 20, or 30.
            aggressiveness (int): Tweakable param. A value from 0 to 3.
                                  0 is the least aggressive (most sensitive to speech),
                                  3 is the most aggressive (least sensitive to speech).
            padding_duration_ms (int): Tweakable param. The duration of silence (in ms) to wait for after
                                       speech before considering the utterance to be ended.
        """
        if sample_rate not in [8000, 16000, 32000, 48000]:
            raise ValueError("VAD unsupported sample rate: %s" % sample_rate)

        self.vad = webrtcvad.Vad(aggressiveness)

        self.sample_rate = sample_rate
        self.frame_duration_ms = frame_duration_ms

        self.frame_bytes = int(sample_rate * (frame_duration_ms / 1000.0) * 2)

        self.num_padding_frames = int(padding_duration_ms / frame_duration_ms)

        self.ring_buffer = collections.deque(maxlen=self.num_padding_frames)

        self.triggered = False

        self.utterance_buffer = bytearray()

    def process_audio(self, audio_chunk):
        """
        Processes a chunk of audio, classifies it, and yields utterances.

        Args:
            audio_chunk (bytes): A chunk of raw PCM audio data.

        Yields:
            tuple: A tuple containing the event type ('start', 'end', 'speech')
                   and the associated audio data.
        """
        for i in range(0, len(audio_chunk), self.frame_bytes):
            frame = audio_chunk[i : i + self.frame_bytes]

            if len(frame) < self.frame_bytes:
                continue

            is_speech = self.vad.is_speech(frame, self.sample_rate)

            if not self.triggered:
                self.ring_buffer.append((frame, is_speech))
                if (
                    sum(1 for _, speech in self.ring_buffer if speech)
                    > 0.9 * self.ring_buffer.maxlen
                ):
                    self.triggered = True
                    start_audio = b"".join([f for f, _ in self.ring_buffer])
                    yield "start", start_audio
                    self.utterance_buffer.extend(start_audio)
                    self.ring_buffer.clear()
            else:
                self.ring_buffer.append((frame, is_speech))
                self.utterance_buffer.extend(frame)
                yield "speech", frame

                if (
                    sum(1 for _, speech in self.ring_buffer if not speech)
                    > 0.9 * self.ring_buffer.maxlen
                ):
                    self.triggered = False
                    yield "end", bytes(self.utterance_buffer)
                    self.ring_buffer.clear()
                    self.utterance_buffer.clear()
