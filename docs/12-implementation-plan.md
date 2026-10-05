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

M4 wiring notes (WP-I): `apps/api` composes the real adapters when no override is given: harness `codex`, the Codex structured port, and deciders `[jev, codex]` (see "Composition" in 06). `GG_CODEX_BINARY` optionally points at a `codex` executable. Jev reads `jev-api-key` from the local owner's secrets after migrations run at `start()`, and `PUT`/`DELETE /secrets/jev-api-key` refresh it through `Container.onSecretChanged`, so a new key needs no restart. `HarnessPort.resume` now takes the full `HarnessStartRequest`, so resumed, repair, and crash-recovery turns keep the node's model, effort, sandbox, and working directory. The SSE stream ends right after the replay when the run is already terminal (07). A `LIVE=1` smoke in `apps/api/src/live.test.ts` runs trigger, inference (`gpt-6-luna`, `low`, read-only), and exit through the API and the real Codex CLI; it passed on 2026-10-03. Jev was verified live on 2026-10-03 with Choice, five-label classification, Noul, direct SDK Score, and a published API loop that succeeded via the Jev route (see `research/jev.md`).

## M5 - Web editor and PWA (L)

Goal: the product is usable without curl.

Packages: `apps/web`.

Tasks:

1. App shell, routing, generated client, auth-less local mode.
2. Loops list, create, import, export, publish.
3. Editor: canvas, palette, property panels from schemas, validation panel (since #15, issue badges on the nodes and counts beside Publish), variables, subloop picker, templates with preview.
4. Runs list and run inspector with SSE, thread viewer, patch diffs, wait-for-input form, controls.
5. Settings: model catalog, defaults, secrets, API keys, harness preflight.
6. PWA: manifest, service worker with the prompt update flow, offline shell, IndexedDB drafts.
7. Adversarial QA pass per 10.

Acceptance: the M4 acceptance loop can be built and run entirely in the UI; the update toast appears on a new build and updates only after confirmation; coverage above threshold in `apps/web`; QA defects closed.

M5 notes (first pass, WP-D): `apps/web` ships tasks 1 to 6; task 7 (adversarial QA) is next. The app is served by the API under `/app/` (`GG_WEB_DIST`), so client routes never collide with API paths. Unit tests run in jsdom against the real api-client over an in-memory fake API (`src/__fixtures__/fake-api.ts`) rather than MSW. Playwright E2E (`pnpm --filter @graphgoblin/web test:e2e`, after `pnpm build`) starts `createTestApp` with the fake harness on an ephemeral port; on Windows it drives the installed Microsoft Edge (`channel: 'msedge'`, override with `GG_E2E_BROWSER_CHANNEL`) because the development machine has too little disk for Playwright's Chromium download. Known gaps: with `GG_REQUIRE_API_KEY=true` the auth hook also guards `/app/*` and the UI has no API-key entry, so the web app targets local trusted mode only; the default model and effort in Settings are stored as owner settings (`defaultModel`, `defaultEffort`) that the engine does not read yet (it uses `GG_DEFAULT_MODEL` and `GG_DEFAULT_EFFORT`); the inspector's thread reconstruction starts child runs from an empty thread because the subloop seed is not in the event log.

M5 notes (task 7, WP-D2, 2026-10-03): the adversarial QA pass ran against the built app on Microsoft Edge and against the API; the defects, fixes, and open items are in `qa/2026-10-03-wp-d2.md`. The three known gaps above are closed: the shell under `/app/` is public and the UI asks for an API key on a 401; Settings' default model and effort reach the engine at run start through `EngineSettings.ownerDefaults`; `run.queued` carries the initial thread, so child runs replay correctly. Validate, draft saves, and publish report the same issues (cron syntax, subloop references, and Liquid and JSONata syntax in `domain`). The 1,000-event part of the M8 performance check passes: a 1,211-event run opens in the inspector in about 0.5 s. Open items are listed in the report and as questions 16 to 18 in 13.

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

## M8 - Hardening and 1.0 (M) - DONE 2026-10-03

Goal: a release someone else can install.

Tasks:

1. Container image, install script, first-run preflight, data directory and master key setup.
2. Replay-at-node if not already done.
3. Full adversarial QA pass across the product.
4. Performance check: 1,000 events in a run stream without UI lag; 10 parallel runs.
5. Documentation pass: user guide, node reference generated from schemas, API reference from OpenAPI.
6. Tag 1.0.

Acceptance: a clean machine install following the guide reaches a running loop in under thirty minutes; all gates green; open-questions list empty of 1.0 blockers.

M8 notes (WP-G, adversarial design review fixes, 2026-10-03): a design review by a second model (Codex) attacked nineteen documented invariants with 84 tests; the report is `qa/2026-10-03-adversarial-design-review.md`. Its eight small fixes were ported onto main and reviewed, and its eight open findings and the unverified Windows process-tree check are closed, each with a test that failed first:

- **Engine**: subloop `latest` references are pinned when the parent run is created and recorded on `run.queued` (`subloopVersions`); the executor starts from the log (thread replayed from the initial thread, cursor advanced past a node whose `node.finished` is durable); a parent whose child finished before it parked is woken after the park and at recovery; cancel requests are a compare-and-set (`RunRepository.claimCancel`). See the WP-G notes in 05.
- **Timers** are delivered at least once: `TimerService` removes a timer only after its listeners ran (and only while it still has the fired time), and recovery re-arms each waiting run's timer from its wait spec.
- **Expressions**: regex literals in JSONata and the `redact`/`replace` patterns pass a static check against catastrophic backtracking before they run (`packages/domain/src/regex-safety.ts`); the residual risk is in 11.
- **API**: every private route, reads included, requires `<resource>:read` or `<resource>:write` (write implies read), checked before the body is parsed; resource ids in paths must be ULIDs (400 otherwise). See "Authentication" in 07.
- **Windows**: a real child-and-grandchild cancellation test passes on Windows 11 (`taskkill /T /F`).
- **Second review round**: a cross-vendor review requested changes (nine findings). The engine now writes the log before the status and completes transitions from the log at recovery: wakes are conditional appends checked against a wait identity (`startedSeq`, carried by timer keys), terminal events precede terminal status, a run paused while parked resumes to waiting, timers are acknowledged only on successful delivery and re-armed with both deadlines, thread snapshots are verified checkpoints (migration `0002`), and a loop an active run can still start cannot be deleted. The regex check now sees through nested groups and covers `$eval`. 1.0 runs one API process per data directory (no execution lease). Details in the review report and the WP-G notes in 05.
- **Third review round**: finalization after a terminal status is recorded and completed at boot (returns per channel, children, parent); legacy timer keys are re-keyed with the wait identity; loop deletion is serialized with subloop pinning; `$eval` delegates to JSONata's own implementation after the check; replay applies a completion only to the open visit and checkpoints carry the replay state.
- **Fourth review round**: nested `$eval` errors keep one bounded innermost cause; resuming a failed run is event-first and clears its finalization marker, and recovery completes a durable resume; a child that cannot be cancelled keeps the parent's finalization pending; replay admission and a new run's own-version check run under the deletion lock.

M8 notes (WP-F1, backend and tooling, 2026-10-03):

- **Replay-at-node** (task 2) is done: `POST /runs/{id}/replay` with `{ nodeId }`, `runs.replay` in the client, and the MCP tool `replay_run` fork a new run at a node the source reached, with the thread replayed to just before that node first started. Provenance is `invocation.replayOf` and `run.queued.replayOf`. Rules and limits (no session or working-directory carry-over, children not copied) are in 05.
- **First-run preflight** (part of task 1): `GET /system/preflight` and `graphgoblin-api --preflight` check Node, the data directory, the master key, the database and pending migrations, each harness's `preflight()`, the Jev key, and the default model's catalog entry, as `ok`, `warn`, or `fail`, without changing state. See 11.
- **Performance** (task 4, backend half): 10 parallel runs of 1,011 events each finish in 6.7 s; SSE delivers a finished run's 1,011 events in about 100 ms and a live run's first event in 20 ms. Measuring it found and fixed event-loop starvation during bursts of database work. Numbers and the command are under "Performance baseline" in 10. The UI half (1,000 events without lag in the run inspector) belongs to the web work.
- **Generated references** (part of task 5): `docs/reference/nodes.md` from the node schemas and `docs/reference/api.md` from the OpenAPI document, regenerated by `pnpm docs:generate` and guarded by `pnpm check:docs` in `pnpm check` and CI. Every route now carries an OpenAPI summary.
- **Typecheck covers tests**: each package's `typecheck` also runs `tsc -p tsconfig.json`, which includes tests and fixtures; the three errors it found were fixed.

M8 notes (WP-F2, packaging and the last product fixes, 2026-10-03):

- **Container image and compose file** (task 1): `Dockerfile` (multi-stage on `node:22-bookworm-slim`, `pnpm deploy --prod` of the API, the built web app, the Linux Codex binary with `codex` on `PATH`, non-root, `/data` volume, health check) and `docker-compose.yml` (loopback port, data volume, `~/.codex` mount). 1.04 GB unpacked, 259 MB compressed, 427 MB of it the Codex binary. Built and smoke-tested with Docker Desktop: healthy, `/healthz` 200, `/app/` serves the UI, `--preflight` passes inside the container with the Codex login mounted. See 11.
- **Install scripts** (task 1): `scripts/install.ps1` and `scripts/install.sh` check prerequisites, install, build, create the data directory, run the preflight, and print how to start; tested on Windows 11 with Windows PowerShell 5.1 and Git Bash. `pnpm start` at the root runs the built API, which now defaults `GG_DATA_DIR` to `~/.graphgoblin` and serves the checkout's `apps/web/dist` when `GG_WEB_DIST` is unset.
- **First API key** (D27, question 18): `graphgoblin-api --create-api-key <name> [--scopes a,b]` prints a new key once without starting the server.
- **Draft conflicts** (D26, question 17): `If-Match` with the draft's `draftToken` on `PUT /loops/{id}/draft`, 409 `DRAFT_CONFLICT`, and a reload-or-overwrite choice in the editor.
- **Visit cap** (D28, question 16): `maxIterations` also caps fresh visits per node; a cycle outside an exit loop-back fails with `MAX_ITERATIONS`.
- **User guide**: the "Coming in 1.0" callouts are replaced by documentation; what remains is marked "After 1.0". The cron latest-slot and read-scope callouts were replaced with documentation once WP-G, which implemented both, was merged.
- Decisions for questions 16 to 18 are ADR-0015. The release notes are `CHANGELOG.md`. The 1.0 tag follows the final sign-off.

Acceptance status: the install path is the script plus `pnpm start`, or `docker compose up`; the UI half of the performance check passed in WP-D2 (a 1,211-event run opens in about 0.5 s); the open-questions list has no 1.0 blockers. The adversarial passes are WP-D2 and the design review; their open findings are below.

## Residual risks and post-1.0 backlog

Ordered backlog, carried from the plan:

1. Claude Code adapter.
2. LiteLLM adapter and the summarise operation.
3. Per-loop concurrency policy.
4. Multi-tenant: auth provider, remote runner, Postgres adapter and dialect matrix, scheduler lease, owner scoping audit.
5. Fan-out and fan-in.
6. Retention policies, and the manual run and loop purge controls (guide 06).
7. Trigger presets.
8. Error or debug nodes, only if needed.

Product gaps known at 1.0 (each marked "After 1.0" in the guide or recorded in a QA report):

- Run inspector: no replay button; replay is `POST /runs/{id}/replay` and the MCP tool `replay_run`.
- `exposeTo` on manual triggers is recorded and described to MCP callers but not enforced.
- Inference `capabilities` (MCP servers, plugins, skills) are not resolved; use `harnessOptions.configOverrides`.
- Secrets: no OS-keyring master-key source and no per-secret envelope keys.
- Settings has no scheduler status card, and the API no scheduler status endpoint (WP-D2 gap).
- The Events screen does not list webhook endpoints; they are on `GET /loops/{id}/triggers` (WP-D2 gap).
- Editor: CodeMirror modes for Liquid and JSONata are stand-ins with no completion against a sample thread; no keyboard shortcuts for add, connect, or fit beyond the palette buttons and the Connect form; variables are edited in the Loop tab, not a side sheet (WP-D2 gaps).
- `run.queued.initialThread` has no size cap; offloading large seeds to the artifact store is the follow-up (05).
- `list_runs` pages by creation timestamp, so runs created in the same millisecond can be skipped across a page boundary (M7 notes).

Open defects (WP-D2 report; D26 to D28 are fixed in WP-F2):

- D29 (cosmetic): `POST /loops` with `content-type: text/plain` answers 400 `VALIDATION_FAILED` rather than 415.
- D30 (cosmetic): an empty heartbeat "Until" expression shows a compile error as its preview.

Open findings of the adversarial design review (`qa/2026-10-03-adversarial-design-review.md`) are tracked in that report and in WP-G.

Residual risks:

- Codex's sandbox inside the container image was not exercised live; it relies on kernel features a default container may not grant (11).
- The image is about 1 GB unpacked because of the Codex binary.
- The data-directory default changed from `./data` to `~/.graphgoblin`; installs that relied on the old default must set `GG_DATA_DIR` (CHANGELOG, guide 01).
- Draft saves without `If-Match` (scripts, the MCP `design-loop` flow) stay last-write-wins.
- `--create-api-key` trusts whoever can run it with the server's environment, the same boundary as the database and master key files.
- The Jev live check stays open until a key is available (WP-I).

## First week checklist

- [ ] M0 complete and CI green.
- [ ] Context thread co-design session scheduled; questions in 13 answered.
- [ ] Heartbeat node interpretation confirmed or corrected.
- [ ] Codex CLI and Jev account available on the development machine for M4 verification.

## Release sign-off

2026-10-03, first pass on `main` at `21fa22d`, re-verified on `0441b26`, `3776ee1`, and `07c166b` (report: `qa/2026-10-03-release-signoff.md`). Verdict: **ship 1.0.** Every gate passed with caches bypassed on `21fa22d` (typecheck, lint, layers, dependency rules, coverage above 90% on all four metrics in all eleven packages, licences, generated docs, build, format, tooling tests, Playwright E2E on Edge). The install script, the preflight, and one live Codex run (`gpt-6-luna`, `low`, read-only, answer `OK`, succeeded in 9.1 s) passed through the API with a fresh data directory. The four blockers the review found are fixed and verified. First, the unguarded second process: an exclusive data-directory lock is now taken before any database or recovery work. Second, the false secrets and purge claims in docs/11 and docs/02. Third, the lock's restart loop in the container. Fourth, the container first-key instructions. On `07c166b` the image was rebuilt and the full container sequence passed. The first start was healthy and served `/app/`. A restart after `docker kill` was healthy with the lock naming the new owner. `docker stop` released the lock. The documented first-key sequence produced a key the running API accepted with `GG_REQUIRE_API_KEY=true`. Stale `.reclaim` sidecars were reclaimed, and `--preflight` passed inside the container. Residual risks for 1.0:

- One API process per data directory, enforced by `<dataDir>/graphgoblin.lock` but with no execution or scheduler lease. Two data directories sharing one `GG_DB_URL` are unguarded. The lock cannot guard across containers sharing a volume: `docker compose run` while the API container runs takes the lock and leaves the running API without one (confirmed); stop the API first, as documented. A lock whose PID was reused by an unrelated host process refuses until it is removed by hand.
- Returns are at least once: a crash between delivering a channel and recording it re-delivers, so an `event` channel can start downstream runs twice and a `webhook` channel can post twice.
- A crash between creating a subloop child and recording `child_run.started` can orphan that child and start a second.
- Expression regexes are checked by a syntactic heuristic; polynomial backtracking, memory, and Liquid CPU and output size are not bounded in-process.
- Codex's sandbox inside the container image is not verified live; the image is about 1 GB.
- The Jev live check is open.
- `run.queued.initialThread` has no size cap beyond the request body limits.
- The product gaps and the cosmetic defects D29 and D30 listed above.
