# BUG: This service is not currently in use due to lack of time to evaluate solutions
# The goal is to find a lightweight denoising solution that is actually effective at isolating vocals

import logging

import noisereduce as nr
import numpy as np
from core.logging_setup import log_step

logger = logging.getLogger(__name__)


class AudioProcessingService:
    """
    Houses audio post-processing logic for noise suppression and normalization.
    """

    def __init__(self, sample_rate=16000):
        """
        Initializes the audio processor.
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
        """
        audio_float = audio_data.astype(np.float32)
        reduced_noise_audio = nr.reduce_noise(y=audio_float, sr=self.sample_rate)
        return reduced_noise_audio.astype(np.int16)

    def normalize_volume(self, audio_data: np.ndarray, target_peak=0.95) -> np.ndarray:
        """
        Normalizes the audio to a target peak amplitude.
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
        """
        with log_step("AUDIO_PROCESSING"):
            if not audio_bytes:
                logger.info("Received empty audio payload. Skipping post-processing.")
                return b""

            raw_sample_count = len(audio_bytes) // 2

            logger.debug(
                f"Starting audio post-processing. Bytes: {len(audio_bytes)}, "
                f"Samples: {raw_sample_count}"
            )

            audio_data = self._bytes_to_audio(audio_bytes)
            logger.debug(
                f"Converted to numpy array. Shape: {audio_data.shape}, "
                f"Min: {int(audio_data.min())}, Max: {int(audio_data.max())}"
            )

            denoised_audio = self.suppress_noise(audio_data)
            logger.debug(
                f"Noise suppression complete. "
                f"Min: {int(denoised_audio.min())}, Max: {int(denoised_audio.max())}"
            )

            normalized_audio = self.normalize_volume(denoised_audio)
            logger.debug(
                f"Volume normalization complete. "
                f"Min: {int(normalized_audio.min())}, Max: {int(normalized_audio.max())}"
            )

            processed_bytes = self._audio_to_bytes(denoised_audio)
            logger.debug(
                f"Post-processing complete. Bytes emitted: {len(processed_bytes)}"
            )

            return processed_bytes
