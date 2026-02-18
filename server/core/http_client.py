import httpx

_shared_http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    global _shared_http_client
    if _shared_http_client is None:
        _shared_http_client = httpx.AsyncClient()
    return _shared_http_client


async def init_http_client():
    global _shared_http_client
    if _shared_http_client is None:
        _shared_http_client = httpx.AsyncClient()


async def close_http_client():
    global _shared_http_client
    if _shared_http_client is not None:
        await _shared_http_client.aclose()
        _shared_http_client = None
