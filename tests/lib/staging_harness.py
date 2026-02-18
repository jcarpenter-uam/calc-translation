import asyncio
import base64
import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp
import jwt

from lib.bot import CHUNK_DURATION, ZoomRTMSBot


def make_viewer_tokens(user_id: str, session_id: str) -> tuple[str, str]:
    jwt_secret_key = os.getenv("JWT_SECRET_KEY")
    if not jwt_secret_key:
        raise RuntimeError("JWT_SECRET_KEY is required for viewer tests")

    now = datetime.now(timezone.utc)
    cookie_payload = {
        "iss": "calc-translation-service",
        "iat": now,
        "exp": now + timedelta(hours=1),
        "sub": user_id,
        "aud": "web-desktop-client",
    }
    query_payload = {
        "iss": "calc-translation-service",
        "iat": now,
        "exp": now + timedelta(hours=1),
        "sub": user_id,
        "resource": session_id,
        "aud": "web-desktop-client",
    }

    cookie_token = jwt.encode(cookie_payload, jwt_secret_key, algorithm="HS256")
    query_token = jwt.encode(query_payload, jwt_secret_key, algorithm="HS256")
    return cookie_token, query_token


async def open_viewer_ws(
    view_url: str,
    session_id: str,
    language: str,
    user_id: str,
) -> tuple[aiohttp.ClientSession, aiohttp.ClientWebSocketResponse]:
    cookie_token, query_token = make_viewer_tokens(user_id=user_id, session_id=session_id)
    url = f"{view_url}/zoom/{session_id}?language={language}&token={query_token}"
    session = aiohttp.ClientSession(cookies={"app_auth_token": cookie_token})
    try:
        ws = await session.ws_connect(url)
        return session, ws
    except Exception:
        await session.close()
        raise


async def wait_for_transcript(
    ws: aiohttp.ClientWebSocketResponse,
    timeout_seconds: int = 30,
) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        timeout = max(min(CHUNK_DURATION, deadline - time.time()), 0.05)
        try:
            msg = await ws.receive(timeout=timeout)
        except asyncio.TimeoutError:
            continue

        if msg.type != aiohttp.WSMsgType.TEXT:
            continue

        data = json.loads(msg.data)
        if data.get("type") == "status":
            continue
        if data.get("message_id"):
            return data

    raise TimeoutError("Timed out waiting for transcript payload")


async def wait_for_matching_transcript(
    ws: aiohttp.ClientWebSocketResponse,
    predicate,
    timeout_seconds: int = 30,
) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        timeout = max(min(CHUNK_DURATION, deadline - time.time()), 0.05)
        try:
            msg = await ws.receive(timeout=timeout)
        except asyncio.TimeoutError:
            continue

        if msg.type != aiohttp.WSMsgType.TEXT:
            continue

        data = json.loads(msg.data)
        if data.get("type") == "status":
            continue
        if data.get("message_id") and predicate(data):
            return data

    raise TimeoutError("Timed out waiting for matching transcript payload")


async def collect_transcripts(
    ws: aiohttp.ClientWebSocketResponse,
    window_seconds: int,
) -> list[dict[str, Any]]:
    end = time.time() + window_seconds
    out: list[dict[str, Any]] = []
    while time.time() < end:
        timeout = max(min(CHUNK_DURATION, end - time.time()), 0.05)
        try:
            msg = await ws.receive(timeout=timeout)
        except asyncio.TimeoutError:
            continue

        if msg.type != aiohttp.WSMsgType.TEXT:
            continue

        data = json.loads(msg.data)
        if data.get("type") == "status":
            continue
        if data.get("message_id"):
            out.append(data)
    return out


async def close_viewer(session: aiohttp.ClientSession, ws: aiohttp.ClientWebSocketResponse):
    try:
        if not ws.closed:
            await ws.close()
    finally:
        await session.close()


async def send_silence(bot: ZoomRTMSBot, seconds: float = 4.0):
    if not bot.ws or bot.ws.closed:
        raise RuntimeError("Bot websocket is not open")

    silence_chunk = base64.b64encode(bytes(4096)).decode("utf-8")
    deadline = time.time() + seconds
    while time.time() < deadline:
        await bot.ws.send_json({"userName": bot.user_name, "audio": silence_chunk})
        await asyncio.sleep(CHUNK_DURATION)


async def run_bot_for(url: str, seconds: int, meeting_uuid: str | None = None, reconnect: bool = False) -> ZoomRTMSBot:
    bot = ZoomRTMSBot(websocket_url=url, meeting_uuid=meeting_uuid)
    connected = await bot.connect(reconnect=reconnect)
    if not connected:
        raise RuntimeError("Bot failed to connect")
    await bot.run_for(seconds)
    return bot


def parse_prometheus_metric(text: str, metric_name: str) -> float | None:
    for line in text.splitlines():
        if line.startswith(metric_name + " "):
            try:
                return float(line.split(" ", 1)[1].strip())
            except Exception:
                return None
    return None
