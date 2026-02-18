import asyncio

import pytest

from lib.bot import ZoomRTMSBot


pytestmark = pytest.mark.integration


# Purpose: validate core connect/stream/disconnect flow remains stable for a single session.
@pytest.mark.asyncio
async def test_smoke_connection(transcribe_url):
    """
    Smoke Test: Can a single bot connect, send audio, and disconnect gracefully?
    """
    bot = ZoomRTMSBot(websocket_url=transcribe_url)
    connected = await bot.connect()
    assert connected, "Bot failed to connect to WebSocket"

    await bot.run_for(10)

    assert bot.is_connected, "Bot disconnected unexpectedly during run"
    await bot.close()


# Purpose: validate reconnect handoff works for the same meeting after connection loss.
@pytest.mark.asyncio
async def test_reconnection_logic(transcribe_url):
    """
    Feature Test: Verify that the 'session_reconnected' logic works.
    Simulates a worker crashing and coming back up.
    """
    meeting_uuid = "test-failover-uuid"

    bot1 = ZoomRTMSBot(meeting_uuid=meeting_uuid, websocket_url=transcribe_url)
    await bot1.connect(reconnect=False)
    await bot1.run_for(15)

    if bot1.ws:
        await bot1.ws.close()
    if bot1.session:
        await bot1.session.close()

    await asyncio.sleep(5)
    bot2 = ZoomRTMSBot(meeting_uuid=meeting_uuid, websocket_url=transcribe_url)
    connected = await bot2.connect(reconnect=True)

    assert connected, "Bot failed to reconnect after drop"
    await bot2.run_for(15)
    assert bot2.is_connected, "Reconnected bot dropped unexpectedly"
    await bot2.close()


# Purpose: validate forced websocket closure does not break cleanup/shutdown behavior.
@pytest.mark.asyncio
async def test_cleanup_logic(transcribe_url):
    """
    Feature Test: Verify that forced WebSocket closure is handled and cleanup works.
    """
    meeting_uuid = "test-cleanup-uuid"

    bot = ZoomRTMSBot(meeting_uuid=meeting_uuid, websocket_url=transcribe_url)
    await bot.connect(reconnect=False)
    await bot.run_for(5)

    if bot.ws:
        await bot.ws.close()

    await asyncio.sleep(2)
    assert bot.ws is None or bot.ws.closed

    await bot.close()
