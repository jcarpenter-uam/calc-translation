# Test Suite

This suite is split into:

- `test_auth.py`: security authentication checks
- `test_latency.py`: latency performance checks
- `test_stability.py`: staged stress + SLO checks
- `test_system_working_order.py`: additional security/stress checks

## Required staging environment variables

- `STAGING_BASE_DOMAIN` (example: `staging.example.com` or `https://staging.example.com`)
- `PRIVATE_KEY` (or `ZM_PRIVATE_KEY`)
- `JWT_SECRET_KEY` (required for viewer/latency tests)

By default the suite refuses localhost URLs. For local-only runs, set:

- `ALLOW_LOCAL_TEST_URLS=true`

## Stress test tuning

- Stage/SLO parameters for `tests/test_stability.py` are hardcoded directly in that file.
- `STRESS_SOAK_SECONDS` soak-test runtime for long stability test (default: `180`)
- `SOAK_MAX_MEMORY_INCREASE_PCT` allowed RSS increase during soak test (default: `60`)

## Stage SLO gates

- Stage SLO thresholds for `tests/test_stability.py` are hardcoded directly in that file.

## Example commands

```bash
# security only
./tests/venv/bin/pytest -q tests/test_auth.py tests/test_system_working_order.py::test_api_authz_matrix

# latency only
./tests/venv/bin/pytest -q tests/test_latency.py -s

# stress only
./tests/venv/bin/pytest -q tests/test_stability.py tests/test_system_working_order.py::test_long_soak_memory_stability -s

# all tests
./tests/venv/bin/pytest -q tests
```
