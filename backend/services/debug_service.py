import os
import wave
from datetime import datetime
from typing import List, Union


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
        print(f"Debug Service: No audio data provided for {file_name}.")
        return

    # Ensure the directory exists
    os.makedirs(dir_path, exist_ok=True)
    filepath = os.path.join(dir_path, file_name)

    # Combine frames if audio_data is a list
    if isinstance(audio_data, list):
        audio_bytes = b"".join(audio_data)
    else:
        audio_bytes = audio_data

    CHANNELS = 1
    SAMPLE_WIDTH = 2
    FRAME_RATE = 16000

    print(f"Debug Service: Saving audio to {filepath}...")

    try:
        with wave.open(filepath, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(SAMPLE_WIDTH)
            wf.setframerate(FRAME_RATE)
            wf.writeframes(audio_bytes)
        print(f"Debug Service: Audio saved successfully to {filepath}.")
    except Exception as e:
        print(f"Debug Service: Error saving .wav file at {filepath}: {e}")
