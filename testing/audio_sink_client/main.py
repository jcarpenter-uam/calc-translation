import asyncio
import sys

import numpy as np
import resampy
import sounddevice as sd
import websockets

# --- Configuration ---
WEBSOCKET_URL = "ws://localhost:8000/ws/transcribe"
TARGET_SAMPLE_RATE = 16000
CHUNK_BYTES = 1280
SEND_INTERVAL_S = 0.04

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
        async for message in ws:
            print(message, end="", flush=True)
    except websockets.exceptions.ConnectionClosed as e:
        print(f"\nConnection closed by server: {e.reason}")


async def send_audio(ws, stop_event: asyncio.Event):
    """
    Pulls audio from the shared buffer in fixed-size chunks and sends it
    at the required 40ms interval.
    """
    try:
        while not stop_event.is_set():
            async with buffer_lock:
                if len(audio_buffer) >= CHUNK_BYTES:
                    data_chunk = audio_buffer[:CHUNK_BYTES]
                    del audio_buffer[:CHUNK_BYTES]
                else:
                    data_chunk = None

            if data_chunk:
                await ws.send(data_chunk)

            await asyncio.sleep(SEND_INTERVAL_S)

    except websockets.exceptions.ConnectionClosed:
        print("\nSender task is stopping because connection closed.")
    except asyncio.CancelledError:
        pass


async def main(device_name: str, native_rate: int):
    """Main function to set up audio capture and WebSocket communication."""
    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()

    def audio_callback(indata: np.ndarray, frames: int, time, status: sd.CallbackFlags):
        """Captures, resamples, and adds audio data to the shared buffer."""
        if status:
            print(status, file=sys.stderr)

        mono_data = indata.flatten()
        resampled_data = resampy.resample(
            mono_data, sr_orig=native_rate, sr_new=TARGET_SAMPLE_RATE
        )
        audio_bytes = (resampled_data * 32767).astype(np.int16).tobytes()

        asyncio.run_coroutine_threadsafe(add_to_buffer(audio_bytes), loop)

    async def add_to_buffer(data):
        """Coroutine-safe way to append data to the shared buffer."""
        async with buffer_lock:
            audio_buffer.extend(data)

    try:
        async with websockets.connect(WEBSOCKET_URL) as ws:
            print(f"\nConnected to {WEBSOCKET_URL}")

            receiver_task = asyncio.create_task(receive_transcriptions(ws))
            sender_task = asyncio.create_task(send_audio(ws, stop_event))

            print(f"Starting audio stream from '{device_name}' at {native_rate} Hz...")
            with sd.InputStream(
                samplerate=native_rate,
                device=device_name,
                channels=1,
                dtype="float32",
                callback=audio_callback,
            ):
                await receiver_task

            stop_event.set()
            await sender_task

    except websockets.exceptions.ConnectionClosedError:
        print("\nCould not connect to the server. Is it running?")
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
