import jwt
import pytest

from lib.bot import CHUNK_SIZE, ZoomRTMSBot


class DummyWS:
    def __init__(self):
        self.closed = False
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)

    async def close(self):
        self.closed = True


class DummySession:
    def __init__(self):
        self.closed = False

    async def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def patch_audio_loader(monkeypatch):
    def _fake_prepare(self):
        self.audio_buffer = bytes(CHUNK_SIZE * 2)

    monkeypatch.setattr(ZoomRTMSBot, "_prepare_audio_data", _fake_prepare)


@pytest.fixture
def bot_with_private_key(monkeypatch):
    monkeypatch.setenv("PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----")
    return ZoomRTMSBot(websocket_url="wss://staging.example.com/ws/transcribe")


# Purpose: verify escaped newline keys are normalized into valid PEM content.
def test_private_key_formatting(monkeypatch):
    monkeypatch.setenv("PRIVATE_KEY", "line1\\nline2")
    bot = ZoomRTMSBot(websocket_url="wss://staging.example.com/ws/transcribe")
    assert bot.private_key == "line1\nline2"


# Purpose: verify token generation uses configured key material and RS256 signing.
def test_generate_token_uses_configured_key(monkeypatch, bot_with_private_key):
    bot = bot_with_private_key

    captured = {}

    def _fake_encode(payload, key, algorithm):
        captured["payload"] = payload
        captured["key"] = key
        captured["algorithm"] = algorithm
        return "token"

    monkeypatch.setattr(jwt, "encode", _fake_encode)
    token = bot.generate_token()

    assert token == "token"
    assert captured["key"] == bot.private_key
    assert captured["algorithm"] == "RS256"


# Purpose: verify invalid-signature mode still produces a token for negative auth tests.
def test_generate_token_invalid_signature(monkeypatch, bot_with_private_key):
    monkeypatch.delenv("PRIVATE_KEY", raising=False)
    token = bot_with_private_key.generate_token(invalid_signature=True)
    assert isinstance(token, str)


# Purpose: verify audio chunking wraps cursor correctly at buffer boundaries.
@pytest.mark.asyncio
async def test_send_audio_chunk_wraps_cursor(bot_with_private_key):
    bot = bot_with_private_key
    bot.ws = DummyWS()
    bot.audio_buffer = bytes(CHUNK_SIZE + 50)
    bot.audio_cursor = CHUNK_SIZE

    await bot.send_audio_chunk()

    assert len(bot.ws.sent) == 1
    assert bot.audio_cursor == CHUNK_SIZE - 50
    assert "audio" in bot.ws.sent[0]


# Purpose: verify close path sends session_end and closes websocket/session resources.
@pytest.mark.asyncio
async def test_close_sends_session_end_and_closes_resources(bot_with_private_key):
    bot = bot_with_private_key
    bot.ws = DummyWS()
    bot.session = DummySession()

    await bot.close()

    assert bot.ws.closed
    assert bot.session.closed
    assert bot.ws.sent[0]["type"] == "session_end"


# Purpose: verify connect fails fast when websocket URL is missing.
@pytest.mark.asyncio
async def test_connect_requires_websocket_url(monkeypatch):
    monkeypatch.setenv("PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----")
    bot = ZoomRTMSBot(websocket_url=None)
    bot.websocket_url = None

    with pytest.raises(ValueError, match="Missing websocket_url"):
        await bot.connect()
