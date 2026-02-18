import os
from typing import Optional
from urllib.parse import urlparse


def _as_bool(value: Optional[str]) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _is_localhost(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def _resolve_ws_base_domain() -> str:
    raw = os.getenv("STAGING_BASE_DOMAIN")
    if not raw:
        raise RuntimeError(
            "Missing STAGING_BASE_DOMAIN. Set it to your staging domain "
            "(for example: staging.example.com)."
        )

    candidate = raw.strip().rstrip("/")
    if "://" not in candidate:
        candidate = f"https://{candidate}"

    parsed = urlparse(candidate)
    if not parsed.hostname:
        raise RuntimeError("STAGING_BASE_DOMAIN must contain a valid domain name")
    if parsed.path not in {"", "/"}:
        raise RuntimeError("STAGING_BASE_DOMAIN must only be a base domain (no path)")

    if parsed.scheme == "https":
        ws_scheme = "wss"
    elif parsed.scheme == "http":
        ws_scheme = "ws"
    elif parsed.scheme in {"ws", "wss"}:
        ws_scheme = parsed.scheme
    else:
        raise RuntimeError(
            "STAGING_BASE_DOMAIN must use http(s) or ws(s), or omit scheme"
        )

    host = parsed.netloc
    ws_base = f"{ws_scheme}://{host}"
    if _is_localhost(ws_base) and not _as_bool(os.getenv("ALLOW_LOCAL_TEST_URLS")):
        raise RuntimeError(
            "Refusing localhost staging domain. "
            "Set STAGING_BASE_DOMAIN to staging or set ALLOW_LOCAL_TEST_URLS=true for local-only runs."
        )
    return ws_base


def resolve_transcribe_url() -> str:
    return f"{_resolve_ws_base_domain()}/ws/transcribe"


def resolve_view_url() -> str:
    return f"{_resolve_ws_base_domain()}/ws/view"


def resolve_http_base_url() -> str:
    ws_base = _resolve_ws_base_domain()
    if ws_base.startswith("wss://"):
        return ws_base.replace("wss://", "https://", 1)
    if ws_base.startswith("ws://"):
        return ws_base.replace("ws://", "http://", 1)
    return ws_base


def resolve_stress_profiles() -> list[int]:
    raw = os.getenv("STRESS_BOT_COUNTS", "5,10,20,40,60")
    counts = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        count = int(token)
        if count <= 0:
            raise RuntimeError("STRESS_BOT_COUNTS values must be positive integers")
        counts.append(count)
    if not counts:
        raise RuntimeError("STRESS_BOT_COUNTS must include at least one integer value")
    return counts


def resolve_stress_duration_seconds() -> int:
    duration = int(os.getenv("STRESS_DURATION_SECONDS", "30"))
    if duration <= 0:
        raise RuntimeError("STRESS_DURATION_SECONDS must be > 0")
    return duration
