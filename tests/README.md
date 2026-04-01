# Test Suite

The test suite is organized by scope so it is easier to find the right level of coverage and run only the tests you need.

## Layout

- `tests/unit/` - isolated logic and helper tests
- `tests/integration/` - route, database, websocket, and multi-layer behavior tests
- `tests/stress/` - concurrency, timing, and load-oriented scenarios
- `tests/setup/` - Bun preload/bootstrap, shared test helpers, and bundled fixtures

## Naming Convention

- Test files use lowercase kebab-case names ending in `.test.ts`
- Prefer names that describe the feature or behavior under test
- Use directory placement, not filename suffixes, to distinguish unit vs integration vs stress

## Commands

- All tests: `bun test`
- Unit tests: `bun run test:unit`
- Integration tests: `bun run test:integration`
- Stress tests: `bun run test:stress`
- Single file: `bun test tests/integration/reconnect-flow.test.ts`

## Test Purposes

### Unit

- `tests/unit/access-policy.test.ts` - verifies role checks, meeting access rules, transcript download permissions, and tenant-scoped visibility filters.
- `tests/unit/calendar-link-parser.test.ts` - verifies extraction and classification of supported meeting links from calendar text.
- `tests/unit/transcript-display.test.ts` - verifies transcript rendering rules for translated, transcribed, both, and two-way display modes.
- `tests/unit/transcription-service.test.ts` - verifies transcript text splitting, translation fallback behavior, and speaker label normalization.

### Integration

- `tests/integration/bug-report-routes.test.ts` - verifies bug report submission, listing restrictions, and status transitions.
- `tests/integration/auth-routes.test.ts` - verifies login-domain routing, provider selection safeguards, callback validation, and logout cookie clearing.
- `tests/integration/meeting-access-routes.test.ts` - verifies join-gated meeting access, host activity state, and stale membership rejection.
- `tests/integration/meeting-integration-config.test.ts` - verifies meeting creation rules for native and Zoom-backed meetings.
- `tests/integration/meeting-join-service.test.ts` - verifies readable ID lookup, join planning, language cap handling, and persistence.
- `tests/integration/meeting-language-limits.test.ts` - verifies one-way meeting language limits during creation and join.
- `tests/integration/meeting-subscription-authorization.test.ts` - verifies cross-tenant join attempts and unauthorized websocket meeting subscriptions are denied.
- `tests/integration/observability-routes.test.ts` - verifies Prometheus metrics access and super-admin-only server log retrieval.
- `tests/integration/quick-meeting-routes.test.ts` - verifies tenant-scoped invitee search and quick meeting creation rules.
- `tests/integration/rbac-access.test.ts` - verifies meeting list/detail access for super admins, tenant admins, and regular users.
- `tests/integration/reconnect-flow.test.ts` - verifies host disconnect recovery and timeout-based meeting shutdown behavior.
- `tests/integration/session-policy.test.ts` - verifies session resolution against tenant membership and super admin exemptions.
- `tests/integration/smoke-check.test.ts` - verifies the basic end-to-end path for creating a meeting, joining it, and receiving transcript output.
- `tests/integration/transcript-cache.test.ts` - verifies transcript history replay and archived VTT generation behavior.
- `tests/integration/transcript-download.test.ts` - verifies only hosts and attendees can download archived transcripts.
- `tests/integration/transcript-language-isolation-controller.test.ts` - verifies controller-level transcript fan-out rules for one-way and two-way meetings.
- `tests/integration/transcript-language-isolation-live.test.ts` - verifies live websocket transcript delivery and history replay by subscriber language.
- `tests/integration/tenant-admin-guardrails.test.ts` - verifies tenant deletion restrictions, self-delete prevention, and super-admin tenant cleanup behavior.
- `tests/integration/user-routes.test.ts` - verifies user profile, calendar sync, tenant admin user management, settings, and deletion flows.

### Stress

- `tests/stress/one-host-five-viewers.test.ts` - verifies one host and five viewers across several join-order scenarios, including waiting room behavior and TTFT expectations.
- `tests/stress/concurrent-meetings-two-language-capacity.test.ts` - ramps up the number of simultaneous meetings while each meeting carries 200 viewers split across English and Spanish, then stops when join or transcript delivery latency exceeds the hardcoded limits.
- `tests/stress/single-meeting-same-language-viewers.test.ts` - ramps one live meeting upward while the host keeps streaming audio, then stops when join/delivery latency breaches hardcoded thresholds or subscriptions break; writes detailed per-level metrics to `tests/stress/results/`.
- `tests/stress/time-to-first-token.test.ts` - measures time-to-first-token across increasing levels of concurrent live streams.

## Support Files

- `tests/setup/setupServer.ts` - starts the shared app instance before tests run.
- `tests/setup/utils/testHelpers.ts` - provides reusable helpers for API calls, websocket setup, test users, teardown, and shared fixture paths.
- `tests/setup/samples/` - stores bundled test fixtures such as sample audio input.
