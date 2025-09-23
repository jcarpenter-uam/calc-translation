class AudioBufferService:
    """
    Buffers incoming audio chunks and yields them in consistent frame sizes
    suitable for the VAD service.
    """

    def __init__(self, frame_duration_ms=30, sample_rate=16000, sample_width=2):
        """
        Initializes the buffer with parameters matching the VAD's requirements.

        Args:
            frame_duration_ms (int): The duration of each audio frame in ms (e.g., 10, 20, 30).
            sample_rate (int): The sample rate of the audio (e.g., 16000).
            sample_width (int): The number of bytes per sample (e.g., 2 for 16-bit audio).
        """
        # Calculate the exact number of bytes for the desired frame duration
        self.frame_size_bytes = int(
            sample_rate * (frame_duration_ms / 1000.0) * sample_width
        )
        self.buffer = bytearray()

    def process_audio(self, audio_chunk: bytes):
        """
        Adds a new audio chunk to the buffer and yields frames of the configured size.

        Args:
            audio_chunk (bytes): The incoming raw audio data from the client.

        Yields:
            bytes: Audio frames of `self.frame_size_bytes`.
        """
        # Add the new data to our internal buffer
        self.buffer.extend(audio_chunk)

        # Yield as many full frames as we can from the buffer
        while len(self.buffer) >= self.frame_size_bytes:
            frame = self.buffer[: self.frame_size_bytes]
            self.buffer = self.buffer[self.frame_size_bytes :]
            yield frame
