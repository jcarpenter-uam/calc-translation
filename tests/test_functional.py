import pytest
from lib.bot import ZoomRTMSBot


@pytest.mark.asyncio
async def test_smoke_connection():
    """
    Smoke Test: Can a single bot connect, send audio, and disconnect gracefully?
    """
    bot = ZoomRTMSBot()
    connected = await bot.connect()
    assert connected, "Bot failed to connect to WebSocket"

    await bot.run_for(2)

    assert bot.is_connected, "Bot disconnected unexpectedly during run"
    await bot.close()


@pytest.mark.asyncio
async def test_reconnection_logic():
    """
    Feature Test: Verify that the 'session_reconnected' logic works.
    Simulates a worker crashing and coming back up.
    """
    meeting_uuid = "test-failover-uuid"

    bot1 = ZoomRTMSBot(meeting_uuid=meeting_uuid)
    await bot1.connect(reconnect=False)
    await bot1.run_for(1)

    if bot1.ws:
        await bot1.ws.close()
    if bot1.session:
        await bot1.session.close()

    bot2 = ZoomRTMSBot(meeting_uuid=meeting_uuid)
    connected = await bot2.connect(reconnect=True)

    assert connected, "Bot failed to reconnect after drop"
    await bot2.run_for(1)
    await bot2.close()
