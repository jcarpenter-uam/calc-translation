import asyncio
import json
import time
import uuid
from datetime import datetime, timedelta, timezone

import aiohttp
import jwt
import pytest

from lib.bot import CHUNK_DURATION, ZoomRTMSBot


pytestmark = [pytest.mark.integration, pytest.mark.stress]

# Hardcoded staged load profile and SLO thresholds for deterministic stress runs.
BOT_STAGES = [5, 10, 20, 40, 60]
STAGE_DURATION_SECONDS = 30

PROBE_TIMEOUT_SECONDS = 90
PROBE_WINDOW_SECONDS = 10
PROBE_SAMPLES = 5

RECONNECT_ATTEMPTS = 3
RECONNECT_RUN_SECONDS = 4
RECONNECT_SETTLE_SECONDS = 2.0

SLO_P95_LATENCY_MS = 2500.0
SLO_MAX_ERROR_RATE_PCT = 5.0
SLO_MIN_RECONNECT_SUCCESS_RATE_PCT = 95.0
SLO_MAX_DROPPED_MESSAGE_RATE_PCT = 2.0


def _viewer_tokens(session_id: str, user_id: str) -> tuple[str, str]:
    import os
    jwt_secret_key = os.getenv("JWT_SECRET_KEY")
    if not jwt_secret_key:
        raise RuntimeError("JWT_SECRET_KEY is required for stress latency tests")

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


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        raise ValueError("Cannot compute percentile for empty list")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]

    rank = (pct / 100.0) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _dropped_message_rate(final_ids: list[str]) -> float:
    nums: list[int] = []
    for msg_id in final_ids:
        try:
            num = int(msg_id.split("_", 1)[0])
            nums.append(num)
        except Exception:
            continue

    unique_sorted = sorted(set(nums))
    if len(unique_sorted) < 2:
        return 0.0

    expected = unique_sorted[-1] - unique_sorted[0] + 1
    if expected <= 0:
        return 0.0

    missing = expected - len(unique_sorted)
    if missing <= 0:
        return 0.0
    return (missing / expected) * 100.0


async def _measure_probe_metrics(transcribe_url: str, view_url: str) -> dict[str, float]:
    user_id = f"stress-probe-{uuid.uuid4().hex[:8]}"
    probe_bot = ZoomRTMSBot(websocket_url=transcribe_url, user_name="SLO Probe")
    connected = await probe_bot.connect()
    if not connected:
        raise RuntimeError("Probe bot could not connect")

    cookie_token, query_token = _viewer_tokens(probe_bot.meeting_uuid, user_id)
    viewer_url = f"{view_url}/zoom/{probe_bot.meeting_uuid}?language=en&token={query_token}"

    first_latency_ms: float | None = None
    final_ids: list[str] = []
    start_send_time: float | None = None
    collection_deadline: float | None = None
    absolute_deadline = time.time() + PROBE_TIMEOUT_SECONDS

    try:
        async with aiohttp.ClientSession(cookies={"app_auth_token": cookie_token}) as session:
            async with session.ws_connect(viewer_url) as viewer_ws:
                while time.time() < absolute_deadline:
                    await probe_bot.send_audio_chunk()
                    if start_send_time is None:
                        start_send_time = time.time()

                    try:
                        msg = await viewer_ws.receive(timeout=CHUNK_DURATION)
                    except asyncio.TimeoutError:
                        continue

                    if msg.type == aiohttp.WSMsgType.TEXT:
                        data = json.loads(msg.data)
                        if data.get("type") == "status":
                            continue

                        msg_id = data.get("message_id")
                        if not msg_id:
                            continue

                        if first_latency_ms is None and start_send_time is not None:
                            first_latency_ms = (time.time() - start_send_time) * 1000.0
                            collection_deadline = time.time() + PROBE_WINDOW_SECONDS

                        if data.get("isfinalize") is True:
                            final_ids.append(msg_id)

                        if collection_deadline is not None and time.time() >= collection_deadline:
                            break

                    elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        break
    finally:
        await probe_bot.close()

    if first_latency_ms is None:
        raise RuntimeError("Timed out waiting for probe first transcript")

    return {
        "latency_ms": first_latency_ms,
        "dropped_message_rate_pct": _dropped_message_rate(final_ids),
        "finalized_messages": float(len(final_ids)),
    }


async def _run_load_bots(transcribe_url: str, bot_count: int, duration_seconds: int) -> dict[str, int]:
    bots = [ZoomRTMSBot(websocket_url=transcribe_url, user_name=f"Load Bot {i}") for i in range(bot_count)]
    connect_results = await asyncio.gather(*[b.connect() for b in bots])
    connected_bots = [b for b, ok in zip(bots, connect_results) if ok]

    connect_failures = bot_count - len(connected_bots)

    try:
        await asyncio.gather(*[b.run_for(duration_seconds) for b in connected_bots])
        active_count = sum(1 for b in connected_bots if b.is_connected)
        runtime_drops = len(connected_bots) - active_count
        return {
            "requested": bot_count,
            "connected": len(connected_bots),
            "connect_failures": connect_failures,
            "runtime_drops": runtime_drops,
            "active_after_run": active_count,
        }
    finally:
        await asyncio.gather(*[b.close() for b in connected_bots])


async def _measure_reconnect_success(transcribe_url: str) -> dict[str, int]:
    successes = 0

    for _ in range(RECONNECT_ATTEMPTS):
        meeting_uuid = f"stress-reconnect-{uuid.uuid4()}"

        bot1 = ZoomRTMSBot(websocket_url=transcribe_url, meeting_uuid=meeting_uuid)
        if not await bot1.connect(reconnect=False):
            await bot1.close()
            continue

        await bot1.run_for(RECONNECT_RUN_SECONDS)

        if bot1.ws:
            await bot1.ws.close()
        if bot1.session:
            await bot1.session.close()

        await asyncio.sleep(RECONNECT_SETTLE_SECONDS)

        bot2 = ZoomRTMSBot(websocket_url=transcribe_url, meeting_uuid=meeting_uuid)
        ok = await bot2.connect(reconnect=True)
        if ok:
            successes += 1
            await bot2.run_for(2)

        await bot2.close()

    return {
        "attempts": RECONNECT_ATTEMPTS,
        "successes": successes,
        "failures": RECONNECT_ATTEMPTS - successes,
    }


# Purpose: enforce stage-by-stage SLO gates for p95 latency, error rate, reconnect success, and dropped-message rate.
@pytest.mark.asyncio
async def test_staged_load_slos(transcribe_url, view_url):
    for bot_count in BOT_STAGES:
        print(f"[SLO] Stage start: bots={bot_count}, duration={STAGE_DURATION_SECONDS}s")

        load_task = asyncio.create_task(
            _run_load_bots(
                transcribe_url=transcribe_url,
                bot_count=bot_count,
                duration_seconds=STAGE_DURATION_SECONDS,
            )
        )

        await asyncio.sleep(1)

        probe_latencies: list[float] = []
        probe_drop_rates: list[float] = []
        probe_failures = 0

        for _ in range(PROBE_SAMPLES):
            try:
                probe = await _measure_probe_metrics(transcribe_url, view_url)
                probe_latencies.append(probe["latency_ms"])
                probe_drop_rates.append(probe["dropped_message_rate_pct"])
            except Exception as exc:
                probe_failures += 1
                print(f"[SLO] Probe failed: {exc}")

        reconnect_stats = await _measure_reconnect_success(transcribe_url)
        load_stats = await load_task

        p95_latency = _percentile(probe_latencies, 95.0) if probe_latencies else float("inf")
        avg_drop_rate = (
            sum(probe_drop_rates) / len(probe_drop_rates)
            if probe_drop_rates
            else 100.0
        )

        total_ops = (
            load_stats["requested"]
            + PROBE_SAMPLES
            + reconnect_stats["attempts"]
        )
        total_errors = (
            load_stats["connect_failures"]
            + load_stats["runtime_drops"]
            + probe_failures
            + reconnect_stats["failures"]
        )
        error_rate_pct = (total_errors / total_ops) * 100.0 if total_ops > 0 else 100.0

        reconnect_success_rate_pct = (
            (reconnect_stats["successes"] / reconnect_stats["attempts"]) * 100.0
            if reconnect_stats["attempts"] > 0
            else 0.0
        )

        print(
            "[SLO] "
            f"stage={bot_count} "
            f"p95_latency_ms={p95_latency:.2f} "
            f"error_rate_pct={error_rate_pct:.2f} "
            f"reconnect_success_rate_pct={reconnect_success_rate_pct:.2f} "
            f"dropped_message_rate_pct={avg_drop_rate:.2f}"
        )

        violations = []
        if p95_latency > SLO_P95_LATENCY_MS:
            violations.append(
                f"p95 latency {p95_latency:.2f}ms > {SLO_P95_LATENCY_MS:.2f}ms"
            )
        if error_rate_pct > SLO_MAX_ERROR_RATE_PCT:
            violations.append(
                f"error rate {error_rate_pct:.2f}% > {SLO_MAX_ERROR_RATE_PCT:.2f}%"
            )
        if reconnect_success_rate_pct < SLO_MIN_RECONNECT_SUCCESS_RATE_PCT:
            violations.append(
                f"reconnect success {reconnect_success_rate_pct:.2f}% < {SLO_MIN_RECONNECT_SUCCESS_RATE_PCT:.2f}%"
            )
        if avg_drop_rate > SLO_MAX_DROPPED_MESSAGE_RATE_PCT:
            violations.append(
                f"dropped message rate {avg_drop_rate:.2f}% > {SLO_MAX_DROPPED_MESSAGE_RATE_PCT:.2f}%"
            )

        assert not violations, (
            f"SLO violations at stage {bot_count} bots: " + "; ".join(violations)
        )
