import os
import wave
from datetime import datetime
from typing import List


def save_audio_to_wav(audio_frames: List[bytes]):
    """
    Saves a list of raw audio frames to a WAV file inside a new,
    timestamped directory within a 'debug' folder.

    Args:
        audio_frames: A list of byte strings, each representing a raw audio chunk.
    """
    if not audio_frames:
        print("Debug Service: No audio frames to save.")
        return

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    debug_dir_path = os.path.join("debug", timestamp)

    os.makedirs(debug_dir_path, exist_ok=True)

    filepath = os.path.join(debug_dir_path, "audio.wav")

    CHANNELS = 1
    SAMPLE_WIDTH = 2
    FRAME_RATE = 16000

    print(f"Debug Service: Saving received audio to {filepath}...")

    try:
        with wave.open(filepath, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(SAMPLE_WIDTH)
            wf.setframerate(FRAME_RATE)
            wf.writeframes(b"".join(audio_frames))
        print(f"Debug Service: Audio saved successfully to {filepath}.")
    except Exception as e:
        print(f"Debug Service: Error saving .wav file: {e}")
