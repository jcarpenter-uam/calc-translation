import asyncio
import base64
import hashlib
import hmac
import json
import os
import ssl
import threading
import time
from datetime import datetime
from time import mktime
from urllib.parse import urlencode
from wsgiref.handlers import format_date_time

import websocket
from dotenv import load_dotenv
from services.debug_service import log_pipeline_step

STATUS_FIRST_FRAME = 0
STATUS_CONTINUE_FRAME = 1
STATUS_LAST_FRAME = 2


class TranscriptionResult:
    """A standardized class to hold transcription results."""

    def __init__(self, text, is_final=False, is_replace=False):
        self.text = text
        self.is_final = is_final
        self.is_replace = is_replace


class IFlyTekTranscriptionService:
    """
    Manages the connection and real-time transcription with the iFlyTek WebSocket service.
    """

    def __init__(self, on_message_callback, on_error_callback, on_close_callback, loop):
        load_dotenv()
        self.APPID = os.getenv("APPID")
        self.APIKey = os.getenv("APIKEY")
        self.APISecret = os.getenv("APISECRET")

        if not all([self.APPID, self.APIKey, self.APISecret]):
            raise ValueError("Missing iFlyTek API credentials in .env file.")

        self.on_message_callback = on_message_callback
        self.on_error_callback = on_error_callback
        self.on_close_callback = on_close_callback
        self.loop = loop

        self.BusinessArgs = {
            "domain": "ist_open",
            "language": "zh_cn",
            "accent": "mandarin",
        }
        self.ws = None
        self.ws_thread = None
        self._is_first_chunk = True
        log_pipeline_step(
            "TRANSCRIPTION",
            "Initialized iFlyTek transcription client.",
            extra={
                "has_app_id": bool(self.APPID),
                "language": self.BusinessArgs["language"],
                "accent": self.BusinessArgs["accent"],
            },
            detailed=True,
        )

    def create_url(self):
        """Generates the authenticated URL for the WebSocket connection."""
        url = "wss://ist-api-sg.xf-yun.com/v2/ist"
        now = datetime.now()
        date = format_date_time(mktime(now.timetuple()))
        signature_origin = (
            f"host: ist-api-sg.xf-yun.com\ndate: {date}\nGET /v2/ist HTTP/1.1"
        )
        signature_sha = hmac.new(
            self.APISecret.encode("utf-8"),
            signature_origin.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).digest()
        signature_sha_base64 = base64.b64encode(signature_sha).decode("utf-8")
        authorization_origin = (
            f'api_key="{self.APIKey}", algorithm="hmac-sha256", '
            f'headers="host date request-line", signature="{signature_sha_base64}"'
        )
        authorization = base64.b64encode(authorization_origin.encode("utf-8")).decode(
            "utf-8"
        )
        v = {
            "authorization": authorization,
            "date": date,
            "host": "ist-api-sg.xf-yun.com",
        }
        full_url = f"{url}?{urlencode(v)}"
        log_pipeline_step(
            "TRANSCRIPTION",
            "Generated authenticated WebSocket URL.",
            detailed=True,
        )
        return full_url

    def connect(self):
        """Establishes the WebSocket connection in a separate thread."""
        ws_url = self.create_url()
        log_pipeline_step(
            "TRANSCRIPTION",
            "Connecting to iFlyTek WebSocket endpoint.",
            detailed=False,
        )
        self.ws = websocket.WebSocketApp(
            ws_url,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
        )
        self.ws.on_open = self._on_open
        self.ws_thread = threading.Thread(
            target=self.ws.run_forever, kwargs={"sslopt": {"cert_reqs": ssl.CERT_NONE}}
        )
        self.ws_thread.daemon = True
        self.ws_thread.start()
        while self.ws and (not self.ws.sock or not self.ws.sock.connected):
            time.sleep(0.1)
        log_pipeline_step(
            "TRANSCRIPTION",
            "iFlyTek WebSocket connection established.",
            detailed=True,
        )

    def send_chunk(self, audio_chunk: bytes):
        """Sends a single chunk of audio, managing the frame status internally."""
        status = STATUS_CONTINUE_FRAME
        if self._is_first_chunk:
            status = STATUS_FIRST_FRAME
            self._is_first_chunk = False
        log_pipeline_step(
            "TRANSCRIPTION",
            "Sending audio frame to iFlyTek service.",
            extra={"status": status, "chunk_bytes": len(audio_chunk)},
            detailed=True,
        )
        self._send_frame(audio_chunk, status)

    def finalize_utterance(self):
        """Sends the final frame to signal the end of the utterance."""
        log_pipeline_step(
            "TRANSCRIPTION",
            "Finalizing utterance with closing frame.",
            detailed=True,
        )
        self._send_frame(b"", STATUS_LAST_FRAME)
        self._is_first_chunk = True  # Reset for the next utterance

    def _send_frame(self, audio_chunk, status):
        """(Internal) Sends an audio frame with a specific status."""
        if not self.ws or not self.ws.sock or not self.ws.sock.connected:
            log_pipeline_step(
                "TRANSCRIPTION",
                "Error: iFlyTek WebSocket is not connected.",
                detailed=False,
            )
            return
        common_args = {"app_id": self.APPID}
        data = {
            "data": {
                "status": status,
                "format": "audio/L16;rate=16000",
                "audio": base64.b64encode(audio_chunk).decode("utf-8"),
                "encoding": "raw",
            }
        }
        if status == STATUS_FIRST_FRAME:
            data["common"] = common_args
            data["business"] = self.BusinessArgs
        payload = json.dumps(data)
        log_pipeline_step(
            "TRANSCRIPTION",
            "Dispatching frame payload to WebSocket.",
            extra={"status": status, "payload_bytes": len(payload)},
            detailed=True,
        )
        self.ws.send(payload)
        if status == STATUS_LAST_FRAME:
            log_pipeline_step(
                "TRANSCRIPTION",
                "Sent final frame to transcription service.",
                detailed=True,
            )

    def close(self):
        """Closes the WebSocket connection."""
        if self.ws and self.ws.sock and self.ws.sock.connected:
            self.finalize_utterance()
            time.sleep(0.1)
            self.ws.close()
            log_pipeline_step(
                "TRANSCRIPTION",
                "iFlyTek WebSocket connection closed.",
                detailed=True,
            )

    def _on_message(self, ws, message):
        try:
            msg_json = json.loads(message)
            code = msg_json.get("code")
            sid = msg_json.get("sid")
            if code != 0:
                errMsg = msg_json.get("message", "Unknown error")
                error_message = f"iFlyTek Error (sid:{sid}): {errMsg} (code:{code})"
                log_pipeline_step(
                    "TRANSCRIPTION",
                    "Non-success response received from iFlyTek service.",
                    extra={"sid": sid, "code": code, "message": errMsg},
                    detailed=False,
                )
                asyncio.run_coroutine_threadsafe(
                    self.on_error_callback(error_message), self.loop
                )
                return
            data = msg_json.get("data", {})
            if data:
                result_data = data.get("result", {})
                current_text = "".join(
                    cw.get("w", "")
                    for w in result_data.get("ws", [])
                    for cw in w.get("cw", [])
                )
                is_final = result_data.get("ls", False)
                is_replace = result_data.get("pgs") == "rpl"
                result = TranscriptionResult(
                    text=current_text, is_final=is_final, is_replace=is_replace
                )
                log_pipeline_step(
                    "TRANSCRIPTION",
                    "Received transcription delta from iFlyTek.",
                    extra={
                        "chunk_length": len(current_text),
                        "is_final": is_final,
                        "is_replace": is_replace,
                    },
                    detailed=True,
                )
                asyncio.run_coroutine_threadsafe(
                    self.on_message_callback(result), self.loop
                )
        except Exception as e:
            error_message = f"Error processing message: {e}"
            asyncio.run_coroutine_threadsafe(
                self.on_error_callback(error_message), self.loop
            )

    def _on_error(self, ws, error):
        error_message = f"iFlyTek WebSocket error: {error}"
        log_pipeline_step(
            "TRANSCRIPTION",
            "WebSocket error encountered.",
            extra={"error": str(error)},
            detailed=False,
        )
        asyncio.run_coroutine_threadsafe(
            self.on_error_callback(error_message), self.loop
        )

    def _on_close(self, ws, close_status_code, close_msg):
        log_pipeline_step(
            "TRANSCRIPTION",
            "WebSocket connection closed by server.",
            extra={
                "status_code": close_status_code,
                "message": close_msg,
            },
            detailed=False,
        )
        asyncio.run_coroutine_threadsafe(
            self.on_close_callback(close_status_code, close_msg), self.loop
        )

    def _on_open(self, ws):
        log_pipeline_step(
            "TRANSCRIPTION",
            "Connection to iFlyTek opened.",
            detailed=True,
        )
        log_pipeline_step(
            "TRANSCRIPTION",
            "Initial handshake complete; ready to stream audio.",
            detailed=False,
        )
