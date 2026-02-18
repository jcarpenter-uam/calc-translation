# Test Suite

This suite is split into:

- `test_bot_unit.py`: fast unit coverage for bot behavior (no network required)
- `test_functional.py`, `test_auth.py`, `test_latency.py`: staging integration coverage
- `test_stability.py`: staging stress/load coverage

## Required staging environment variables

- `STAGING_BASE_DOMAIN` (example: `staging.example.com` or `https://staging.example.com`)
- `PRIVATE_KEY` (or `ZM_PRIVATE_KEY`)
- `JWT_SECRET_KEY` (required for viewer/latency tests)

By default the suite refuses localhost URLs. For local-only runs, set:

- `ALLOW_LOCAL_TEST_URLS=true`

## Stress test tuning

- `STRESS_BOT_COUNTS` comma-separated staged load levels after baseline (default: `5,10,20,40,60`)
- `STRESS_DURATION_SECONDS` per-stage load duration in seconds (default: `30`)
- `STRESS_LATENCY_INCREASE_PCT` threshold increase from baseline latency where test reports breakpoint (default: `50`)
- `STRESS_PROBE_TIMEOUT_SECONDS` max wait for probe transcript event (default: `90`)
- `STRESS_SOAK_SECONDS` soak-test runtime for long stability test (default: `180`)
- `SOAK_MAX_MEMORY_INCREASE_PCT` allowed RSS increase during soak test (default: `60`)

## Example commands

```bash
# unit only
./tests/venv/bin/pytest -q tests/test_bot_unit.py

# full staging integration + stress
./tests/venv/bin/pytest -q tests -m "integration or stress"

# all tests
./tests/venv/bin/pytest -q tests
```
