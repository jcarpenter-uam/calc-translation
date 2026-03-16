# AGENTS.md

Guidance for autonomous coding agents working in this repository.

## Repository Snapshot

- Runtime: Bun + TypeScript (ESM) with Elysia.
- Entry point: `index.ts`.
- Main folders: `api/`, `controllers/`, `models/`, `core/`, `services/`, `middlewares/`, `tests/`.

## Rule Files (Cursor/Copilot)

- Checked for Cursor and Copilot instruction files:
  - `.cursorrules`
  - `.cursor/rules/`
  - `.github/copilot-instructions.md`
- Result: none found in this repository at time of writing.
- Therefore, this file and existing project code are the main agent guidance.

## Setup and Environment

- Install dependencies:
  - `bun install`
- Required runtime variables are validated in `core/config.ts`:
  - `PORT`
  - `NODE_ENV`
  - `BASE_URL`
  - `DATABASE_URL`
  - `ENCRYPTION_KEY`
  - `JWT_SECRET`
  - `SONIOX_API_KEY`
- If env validation fails, app exits at startup.
- `.env` is gitignored; do not commit secrets.

## Build / Lint / Test Commands

The project currently has minimal npm scripts; use Bun/CLI commands directly.

### Run the app

- Dev (watch mode): `bun run dev` (same as `bun --watch index.ts`)
- Normal run (no watch): `bun index.ts`

### Type-check / build quality gates

- Type-check only (recommended gate):
  - `bunx tsc --noEmit`
- There is no dedicated linter config (no ESLint/Biome/Prettier config found).
- Treat TypeScript strictness + tests as quality gates.

### Tests

- Run all tests:
  - `bun test`
- Run one test file:
  - `bun test tests/smoke.test.ts`
  - `bun test tests/rbac.test.ts`
- Run a single test by name pattern (important for targeted runs):
  - `bun test tests/rbac.test.ts --test-name-pattern "Super Admin can see all meetings"`
  - Short flag form: `bun test -t "Scenario A" tests/1U-5V.test.ts`
- Increase timeout for long integration/stress tests when needed:
  - `bun test tests/ttft.test.ts --timeout 120000`
- Useful focused flags:
  - `bun test --bail`
  - `bun test --only-failures`
  - `bun test --max-concurrency 1`

### Drizzle schema / migrations

- Generate migration after schema changes: `bunx drizzle-kit generate`
- Migration files are in `drizzle/`.
- App startup runs migrations automatically via `runMigrations()` in `index.ts`.

## Code Style and Conventions

These conventions are inferred from existing code and should be preserved.

### Imports

- Use ESM imports only.
- Prefer grouping as:
  1) external packages,
  2) internal modules,
  3) type imports (or inline `type` in import list).
- Keep relative import paths explicit (e.g., `../core/logger`).
- Avoid wildcard imports except where already idiomatic (`import * as fs from "fs"`).

### Formatting

- Use 2-space indentation.
- Prefer trailing commas in multiline arrays/objects/calls.
- Prefer double quotes for strings.
- Keep chained Elysia builders readable with multiline formatting.

### TypeScript types

- `tsconfig.json` has `strict: true`; keep code type-safe.
- Prefer explicit interfaces/types for contracts (`TranscriptionConfig`, session shapes).
- Avoid introducing new `any` types; reduce existing `any` when touching related code.
- For untyped framework context objects, create local typed helpers when practical.

### Naming

- File names: `camelCase.ts` for modules (`meetingController.ts`, `authMiddleware.ts`).
- Route modules end with `Routes` or `Route`.
- Controllers export verb-led functions (`createMeeting`, `getMeetingDetails`).
- DB model tables are plural nouns (`users`, `meetings`, `tenants`).
- Keep API payload keys stable; preserve existing snake_case DB columns.

### API / controller patterns

- Validate request shapes at route layer with Elysia `t.Object(...)` when possible.
- Keep business logic in controllers, not route definitions.
- Use middleware-derived auth context (`user`, `tenantId`, `wsUser`) consistently.
- Return structured JSON errors with appropriate HTTP status via `set.status`.

### Error handling and logging

- Wrap IO-heavy controller paths in `try/catch`.
- Log with `logger` (`debug`, `info`, `warn`, `error`) instead of `console.*` in app code.
- Include contextual identifiers in logs (user id/email, meeting id, tenant id).
- Do not leak secrets/tokens in logs.

### Security / auth expectations

- API auth uses `auth_session` cookie.
- WebSocket auth uses JWT ticket query parameter (`?ticket=`) with purpose checks.
- Never allow websocket tickets where API session is expected (and vice versa).
- Preserve tenant boundary checks in meeting access logic.
- Keep RBAC behavior aligned with `super_admin`, `tenant_admin`, `user` roles.

### Data and migrations

- Update Drizzle models first, then generate SQL migration.
- Do not hand-edit prior migration history unless explicitly requested.
- Preserve tenant isolation and foreign-key behavior.

### Tests and fixtures

- Tests use Bun's test runner (`bun:test`) and hit real HTTP/WebSocket flows.
- Many tests assume server + DB + env are running/valid.
- Reuse helpers in `tests/utils/testHelpers.ts`.
- Ensure teardown is preserved (`cleanupTestUsers`, closing sockets, ending meetings).
- For new tests, prefer deterministic waits (`waitForEvent`) over arbitrary long sleeps.

## Quick Command Cheat Sheet

- Install: `bun install`
- Dev server: `bun run dev`
- Type-check: `bunx tsc --noEmit`
- All tests: `bun test`
- Single file test: `bun test tests/reconnect.test.ts`
- Single test case: `bun test tests/reconnect.test.ts -t "host to disconnect and reconnect"`
- Generate migration: `bunx drizzle-kit generate`
