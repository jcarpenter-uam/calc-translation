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

# Status constants for frames
STATUS_FIRST_FRAME = 0
STATUS_CONTINUE_FRAME = 1
STATUS_LAST_FRAME = 2


class TranscriptionService:
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

        # Callbacks to communicate with the FastAPI WebSocket endpoint
        self.on_message_callback = on_message_callback
        self.on_error_callback = on_error_callback
        self.on_close_callback = on_close_callback

        self.loop = loop

        # Business arguments for iFlyTek API
        self.BusinessArgs = {
            "domain": "ist_open",
            "language": "zh_cn",
            "accent": "mandarin",
        }
        self.ws = None
        self.ws_thread = None

    def create_url(self):
        """Generates the authenticated URL for the WebSocket connection."""
        url = "wss://ist-api-sg.xf-yun.com/v2/ist"
        now = datetime.now()
        date = format_date_time(mktime(now.timetuple()))

        signature_origin = f"host: ist-api-sg.xf-yun.com\n"
        signature_origin += f"date: {date}\n"
        signature_origin += f"GET /v2/ist HTTP/1.1"

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
        return f"{url}?{urlencode(v)}"

    def connect(self):
        """Establishes the WebSocket connection in a separate thread."""
        ws_url = self.create_url()
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
        print("iFlyTek WebSocket connection established.")

    def send_audio(self, audio_chunk, status):
        """Sends an audio chunk to the iFlyTek service."""
        if not self.ws or not self.ws.sock or not self.ws.sock.connected:
            print("Error: iFlyTek WebSocket is not connected.")
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

        self.ws.send(json.dumps(data))

    def close(self):
        """Closes the WebSocket connection."""
        if self.ws and self.ws.sock and self.ws.sock.connected:
            final_chunk = b""
            self.send_audio(final_chunk, STATUS_LAST_FRAME)
            time.sleep(1)
            self.ws.close()
            print("iFlyTek WebSocket connection closed.")

    def _on_message(self, ws, message):
        try:
            msg_json = json.loads(message)
            code = msg_json.get("code")
            sid = msg_json.get("sid")

            if code != 0:
                errMsg = msg_json.get("message", "Unknown error")
                error_message = f"iFlyTek Error (sid:{sid}): {errMsg} (code:{code})"
                asyncio.run_coroutine_threadsafe(
                    self.on_error_callback(error_message), self.loop
                )
                return

            data = msg_json.get("data", {})
            if data:
                asyncio.run_coroutine_threadsafe(
                    self.on_message_callback(data), self.loop
                )

        except Exception as e:
            error_message = f"Error processing message: {e}"
            asyncio.run_coroutine_threadsafe(
                self.on_error_callback(error_message), self.loop
            )

    def _on_error(self, ws, error):
        error_message = f"iFlyTek WebSocket error: {error}"
        asyncio.run_coroutine_threadsafe(
            self.on_error_callback(error_message), self.loop
        )

    def _on_close(self, ws, close_status_code, close_msg):
        asyncio.run_coroutine_threadsafe(self.on_close_callback(), self.loop)

    def _on_open(self, ws):
        print("Connection to iFlyTek opened.")
