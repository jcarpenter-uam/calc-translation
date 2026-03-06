from datetime import timedelta
from types import SimpleNamespace

import jwt
import pytest
from cryptography.fernet import InvalidToken
from fastapi import HTTPException, WebSocketException

from core import authentication
from tests.helpers import FakeResult, fake_session_local


def test_generate_tokens(monkeypatch):
    captured = {}

    def fake_encode(payload, _secret, algorithm="HS256"):
        captured["payload"] = payload
        captured["algorithm"] = algorithm
        return "tok"

    monkeypatch.setattr(authentication.jwt, "encode", fake_encode)

    out = authentication.generate_jwt_token("u1", "s1", timedelta(minutes=5))
    assert out == "tok"
    assert captured["payload"]["sub"] == "u1"
    assert captured["payload"]["resource"] == "s1"

    out2 = authentication.generate_review_token("u2", "s2", timedelta(days=1))
    assert out2 == "tok"
    assert captured["payload"]["aud"] == "review-feedback"

    out3 = authentication.generate_jwt_token("u3")
    assert out3 == "tok"
    out4 = authentication.generate_review_token("u4")
    assert out4 == "tok"


@pytest.mark.asyncio
async def test_get_token_from_cookie_paths():
    req = SimpleNamespace(cookies={"app_auth_token": "abc"})
    assert await authentication.get_token_from_cookie(req) == "abc"

    with pytest.raises(HTTPException) as exc_info:
        await authentication.get_token_from_cookie(SimpleNamespace(cookies={}))
    assert exc_info.value.status_code == 401


def test_get_current_user_payload_paths(monkeypatch):
    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: {"iss": "calc-translation-service", "iat": 1, "exp": 2, "sub": "u1", "resource": "s1", "aud": "web-desktop-client"})
    payload = authentication.get_current_user_payload("tok")
    assert payload["sub"] == "u1"

    calls = {"n": 0}

    def expired_decode(token, *args, **kwargs):
        calls["n"] += 1
        if kwargs.get("options"):
            return {"sub": "u1"}
        raise jwt.ExpiredSignatureError()

    monkeypatch.setattr(authentication.jwt, "decode", expired_decode)
    with pytest.raises(HTTPException) as exc_info:
        authentication.get_current_user_payload("tok")
    assert exc_info.value.status_code == 401

    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: (_ for _ in ()).throw(jwt.InvalidTokenError("bad")))
    with pytest.raises(HTTPException) as exc_info2:
        authentication.get_current_user_payload("tok")
    assert exc_info2.value.status_code == 401


def test_validate_client_token_paths(monkeypatch):
    with pytest.raises(WebSocketException):
        authentication.validate_client_token("")

    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: {"sub": "u1", "resource": "s1"})
    assert authentication.validate_client_token("tok")["resource"] == "s1"

    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: {"sub": "u1"})
    with pytest.raises(WebSocketException):
        authentication.validate_client_token("tok")

    def expired_decode(_token, *args, **kwargs):
        if kwargs.get("options"):
            return {"sub": "u1", "resource": "s1"}
        raise jwt.ExpiredSignatureError()

    monkeypatch.setattr(authentication.jwt, "decode", expired_decode)
    with pytest.raises(WebSocketException):
        authentication.validate_client_token("tok")

    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: (_ for _ in ()).throw(jwt.InvalidIssuerError()))
    with pytest.raises(WebSocketException):
        authentication.validate_client_token("tok")

    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: (_ for _ in ()).throw(jwt.InvalidAudienceError()))
    with pytest.raises(WebSocketException):
        authentication.validate_client_token("tok")

    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: (_ for _ in ()).throw(jwt.InvalidTokenError("bad")))
    with pytest.raises(WebSocketException):
        authentication.validate_client_token("tok")


def test_validate_review_token_paths(monkeypatch):
    with pytest.raises(HTTPException):
        authentication.validate_review_token("")

    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: {"iss": "calc-translation-service", "iat": 1, "exp": 2, "sub": "u1", "resource": "s1", "aud": "review-feedback"})
    assert authentication.validate_review_token("tok")["sub"] == "u1"

    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: (_ for _ in ()).throw(jwt.ExpiredSignatureError()))
    with pytest.raises(HTTPException):
        authentication.validate_review_token("tok")

    monkeypatch.setattr(authentication.jwt, "decode", lambda *_a, **_k: (_ for _ in ()).throw(jwt.InvalidTokenError()))
    with pytest.raises(HTTPException):
        authentication.validate_review_token("tok")


def test_encrypt_decrypt_paths(monkeypatch):
    class Cipher:
        def encrypt(self, value):
            return b"enc-" + value

        def decrypt(self, value):
            if value == b"bad":
                raise InvalidToken()
            if value == b"err":
                raise RuntimeError("boom")
            return b"plain"

    monkeypatch.setattr(authentication, "_cipher_suite", Cipher())

    assert authentication.encrypt("abc") == "enc-abc"
    assert authentication.decrypt("good") == "plain"

    with pytest.raises(HTTPException):
        authentication.decrypt("bad")

    with pytest.raises(RuntimeError):
        authentication.decrypt("err")

    class BadCipher:
        def encrypt(self, _value):
            raise RuntimeError("enc boom")

    monkeypatch.setattr(authentication, "_cipher_suite", BadCipher())
    with pytest.raises(RuntimeError):
        authentication.encrypt("abc")


@pytest.mark.asyncio
async def test_get_admin_user_payload_paths(monkeypatch):
    with pytest.raises(HTTPException):
        await authentication.get_admin_user_payload(payload={})

    monkeypatch.setattr(
        authentication,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=None)),
    )
    with pytest.raises(HTTPException) as missing_user:
        await authentication.get_admin_user_payload(payload={"sub": "u1"})
    assert missing_user.value.status_code == 401

    monkeypatch.setattr(
        authentication,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=SimpleNamespace(is_admin=False))),
    )
    with pytest.raises(HTTPException) as not_admin:
        await authentication.get_admin_user_payload(payload={"sub": "u1"})
    assert not_admin.value.status_code == 403

    monkeypatch.setattr(
        authentication,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=SimpleNamespace(is_admin=True))),
    )
    out = await authentication.get_admin_user_payload(payload={"sub": "u1"})
    assert out["sub"] == "u1"
