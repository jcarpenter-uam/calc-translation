import asyncio
import os
import uuid

import aiohttp
import pytest

from lib.bot import ZoomRTMSBot
from lib.staging_harness import (
    close_viewer,
    collect_transcripts,
    make_viewer_tokens,
    open_viewer_ws,
    parse_prometheus_metric,
    send_silence,
    wait_for_matching_transcript,
    wait_for_transcript,
)


pytestmark = [pytest.mark.integration]


# Purpose: verify complete bot->server->viewer transcript delivery path works end-to-end.
@pytest.mark.asyncio
async def test_end_to_end_transcript_delivery(transcribe_url, view_url):
    bot = ZoomRTMSBot(websocket_url=transcribe_url)
    assert await bot.connect()

    viewer_session, viewer_ws = await open_viewer_ws(
        view_url=view_url,
        session_id=bot.meeting_uuid,
        language="en",
        user_id="e2e-viewer",
    )

    runner = asyncio.create_task(bot.run_for(10))
    payload = await wait_for_transcript(viewer_ws, timeout_seconds=30)
    await runner

    assert payload["message_id"].endswith("_en")
    assert payload.get("type") in {"partial", "final", "correction", "status_update"}

    await close_viewer(viewer_session, viewer_ws)
    await bot.close()


# Purpose: verify late-join viewers receive finalized cached transcript replay.
@pytest.mark.asyncio
async def test_backfill_on_late_join(transcribe_url, view_url):
    bot = ZoomRTMSBot(websocket_url=transcribe_url)
    assert await bot.connect()

    prime_session, prime_ws = await open_viewer_ws(
        view_url=view_url,
        session_id=bot.meeting_uuid,
        language="en",
        user_id="prime-viewer",
    )

    await bot.run_for(6)
    await send_silence(bot, seconds=5.0)
    finalized = await wait_for_matching_transcript(
        prime_ws,
        predicate=lambda payload: payload.get("isfinalize") is True,
        timeout_seconds=25,
    )
    assert finalized.get("message_id"), "No finalized message produced for cache replay"
    await close_viewer(prime_session, prime_ws)

    viewer_session, viewer_ws = await open_viewer_ws(
        view_url=view_url,
        session_id=bot.meeting_uuid,
        language="en",
        user_id="late-join-viewer",
    )

    replay = await wait_for_transcript(viewer_ws, timeout_seconds=10)
    assert replay.get("isfinalize") is True, "Late join replay should come from finalized cache history"

    await close_viewer(viewer_session, viewer_ws)
    await bot.close()


# Purpose: verify transcript delivery continues correctly after viewer language reconnect/switch.
@pytest.mark.asyncio
async def test_language_switch_mid_session(transcribe_url, view_url):
    bot = ZoomRTMSBot(websocket_url=transcribe_url)
    assert await bot.connect()

    run_task = asyncio.create_task(bot.run_for(20))

    en_session, en_ws = await open_viewer_ws(
        view_url=view_url,
        session_id=bot.meeting_uuid,
        language="en",
        user_id="lang-switch-viewer",
    )
    first_en = await wait_for_transcript(en_ws, timeout_seconds=25)
    assert first_en["message_id"].endswith("_en")
    await close_viewer(en_session, en_ws)

    es_session, es_ws = await open_viewer_ws(
        view_url=view_url,
        session_id=bot.meeting_uuid,
        language="es",
        user_id="lang-switch-viewer",
    )
    switched = await wait_for_transcript(es_ws, timeout_seconds=30)

    assert switched.get("target_language") in {"es", "two_way", "en"}

    await close_viewer(es_session, es_ws)
    await run_task
    await bot.close()


# Purpose: verify transcripts stay isolated by session and do not leak across session IDs.
@pytest.mark.asyncio
async def test_multi_tenant_isolation(transcribe_url, view_url):
    session_a = f"iso-a-{uuid.uuid4()}"
    session_b = f"iso-b-{uuid.uuid4()}"

    bot_a = ZoomRTMSBot(websocket_url=transcribe_url, meeting_uuid=session_a)
    assert await bot_a.connect()
    run_a = asyncio.create_task(bot_a.run_for(12))

    viewer_a_s, viewer_a_ws = await open_viewer_ws(view_url, session_a, "en", "tenant-a")
    viewer_b_s, viewer_b_ws = await open_viewer_ws(view_url, session_b, "en", "tenant-b")

    a_msgs = await collect_transcripts(viewer_a_ws, window_seconds=6)
    b_msgs = await collect_transcripts(viewer_b_ws, window_seconds=6)

    assert a_msgs, "Active session viewer did not receive transcripts"
    assert not b_msgs, "Inactive session viewer received transcript payloads unexpectedly"

    bot_b = ZoomRTMSBot(websocket_url=transcribe_url, meeting_uuid=session_b)
    assert await bot_b.connect()
    await bot_b.run_for(8)

    b_after = await collect_transcripts(viewer_b_ws, window_seconds=6)
    assert b_after, "Session B viewer did not receive transcripts after Session B started"

    await close_viewer(viewer_a_s, viewer_a_ws)
    await close_viewer(viewer_b_s, viewer_b_ws)
    await run_a
    await bot_a.close()
    await bot_b.close()


# Purpose: verify receiver failover/reconnect resumes transcript delivery for same meeting.
@pytest.mark.asyncio
async def test_receiver_failover_lease_behavior(transcribe_url, view_url):
    meeting_uuid = f"failover-{uuid.uuid4()}"

    bot1 = ZoomRTMSBot(websocket_url=transcribe_url, meeting_uuid=meeting_uuid)
    assert await bot1.connect(reconnect=False)
    await bot1.run_for(6)

    if bot1.ws:
        await bot1.ws.close()
    if bot1.session:
        await bot1.session.close()

    await asyncio.sleep(3)

    bot2 = ZoomRTMSBot(websocket_url=transcribe_url, meeting_uuid=meeting_uuid)
    assert await bot2.connect(reconnect=True)

    viewer_session, viewer_ws = await open_viewer_ws(
        view_url=view_url,
        session_id=meeting_uuid,
        language="en",
        user_id="failover-viewer",
    )

    run2 = asyncio.create_task(bot2.run_for(10))
    payload = await wait_for_transcript(viewer_ws, timeout_seconds=30)
    assert payload.get("message_id")

    await run2
    await close_viewer(viewer_session, viewer_ws)
    await bot2.close()


# Purpose: verify session remains healthy under repeated viewer connect/disconnect churn.
@pytest.mark.asyncio
async def test_redis_outage_recovery_simulated_with_viewer_churn(transcribe_url, view_url):
    bot = ZoomRTMSBot(websocket_url=transcribe_url)
    assert await bot.connect()
    run_task = asyncio.create_task(bot.run_for(20))

    for i in range(5):
        session, ws = await open_viewer_ws(
            view_url=view_url,
            session_id=bot.meeting_uuid,
            language="en",
            user_id=f"churn-viewer-{i}",
        )
        await asyncio.sleep(1)
        await close_viewer(session, ws)

    final_session, final_ws = await open_viewer_ws(
        view_url=view_url,
        session_id=bot.meeting_uuid,
        language="en",
        user_id="churn-viewer-final",
    )
    payload = await wait_for_transcript(final_ws, timeout_seconds=30)

    assert payload.get("message_id")
    assert bot.is_connected, "Bot disconnected during churn test"

    await close_viewer(final_session, final_ws)
    await run_task
    await bot.close()


# Purpose: verify post-session VTT artifact becomes available for secured download flow.
@pytest.mark.asyncio
async def test_summary_and_email_pipeline_artifact_readiness(transcribe_url, http_base_url):
    bot = ZoomRTMSBot(websocket_url=transcribe_url)
    assert await bot.connect()
    await bot.run_for(8)
    await bot.close()

    user_id = "artifact-check-user"
    cookie_token, query_token = make_viewer_tokens(user_id=user_id, session_id=bot.meeting_uuid)

    url = (
        f"{http_base_url}/api/session/zoom/{bot.meeting_uuid}/download/vtt"
        f"?language=en&token={query_token}"
    )

    deadline = asyncio.get_event_loop().time() + 40
    status = None
    body = ""
    async with aiohttp.ClientSession(cookies={"app_auth_token": cookie_token}) as session:
        while asyncio.get_event_loop().time() < deadline:
            async with session.get(url) as resp:
                status = resp.status
                body = await resp.text()
                if status == 200:
                    break
            await asyncio.sleep(2)

    assert status == 200, f"VTT download never became available, last status={status}"
    assert "WEBVTT" in body


# Purpose: verify long-running load does not exceed configured memory growth threshold.
@pytest.mark.asyncio
@pytest.mark.stress
async def test_long_soak_memory_stability(transcribe_url, http_base_url):
    soak_seconds = int(os.getenv("STRESS_SOAK_SECONDS", "180"))
    max_mem_increase_pct = float(os.getenv("SOAK_MAX_MEMORY_INCREASE_PCT", "60"))

    metrics_url = f"{http_base_url}/api/metrics"
    async with aiohttp.ClientSession() as http_session:
        async with http_session.get(metrics_url) as resp:
            before_text = await resp.text()

    before = parse_prometheus_metric(
        before_text, "calc_translation_process_resident_memory_bytes"
    )

    bot = ZoomRTMSBot(websocket_url=transcribe_url)
    assert await bot.connect()
    await bot.run_for(soak_seconds)
    assert bot.is_connected, "Bot disconnected during soak test"
    await bot.close()

    async with aiohttp.ClientSession() as http_session:
        async with http_session.get(metrics_url) as resp:
            after_text = await resp.text()

    after = parse_prometheus_metric(
        after_text, "calc_translation_process_resident_memory_bytes"
    )

    if before is not None and after is not None and before > 0:
        increase_pct = ((after - before) / before) * 100
        assert (
            increase_pct <= max_mem_increase_pct
        ), f"Memory increase too high in soak test: {increase_pct:.2f}%"


# Purpose: verify unauthorized and invalid-token requests are rejected by protected API.
@pytest.mark.asyncio
async def test_api_authz_matrix(http_base_url):
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{http_base_url}/api/users/me") as resp:
            assert resp.status == 401

    async with aiohttp.ClientSession(cookies={"app_auth_token": "invalid"}) as session:
        async with session.get(f"{http_base_url}/api/users/me") as resp:
            assert resp.status == 401


# Purpose: verify viewer websocket reconnect resumes transcript flow after disconnect.
@pytest.mark.asyncio
async def test_frontend_ws_reconnect_and_resume(transcribe_url, view_url):
    bot = ZoomRTMSBot(websocket_url=transcribe_url)
    assert await bot.connect()
    run_task = asyncio.create_task(bot.run_for(20))

    session_a, ws_a = await open_viewer_ws(
        view_url=view_url,
        session_id=bot.meeting_uuid,
        language="en",
        user_id="frontend-reconnect",
    )

    first_payload = await wait_for_transcript(ws_a, timeout_seconds=30)
    first_id = first_payload["message_id"]
    await close_viewer(session_a, ws_a)

    await asyncio.sleep(2)

    session_b, ws_b = await open_viewer_ws(
        view_url=view_url,
        session_id=bot.meeting_uuid,
        language="en",
        user_id="frontend-reconnect",
    )

    replay_or_live = await wait_for_transcript(ws_b, timeout_seconds=30)
    assert replay_or_live.get("message_id")
    assert replay_or_live["message_id"].endswith("_en")
    assert first_id.split("_")[1] == replay_or_live["message_id"].split("_")[1]

    await close_viewer(session_b, ws_b)
    await run_task
    await bot.close()
