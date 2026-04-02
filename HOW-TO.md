# HOW-TO

## Prerequisites

- PostgreSQL
- Soniox API key

## Install

```bash
bun install
```

## Configuration

The server validates its environment at startup. If any required value is missing or invalid, the process exits immediately.

### Required

| Variable         | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `DATABASE_URL`   | PostgreSQL connection string used by Drizzle.         |
| `ENCRYPTION_KEY` | 44-character Fernet key used for encrypted secrets.   |
| `JWT_SECRET`     | Secret used for session and WebSocket ticket signing. |
| `SONIOX_API_KEY` | API key for realtime transcription.                   |

### Optional With Defaults

| Variable                  | Default                  | Description                                                        |
| ------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `PORT`                    | `8000`                   | HTTP server port.                                                  |
| `NODE_ENV`                | `development`            | Runtime mode. Allowed values: `development`, `production`, `test`. |
| `LOG_LEVEL`               | `info`                   | Log verbosity. Allowed values: `debug`, `info`, `warn`, `error`.   |
| `BASE_URL`                | `http://localhost:8000`  | Public base URL for generated links and callbacks.                 |
| `OLLAMA_BASE_URL`         | `https://ollama.com/api` | Base URL for backfill generation.                                  |
| `OLLAMA_BACKFILL_MODEL`   | `gpt-oss:20b`            | Model used for transcript backfill.                                |
| `TRANSCRIPT_OUTPUT_DIR`   | `transcripts`            | Directory for archived transcript output.                          |
| `DISABLE_BACKGROUND_JOBS` | `false`                  | Disables background jobs when set to `true`.                       |

### Optional

| Variable         | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `OLLAMA_API_KEY` | API key for the configured Ollama-compatible backfill service. |
| `REDIS_URL`      | Enables Redis-backed transcript caching when provided.         |

## Example `.env`

```env
PORT=8000
NODE_ENV=development
LOG_LEVEL=info
BASE_URL=http://localhost:8000
DATABASE_URL=postgres://user:password@localhost:5432/calc_translation
ENCRYPTION_KEY=replace-with-44-char-fernet-key-example==
JWT_SECRET=replace-with-a-long-random-secret
SONIOX_API_KEY=replace-with-soniox-key
OLLAMA_BASE_URL=https://ollama.com/api
OLLAMA_BACKFILL_MODEL=gpt-oss:20b
TRANSCRIPT_OUTPUT_DIR=transcripts
DISABLE_BACKGROUND_JOBS=false
```

## Running The Server

### Development

Starts the server in watch mode:

```bash
bun run dev
```

### Standard Run

Starts the server without watch mode:

```bash
bun index.ts
```

## What Happens On Startup

- Environment variables are validated.
- Database connectivity is checked.
- Pending Drizzle migrations are applied automatically.
- The HTTP and WebSocket server starts.
- Background calendar sync starts unless disabled.

## Type Checking

```bash
bunx tsc --noEmit
```

## Testing

### Run Everything

```bash
bun test
```

### Run By Suite

```bash
bun run test:unit
bun run test:integration
bun run test:stress
```

### Useful Focused Test Commands

Run one file:

```bash
bun test tests/integration/smoke-check.test.ts
```

Run one named test:

```bash
bun test tests/integration/rbac-access.test.ts --test-name-pattern "Super Admin can see all meetings"
```

Short form:

```bash
bun test -t "Scenario A" tests/stress/one-host-five-viewers.test.ts
```

Long-running suite with custom timeout:

```bash
bun test tests/stress/time-to-first-token.test.ts --timeout 120000
```

Watch mode:

```bash
bun run test:watch
```

Useful flags:

```bash
bun test --bail
bun test --only-failures
bun test --max-concurrency 1
```

## Test Layout

- `tests/unit/` for isolated logic and helpers.
- `tests/integration/` for route, database, websocket, and multi-layer behavior.
- `tests/stress/` for load, timing, and concurrency scenarios.
- `tests/setup/` for preload/bootstrap and shared test helpers.

## Database Migrations

The app runs pending migrations automatically on startup.

If you change the schema, generate a new migration with:

```bash
bunx drizzle-kit generate
```

Migration files are stored in `drizzle/`.
