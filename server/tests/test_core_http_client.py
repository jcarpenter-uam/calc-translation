import pytest

from core import http_client


class _FakeAsyncClient:
    def __init__(self):
        self.closed = False

    async def aclose(self):
        self.closed = True


def test_get_http_client_reuses_singleton(monkeypatch):
    created = []

    def factory():
        client = _FakeAsyncClient()
        created.append(client)
        return client

    monkeypatch.setattr(http_client.httpx, "AsyncClient", factory)
    monkeypatch.setattr(http_client, "_shared_http_client", None)

    first = http_client.get_http_client()
    second = http_client.get_http_client()

    assert first is second
    assert len(created) == 1


@pytest.mark.asyncio
async def test_init_and_close_http_client(monkeypatch):
    created = []

    def factory():
        client = _FakeAsyncClient()
        created.append(client)
        return client

    monkeypatch.setattr(http_client.httpx, "AsyncClient", factory)
    monkeypatch.setattr(http_client, "_shared_http_client", None)

    await http_client.init_http_client()
    assert len(created) == 1

    await http_client.close_http_client()
    assert created[0].closed is True
    assert http_client._shared_http_client is None


@pytest.mark.asyncio
async def test_close_http_client_noop_when_missing(monkeypatch):
    monkeypatch.setattr(http_client, "_shared_http_client", None)
    await http_client.close_http_client()
