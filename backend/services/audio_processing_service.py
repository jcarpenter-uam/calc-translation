import noisereduce as nr
import numpy as np


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
        # The noisereduce library works on floating-point audio
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
        # Find the maximum absolute value in the audio
        max_val = np.max(np.abs(audio_data))
        if max_val == 0:
            return audio_data  # Avoid division by zero for silence

        # Calculate the gain needed to reach the target peak
        gain = (target_peak * 32767) / max_val

        # Apply the gain, ensuring we don't exceed 16-bit integer limits
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
            return b""

        print("Audio Processor: Starting post-processing...")
        # Convert bytes to a numerical format
        audio_data = self._bytes_to_audio(audio_bytes)

        # Apply noise suppression
        denoised_audio = self.suppress_noise(audio_data)

        # Normalize the volume
        normalized_audio = self.normalize_volume(denoised_audio)

        # Convert back to bytes for sending
        processed_bytes = self._audio_to_bytes(normalized_audio)
        print("Audio Processor: Post-processing complete.")

        return processed_bytes
