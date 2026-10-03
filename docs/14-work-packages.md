# 14 - Work packages and delivery waves

From M3 onward the work is delivered by delegated implementation agents coordinated by an orchestrator: the orchestrator writes a brief per package, agents implement in isolated worktrees, the orchestrator reviews, merges, runs every gate, and commits. This document is the standing map of those packages. Each package lists the docs an agent must read, what it depends on, what it must deliver, and how it is accepted.

Rules that apply to every package:

- Read `AGENTS.md`, `docs/README.md`, and the docs named in the package before writing code.
- Every package or app keeps unit-test coverage above 90% of lines and branches; `pnpm test:coverage` is the gate. Thresholds are never lowered.
- No new dependency without checking `tooling/license-allowlist.json` and adding a line to `docs/research/licenses.md`.
- Behaviour changes update the relevant numbered doc. Decisions become ADRs.
- Agents do not commit to `main` and never add attribution lines. They report branch, files, test results, and open questions.

## Waves

| Wave | Packages                                                    | Runs in parallel?    | Precondition             |
| ---- | ----------------------------------------------------------- | -------------------- | ------------------------ |
| 0    | WP-0 M3 stabilisation                                       | no                   | now                      |
| 1    | WP-A api-client, WP-B Codex and Jev adapters, WP-C triggers | yes, three worktrees | M3 committed             |
| 2    | WP-D web editor and PWA, WP-E MCP server and Codex plugin   | yes, two worktrees   | WP-A merged              |
| 2    | WP-I integration and follow-ups (delivered)                 | alongside WP-D       | WP-A, WP-B, WP-C merged  |
| 3    | WP-F1 backend and tooling hardening (delivered)             | alongside WP-D       | WP-B through WP-E merged |
| 3    | WP-D2 adversarial QA pass and fixes (delivered)             | alongside WP-F1      | WP-D merged              |
| 3    | WP-G adversarial design review fixes (delivered)            | alongside WP-F2      | WP-F1 and WP-D2 merged   |
| 3    | WP-F2 packaging, user guide, adversarial QA, tag 1.0        | no                   | WP-D and WP-F1 merged    |

## WP-0 - M3 stabilisation

Read: 07, 10. Depends on: nothing. Deliver: `apps/api` test suite green three runs in a row, coverage above thresholds, lint and format clean, root cause of the libsql worker crash written into 12. Accept: `pnpm check` green for `apps/api` and `packages/infrastructure` (at the time, `packages/adapter-sqlite`).

## WP-A - API client package

Read: 02, 07. Depends on: M3. Deliver `packages/api-client` (`@graphgoblin/api-client`, layer `client`, production dependency on `contracts` only):

- Types generated from the API's OpenAPI document with `openapi-typescript`; the API emits the document with `pnpm --filter @graphgoblin/api openapi -- <path>` after building. Wire a Turborepo task so the client's build depends on the API's emit task.
- A thin `openapi-fetch` client factory `createGraphGoblinClient({ baseUrl, apiKey?, fetch? })`.
- An SSE helper that works in Node and browsers using `fetch` streaming: `subscribeRunEvents(client, runId, { after, onEvent, signal })` with automatic resume from the last sequence number and a parsed `RunEvent` per callback.
- Tests against mocked HTTP (MSW or undici's MockAgent) for the client, and a contract test that boots the real API in-process through `@graphgoblin/api`'s `createTestApp` helper as a dev dependency.

Accept: generated types match the live document (a test regenerates and diffs); coverage above thresholds; `pnpm check:layers` green (dev dependencies are exempt from layer rules).

Delivered: `packages/api-client` ships the typed client, resource wrappers, `subscribeRunEvents`, and `waitForRun`, with `openapi.json` and `src/generated/schema.ts` committed and a drift test (instead of a Turborepo emit task) that fails when the API's document changes; see "Client" in 07.

## WP-B - Codex and Jev adapters (M4)

Read: 04 (inference, decision), 05, 06, `research/codex-sdk.md`, `research/jev.md`, ADR-0014. Depends on: M2 (engine ports). Both adapters stay separate `adapter-*` packages because each wraps an optional external service with its own dependency and licence (ADR-0014); they do not go into `packages/infrastructure`. Deliver:

- `packages/adapter-codex`: `HarnessPort` over `@openai/codex-sdk` pinned exactly. `preflight` runs the CLI to check install and login. `start` and `resume` map to `startThread`/`resumeThread` and `runStreamed`; model, effort, sandbox, approval, network, and web search are set explicitly on every session through `config` keys so the machine's `config.toml` defaults never leak (see the research doc for the owner's defaults). Normalise events to `HarnessEvent`; a configuration-warning `error` item is not a failure, `turn.failed` is. Record session ids as soon as `thread.started` arrives. Cancel aborts the SDK call and kills the CLI process tree (Windows `taskkill /T /F`).
- `StructuredPort` over a read-only Codex thread with an output schema, and a `DeciderPort` (`id: 'codex'`) built on it for choices and yes/no questions.
- `packages/adapter-jev`: `DeciderPort` (`id: 'jev'`) over `@typesafe-ai/sdk` or raw HTTP if the SDK's licence is not permissive; `available()` is true only when an API key is resolvable from the secret `jev-api-key`.
- Fixtures: record real JSONL event streams with a small script (`pnpm --filter @graphgoblin/adapter-codex record -- "<prompt>"`) using model `gpt-6-luna` at `low` effort, store them under `fixtures/`, and drive adapter unit tests from them. A `LIVE=1` smoke test runs one real turn; it is skipped otherwise.
- Update `docs/06-harness-integration.md` and `docs/research/codex-sdk.md` with every verified option name.

Accept: adapter tests green from fixtures without network; one live smoke run succeeds on the development machine; coverage above thresholds.

## WP-C - Triggers (M6) - DELIVERED 2026-10-02

Delivered: cron schedules with missed-fire policies, signed webhooks, persisted event triggers with a self-trigger guard, and poll triggers, as described in 08 and the M6 notes in 12.

Read: 03, 04 (trigger), 08, 11, ADR-0014. Depends on: M3. Deliver:

- `packages/infrastructure/src/scheduler`: cron schedules over `croner` with timezone support; schedules persisted (new `schedules` table in `src/sqlite` with a migration in `packages/infrastructure/drizzle`); re-arm at boot; missed-fire policies `skip`, `run-once`, `run-each`. The scheduler may import the sqlite folder directly or define its own store interface, as `TimerStore` does.
- `packages/infrastructure/src/sqlite`: `schedules`, `webhook_endpoints`, `inbound_events` tables and repositories.
- `apps/api`: on publish, regenerate schedules and webhook endpoints for the version's trigger nodes; `POST /hooks/{endpointToken}` with HMAC-SHA256 verification, timestamp window, dedupe, size limit, and rate limit; `POST /events` now fires `event` trigger nodes through the bus with filters and dedupe; `poll` trigger as a stretch over the heartbeat probe model; an events listing backed by `inbound_events`.
- A `TriggerService` in `apps/api` (or a new `packages/triggers` if it stays pure) that turns a firing into `RunManager.startRun` with the right `source` and `triggerKind`.

Accept: a cron loop fires on schedule and after a simulated outage per policy; a webhook with a bad signature is rejected and a good one starts a run; one loop triggers another through the bus; coverage above thresholds.

## WP-D - Web editor and PWA (M5)

Read: 04, 09, 10. Depends on: WP-A merged. Deliver `apps/web` (React 19, Vite, `@xyflow/react`, Zustand, TanStack Query, Tailwind, shadcn/ui, CodeMirror 6, react-hook-form, vite-plugin-pwa):

- Screens from 09: loops, editor, runs, run inspector, settings, events.
- Property panels generated from the node config schemas in `contracts`; live validation using `domain`.
- Run inspector over the SSE helper from `api-client`.
- PWA with `registerType: 'prompt'` and the confirm-to-update toast; app shell precache only; drafts mirrored to IndexedDB.
- Served by the API process from `apps/web/dist` (add static hosting to `apps/api` behind a config flag).
- Component tests with Testing Library and MSW; Playwright E2E for draw, publish, run, watch, input, cancel.

Accept: the kitchen-sink loop can be built and run from the UI; update toast appears on a new build and updates only after confirmation; coverage above thresholds; an adversarial QA pass (Playwright MCP and computer use) finds no open defects.

Delivered (first pass): `apps/web` ships all six screens, schema-driven property panels, live validation, the SSE run inspector, and the prompt-update PWA, served by the API under `/app/` via `GG_WEB_DIST`, with Playwright E2E for draw, publish, run, watch, input, cancel, and the update toast; the adversarial QA pass is still open (see 09 and the M5 notes in 12).

## WP-E - MCP server and Codex plugin (M7)

Read: 07, `research/codex-sdk.md` (plugins). Depends on: WP-A merged. Deliver `apps/mcp` over `@modelcontextprotocol/sdk` using the API client: tools `list_loops`, `describe_loop`, `start_run`, `wait_for_run`, `get_run`, `get_run_thread`, `list_runs`, `cancel_run`, `pause_run`, `resume_run`, `provide_input`, `send_signal`, `read_run_events`; resources for a run's events and thread; stdio and Streamable HTTP transports; API-key auth to the gateway. Deliver `apps/plugin-codex`: plugin manifest registering the MCP server plus skills `run-loop`, `design-loop`, `inspect-run`, following the pinned Codex plugin layout.

Accept: an E2E test drives the MCP server against the in-process API with the fake harness; one live check from a Codex session starts a loop and reads its result; coverage above thresholds.

Delivered: `apps/mcp` serves the thirteen tools and two run resources over stdio and Streamable HTTP, and `apps/plugin-codex` assembles an installable Codex marketplace with the MCP server and the `run-loop`, `design-loop`, and `inspect-run` skills, verified live with Codex CLI 0.160.0; see "MCP server" and "Codex plugin" in 07.

## WP-I - Integration and follow-ups - DELIVERED 2026-10-03

Delivered: `apps/api` composes the real Codex harness, structured port, and deciders `[jev, codex]`, with `GG_CODEX_BINARY` and a secret-change hook that refreshes Jev when `jev-api-key` is set or deleted; poll triggers record the new `poll` invocation source; the API client is regenerated; `HarnessPort.resume` takes the full `HarnessStartRequest` so resumed turns keep the node's settings; the SSE stream ends at once for a run that is already terminal; the dependency-cruiser cross-package rule only flags relative imports. A `LIVE=1` API smoke through the real Codex CLI passed. The Jev live check stays open until a key is available. See the M4 wiring notes in 12.

## WP-D2 - Adversarial QA pass and fixes - DELIVERED 2026-10-03

Read: 04, 07, 09, 10. Depends on: WP-D merged. Deliver: an adversarial QA pass over the built app and the API with every defect recorded and fixed or explicitly left open, the WP-D1 gaps closed (API-key mode, owner defaults in the engine, child-run replay), and an optional `LIVE=1` check through the UI.

Delivered: the report is `qa/2026-10-03-wp-d2.md`; regressions are `apps/web/e2e/qa.spec.ts` and `apps/api/src/qa.test.ts`; the E2E server gained a control port for scripting the fakes; the `LIVE=1` UI spec passed against Codex (`gpt-6-luna`, `low`, read-only). Open items are in the report and as questions 16 to 18 in 13.

## WP-G - Adversarial design review fixes - DELIVERED 2026-10-03

Read: 03, 05, 07, 08, 11, 13, the decisions, and the review report `qa/2026-10-03-adversarial-design-review.md` (Codex, branch `codex-adversarial-design`). Depends on: WP-F1 and WP-D2 merged. Deliver: the review's eight small fixes and four attack-test files ported onto main and reviewed; its eight open findings (ADV-004, 007, 008, 009, 011, 012, 015, 016) and QA-LIMIT-001 closed with tests that fail before the fix; docs in sync.

Delivered: subloop version pinning at parent creation (`run.queued.subloopVersions`); at-least-once timers with recovery re-arming; idempotent cancel (`RunRepository.claimCancel`); child-before-park and recovery reconciliation; log-derived cursor and thread at every executor start; a static regex safety check for JSONata literals and mutation patterns; read scopes on every API route with a route-to-scope table test; ULID path validation with the API client regenerated; a real Windows process-tree cancellation test. A second, cross-vendor review round (nine findings) led to log-first transitions with recovery from the log, wait identities on timers, resume-to-waiting, verified thread checkpoints, delete protection for pinned loops, and a stronger regex check; a third round added recorded finalization, legacy timer re-keying, serialized loop deletion, an environment-preserving `$eval`, and checkpointed replay state; the report records each finding's status and commit. See the WP-G notes in 05 and the M8 notes in 12.

## WP-F - Hardening and 1.0 (M8)

Split into WP-F1 (delivered) and WP-F2 below.

Read: 11, 12. Depends on: everything above. Deliver: container image and install script; first-run preflight; replay-at-node; full adversarial QA pass; performance check (1,000 events streamed without UI lag, 10 parallel runs); user guide, node reference generated from schemas, API reference from OpenAPI; tag 1.0.

## WP-F1 - Backend and tooling hardening - DELIVERED 2026-10-03

Read: 05, 07, 10, 11, 12. Depends on: WP-I. Deliver: replay-at-node in the engine, API, client, and MCP; first-run preflight over HTTP and the command line; typecheck of test files in every package; a `PERF=1` backend performance baseline; node and API references generated from the schemas and the OpenAPI document with a staleness gate.

Delivered: `RunManager.replay` with `POST /runs/{id}/replay`, `runs.replay`, and the MCP tool `replay_run` (provenance `invocation.replayOf` and `run.queued.replayOf`, 409 `REPLAY_NODE_NOT_REACHED`); `apps/api/src/preflight.ts` behind `GET /system/preflight` and `--preflight`, with `DatabaseHandle.pendingMigrations()`; `typecheck` runs `tsc -p tsconfig.json` too; `apps/api/src/perf.test.ts` and the numbers in 10, plus a fix for event-loop starvation in the serialised database client; `pnpm docs:generate` and `pnpm check:docs` over `docs/reference/`. See the M8 notes in 12.

## WP-F2 - Packaging, guide, QA, and 1.0

Read: 11, 12. Depends on: WP-D and WP-F1. Deliver: container image and install script (data directory and master key setup, preflight on first start); user guide; full adversarial QA pass across the product; the UI half of the performance check (1,000 events in the run inspector without lag); tag 1.0.
