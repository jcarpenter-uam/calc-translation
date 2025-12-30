import base64
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime

import jwt
import rtms
from dotenv import load_dotenv
from websocket import WebSocketException, create_connection

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
ws_client = None
is_stopping = False


def get_timestamp_filename():
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def generate_auth_token(host_id):
    payload = {
        "iss": "zoom-rtms-service",
        "iat": int(time.time()),
        "aud": "python-backend",
        "zoom_host_id": host_id,
    }
    return jwt.encode(payload, ZM_PRIVATE_KEY, algorithm="RS256")


def connect_websocket(meeting_uuid, host_id):
    """Establishes connection to the Main App API"""
    global ws_client
    if is_stopping:
        return

    import urllib.parse

    encoded_uuid = urllib.parse.quote(meeting_uuid, safe="")

    url = f"{ZOOM_BASE_SERVER_URL}/{encoded_uuid}"
    token = generate_auth_token(host_id)
    headers = {"Authorization": f"Bearer {token}"}

    logger.info(f"Connecting to Backend WebSocket: {url}")
    try:
        ws_client = create_connection(url, header=headers, timeout=10)
        logger.info("Backend WebSocket connected.")
    except Exception as e:
        logger.error(f"WebSocket connection failed: {e}")
        ws_client = None


def signal_handler(sig, frame):
    """Handle SIGTERM from server.py for graceful shutdown"""
    global is_stopping
    logger.info(f"Received signal {sig}. Shutting down...")
    is_stopping = True

    if rtms_client:
        try:
            logger.info("Leaving Zoom meeting...")
            rtms_client.leave()
        except Exception as e:
            logger.error(f"Error leaving meeting: {e}")

    if ws_client:
        try:
            ws_client.close()
        except:
            pass

    sys.exit(0)


signal.signal(signal.SIGTERM, signal_handler)


def on_audio_data(data, size, timestamp, metadata):
    """Callback from Zoom RTMS SDK"""
    global ws_client

    if not ws_client or is_stopping:
        return

    logger.info(f"METADATA TYPE: {type(metadata)}")
    logger.info(f"METADATA DIR: {dir(metadata)}")

    try:
        b64_audio = base64.b64encode(data).decode("utf-8")
        speaker = metadata.userName if metadata.userName else "Zoom RTMS"

        payload = json.dumps({"userName": speaker, "audio": b64_audio})

        ws_client.send(payload)

    except (WebSocketException, BrokenPipeError):
        logger.warning("WebSocket lost. Attempting reconnect...")
        ws_client = None
    except Exception as e:
        logger.error(f"Error sending audio: {e}")


def main():
    global rtms_client, ws_client

    if not ZM_PRIVATE_KEY:
        logger.critical("ZM_PRIVATE_KEY not found.")
        sys.exit(1)

    try:
        input_data = sys.stdin.readline()
        if not input_data:
            logger.error("No input data received.")
            sys.exit(1)

        config = json.loads(input_data)
        payload = config.get("payload")
        stream_id = config.get("stream_id")
        meeting_uuid = payload.get("meeting_uuid")
        operator_id = payload.get("operator_id")
    except Exception as e:
        logger.error(f"Failed to parse input config: {e}")
        sys.exit(1)

    safe_uuid = meeting_uuid.replace("/", "_")
    log_file = os.path.join(LOG_DIR, f"{safe_uuid}_{get_timestamp_filename()}.log")
    file_handler = logging.FileHandler(log_file)
    file_handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    logger.addHandler(file_handler)

    logger.info(f"Worker started for stream {stream_id} (Meeting: {meeting_uuid})")

    connect_websocket(meeting_uuid, operator_id)

    try:
        rtms_client = rtms.Client()
        rtms_client.onAudioData(on_audio_data)

        logger.info("Joining Zoom RTMS...")
        rtms_client.join(
            meeting_uuid=meeting_uuid,
            rtms_stream_id=stream_id,
            server_urls=payload.get("server_urls"),
            signature=payload.get("signature"),
        )

        logger.info("Joined successfully. Entering polling loop.")

        while not is_stopping:
            rtms_client._process_join_queue()
            rtms_client._poll_if_needed()

            if not ws_client and not is_stopping:
                connect_websocket(meeting_uuid, operator_id)

            time.sleep(0.01)

    except Exception as e:
        logger.critical(f"Unexpected error in worker: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
