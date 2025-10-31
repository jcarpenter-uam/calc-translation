import noisereduce as nr
import numpy as np

from .debug_service import log_pipeline_step

# BUG:
# /usr/local/lib/python3.13/site-packages/noisereduce/spectralgate/nonstationary.py:70: RuntimeWarning: invalid value encountered in divide
# sig_mult_above_thresh = (abs_sig_stft - sig_stft_smooth) / sig_stft_smooth
# /app/services/audio_processing_service.py:41: RuntimeWarning: invalid value encountered in cast
# return reduced_noise_audio.astype(np.int16)


class AudioProcessingService:
    """
    Houses audio post-processing logic for noise suppression and normalization.
    """

    def __init__(self, sample_rate=16000):
        """
        Initializes the audio processor.

        Args:
            sample_rate (int): The sample rate of the audio.
        """
        self.sample_rate = sample_rate

    def _bytes_to_audio(self, audio_bytes: bytes) -> np.ndarray:
        """Converts raw audio bytes into a NumPy array."""
        return np.frombuffer(audio_bytes, dtype=np.int16)

    def _audio_to_bytes(self, audio_data: np.ndarray) -> bytes:
        """Converts a NumPy array back into audio bytes."""
        return audio_data.astype(np.int16).tobytes()

    def suppress_noise(self, audio_data: np.ndarray) -> np.ndarray:
        """
        Reduces stationary noise from the audio.

        Args:
            audio_data (np.ndarray): The audio data.

        Returns:
            np.ndarray: Audio data with noise reduced.
        """
        audio_float = audio_data.astype(np.float32)
        reduced_noise_audio = nr.reduce_noise(y=audio_float, sr=self.sample_rate)
        return reduced_noise_audio.astype(np.int16)

    def normalize_volume(self, audio_data: np.ndarray, target_peak=0.95) -> np.ndarray:
        """
        Normalizes the audio to a target peak amplitude.

        Args:
            audio_data (np.ndarray): The audio data.
            target_peak (float): The target peak amplitude (0.0 to 1.0).

        Returns:
            np.ndarray: Normalized audio data.
        """
        max_val = np.max(np.abs(audio_data))
        if max_val == 0:
            return audio_data

        gain = (target_peak * 32767) / max_val

        normalized_audio = np.clip(audio_data * gain, -32768, 32767)
        return normalized_audio.astype(np.int16)

    def process(self, audio_bytes: bytes) -> bytes:
        """
        Runs the full post-processing pipeline on an audio utterance.

        Args:
            audio_bytes (bytes): The complete raw audio utterance.

        Returns:
            bytes: The processed (denoised and normalized) audio utterance.
        """
        if not audio_bytes:
            log_pipeline_step(
                "AUDIO_PROCESSING",
                "Received empty audio payload. Skipping post-processing.",
                detailed=False,
            )
            return b""

        raw_sample_count = len(audio_bytes) // 2
        log_pipeline_step(
            "AUDIO_PROCESSING",
            "Starting audio post-processing pipeline.",
            extra={
                "bytes_received": len(audio_bytes),
                "estimated_samples": raw_sample_count,
                "sample_rate": self.sample_rate,
            },
            detailed=True,
        )

        audio_data = self._bytes_to_audio(audio_bytes)
        log_pipeline_step(
            "AUDIO_PROCESSING",
            "Converted raw bytes to numpy array.",
            extra={
                "dtype": str(audio_data.dtype),
                "array_shape": audio_data.shape,
                "min": int(audio_data.min()),
                "max": int(audio_data.max()),
            },
            detailed=True,
        )

        denoised_audio = self.suppress_noise(audio_data)
        log_pipeline_step(
            "AUDIO_PROCESSING",
            "Noise suppression complete.",
            extra={
                "dtype": str(denoised_audio.dtype),
                "min": int(denoised_audio.min()),
                "max": int(denoised_audio.max()),
            },
            detailed=True,
        )

        normalized_audio = self.normalize_volume(denoised_audio)
        log_pipeline_step(
            "AUDIO_PROCESSING",
            "Volume normalization complete.",
            extra={
                "dtype": str(normalized_audio.dtype),
                "min": int(normalized_audio.min()),
                "max": int(normalized_audio.max()),
            },
            detailed=True,
        )

        processed_bytes = self._audio_to_bytes(denoised_audio)
        log_pipeline_step(
            "AUDIO_PROCESSING",
            "Audio Processor: Post-processing complete.",
            extra={
                "bytes_emitted": len(processed_bytes),
                "sample_rate": self.sample_rate,
            },
            detailed=True,
        )

        return processed_bytes
