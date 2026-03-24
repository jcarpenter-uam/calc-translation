# AGENTS.md

This file guides coding agents working in `/home/jonah/projects/calc-translation-old`.

## Repo Overview

- Monorepo with three main areas:
- `server/`: FastAPI backend, SQLAlchemy models, Redis-backed session state, pytest suite.
- `clients/web/`: Vite + React web client.
- `clients/desktop/`: Electron + electron-vite + React desktop client.
- `integrations/zoom-rtms/`: small Node service for Zoom RTMS integration.

## Instruction Files Checked

- Existing `AGENTS.md`: none found before this file was created.
- Cursor rules in `.cursor/rules/`: none found.
- `.cursorrules`: none found.
- Copilot rules in `.github/copilot-instructions.md`: none found.

## General Working Rules

- Prefer minimal, targeted changes; keep existing architecture and naming.
- Do not rename `calender` paths/files unless explicitly asked; the misspelling is part of current API/module naming.
- Match the style of the area you edit rather than imposing a repo-wide rewrite.
- Preserve public API shapes and route paths unless the user asks for a breaking change.

## Build And Run Commands

### Root

- Coverage and performance gates live in the root `Makefile`.
- Run all important server gates: `make server-test-gates`
- Run deterministic TTFT gate: `make server-ttft-test`
- Run live Soniox TTFT gate: `make server-ttft-live`
- Run the full 100% production coverage gate: `make server-prod-coverage-100`

### Server

- Install deps: `cd server && python -m pip install -r requirements.txt && python -m pip install pytest pytest-asyncio pytest-cov`
- Main API test suite: `cd server && python -m pytest -q -c pytest.ini`
- Services coverage suite: `cd server && python -m pytest -q -c pytest-services.ini`
- Full coverage without default addopts: `cd server && python -m pytest -q -o addopts='' --cov=api --cov=core --cov=integrations --cov=main --cov=models --cov=services --cov-report=term-missing --cov-fail-under=100`
- Run a single test file: `cd server && python -m pytest -q tests/test_main.py`
- Run a single test function: `cd server && python -m pytest -q tests/test_main.py::test_serve_spa_returns_index_file`
- Run a single parametrized or async test with extra output: `cd server && python -m pytest -q -s tests/test_api_transcribe.py::test_transcribe_ttft_from_audio_to_first_soniox_token`
- Typical local dev server command: `cd server && PYTHONPATH=. uvicorn main:app --reload`

### Web Client

- Install deps: `cd clients/web && npm install`
- Dev server: `cd clients/web && npm run dev`
- Production build: `cd clients/web && npm run build`
- Lint: `cd clients/web && npm run lint`
- There is currently no frontend test runner configured in `clients/web/package.json`.

### Desktop Client

- Install deps: `cd clients/desktop && npm install`
- Electron dev mode: `cd clients/desktop && npm run dev`
- Production build: `cd clients/desktop && npm run build`
- Publish build: `cd clients/desktop && npm run publish`
- There is currently no lint or test script configured in `clients/desktop/package.json`.

### Zoom RTMS Integration

- Install deps: `cd integrations/zoom-rtms && npm install`
- Start service: `cd integrations/zoom-rtms && npm start`
- No dedicated lint or test script is configured here.

## Testing Notes

- Backend tests are the only first-class automated tests in this repo.
- `server/pytest.ini` enforces API coverage at 90%.
- `server/pytest-services.ini` enforces services coverage at 85%.
- CI also runs a deterministic TTFT websocket test and a 100% production-module coverage gate.
- Many backend tests use `monkeypatch`, lightweight fake sessions, and direct function/router calls instead of full integration harnesses.
- When changing frontend behavior, verify with build/lint because automated JS tests are not present.

## Architecture Notes

- Backend modules are organized by domain: `api/`, `core/`, `integrations/`, `models/`, `services/`.
- Routers are usually created with factory functions like `create_auth_router()` and then mounted in `server/main.py`.
- Shared runtime services are attached to `app.state` during startup.
- Desktop-specific native behavior lives in Electron `src/main/` IPC handlers and `src/preload/`.

## Code Style: Python Backend

- Use 4-space indentation and standard PEP 8 layout.
- Imports are grouped with stdlib first, then third-party, then local modules.
- Favor direct imports from local packages like `from core.config import settings`.
- Keep import ordering stable and readable; do not introduce wildcard imports.
- Use type hints where the surrounding code already uses them, especially for public helpers and request/response models.
- Pydantic models are used for request and response payloads; prefer explicit `BaseModel` classes for API contracts.
- SQLAlchemy queries are written inline near the endpoint or service using `select(...)` and async sessions.
- Keep functions async when they touch I/O, DB access, websockets, HTTP clients, or async service methods.
- Use module-level `logger = logging.getLogger(__name__)`.
- Log useful operational context like user IDs, session IDs, and platform type.
- For expected client errors, raise `HTTPException` with a clear status code and detail message.
- In endpoints, a common pattern is `except HTTPException as e: raise e` followed by broad exception logging and a 500 response.
- When catching broad exceptions, log with `exc_info=True` if the traceback is useful.
- Tests commonly use fakes from `server/tests/helpers.py`; reuse those instead of building heavy fixtures.

## Code Style: React / JS Clients

- JS/JSX uses double quotes and semicolons consistently.
- Prefer functional React components and hooks; no class components observed.
- Route/page components are often default exports; hooks/utilities are often named exports.
- Keep components focused and colocate related UI logic in hooks or nearby files.
- Use `useEffect`, `useMemo`, and `useCallback` in the existing style; do not over-memoize trivial values.
- Prefer early validation and `throw new Error(...)` in async flows, then surface the message in UI state.
- API helpers live in small utility modules such as `clients/web/src/lib/api-client.js`.
- Keep fetch helpers thin and reuse existing helpers before adding new ones.
- Use Tailwind utility classes directly in JSX; styling is largely inline via class strings.
- Use relative imports unless an area already has an alias configured; desktop renderer supports `@renderer` but much of the code still uses relative paths.
- Keep state variable names explicit: `isLoading`, `isSubmitting`, `reviewsError`, `setUsers`, etc.

## Naming Conventions

- Python files and modules use `snake_case`.
- React component files are often lowercase with hyphens, even when exporting PascalCase components.
- Python classes use `PascalCase`.
- React component function names use `PascalCase`.
- Hooks start with `use`.
- Internal variables and functions use `snake_case` in Python and `camelCase` in JS.
- Keep existing public field names such as `meetingId`, `joinUrl`, `sessionId`, and `language_code` exactly as their current layer expects.

## Formatting Expectations

- Keep lines readable rather than aggressively compact.
- Preserve blank lines between logical blocks.
- Do not reformat untouched files just for style cleanup.
- When adding comments or docstrings, make them practical and short.

## Error Handling Expectations

- Fail fast on invalid input.
- Return actionable error messages to callers and UI where possible.
- Log operational failures with enough context to debug production issues.
- Do not swallow exceptions silently.
- In frontend async handlers, set error state or return `{ status: "error", message }` in the existing IPC style.
- In Electron IPC handlers, keep the established pattern of returning structured status objects instead of crashing the process.

## Agent Checklist Before Finishing

- Run the narrowest relevant checks for the code you changed.
- For backend changes, prefer targeted pytest first, then broader suites if risk is higher.
- For web changes, run `npm run lint` and `npm run build` when possible.
- For desktop changes, run `npm run build` at minimum because no dedicated lint/test script exists.

## High-Value File References

- `Makefile`: root quality gates.
- `server/main.py`: FastAPI startup, shutdown, router mounting, SPA fallback.
- `server/tests/`: authoritative examples for backend behavior.
- `server/tests/helpers.py`: fake DB/session helpers for unit-style tests.
- `clients/web/package.json`: web scripts.
- `clients/desktop/package.json`: desktop scripts.
