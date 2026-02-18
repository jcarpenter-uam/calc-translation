import asyncio
import json
import os
import time
from datetime import datetime, timedelta, timezone

import aiohttp
import jwt
import pytest

from lib.bot import CHUNK_DURATION, ZoomRTMSBot


pytestmark = [pytest.mark.integration, pytest.mark.stress]


def _viewer_tokens(session_id: str) -> tuple[str, str]:
    jwt_secret_key = os.getenv("JWT_SECRET_KEY")
    if not jwt_secret_key:
        raise RuntimeError("JWT_SECRET_KEY is required for stress latency tests")

    now = datetime.now(timezone.utc)
    user_id = "stress-probe-user"

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


async def _measure_first_partial_latency_ms(transcribe_url: str, view_url: str) -> float:
    probe_bot = ZoomRTMSBot(websocket_url=transcribe_url, user_name="Latency Probe")
    connected = await probe_bot.connect()
    if not connected:
        raise RuntimeError("Probe bot could not connect")

    cookie_token, query_token = _viewer_tokens(probe_bot.meeting_uuid)
    viewer_url = f"{view_url}/zoom/{probe_bot.meeting_uuid}?language=en&token={query_token}"

    timeout_seconds = int(os.getenv("STRESS_PROBE_TIMEOUT_SECONDS", "90"))
    deadline = time.time() + timeout_seconds
    start_time = None

    try:
        async with aiohttp.ClientSession(cookies={"app_auth_token": cookie_token}) as session:
            async with session.ws_connect(viewer_url) as viewer_ws:
                while time.time() < deadline:
                    await probe_bot.send_audio_chunk()
                    if start_time is None:
                        start_time = time.time()

                    try:
                        msg = await viewer_ws.receive(timeout=CHUNK_DURATION)
                    except asyncio.TimeoutError:
                        continue

                    if msg.type == aiohttp.WSMsgType.TEXT:
                        data = json.loads(msg.data)
                        if data.get("type") == "status":
                            continue
                        if data.get("message_id") == "1_en":
                            return (time.time() - start_time) * 1000
                    if msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        break
    finally:
        await probe_bot.close()

    raise RuntimeError("Timed out waiting for first partial transcript on probe session")


async def _run_load_bots(transcribe_url: str, bot_count: int, duration_seconds: int) -> tuple[list[ZoomRTMSBot], int]:
    bots = [ZoomRTMSBot(websocket_url=transcribe_url, user_name=f"Load Bot {i}") for i in range(bot_count)]
    connect_results = await asyncio.gather(*[b.connect() for b in bots])
    connected_bots = [b for b, ok in zip(bots, connect_results) if ok]

    if len(connected_bots) != bot_count:
        await asyncio.gather(*[b.close() for b in connected_bots])
        raise RuntimeError(f"Only {len(connected_bots)}/{bot_count} load bots connected")

    try:
        await asyncio.gather(*[b.run_for(duration_seconds) for b in connected_bots])
        active_count = sum(1 for b in connected_bots if b.is_connected)
        return connected_bots, active_count
    finally:
        await asyncio.gather(*[b.close() for b in connected_bots])


# Purpose: find staged load level where latency increase exceeds configured threshold.
@pytest.mark.asyncio
async def test_staged_stress_latency_breakpoint(transcribe_url, view_url, stress_bot_counts, stress_duration_seconds):
    """
    Stage 1: establish baseline latency with one bot.
    Then run staged load profiles and stop once latency increase crosses threshold.
    """
    threshold_pct = float(os.getenv("STRESS_LATENCY_INCREASE_PCT", "50"))

    baseline_ms = await _measure_first_partial_latency_ms(transcribe_url, view_url)
    print(f"[Stress] Baseline latency with 1 bot: {baseline_ms:.2f} ms")

    breakpoint_bots = None
    breakpoint_latency_ms = None

    for bot_count in stress_bot_counts:
        print(f"[Stress] Stage: {bot_count} load bots for {stress_duration_seconds}s")

        load_task = asyncio.create_task(
            _run_load_bots(
                transcribe_url=transcribe_url,
                bot_count=bot_count,
                duration_seconds=stress_duration_seconds,
            )
        )

        await asyncio.sleep(1)
        stage_latency_ms = await _measure_first_partial_latency_ms(transcribe_url, view_url)
        _, active_count = await load_task

        increase_pct = ((stage_latency_ms - baseline_ms) / baseline_ms) * 100 if baseline_ms > 0 else 0.0
        print(
            "[Stress] "
            f"bots={bot_count} "
            f"latency={stage_latency_ms:.2f}ms "
            f"increase={increase_pct:.2f}% "
            f"active_after_stage={active_count}/{bot_count}"
        )

        if increase_pct >= threshold_pct:
            breakpoint_bots = bot_count
            breakpoint_latency_ms = stage_latency_ms
            print(
                "[Stress] Latency threshold reached at "
                f"{breakpoint_bots} bots (latency={breakpoint_latency_ms:.2f}ms, threshold={threshold_pct:.2f}%)."
            )
            break

    if breakpoint_bots is None:
        print(
            "[Stress] Threshold was not reached in configured stages. "
            f"Highest stage tested: {stress_bot_counts[-1]} bots."
        )
