# 12 - Implementation plan

Milestones are sequential. Each has a goal, the packages it touches, the tasks, and acceptance criteria. "Done" for every milestone includes the definition of done in 10. Sizes are relative: S is days, M is a week or two, L is several weeks for one engineer working with coding agents.

## M0 - Repository and gates (S) - DONE 2026-10-02

Notes: TypeScript 6.x (typescript-eslint does not yet support 7.x), ESLint 10, Vitest 5, Zod 4, pnpm 12. dependency-cruiser requires Node 22 or 24 locally; the development machine runs Node 23, so `pnpm check:deps` runs in CI only until Node is upgraded (`.nvmrc` says 24).

Goal: an empty monorepo where every CI gate already runs and passes.

Packages: `tooling`, `contracts` skeleton, `domain` skeleton.

Tasks:

1. `pnpm` workspace, Turborepo pipeline, base tsconfig with project references, ESLint, Prettier.
2. dependency-cruiser rules encoding the layer table in 02; a deliberately failing test import to prove the rule fires.
3. Vitest config template with 90/90 thresholds; one real test per skeleton package.
4. Licence allowlist script and the research licence ledger.
5. GitHub Actions workflow with all ten gates; Renovate config.
6. `docs/` linked from the repository README.

Acceptance: CI green on a pull request; a layer violation and a coverage shortfall each fail CI when introduced on purpose.

## M1 - Contracts and domain (M) - DONE 2026-10-02

Notes: the context thread was implemented to the proposed defaults and recorded as ADR-0013 (Draft) rather than waiting for the co-design session. jsonata 2.x keys its evaluation hooks by `Symbol.for('jsonata.__evaluate_entry')`; the time-box relies on that.

Goal: the loop definition, node config schemas, run and event schemas, and the first version of the context thread, with pure validation and thread operations.

Packages: `contracts`, `domain`.

Tasks:

1. Zod schemas for `LoopDefinition`, every node config in 04, `Invocation`, `Run`, `RunEvent`, `ContextThread`.
2. Co-design session on the context thread, closing the five questions in 03 and 13. Record the outcome as ADR-0013.
3. Graph validation with precise, user-facing error messages.
4. Thread operations: JSON Patch apply and validate, every mutation operation in 04, token estimation for truncation.
5. Expression and template evaluation helpers over JSONata and LiquidJS with a sandboxed context object.
6. Exit criteria evaluation, iteration counters, run state machine.
7. Export and import format for definitions.

Acceptance: a definition with every node kind validates; invalid graphs produce the expected errors; property-based tests over patch apply and truncate; coverage above threshold.

## M2 - Engine (L) - DONE 2026-10-02

Notes: all nine handlers, the run manager, fakes for every port, and a scenario helper are in `packages/engine`. Replay-at-node was left for M8. See the implementation notes in 05.

Goal: a run executes end to end against fake ports, including parking, resuming, cancellation, subloops, and crash recovery.

Packages: `engine`.

Tasks:

1. Ports from 02 as interfaces, with in-memory fakes and a fake clock.
2. Run manager: queue, worker pool, status transitions, persisted intents.
3. Executor loop and the node handler contract.
4. Handlers: trigger, decision with the expression strategy, script, mutate, subloop, wait, heartbeat, exit, and inference against the `FakeHarness`.
5. Event store contract and projections.
6. Crash recovery and resume-from-failure.
7. Return channel delivery for `caller`, `event`, `log`, and `file` through the workspace port, `webhook` through the HTTP port.
8. Replay-at-node (Draft) if time allows.

Acceptance: scenario tests for every node kind; a loop-back loop that exhausts; a subloop two levels deep; cancel during an inference node; kill the process mid-node in a test and recover; coverage above threshold.

## M3 - Persistence and API (M)

M3 notes: the intermittent 0xC0000005 crash in the `apps/api` suite comes from libsql's native addon, which on Windows can crash or hang the process when it is loaded only inside a worker thread and that thread exits, as Vitest's `threads` and `vmThreads` pools do. `apps/api` and `adapter-sqlite` (now `infrastructure`) therefore pin Vitest to `pool: 'forks'`, where the crash never reproduced; production loads libsql on the main thread and is unaffected. Fixing the suite also surfaced a real bug: revoking an already revoked API key returned 204 instead of 404, so `SqliteApiKeys.revoke` now matches only active keys. Details are in `research/sqlite-libsql.md`.

Goal: the engine runs behind a real API with SQLite, usable from curl before any UI exists.

Packages: `infrastructure` (`src/sqlite`, `src/scheduler` for timers only, `src/fs`, `src/process`, `src/http`), `apps/api`. Built as five `adapter-*` packages and merged by ADR-0014.

Tasks:

1. Drizzle schema and migrations for every table in 03; event store with transactional append.
2. Repositories; owner id on every row.
3. Fastify app: routes in 07, Zod validation, OpenAPI generation, generated client package.
4. SSE endpoint with cursor resume and heartbeats.
5. Local trusted mode and API keys.
6. Manual triggers end to end: start, stream, input, cancel, pause, resume.
7. Boot sequence: migrations, recovery scan, timer re-arm.

Acceptance: a curl script creates, publishes, runs, and streams a loop; SSE reconnect replays missed events; restart during a waiting run resumes correctly; coverage above threshold.

## M4 - Codex, Jev, and real nodes (L)

Goal: real inferencing and decisions.

Packages: `adapter-codex`, `adapter-jev`, `infrastructure/src/http`.

Tasks:

1. Codex adapter: preflight, start, resume, event normalisation, cancellation with tree kill, usage capture, transcript artifact. Verify every SDK option name against the pinned version and update `research/codex-sdk.md`.
2. Session policies: fresh, resume-previous, resume-named.
3. Prompt and context-file rendering; input and output transforms.
4. Structured output with native schema and the configurable repair policy.
5. Codex-backed decider and the coerce repair path.
6. Jev adapter with the Choice primitive and confidence threshold.
7. Script node over the real process port, Windows tree kill included.
8. Heartbeat and poll probes over the HTTP port.
9. Model catalog seeding and settings.
10. Fixture recorder and the recorded fixtures; nightly live smoke job.

Acceptance: a loop that triggers manually, asks Codex to change a file in a working directory, validates a structured result, decides with Jev, loops back once, and returns a payload through the `file` channel; runs on the owner's Windows machine; coverage above threshold.

M4 wiring notes (WP-I): `apps/api` composes the real adapters when no override is given: harness `codex`, the Codex structured port, and deciders `[jev, codex]` (see "Composition" in 06). `GG_CODEX_BINARY` optionally points at a `codex` executable. Jev reads `jev-api-key` from the local owner's secrets after migrations run at `start()`, and `PUT`/`DELETE /secrets/jev-api-key` refresh it through `Container.onSecretChanged`, so a new key needs no restart. `HarnessPort.resume` now takes the full `HarnessStartRequest`, so resumed, repair, and crash-recovery turns keep the node's model, effort, sandbox, and working directory. The SSE stream ends right after the replay when the run is already terminal (07). A `LIVE=1` smoke in `apps/api/src/live.test.ts` runs trigger, inference (`gpt-6-luna`, `low`, read-only), and exit through the API and the real Codex CLI; it passed on 2026-10-03. The Jev live check is still open: no key was available on the development machine.

## M5 - Web editor and PWA (L)

Goal: the product is usable without curl.

Packages: `apps/web`.

Tasks:

1. App shell, routing, generated client, auth-less local mode.
2. Loops list, create, import, export, publish.
3. Editor: canvas, palette, property panels from schemas, validation panel, variables, subloop picker, templates with preview.
4. Runs list and run inspector with SSE, thread viewer, patch diffs, wait-for-input form, controls.
5. Settings: model catalog, defaults, secrets, API keys, harness preflight.
6. PWA: manifest, service worker with the prompt update flow, offline shell, IndexedDB drafts.
7. Adversarial QA pass per 10.

Acceptance: the M4 acceptance loop can be built and run entirely in the UI; the update toast appears on a new build and updates only after confirmation; coverage above threshold in `apps/web`; QA defects closed.

## M6 - Triggers (M)

M6 notes (WP-C): tasks 1 to 4 shipped; task 5, the events screen, belongs to the web work. New tables `schedules`, `webhook_endpoints`, and `inbound_events` (migration `0001_triggers`); `CronScheduler` over croner in `infrastructure/src/scheduler`; a `TriggerService` and `PollTriggers` in `apps/api/src/triggers`; routes `POST /hooks/{token}`, `GET /loops/{id}/triggers`, and a persisted `GET /events`. Decisions made on the way, all recorded in 08: webhook tokens are kept across versions of the same trigger node so publishing does not break senders; without a `dedupeKey` expression a webhook's dedupe key is its signature; `run-each` catch-up is capped at 100 runs per schedule; an exit event never re-enters a loop already in its run chain and chains stop at 8 runs; poll triggers are armed in memory and record `source: 'poll'` (added to `InvocationSource` in WP-I). Drizzle's JSON column mode writes a JSON `null` as SQL NULL, so `inbound_events.payload` is plain text serialised by the repository.

Goal: loops start without a human.

Packages: `infrastructure` (`src/scheduler`, `src/sqlite`, `src/http`), `apps/api`.

Tasks:

1. Cron schedules with timezone, persistence, re-arm, and missed-fire policies.
2. Signed webhook endpoints with replay protection, rate limits, filters, dedupe.
3. Inbound event bus and the `event` trigger; `event` return channel wiring.
4. Poll trigger if it fits.
5. Events screen in the UI.

Acceptance: a cron loop fires on schedule and after a simulated outage per policy; a webhook with a bad signature is rejected and a good one starts a run; a loop triggers another loop through the bus.

## M7 - MCP server and Codex plugin (M)

Goal: agents can drive loops.

Packages: `apps/mcp`, `apps/plugin-codex`.

Tasks:

1. MCP server with the tool set in 07 over the generated client; stdio and Streamable HTTP.
2. API-key auth from the MCP server to the API.
3. Codex plugin packaging with the three skills; verify the pinned plugin format.
4. A Codex session starts a loop, waits for it, provides input to a waiting node, and reads the result, all through tools.

Acceptance: the scenario above recorded as an E2E test with the fake harness and verified live once.

M7 notes: `apps/mcp` uses `@modelcontextprotocol/sdk` 1.31 (1.32 was inside pnpm's minimum release age on the day) over `@graphgoblin/api-client` and sends `x-graphgoblin-client: mcp`, so MCP-started runs record `manual.mcp`. `wait_for_run` polls `GET /runs/{id}` itself instead of `waitForRun` because it returns early when the run needs the caller (waiting for input, or paused) and sends MCP progress notifications between polls. Streamable HTTP runs stateless (a server and transport per POST) and refuses non-loopback `Host` headers when bound to loopback. The E2E suite (`apps/mcp/src/mcp.test.ts`) drives every tool, including input, signals, pause, resume, and cancel, through the SDK's in-memory transport against the in-process API with the fake harness. The plugin layout was verified against Codex CLI 0.160.0 (see 07 and `research/codex-sdk.md`); because Codex copies installed plugins into its cache, `apps/plugin-codex` assembles a local marketplace with the absolute MCP server path at build time. The live check (`LIVE=1`, `apps/plugin-codex/src/live.test.ts`) ran one `codex exec --json` session with `gpt-6-luna` at `low` effort that called `list_loops`, `start_run`, and `wait_for_run` and reported the run as succeeded; the input path is covered by the E2E suite rather than live. `GET /runs?before=` takes a creation timestamp, so `list_runs` pages with `nextBefore` (a `createdAt`); runs created in the same millisecond can be skipped across a page boundary.

## M8 - Hardening and 1.0 (M)

Goal: a release someone else can install.

Tasks:

1. Container image, install script, first-run preflight, data directory and master key setup.
2. Replay-at-node if not already done.
3. Full adversarial QA pass across the product.
4. Performance check: 1,000 events in a run stream without UI lag; 10 parallel runs.
5. Documentation pass: user guide, node reference generated from schemas, API reference from OpenAPI.
6. Tag 1.0.

Acceptance: a clean machine install following the guide reaches a running loop in under thirty minutes; all gates green; open-questions list empty of 1.0 blockers.

## After 1.0 (ordered backlog)

1. Claude Code adapter.
2. LiteLLM adapter and the summarise operation.
3. Per-loop concurrency policy.
4. Multi-tenant: auth provider, remote runner, Postgres adapter and dialect matrix, scheduler lease, owner scoping audit.
5. Fan-out and fan-in.
6. Retention policies.
7. Trigger presets.
8. Error or debug nodes, only if needed.

## First week checklist

- [ ] M0 complete and CI green.
- [ ] Context thread co-design session scheduled; questions in 13 answered.
- [ ] Heartbeat node interpretation confirmed or corrected.
- [ ] Codex CLI and Jev account available on the development machine for M4 verification.
