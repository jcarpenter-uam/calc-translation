import asyncio
import base64
import json
import os
import time
from datetime import datetime, timedelta, timezone

import aiohttp
import jwt
import pytest

from lib.bot import CHUNK_DURATION, CHUNK_SIZE, ZoomRTMSBot


pytestmark = pytest.mark.integration


def generate_viewer_tokens(user_id, session_id):
    jwt_secret_key = os.getenv("JWT_SECRET_KEY")
    if not jwt_secret_key:
        raise RuntimeError("JWT_SECRET_KEY is required for latency/viewer tests")

    now = datetime.now(timezone.utc)
    cookie_payload = {
        "iss": "calc-translation-service",
        "iat": now,
        "exp": now + timedelta(hours=1),
        "sub": user_id,
        "aud": "web-desktop-client",
    }
    cookie_token = jwt.encode(cookie_payload, jwt_secret_key, algorithm="HS256")

    query_payload = {
        "iss": "calc-translation-service",
        "iat": now,
        "exp": now + timedelta(hours=1),
        "sub": user_id,
        "resource": session_id,
        "aud": "web-desktop-client",
    }
    query_token = jwt.encode(query_payload, jwt_secret_key, algorithm="HS256")

    return cookie_token, query_token


async def send_silence_chunk(bot):
    """Sends a single chunk of silence (zeros) to the server."""
    if bot.ws and not bot.ws.closed:
        silence = bytes(CHUNK_SIZE)
        encoded = base64.b64encode(silence).decode("utf-8")
        await bot.ws.send_json({"userName": bot.user_name, "audio": encoded})


async def measure_time_to_first_partial(bot, viewer_ws, target_message_id, label):
    print(f"\n[Test] Starting {label} (Target: {target_message_id})...")
    start_time = None
    response_time = None
    timeout = time.time() + 600

    while time.time() < timeout:
        await bot.send_audio_chunk()

        if start_time is None:
            start_time = time.time()

        try:
            msg = await viewer_ws.receive(timeout=CHUNK_DURATION)

            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)

                if data.get("type") == "status":
                    continue

                rx_id = data.get("message_id", "unknown")

                if rx_id == target_message_id:
                    response_time = time.time()
                    print(f"[Test] {label} MATCH: {msg.data[:100]}...")
                    break

            elif msg.type == aiohttp.WSMsgType.CLOSED:
                pytest.fail(f"Viewer connection closed during {label}")

        except asyncio.TimeoutError:
            continue

    if response_time is None:
        pytest.fail(f"Timed out waiting for {target_message_id}")

    return (response_time - start_time) * 1000


async def trigger_vad_finalization(bot, viewer_ws, target_message_id):
    """
    Sends silence to the bot while listening for the 'isfinalize: true' event.
    """
    print(f"[Test] Sending silence to trigger finalization of {target_message_id}...")

    start_time = time.time()
    while time.time() - start_time < 5.0:
        await send_silence_chunk(bot)

        try:
            msg = await viewer_ws.receive(timeout=CHUNK_DURATION)

            if msg.type == aiohttp.WSMsgType.TEXT:
                data = json.loads(msg.data)

                if data.get("message_id") == target_message_id:
                    if data.get("isfinalize") is True:
                        print(f"[Test] {target_message_id} Finalized! (Server is clear)")
                        return

        except asyncio.TimeoutError:
            continue

    print(f"[Test] Warning: Timed out waiting for finalization of {target_message_id}")


# Purpose: measure and compare cold-start latency vs warm-stream latency for first partials.
@pytest.mark.asyncio
async def test_cold_vs_hot_latency(transcribe_url, view_url):
    """
    Compare Cold vs Hot latency.
    Streams silence between utterances to force VAD to close Utterance 1.
    """
    bot = ZoomRTMSBot(websocket_url=transcribe_url)
    await bot.connect()
    await asyncio.sleep(0.5)

    user_id = "test-perf-user"
    session_id = bot.meeting_uuid
    cookie_token, query_token = generate_viewer_tokens(user_id, session_id)
    viewer_url = f"{view_url}/zoom/{session_id}?language=en&token={query_token}"

    async with aiohttp.ClientSession(cookies={"app_auth_token": cookie_token}) as session:
        async with session.ws_connect(viewer_url) as viewer_ws:
            print(f"[Test] Connected to {session_id}")

            cold_ms = await measure_time_to_first_partial(bot, viewer_ws, "1_en", "COLD START")

            await trigger_vad_finalization(bot, viewer_ws, "1_en")

            await asyncio.sleep(1)

            hot_ms = await measure_time_to_first_partial(bot, viewer_ws, "2_en", "HOT START")

            await bot.close()

            print("\n==========================================")
            print(" LATENCY COMPARISON (Cold vs Hot)")
            print("==========================================")
            print(f" Cold Start (1_en):   {cold_ms:.2f} ms")
            print(f" Hot Start  (2_en):   {hot_ms:.2f} ms")
            print(" ------------------------------------------")

            diff = cold_ms - hot_ms
            if diff > 0:
                print(f" RESULT: Hot was {diff:.2f}ms faster")
            else:
                print(f" RESULT: Hot was {abs(diff):.2f}ms slower")
            print("==========================================\n")
