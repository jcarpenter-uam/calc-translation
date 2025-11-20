import asyncio
import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import aiohttp
import jwt
from dotenv import load_dotenv

load_dotenv()

WEBSOCKET_URL = os.getenv(
    "WEBSOCKET_URL", "ws://localhost:8000/ws/transcribe/test/test"
)
SPEAKER_NAME = "CALC IT"
TARGET_SAMPLE_RATE = 16000
EXPECTED_CHANNELS = 1
EXPECTED_SAMPLE_WIDTH = 2  # 16-bit PCM

PRIVATE_KEY = os.getenv("PRIVATE_KEY")
if not PRIVATE_KEY:
    print(
        "FATAL: 'PRIVATE_KEY' environment variable is not set. Please add it to your .env file.",
        file=sys.stderr,
    )
    sys.exit(1)


def generate_auth_token(secret_key: str) -> str:
    """
    Generates a short-lived JWT valid for 5 minutes
    """
    now = datetime.now(timezone.utc)
    payload = {
        # BACKEND ONLY WANTS THIS ISS
        "iss": "zoom-rtms-service",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
        "aud": "python-backend",
    }
    token = jwt.encode(payload, secret_key, algorithm="RS256")
    return token


async def receive_transcriptions(ws, stop_event: asyncio.Event):
    """Receives and prints transcription results from the server."""
    print("--- Transcription Receiver Active ---")
    try:
        while not stop_event.is_set():
            try:
                # Wait for a message with a short timeout
                msg = await ws.receive(timeout=0.5)

                if msg.type == aiohttp.WSMsgType.TEXT:
                    # Actually print the transcription
                    print(f"[Transcription]: {msg.data}")
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    print(f"WebSocket Error: {ws.exception()}")
                    break
                elif msg.type == aiohttp.WSMsgType.CLOSED:
                    print("WebSocket closed by server")
                    break
            except asyncio.TimeoutError:
                # No message received, check stop_event and continue
                continue
    except Exception as e:
        if not isinstance(e, asyncio.CancelledError):
            print(f"\nReceiver task closed: {e}")
    finally:
        print("Receiver task finished.")


async def send_audio_from_media_file(ws, file_path: str, stop_event: asyncio.Event):
    """
    Uses FFmpeg to convert a media file (like .mp4) to raw PCM audio
    and streams it over the WebSocket.
    """
    chunk_size_bytes = 4096  # Send 4KB chunks

    # --- FFmpeg Command ---
    # -i {file_path}: Input file
    # -f s16le: Output format (signed 16-bit little-endian PCM)
    # -ar {TARGET_SAMPLE_RATE}: Audio sample rate
    # -ac {EXPECTED_CHANNELS}: Audio channels (1 = mono)
    # -loglevel warning: Suppress verbose FFmpeg logs
    # -: Output to stdout
    ffmpeg_command = [
        "ffmpeg",
        "-i",
        file_path,
        "-f",
        "s16le",
        "-ar",
        str(TARGET_SAMPLE_RATE),
        "-ac",
        str(EXPECTED_CHANNELS),
        "-loglevel",
        "warning",
        "-",
    ]

    # Calculate sleep time to simulate real-time streaming
    bytes_per_second = TARGET_SAMPLE_RATE * EXPECTED_CHANNELS * EXPECTED_SAMPLE_WIDTH
    sleep_duration = chunk_size_bytes / bytes_per_second

    proc = None
    try:
        # Start the FFmpeg subprocess
        print(f"\nStarting FFmpeg to process '{file_path}'...")
        proc = await asyncio.create_subprocess_exec(
            *ffmpeg_command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,  # Capture errors
        )

        print(f"Sending audio from '{file_path}' (simulating real-time)...")

        while not stop_event.is_set():
            # Read a chunk of raw audio data from FFmpeg's stdout
            data_chunk = await proc.stdout.read(chunk_size_bytes)

            if not data_chunk:
                print("--- End of audio stream from FFmpeg ---")
                break  # End of stream

            encoded_audio = base64.b64encode(data_chunk).decode("utf-8")
            payload = {"userName": SPEAKER_NAME, "audio": encoded_audio}

            await ws.send_str(json.dumps(payload))

            try:
                # Sleep to simulate real-time stream
                await asyncio.wait_for(stop_event.wait(), timeout=sleep_duration)
                print("Sender stopping due to stop event.")
                break
            except asyncio.TimeoutError:
                # This is the normal, expected case: sleep finished
                pass

    except FileNotFoundError:
        print("\nFATAL: 'ffmpeg' command not found.", file=sys.stderr)
        print(
            "Please install FFmpeg and ensure it's in your system's PATH.",
            file=sys.stderr,
        )
        stop_event.set()
    except (ConnectionResetError, asyncio.CancelledError):
        print("\nSender task is stopping (connection lost or cancelled).")
    except Exception as e:
        print(f"\nSender task encountered an error: {e}")
    finally:
        if proc:
            # Clean up the FFmpeg process
            if proc.returncode is None:
                try:
                    proc.terminate()
                    await proc.wait()
                    print("FFmpeg process terminated.")
                except ProcessLookupError:
                    pass  # Process already finished

            # Print any errors from FFmpeg
            stderr_data = await proc.stderr.read()
            if stderr_data:
                print(
                    f"--- FFmpeg Errors ---\n{stderr_data.decode()}\n---------------------",
                    file=sys.stderr,
                )

        print("Sender task finished.")


async def main(file_path: str):
    """Main function to set up WebSocket communication and send file."""
    stop_event = asyncio.Event()
    receiver_task = None
    sender_task = None

    try:
        token = generate_auth_token(PRIVATE_KEY)
        auth_header = {"Authorization": f"Bearer {token}"}

        async with aiohttp.ClientSession(headers=auth_header) as session:
            async with session.ws_connect(WEBSOCKET_URL) as ws:
                print(f"\nConnected to {WEBSOCKET_URL}")

                receiver_task = asyncio.create_task(
                    receive_transcriptions(ws, stop_event)
                )
                # Call the new function
                sender_task = asyncio.create_task(
                    send_audio_from_media_file(ws, file_path, stop_event)
                )

                # Wait for the sender to finish (either file end or interrupt)
                await sender_task

                print(
                    "Sender has finished. Waiting a few seconds for final transcriptions..."
                )
                await asyncio.sleep(3.0)  # Give server time to send final results

    except aiohttp.ClientConnectorError:
        print("\nCould not connect to the server. Is it running?")
    except aiohttp.WSServerHandshakeError as e:
        print(
            f"\nHandshake failed. Check auth token? Server said: {e.status} {e.message}"
        )
    except Exception as e:
        print(f"\nAn unexpected error occurred in main: {e}")
    finally:
        print("--- Cleaning up tasks ---")
        stop_event.set()  # Signal all tasks to stop

        # Wait for receiver to finish
        if receiver_task:
            await receiver_task

        print("Main function exiting.")


if __name__ == "__main__":
    try:
        # --- MODIFIED: Hardcode your .mp4 file path here ---
        # Make sure to use forward slashes (/) or double backslashes (\\) for paths on Windows.
        file_path = "test_1.m4a"

        # -----------------------------------------------

        if not os.path.exists(file_path):
            print(f"Error: File not found at '{file_path}'", file=sys.stderr)
            sys.exit(1)

        # Updated check for .mp4, but FFmpeg can handle many formats
        if not file_path.lower().endswith(
            (".mp4", ".m4a", ".mov", ".avi", ".mkv", ".wav", ".mp3")
        ):
            print(
                f"Warning: File '{file_path}' is not a common media type."
                " FFmpeg will still attempt to process it.",
                file=sys.stderr,
            )

        asyncio.run(main(file_path=file_path))

    except KeyboardInterrupt:
        print("\n--- Shutting down gracefully ---")
