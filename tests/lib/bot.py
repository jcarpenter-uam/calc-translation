import asyncio
import base64
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

import aiohttp
import jwt

WEBSOCKET_URL = os.getenv("WEBSOCKET_URL", "ws://localhost:8000/ws/transcribe")
CHUNK_SIZE = 4096


class ZoomRTMSBot:
    def __init__(self, meeting_uuid=None, host_id=None, audio_file=None):
        self.meeting_uuid = meeting_uuid or f"test-{uuid.uuid4()}"
        self.host_id = host_id or f"host-{uuid.uuid4().hex[:8]}"
        self.stream_id = f"st_{uuid.uuid4().hex[:8]}"

        self.ws = None
        self.session = None
        self.received_messages = []
        self.is_connected = False
        self.audio_proc = None

        if audio_file:
            self.audio_file = audio_file
        else:
            self.audio_file = self._pick_random_audio_file()

        raw_key = os.getenv("PRIVATE_KEY", "")
        if not raw_key:
            raw_key = os.getenv("ZM_PRIVATE_KEY", "")
        self.private_key = self._format_private_key(raw_key)

    def _pick_random_audio_file(self):
        """Searches known directories for audio files and picks one at random."""
        search_paths = [
            "audio",
        ]

        valid_extensions = [".m4a", ".mp3", ".wav", ".mp4", ".mkv"]
        found_files = []

        for path in search_paths:
            if os.path.exists(path):
                for root, dirs, files in os.walk(path):
                    for file in files:
                        if any(file.lower().endswith(ext) for ext in valid_extensions):
                            found_files.append(os.path.join(root, file))

        if found_files:
            selected = random.choice(found_files)
            return selected

        return None

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
        try:
            token = self.generate_token(invalid_signature=invalid_auth)
        except Exception as e:
            print(f"Token generation failed: {e}")
            return False

        url = f"{WEBSOCKET_URL.rstrip('/')}/zoom/{self.meeting_uuid}"
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

    async def _start_ffmpeg(self):
        if not self.audio_file or not os.path.exists(self.audio_file):
            return

        self.audio_proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-i",
            self.audio_file,
            "-f",
            "s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-loglevel",
            "quiet",
            "-",
            stdout=asyncio.subprocess.PIPE,
        )

    async def send_audio_chunk(self):
        if not self.ws or self.ws.closed:
            return

        if self.audio_file:
            if not self.audio_proc:
                await self._start_ffmpeg()

            try:
                if self.audio_proc and self.audio_proc.stdout:
                    audio_data = await self.audio_proc.stdout.read(CHUNK_SIZE)
                    if len(audio_data) == 0:
                        try:
                            self.audio_proc.terminate()
                        except:
                            pass
                        await self._start_ffmpeg()
                        if self.audio_proc and self.audio_proc.stdout:
                            audio_data = await self.audio_proc.stdout.read(CHUNK_SIZE)
                        else:
                            audio_data = bytes(CHUNK_SIZE)
                else:
                    audio_data = bytes(CHUNK_SIZE)
            except Exception:
                audio_data = bytes(CHUNK_SIZE)
        else:
            audio_data = os.urandom(CHUNK_SIZE)

        encoded = base64.b64encode(audio_data).decode("utf-8")
        await self.ws.send_json({"userName": "Test Bot", "audio": encoded})

    async def run_for(self, seconds):
        end_time = asyncio.get_event_loop().time() + seconds
        while asyncio.get_event_loop().time() < end_time:
            if not self.ws or self.ws.closed:
                break

            await self.send_audio_chunk()

            try:
                msg = await self.ws.receive(timeout=0.1)
                if msg.type == aiohttp.WSMsgType.TEXT:
                    self.received_messages.append(msg.data)
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    self.is_connected = False
                    break
            except asyncio.TimeoutError:
                continue

    async def close(self):
        if self.audio_proc:
            try:
                self.audio_proc.terminate()
                await self.audio_proc.wait()
            except:
                pass

        if self.ws and not self.ws.closed:
            await self.ws.send_json({"type": "session_end"})
            await asyncio.sleep(0.1)
            await self.ws.close()
        if self.session:
            await self.session.close()
