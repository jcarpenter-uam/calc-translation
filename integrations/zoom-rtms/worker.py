import asyncio
import base64
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime

import aiohttp
import jwt
import rtms
from dotenv import load_dotenv

load_dotenv()

BASE_SERVER_URL = os.getenv("BASE_SERVER_URL", "ws://localhost:8000/ws/transcribe")
ZOOM_BASE_SERVER_URL = f"{BASE_SERVER_URL}/zoom"
ZM_PRIVATE_KEY = os.getenv("ZM_PRIVATE_KEY")

LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("worker")

rtms_client = None
stop_event = asyncio.Event()
audio_queue = asyncio.Queue()


def get_timestamp_filename():
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def generate_auth_token(host_id):
    """Generates a JWT token for the backend connection."""
    payload = {
        "iss": "zoom-rtms-service",
        "iat": int(time.time()),
        "aud": "python-backend",
        "zoom_host_id": host_id,
    }
    return jwt.encode(payload, ZM_PRIVATE_KEY, algorithm="RS256")


def on_audio_data(data, size, timestamp, metadata):
    """
    Callback from Zoom RTMS SDK (Synchronous).
    We do the heavy lifting (Base64) here, then push to the async queue.
    """
    if stop_event.is_set():
        return

    try:
        b64_audio = base64.b64encode(data).decode("utf-8")

        speaker = getattr(metadata, "userName", "")
        if not speaker:
            speaker = "Zoom RTMS"

        payload = {"userName": speaker, "audio": b64_audio}

        audio_queue.put_nowait(payload)

    except Exception as e:
        logger.error(f"Error processing audio callback: {e}")


async def websocket_sender_task(meeting_uuid, host_id):
    """
    Consumer Task: Reads from queue and sends via aiohttp.
    Maintains persistent connection logic.
    """
    import urllib.parse

    encoded_uuid = urllib.parse.quote(meeting_uuid, safe="")
    url = f"{ZOOM_BASE_SERVER_URL}/{encoded_uuid}"

    logger.info(f"Starting WebSocket Sender Task for {url}")

    while not stop_event.is_set():
        try:
            token = generate_auth_token(host_id)
            headers = {"Authorization": f"Bearer {token}"}

            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.ws_connect(url) as ws:
                    logger.info("Backend WebSocket connected (aiohttp).")

                    while not stop_event.is_set():
                        try:
                            payload = await asyncio.wait_for(
                                audio_queue.get(), timeout=1.0
                            )
                        except asyncio.TimeoutError:
                            continue

                        await ws.send_str(json.dumps(payload))
                        audio_queue.task_done()

        except aiohttp.ClientConnectorError:
            logger.warning("Connection failed. Retrying in 2 seconds...")
            await asyncio.sleep(2)
        except Exception as e:
            if not stop_event.is_set():
                logger.error(f"WebSocket Error: {e}. Reconnecting...")
                await asyncio.sleep(1)
            else:
                break

    logger.info("WebSocket Sender Task finished.")


async def rtms_polling_loop(
    rtms_client, meeting_uuid, stream_id, server_urls, signature
):
    """
    Producer Task: Runs the RTMS join and polling loop.
    """
    try:
        logger.info("Joining Zoom RTMS...")
        rtms_client.join(
            meeting_uuid=meeting_uuid,
            rtms_stream_id=stream_id,
            server_urls=server_urls,
            signature=signature,
        )
        logger.info("Joined successfully. Starting polling...")

        while not stop_event.is_set():
            rtms_client._process_join_queue()
            rtms_client._poll_if_needed()

            await asyncio.sleep(0.01)

    except Exception as e:
        logger.critical(f"RTMS Polling Error: {e}", exc_info=True)
        stop_event.set()
    finally:
        logger.info("Leaving Zoom meeting...")
        try:
            rtms_client.leave()
        except:
            pass


async def main():
    global rtms_client

    if not ZM_PRIVATE_KEY:
        logger.critical("ZM_PRIVATE_KEY not found.")
        sys.exit(1)

    try:
        loop = asyncio.get_running_loop()
        input_data = await loop.run_in_executor(None, sys.stdin.readline)

        if not input_data:
            logger.error("No input data received.")
            sys.exit(1)

        config = json.loads(input_data)
        payload_data = config.get("payload")
        stream_id = config.get("stream_id")
        meeting_uuid = payload_data.get("meeting_uuid")
        operator_id = payload_data.get("operator_id")

        safe_uuid = meeting_uuid.replace("/", "_")
        log_file = os.path.join(LOG_DIR, f"{safe_uuid}_{get_timestamp_filename()}.log")
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        logger.addHandler(file_handler)

        logger.info(f"Worker started for stream {stream_id}")

    except Exception as e:
        logger.error(f"Failed to parse input config: {e}")
        sys.exit(1)

    rtms_client = rtms.Client()
    rtms_client.onAudioData(on_audio_data)

    sender_task = asyncio.create_task(websocket_sender_task(meeting_uuid, operator_id))

    poller_task = asyncio.create_task(
        rtms_polling_loop(
            rtms_client,
            meeting_uuid,
            stream_id,
            payload_data.get("server_urls"),
            payload_data.get("signature"),
        )
    )

    try:
        await stop_event.wait()
    except asyncio.CancelledError:
        pass

    logger.info("Shutting down tasks...")
    if not stop_event.is_set():
        stop_event.set()

    await asyncio.gather(sender_task, poller_task, return_exceptions=True)
    logger.info("Worker exited cleanly.")


def handle_exit(sig, frame):
    logger.info(f"Received signal {sig}. Initiating shutdown...")
    stop_event.set()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, handle_exit)
    signal.signal(signal.SIGINT, handle_exit)

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
