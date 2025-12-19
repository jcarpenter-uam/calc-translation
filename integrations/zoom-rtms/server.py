import hashlib
import hmac
import json
import logging
import os
import subprocess
import sys
from typing import Dict, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel

load_dotenv()

ZM_WEBHOOK_SECRET = os.getenv("ZM_WEBHOOK_SECRET")
PORT = int(os.getenv("PORT", 8080))
WORKER_SCRIPT = "worker.py"

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("zoom-rtms-server")

if not ZM_WEBHOOK_SECRET:
    logger.critical("FATAL: ZM_WEBHOOK_SECRET is not defined.")
    sys.exit(1)

app = FastAPI()

active_workers: Dict[str, subprocess.Popen] = {}


class WebhookPayload(BaseModel):
    event: str
    payload: dict


@app.post("/zoom")
async def zoom_webhook(request: Request):
    if not ZM_WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Server config error")

    try:
        body_bytes = await request.body()
        body_str = body_bytes.decode("utf-8")
        timestamp = request.headers.get("x-zm-request-timestamp")
        signature = request.headers.get("x-zm-signature")

        if not timestamp or not signature:
            raise HTTPException(status_code=401, detail="Missing signature headers")

        msg_prefix = f"v0:{timestamp}:"
        message = msg_prefix.encode("utf-8") + body_bytes

        hashed = hmac.new(
            ZM_WEBHOOK_SECRET.encode("utf-8"), message, hashlib.sha256
        ).hexdigest()

        expected_signature = f"v0={hashed}"

        if signature != expected_signature:
            logger.warning("Invalid webhook signature received.")
            raise HTTPException(status_code=401, detail="Invalid signature")

        payload_data = json.loads(body_str)
        event = payload_data.get("event")
        payload = payload_data.get("payload")

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    logger.info(f"Received valid webhook event: {event}")

    if event == "endpoint.url_validation":
        plain_token = payload.get("plainToken")
        if not plain_token:
            raise HTTPException(status_code=400, detail="Missing plainToken")

        hash_for_validate = hmac.new(
            ZM_WEBHOOK_SECRET.encode("utf-8"),
            plain_token.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        return {"plainToken": plain_token, "encryptedToken": hash_for_validate}

    elif event == "meeting.rtms_started":
        stream_id = payload.get("rtms_stream_id")
        logger.info(f"Handling meeting.rtms_started for stream: {stream_id}")

        if stream_id in active_workers:
            if active_workers[stream_id].poll() is None:
                logger.warning(f"Worker already exists for stream {stream_id}")
                return Response(content="OK")
            else:
                del active_workers[stream_id]

        try:
            process = subprocess.Popen(
                [sys.executable, WORKER_SCRIPT], stdin=subprocess.PIPE, text=True
            )

            init_data = json.dumps({"stream_id": stream_id, "payload": payload})
            if process.stdin:
                process.stdin.write(init_data + "\n")
                process.stdin.flush()

            active_workers[stream_id] = process
            logger.info(f"Spawned worker PID {process.pid} for stream {stream_id}")

        except Exception as e:
            logger.error(f"Failed to spawn worker: {e}")
            raise HTTPException(status_code=500, detail="Worker spawn failed")

        return Response(content="OK")

    elif event == "meeting.rtms_stopped":
        stream_id = payload.get("rtms_stream_id")
        logger.info(f"Handling meeting.rtms_stopped for stream: {stream_id}")

        if stream_id in active_workers:
            worker = active_workers[stream_id]
            worker.terminate()

            del active_workers[stream_id]

        return Response(content="OK")

    return Response(content="OK")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
