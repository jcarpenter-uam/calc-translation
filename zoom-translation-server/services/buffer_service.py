from .debug_service import log_pipeline_step


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
        log_pipeline_step(
            "BUFFER",
            "Initialized audio buffer service.",
            extra={
                "frame_duration_ms": frame_duration_ms,
                "sample_rate": sample_rate,
                "frame_size_bytes": self.frame_size_bytes,
            },
            detailed=True,
        )

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
        log_pipeline_step(
            "BUFFER",
            "Buffered incoming audio chunk.",
            extra={
                "chunk_bytes": len(audio_chunk),
                "buffer_size": len(self.buffer),
                "frame_size": self.frame_size_bytes,
            },
            detailed=True,
        )

        # Yield as many full frames as we can from the buffer
        while len(self.buffer) >= self.frame_size_bytes:
            frame = self.buffer[: self.frame_size_bytes]
            self.buffer = self.buffer[self.frame_size_bytes :]
            log_pipeline_step(
                "BUFFER",
                "Emitting frame from buffer for VAD processing.",
                extra={
                    "emitted_frame_bytes": len(frame),
                    "buffer_remaining": len(self.buffer),
                },
                detailed=True,
            )
            yield frame

        if self.buffer:
            log_pipeline_step(
                "BUFFER",
                "Residual audio data retained in buffer awaiting next chunk.",
                extra={"buffer_size": len(self.buffer)},
                detailed=True,
            )
