import pytest

from lib.config import (
    resolve_http_base_url,
    resolve_stress_duration_seconds,
    resolve_stress_profiles,
    resolve_transcribe_url,
    resolve_view_url,
)


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
def stress_bot_counts() -> list[int]:
    return resolve_stress_profiles()


@pytest.fixture(scope="session")
def stress_duration_seconds() -> int:
    return resolve_stress_duration_seconds()


def pytest_configure(config):
    config.addinivalue_line("markers", "integration: requires staging environment connectivity and secrets")
    config.addinivalue_line("markers", "stress: long-running load tests against staging")
