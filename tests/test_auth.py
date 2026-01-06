import aiohttp
import pytest
from lib.bot import ZoomRTMSBot


@pytest.mark.asyncio
async def test_invalid_signature():
    """
    Security Test: Ensure connection is rejected if JWT signature is wrong.
    """
    bot = ZoomRTMSBot()

    connected = await bot.connect(invalid_auth=True)

    if connected:
        if not bot.ws.closed:
            msg = await bot.ws.receive()
            assert msg.type in (
                aiohttp.WSMsgType.CLOSED,
                aiohttp.WSMsgType.CLOSE,
            ), "Server did not close connection for invalid token"
    else:
        assert not connected

    await bot.close()
