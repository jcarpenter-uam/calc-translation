import asyncio

import pytest
from lib.bot import ZoomRTMSBot

CONCURRENT_BOTS = 50
DURATION_SECONDS = 60


@pytest.mark.asyncio
async def test_stability_load():
    """
    Load Test: Spawn N bots and ensure they all survive for T seconds.
    """
    bots = [ZoomRTMSBot() for _ in range(CONCURRENT_BOTS)]

    connect_tasks = [b.connect() for b in bots]
    connect_results = await asyncio.gather(*connect_tasks)

    successful_bots = [b for b, connected in zip(bots, connect_results) if connected]
    assert (
        len(successful_bots) == CONCURRENT_BOTS
    ), f"Only {len(successful_bots)}/{CONCURRENT_BOTS} connected"

    run_tasks = [b.run_for(DURATION_SECONDS) for b in successful_bots]
    await asyncio.gather(*run_tasks)

    active_count = sum(1 for b in successful_bots if b.is_connected)
    failure_rate = (CONCURRENT_BOTS - active_count) / CONCURRENT_BOTS

    close_tasks = [b.close() for b in successful_bots]
    await asyncio.gather(*close_tasks)

    assert (
        failure_rate < 0.10
    ), f"Too many bots dropped: {CONCURRENT_BOTS - active_count} failures"
