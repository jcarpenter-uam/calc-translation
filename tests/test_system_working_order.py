import os

import aiohttp
import pytest

from lib.bot import ZoomRTMSBot
from lib.staging_harness import parse_prometheus_metric


pytestmark = [pytest.mark.integration]


# Purpose: verify unauthorized and invalid-token requests are rejected by protected API.
@pytest.mark.asyncio
async def test_api_authz_matrix(http_base_url):
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{http_base_url}/api/users/me") as resp:
            assert resp.status == 401

    async with aiohttp.ClientSession(cookies={"app_auth_token": "invalid"}) as session:
        async with session.get(f"{http_base_url}/api/users/me") as resp:
            assert resp.status == 401


# Purpose: verify long-running load does not exceed configured memory growth threshold.
@pytest.mark.asyncio
@pytest.mark.stress
async def test_long_soak_memory_stability(
    transcribe_url,
    http_base_url,
    session_ram_baseline_bytes,
):
    soak_seconds = int(os.getenv("STRESS_SOAK_SECONDS", "180"))
    max_residual_growth_pct = float(os.getenv("SOAK_MAX_MEMORY_INCREASE_PCT", "10"))

    metrics_url = f"{http_base_url}/api/metrics"
    baseline = float(session_ram_baseline_bytes)

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

    if after is not None and baseline > 0:
        increase_pct = ((after - baseline) / baseline) * 100
        assert (
            increase_pct <= max_residual_growth_pct
        ), (
            "Residual memory growth too high after soak run: "
            f"{increase_pct:.2f}% (baseline={baseline:.0f}, after={after:.0f})"
        )
