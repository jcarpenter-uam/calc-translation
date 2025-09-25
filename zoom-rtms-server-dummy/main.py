import asyncio
import base64
import json
import sys
from pathlib import Path

import numpy as np
import resampy
import sounddevice as sd
import websockets

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from services.debug_service import log_pipeline_step

# --- Configuration ---
WEBSOCKET_URL = "ws://localhost:8000/ws/transcribe"
SPEAKER_NAME = "Jonah"
TARGET_SAMPLE_RATE = 16000

# A shared buffer to hold resampled audio data
audio_buffer = bytearray()
buffer_lock = asyncio.Lock()


def select_audio_device():
    """Lists available input devices and prompts the user to select one."""
    log_pipeline_step("CLI", "Searching for available audio input devices...", detailed=False)
    devices = sd.query_devices()
    input_devices = [device for device in devices if device["max_input_channels"] > 0]
    if not input_devices:
        log_pipeline_step(
            "CLI",
            "No audio input devices found.",
            detailed=False,
            stream=sys.stderr,
        )
        return None, None
    log_pipeline_step("CLI", "Available audio input devices:", detailed=False)
    for i, device in enumerate(input_devices):
        log_pipeline_step(
            "CLI",
            f"[{i}] {device['name']} (default rate: {int(device['default_samplerate'])} Hz)",
            detailed=False,
        )
    while True:
        try:
            choice = int(input("\n➡️ Please select an input device by number: "))
            if 0 <= choice < len(input_devices):
                selected_device = input_devices[choice]
                device_name = selected_device["name"]
                native_rate = int(selected_device["default_samplerate"])
                log_pipeline_step(
                    "CLI",
                    f"You selected: '{device_name}' running at {native_rate} Hz",
                    detailed=False,
                )
                return device_name, native_rate
            else:
                log_pipeline_step(
                    "CLI",
                    "Invalid number. Please try again.",
                    detailed=False,
                    stream=sys.stderr,
                )
        except (ValueError, IndexError):
            log_pipeline_step(
                "CLI",
                "Invalid input. Please enter a number.",
                detailed=False,
                stream=sys.stderr,
            )
        except KeyboardInterrupt:
            log_pipeline_step(
                "CLI",
                "Selection cancelled.",
                detailed=False,
            )
            return None, None


async def receive_transcriptions(ws):
    """Receives and prints transcription results from the server."""
    log_pipeline_step(
        "CLI",
        "--- Live Transcription Active (Press Ctrl+C to stop) 🎤 ---",
        detailed=False,
    )
    try:
        async for message in ws:
            pass
    except websockets.exceptions.ConnectionClosed as e:
        log_pipeline_step(
            "CLI",
            f"Connection closed by server: {e.reason}",
            detailed=False,
        )


async def send_audio(ws, stop_event: asyncio.Event):
    """
    Continuously sends raw audio data from the buffer as soon as it's available.
    """
    try:
        while not stop_event.is_set():
            data_chunk = None
            async with buffer_lock:
                if audio_buffer:
                    # Take all data currently in the buffer
                    data_chunk = bytes(audio_buffer)
                    audio_buffer.clear()

            if data_chunk:
                # Log the size of the chunk being sent
                log_pipeline_step(
                    "CLI",
                    f"Sending audio chunk of size: {len(data_chunk)} bytes",
                    detailed=True,
                )

                encoded_audio = base64.b64encode(data_chunk).decode("utf-8")
                payload = {"userName": SPEAKER_NAME, "audio": encoded_audio}
                await ws.send(json.dumps(payload))

            # A small sleep to prevent a tight loop when there's no audio
            await asyncio.sleep(0.01)

    except websockets.exceptions.ConnectionClosed:
        log_pipeline_step(
            "CLI",
            "Sender task is stopping because connection closed.",
            detailed=False,
        )
    except asyncio.CancelledError:
        pass


async def main(device_name: str, native_rate: int):
    """Main function to set up audio capture and WebSocket communication."""
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def audio_callback(indata: np.ndarray, frames: int, time, status: sd.CallbackFlags):
        """Captures, resamples, and adds audio data to the shared buffer."""
        if status:
            log_pipeline_step(
                "CLI",
                f"Audio callback status: {status}",
                detailed=True,
                stream=sys.stderr,
            )

        # Resample to the target rate and convert to 16-bit PCM bytes
        resampled_data = resampy.resample(
            indata.flatten(), sr_orig=native_rate, sr_new=TARGET_SAMPLE_RATE
        )
        audio_bytes = (resampled_data * 32767).astype(np.int16).tobytes()

        # Add the captured audio to the buffer in a thread-safe manner
        asyncio.run_coroutine_threadsafe(add_to_buffer(audio_bytes), loop)

    async def add_to_buffer(data):
        """Coroutine-safe way to append data to the shared buffer."""
        async with buffer_lock:
            audio_buffer.extend(data)

    try:
        async with websockets.connect(WEBSOCKET_URL) as ws:
            log_pipeline_step(
                "CLI",
                f"Connected to {WEBSOCKET_URL}",
                detailed=False,
            )

            receiver_task = asyncio.create_task(receive_transcriptions(ws))
            sender_task = asyncio.create_task(send_audio(ws, stop_event))

            log_pipeline_step(
                "CLI",
                f"Starting audio stream from '{device_name}' at {native_rate} Hz...",
                detailed=False,
            )
            with sd.InputStream(
                samplerate=native_rate,
                device=device_name,
                channels=1,
                dtype="float32",
                callback=audio_callback,
            ):
                # Wait for the receiver to finish (e.g., connection closes)
                await receiver_task

            # Cleanly stop the sender task
            stop_event.set()
            await sender_task

    except websockets.exceptions.ConnectionClosedError:
        log_pipeline_step(
            "CLI",
            "Could not connect to the server. Is it running?",
            detailed=False,
        )
    except Exception as e:
        log_pipeline_step(
            "CLI",
            f"An unexpected error occurred: {e}",
            detailed=False,
        )


if __name__ == "__main__":
    try:
        selected_device, native_samplerate = select_audio_device()
        if selected_device and native_samplerate:
            asyncio.run(
                main(device_name=selected_device, native_rate=native_samplerate)
            )
    except KeyboardInterrupt:
        log_pipeline_step(
            "CLI",
            "--- Shutting down gracefully ---",
            detailed=False,
        )
