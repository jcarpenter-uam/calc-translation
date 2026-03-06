import jwt
import pytest
from fastapi import WebSocketException

from core import security


@pytest.mark.asyncio
async def test_get_auth_token_from_header_paths():
    token = await security.get_auth_token_from_header("Bearer abc")
    assert token == "abc"

    with pytest.raises(WebSocketException):
        await security.get_auth_token_from_header(None)

    with pytest.raises(WebSocketException):
        await security.get_auth_token_from_header("Bad abc")


def test_validate_server_token_success(monkeypatch):
    monkeypatch.setattr(security.jwt, "decode", lambda *a, **k: {"sub": "u1"})
    out = security.validate_server_token("t")
    assert out["sub"] == "u1"


@pytest.mark.parametrize(
    "exc_type",
    [
        jwt.ExpiredSignatureError,
        jwt.InvalidIssuerError,
        jwt.InvalidAudienceError,
        jwt.InvalidTokenError,
    ],
)
def test_validate_server_token_error_paths(monkeypatch, exc_type):
    def bad_decode(*_args, **_kwargs):
        if exc_type is jwt.InvalidTokenError:
            raise exc_type("bad")
        raise exc_type()

    monkeypatch.setattr(security.jwt, "decode", bad_decode)

    with pytest.raises(WebSocketException):
        security.validate_server_token("bad")
