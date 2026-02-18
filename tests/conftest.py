import json
from urllib.request import urlopen

import pytest

from lib.config import (
    resolve_http_base_url,
    resolve_stress_duration_seconds,
    resolve_stress_profiles,
    resolve_transcribe_url,
    resolve_view_url,
)
from lib.staging_harness import parse_prometheus_metric


@pytest.fixture(scope="session")
def transcribe_url() -> str:
    return resolve_transcribe_url()


@pytest.fixture(scope="session")
def view_url() -> str:
    return resolve_view_url()


@pytest.fixture(scope="session")
def http_base_url() -> str:
    return resolve_http_base_url()


@pytest.fixture(scope="session")
def session_ram_baseline_bytes(http_base_url: str) -> float:
    """
    Captures process RSS once near session start so late stability checks can
    detect residual memory growth after all test activity.
    """
    metrics_url = f"{http_base_url}/api/metrics"
    with urlopen(metrics_url, timeout=20) as response:
        raw = response.read().decode("utf-8")
    baseline = parse_prometheus_metric(
        raw, "calc_translation_process_resident_memory_bytes"
    )
    if baseline is None:
        raise RuntimeError("Could not read baseline RSS metric from /api/metrics")
    return baseline


@pytest.fixture(scope="session")
def stress_bot_counts() -> list[int]:
    return resolve_stress_profiles()


@pytest.fixture(scope="session")
def stress_duration_seconds() -> int:
    return resolve_stress_duration_seconds()


def pytest_configure(config):
    config.addinivalue_line("markers", "integration: requires staging environment connectivity and secrets")
    config.addinivalue_line("markers", "stress: long-running load tests against staging")
