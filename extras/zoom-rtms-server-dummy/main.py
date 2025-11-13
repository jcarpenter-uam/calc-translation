import asyncio
import base64
import json
import os
import sys

import aiohttp
import numpy as np
import resampy
import sounddevice as sd
from dotenv import load_dotenv

load_dotenv()

# --- Configuration ---
WEBSOCKET_URL = os.getenv(
    "WEBSOCKET_URL", "ws://localhost:8000/ws/transcribe/test/test"
)
SPEAKER_NAME = "CALC IT"
TARGET_SAMPLE_RATE = 16000

WS_SECRET_TOKEN = os.getenv("WS_SECRET_TOKEN")
if not WS_SECRET_TOKEN:
    print(
        "FATAL: 'WS_SECRET_TOKEN' environment variable is not set. Please add it to your .env file.",
        file=sys.stderr,
    )
    sys.exit(1)

# A shared buffer to hold resampled audio data
audio_buffer = bytearray()
buffer_lock = asyncio.Lock()


def select_audio_device():
    """Lists available input devices and prompts the user to select one."""
    print("Searching for available audio input devices...")
    devices = sd.query_devices()
    input_devices = [device for device in devices if device["max_input_channels"] > 0]
    if not input_devices:
        print("No audio input devices found.", file=sys.stderr)
        return None, None
    print("\nAvailable audio input devices:")
    for i, device in enumerate(input_devices):
        print(
            f"  [{i}] {device['name']} (default rate: {int(device['default_samplerate'])} Hz)"
        )
    while True:
        try:
            choice = int(input("\n➡️ Please select an input device by number: "))
            if 0 <= choice < len(input_devices):
                selected_device = input_devices[choice]
                device_name = selected_device["name"]
                native_rate = int(selected_device["default_samplerate"])
                print(f"You selected: '{device_name}' running at {native_rate} Hz")
                return device_name, native_rate
            else:
                print("Invalid number. Please try again.", file=sys.stderr)
        except (ValueError, IndexError):
            print("Invalid input. Please enter a number.", file=sys.stderr)
        except KeyboardInterrupt:
            print("\nSelection cancelled.")
            return None, None


async def receive_transcriptions(ws):
    """Receives and prints transcription results from the server."""
    print("--- Live Transcription Active (Press Ctrl+C to stop) 🎤 ---")
    try:
        # aiohttp's iteration model is slightly different
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                # The original script had 'pass'.
                # You would process msg.data here (e.g., json.loads(msg.data))
                pass
            elif msg.type == aiohttp.WSMsgType.ERROR:
                print(f"WebSocket Error: {ws.exception()}")
                break
            elif msg.type == aiohttp.WSMsgType.CLOSED:
                print("WebSocket closed by server")
                break
    except Exception as e:
        print(f"\nReceiver task closed: {e}")


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
                print(f"Sending audio chunk of size: {len(data_chunk)} bytes")

                encoded_audio = base64.b64encode(data_chunk).decode("utf-8")
                payload = {"userName": SPEAKER_NAME, "audio": encoded_audio}

                # Use ws.send_str for sending JSON text
                await ws.send_str(json.dumps(payload))

            # A small sleep to prevent a tight loop when there's no audio
            await asyncio.sleep(0.01)

    except (ConnectionResetError, asyncio.CancelledError):
        print("\nSender task is stopping.")
    except Exception as e:
        print(f"\nSender task encountered an error: {e}")


async def main(device_name: str, native_rate: int):
    """Main function to set up audio capture and WebSocket communication."""
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def audio_callback(indata: np.ndarray, frames: int, time, status: sd.CallbackFlags):
        """Captures, resamples, and adds audio data to the shared buffer."""
        if status:
            print(status, file=sys.stderr)

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
        # aiohttp uses a simple dictionary for headers
        auth_header = {"Authorization": f"Bearer {WS_SECRET_TOKEN}"}

        # aiohttp uses a ClientSession to manage connections and headers
        async with aiohttp.ClientSession(headers=auth_header) as session:
            async with session.ws_connect(WEBSOCKET_URL) as ws:
                print(f"\nConnected to {WEBSOCKET_URL}")

                receiver_task = asyncio.create_task(receive_transcriptions(ws))
                sender_task = asyncio.create_task(send_audio(ws, stop_event))

                print(
                    f"Starting audio stream from '{device_name}' at {native_rate} Hz..."
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

    except aiohttp.ClientConnectorError:
        print("\nCould not connect to the server. Is it running?")
    except aiohttp.WSServerHandshakeError as e:
        # This error is useful for debugging auth issues
        print(
            f"\nHandshake failed. Check your auth token? Server said: {e.status} {e.message}"
        )
    except Exception as e:
        print(f"\nAn unexpected error occurred: {e}")


if __name__ == "__main__":
    try:
        selected_device, native_samplerate = select_audio_device()
        if selected_device and native_samplerate:
            asyncio.run(
                main(device_name=selected_device, native_rate=native_samplerate)
            )
    except KeyboardInterrupt:
        print("\n--- Shutting down gracefully ---")
