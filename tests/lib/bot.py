import asyncio
import base64
import io
import os
import urllib.request
import uuid
import wave
from datetime import datetime, timedelta, timezone

import aiohttp
import jwt

CHUNK_SIZE = 4096
SAMPLE_RATE = 16000
CHANNELS = 1
SAMPLE_WIDTH = 2
BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH
CHUNK_DURATION = CHUNK_SIZE / BYTES_PER_SECOND

SPEECH_URL = (
    "https://raw.githubusercontent.com/ggerganov/whisper.cpp/master/samples/jfk.wav"
)


class ZoomRTMSBot:
    def __init__(
        self,
        meeting_uuid=None,
        host_id=None,
        user_name="Test Bot",
        websocket_url=None,
    ):
        self.meeting_uuid = meeting_uuid or f"test-{uuid.uuid4()}"
        self.host_id = host_id or f"host-{uuid.uuid4().hex[:8]}"
        self.stream_id = f"st_{uuid.uuid4().hex[:8]}"
        self.user_name = user_name
        self.websocket_url = websocket_url

        self.ws = None
        self.session = None
        self.received_messages = []
        self.is_connected = False

        self.audio_buffer = bytes()
        self.audio_cursor = 0
        self._prepare_audio_data()

        raw_key = os.getenv("PRIVATE_KEY", "")
        if not raw_key:
            raw_key = os.getenv("ZM_PRIVATE_KEY", "")
        self.private_key = self._format_private_key(raw_key)

    def _prepare_audio_data(self):
        """Downloads wav file to memory and strips headers to get raw PCM."""
        print(f"[Bot] Downloading speech sample from {SPEECH_URL}...")
        try:
            with urllib.request.urlopen(SPEECH_URL) as response:
                audio_data = response.read()

            with wave.open(io.BytesIO(audio_data), "rb") as wav_file:
                if wav_file.getnchannels() != 1 or wav_file.getframerate() != 16000:
                    print(
                        f"[Bot] WARNING: Sample is {wav_file.getframerate()}Hz/{wav_file.getnchannels()}ch. Expected 16000Hz/1ch."
                    )

                self.audio_buffer = wav_file.readframes(wav_file.getnframes())
                print(
                    f"[Bot] Audio loaded! {len(self.audio_buffer)} bytes of speech data."
                )

        except Exception as e:
            print(f"[Bot] CRITICAL: Failed to download audio: {e}")
            print("[Bot] Fallback: Generating loud noise so connection doesn't drop.")
            self.audio_buffer = os.urandom(SAMPLE_RATE * 2)

    def _format_private_key(self, key_str):
        if not key_str:
            return None
        if "\\n" in key_str:
            key_str = key_str.replace("\\n", "\n")
        return key_str.strip()

    def generate_token(self, invalid_signature=False):
        now = datetime.now(timezone.utc)
        payload = {
            "iss": "zoom-rtms-service",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "aud": "python-backend",
            "zoom_host_id": self.host_id,
        }

        if invalid_signature:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric import rsa

            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            pem = key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            return jwt.encode(payload, pem, algorithm="RS256")

        if not self.private_key:
            raise ValueError("PRIVATE_KEY not found or invalid.")

        return jwt.encode(payload, self.private_key, algorithm="RS256")

    async def connect(self, reconnect=False, invalid_auth=False):
        if not self.websocket_url:
            raise ValueError("Missing websocket_url.")

        try:
            token = self.generate_token(invalid_signature=invalid_auth)
        except Exception as e:
            print(f"Token generation failed: {e}")
            return False

        url = f"{self.websocket_url.rstrip('/')}/zoom/{self.meeting_uuid}"
        headers = {"Authorization": f"Bearer {token}"}

        self.session = aiohttp.ClientSession()
        try:
            self.ws = await self.session.ws_connect(url, headers=headers)
            self.is_connected = True

            msg_type = "session_reconnected" if reconnect else "session_start"
            await self.ws.send_json(
                {
                    "type": msg_type,
                    "payload": {
                        "meeting_uuid": self.meeting_uuid,
                        "streamId": self.stream_id,
                        "workerPid": 9999,
                    },
                }
            )
            return True
        except Exception as e:
            if self.session:
                await self.session.close()
            return False

    async def send_audio_chunk(self):
        if not self.ws or self.ws.closed:
            return

        end_pos = self.audio_cursor + CHUNK_SIZE
        chunk_data = self.audio_buffer[self.audio_cursor : end_pos]

        if len(chunk_data) < CHUNK_SIZE:
            remainder = CHUNK_SIZE - len(chunk_data)
            chunk_data += self.audio_buffer[:remainder]
            self.audio_cursor = remainder
        else:
            self.audio_cursor = end_pos

        encoded = base64.b64encode(chunk_data).decode("utf-8")

        await self.ws.send_json({"userName": self.user_name, "audio": encoded})

    async def run_for(self, seconds):
        end_time = asyncio.get_event_loop().time() + seconds

        while asyncio.get_event_loop().time() < end_time:
            if not self.ws or self.ws.closed:
                break

            loop_start = asyncio.get_event_loop().time()

            await self.send_audio_chunk()

            elapsed = asyncio.get_event_loop().time() - loop_start
            remaining_wait = CHUNK_DURATION - elapsed

            if remaining_wait > 0:
                try:
                    msg = await self.ws.receive(timeout=remaining_wait)
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        self.received_messages.append(msg.data)
                        print(f"[Bot] RX: {msg.data}")
                    elif msg.type in (
                        aiohttp.WSMsgType.CLOSED,
                        aiohttp.WSMsgType.ERROR,
                    ):
                        self.is_connected = False
                        break
                except asyncio.TimeoutError:
                    continue
            else:
                await asyncio.sleep(0.001)

    async def close(self):
        if self.ws and not self.ws.closed:
            await self.ws.send_json({"type": "session_end"})
            await asyncio.sleep(0.2)
            await self.ws.close()

        if self.session:
            await self.session.close()
