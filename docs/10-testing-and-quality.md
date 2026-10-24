# 10 - Testing and quality

The separate-process recovery check runs with `pnpm build` followed by `pnpm test:recovery-process`. It starts the built API against disposable mixed healthy/damaged SQLite history and removes its temporary data directory on success.

## Coverage policy (Decided)

- Unit tests must cover more than 90% of lines and more than 90% of branches in every package, including `apps/web`. Thresholds are set in each package's Vitest config and enforced in CI. A package below threshold fails the build.
- Generated code, the OpenAPI client, migrations, and fixture files are excluded from the denominator. Nothing else is.
- Coverage is measured with Vitest's v8 provider and reported per package and merged for the repo.

## Test layers (Decided)

| Layer                                 | Tooling                                                                                 | What it proves                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Unit: `contracts`, `domain`, `engine` | Vitest with fake ports and a fake clock                                                 | Graph validation, patch application, exit criteria, state machine, every node handler, crash recovery, cancellation |
| Unit: adapters                        | Vitest with recorded fixtures and in-memory SQLite                                      | Event normalisation, repository behaviour, scheduler timing, signature verification                                 |
| Unit: `apps/api`                      | Vitest with Fastify inject and in-memory SQLite                                         | Every route, validation errors, auth, SSE framing and resume                                                        |
| Unit: `apps/web`                      | Vitest with Testing Library and the browser mode where DOM APIs matter; MSW for the API | Components, hooks, stores, thread projection, editor validation, update toast                                       |
| End to end                            | Playwright against a built app with a seeded database and a fake harness                | Draw a loop, publish, run, watch events, provide input, cancel                                                      |
| Live smoke                            | Nightly, behind an environment flag                                                     | A tiny Codex session and a Jev call to detect SDK drift                                                             |

The Codex plugin assembly tests use a fresh temporary directory per test and retry temporary-directory cleanup on Windows. MCP entry fixtures and a fake package layout keep these tests independent of build output. The three tests that copy plugin directories have a 20 s timeout: repository-wide parallel runs can exceed Vitest's 5 s default for filesystem I/O. The other tests in `plugin.test.ts` retain the default timeout.

The infrastructure HTTP tests use a local server with an unanswered route for timeout checks and destroy all accepted sockets in teardown. They assert `TimeoutError` and use a pre-aborted caller signal to check `AbortError`, avoiding races between response and abort timers. Ordinary probe and webhook requests allow 20 s for machine load; the timeout test also has a 20 s test budget.

Domain adversarial probes run untrusted expressions in disposable native Node processes. Their shared TypeScript source loader uses `node:module.register`, available on the verified Node 22.14 baseline, and requires no prior build. Heap caps, external watchdogs, evaluator deadlines and rejection assertions remain enforced; the loader does not patch the evaluated component.

Historical conversion tests use frozen contracts: the v1-to-v2 stage uses `V2*`, and the v2-to-v3 stage uses `V3*`. Their minimal-loop and thread factories stay pinned to the `12e5b87` capture, independently of current authoring fixtures. Complete parser-result hashes and conversion snapshots remain unchanged when current contracts move. These tests prove historical-stage output, not conversion to format 4; the final offline cutover owns that stage.

`apps/api/src/guide-examples.test.ts` extracts the visible `guide-example` markers in guides 02 and 03, validates their JSON with current contracts, then imports, saves, publishes and executes the loops through Fastify inject over disposable in-memory SQLite and the fake harness. It also exercises the HTTP requests represented by the command examples; it does not launch a shell. Every fenced block is inventoried in a named test. The MCP suite in `apps/mcp/src/mcp.test.ts` also extracts `start-mcp` and starts it by its exact loop name over the SDK transport against the disposable API, with the fake harness. The first-summary graph runs with a scripted fake response; its paid Codex variant is explicitly excluded from provider execution because it needs an installed authenticated provider and consumes usage. Run the check with `pnpm --filter @graphgoblin/api exec vitest run src/guide-examples.test.ts`.

## Fake harness (Decided)

`packages/engine` ships a `FakeHarness` that replays scripted sessions: items, usage, a final text, an optional structured result, and optional failures. It is used by engine tests, API tests, and E2E, so the whole product is testable without tokens. The Codex adapter's fixtures are JSONL captures of real sessions used only by the adapter's own tests.

## Adversarial QA (Decided)

The owner's chosen strategy for UI quality is heavy evaluation by adversarial QA agents rather than restructuring the UI for testability. Each milestone that touches the UI ends with a QA pass run by subagents equipped with the Playwright MCP server and computer use. The playbook:

1. Seed a database with representative loops: a two-node loop, a loop with every node kind, a loop with a subloop, and a loop waiting for input.
2. Give the QA agent the acceptance criteria for the milestone and the instruction to break the feature: unusual inputs, rapid repeated actions, reloads mid-flow, lost connections, narrow viewports, keyboard-only use.
3. The agent records every defect with steps, a screenshot, and the console log, and files them as issues.
4. Defects are fixed before the milestone closes. A regression test is added for each defect that can be reproduced in a unit or E2E test.

This process complements, and never replaces, the coverage gate.

The first pass (WP-D2, 2026-10-03) drove the built app with Playwright on Microsoft Edge and attacked the API directly; its defects, fixes, and open gaps are in `qa/2026-10-03-wp-d2.md`. Its regressions live in `apps/web/e2e/qa.spec.ts` and `apps/api/src/qa.test.ts`. The E2E server (`apps/web/e2e/server.ts`) has a loopback control port, published to specs as `GG_E2E_CONTROL_URL`, that scripts the fake harness (`POST /harness/script`, with `items` as a count for long streams), toggles decider availability, sets structured responses, reads the model and effort of harness requests, polls timers, and starts extra API instances (`POST /apps` with `requireApiKey`, which also mints a key; `POST /apps/live` with the real adapters). `apps/web/e2e/live.spec.ts` builds, publishes, and runs a one-turn inference loop against Codex through the UI and is skipped unless `LIVE=1`.

Two-tab conflict checks explicitly activate each editor before navigation, wait for its heading and for the existing server/device reconciliation notice to clear, then assert the stored draft and each conflict resolution. These waits synchronize observable state; they are not sleeps or render-speed assertions. The [WP-A2 QA report](qa/2026-10-18-wp-a2-browser-gates.md) records the pre-change modal failure, single activation A/B diagnostic and bounded repeated checks; the historical second-tab failure remains not reproduced, not disproven.

Exit evidence after the decision-gate redesign (#129) has a [capability inventory](qa/2026-10-18-exit-evidence-inventory.md) and a [self-contained owner review](qa/2026-10-19-wp-g4-exit-evidence/README.md). The review builds an isolated instance on port 5641 with disposable data and imports three loops from the same folder. Its browser regressions are in `apps/web/e2e/exit-primitives.spec.ts` and `apps/web/e2e/classifiers.spec.ts`.

## CI gates (Decided, in order)

1. Install with a frozen lockfile.
2. Typecheck every package, test files included.
3. Lint.
4. dependency-cruiser: layer rules and no circular imports.
5. Migration generation is a no-op (`pnpm check:migrations`): generate against a temporary copy of shipped migrations and fail if Drizzle writes SQL.
6. Design token guard: no palette classes or colour literals in web components (`pnpm check:tokens`).
7. Unit tests with coverage thresholds.
8. Licence allowlist check over the full dependency tree.
9. Generated reference docs are current (`pnpm check:docs`).
10. Design token contrast table is current and every enforced pair passes (`pnpm check:contrast`).
11. Dependency audit for known vulnerabilities, failing on high and critical. An advisory may be accepted only when the vulnerable package is test-only and unreachable from shipped code; each accepted advisory is listed under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` with its reason and the condition for removing it, and recorded in the CHANGELOG.
12. Build every package and app.
13. Playwright E2E on the built app.
14. Build the container image on the default branch.

Nightly: live smoke suite, and the test matrix against both SQLite and Postgres once `adapter-postgres` exists.

`pnpm check:migrations` runs Drizzle Kit against the current schema and a disposable copy of the shipped migration ledger and snapshots. It never changes shipped SQL, snapshots, or the ledger. Additive schema drift is covered by a tooling regression test.

Storage readiness tests distinguish the format baseline from the migration head. Format 3 requires `0008_github_triggers`: preflight checks its SQL-derived catalogue, a current complete marker, a timestamp-only shipped-ledger prefix containing that baseline, and strict definitions before writes. Stores at 0008, 0009 or 0010 migrate normally to 0011. Post-migration validation requires the full head catalogue and exact timestamp list. Tests cover baseline damage/non-prefix ledgers before writes, historical applied SQL hashes, and a head ledger with missing additive structure after a no-op migration. Definitions are parsed once only when the preflight database is covered by the data-directory lock; external database URLs are reparsed. Offline-sort tests force multiple bounded fan-in passes, assert hash/issue ordering parity and exercise scratch cleanup after failure.

`pnpm check` also runs `check:tokens` after `check:layers` and `check:contrast` at the end. The token guard checks web source (`.ts`, `.tsx`, `.css`), `index.html`, and `vite.config.ts` for Tailwind palette colour utilities and colour literals in CSS declarations, style/colour properties, and arbitrary colour utilities. CSS named colours are checked only in these colour-setting contexts; prose, identifiers, URLs, and non-colour hex data are permitted. `transparent`, `current`, `currentColor`, and token references are permitted. This static check does not evaluate computed JavaScript values. Tests and `__fixtures__` are skipped. `src/styles/` is the only directory allowlist; there are no inline suppressions. The explicit `CONFIG_EXCEPTIONS` list in the script starts empty and may contain one named, exact palette declaration per config file (a theme-colour meta tag in HTML or a named constant in Vite), never a whole-file or whole-value exemption.

`pnpm docs:contrast` generates `docs/qa/design-contrast.md` from `apps/web/src/styles/tokens.css` and `tooling/scripts/design-contrast.pairs.json`; `check:contrast` rejects a missing/stale table or an enforced pair below 4.5:1 for text or 3:1 for non-text, in either theme. Focus-ring pairs cover every declared surface; decorative pairs are reported without enforcement. The approved palette uses opaque sRGB hex values; unsupported colours fail clearly. Use `--tokens <css>` or `GG_DESIGN_TOKENS` to override the input and `--output <md>` for a temporary test table. Node's built-in runner discovers the tooling unit and CLI fixture tests through the existing `tooling` test commands.

### Dependency-aware task caching (#127)

`transit` has no package script; its recursive `^transit` edges hash direct and transitive workspace sources. `test`, `test:coverage`, `lint` and `typecheck` depend on local `transit`; typecheck retains `^build`. Root `eslint.config.js` and `tsconfig.base.json` are global inputs. This follows [Turbo's transit-node pattern](https://turborepo.com/docs/crafting-your-repository/configuring-tasks#dependent-tasks-that-can-be-run-in-parallel).

A test that reads files outside its package declares them as `$TURBO_ROOT$` inputs alongside `$TURBO_DEFAULT$`. API and MCP guide tests declare their guides; domain conversion tests declare API templates. Tooling tests read the whole repository, so their test and coverage tasks are uncached. Package-specific task definitions restate their transit dependencies and coverage outputs.

Run gates through pnpm: calling `node_modules/.bin/turbo` directly bypasses the runtime check, and Turbo's cache key ignores the running Node version. CI retains coverage `--concurrency=1`; transit adds hash traversal without running dependency suites. Correct dependency invalidation causes more work when inputs change, while unrelated packages retain reuse.

1. Warm a selected cacheable task, then repeat it to confirm a hit.
2. Change a dependency source or declared external input; repeat the same task and confirm a miss. A covered behavioral regression must fail.
3. Restore that input, change an unrelated package and confirm the healthy task still hits. Restore the unrelated change.

## Fixture and SDK drift management (Decided)

- `@openai/codex-sdk` and `@typesafe-ai/sdk` are pinned to exact versions. Renovate opens upgrade PRs; the nightly live job and the recorded fixtures tell us whether the event shapes changed.
- A fixture is re-recorded with a small script in the adapter package, never hand-edited.

## Definition of done for any change (Decided)

- Tests added or updated, thresholds still met.
- OpenAPI document regenerated if a route changed, and the generated client rebuilt.
- Docs updated: the relevant numbered doc, and an ADR if a decision changed.
- No new dependency without a licence check and a line in `research/licenses.md`.

## Performance baseline (Decided by measurement, 2026-10-03)

The #186 server/transport change has a current-baseline [before report](qa/2026-10-22-wp-e1-186-before.md)
and the same-workload [after report](qa/2026-10-22-wp-e1-186-after.md), including full/late/slow/
interrupted/reconnected exact payload hashes, event-loop delay, raw paused-socket wire bytes,
and separate heap samples. Engineering bounds are ADR-0050. API regressions exercise paged
replay with a concurrent append, bounded held live events, and a paused real socket against
SQLite followed by complete cursor recovery. Client and hook regressions cover typed failure,
resume cursor, visible retry reason and early batch flush. The tests were run red on the base.
The round-1 7,078 ms replay and 569 ms loop maximum were host contention, as established by the
reviewer's [interleaved same-host A/B](qa/2026-10-22-wp-e1-186/round-2/review-ab-bench-out.json)
(41,001 events, three rounds): base 3,525.67 ms total / 2,569.01 ms stall / 2,561.28 ms first event;
round-1 head 3,315.19 ms / 180.75 ms / 17.83 ms. The benchmark and reader source are retained
with that evidence; this comparison is separate from the original non-interleaved runs.
The [round-3 terminal-cursor evidence](qa/2026-10-22-wp-e1-186/README.md#round-3-bounded-terminal-confirmation)
compares empty replies on 42,102-event histories and verifies constant read work at/past the end,
including post-terminal delivery audits and resume invalidation. It does not repeat the full replay benchmark.
The [round-4 completion evidence](qa/2026-10-22-wp-e1-186/README.md#round-4-authoritative-stream-completion)
reproduces and fixes truncated resumed histories, omitted delivery audits, empty-cursor retries
and initial corruption retries, using the audit's real SQLite/HTTP and injection probes plus
regressions run red on the audited head. Completion checks retain bounded reads; this is
transport correctness evidence rather than a new full-replay performance comparison.
Shared-host observations are not a quiet-host performance guarantee. History browsing follows
in #186 round 2.

The sustained, file-backed baseline for #190 is recorded in [2026-10-18 sustained-run measurements](qa/2026-10-18-sustained-run-measurements.md). [The repeatable scripts](../tooling/perf/README.md) cover cyclic work, growing context, SSE replay and slow readers, transcripts, readiness, populated stores, and headless Edge. They run separately from coverage and preserve their disposable stores, JSON summaries, memory samples, and API CPU profiles. The earlier in-memory baseline below remains historical evidence.

`apps/api/src/perf.test.ts` boots the API in-process over the in-memory database with the fake harness, whose scripted turn streams 1,000 items, so one run of `trigger -> inference -> exit` appends 1,011 events (one `node.progress` per item). It is skipped unless `PERF=1`:

```
PERF=1 pnpm --filter @graphgoblin/api test -- src/perf.test.ts           # bash
$env:PERF='1'; pnpm --filter @graphgoblin/api test -- src/perf.test.ts   # PowerShell
```

It prints a `PERF { ... }` JSON summary. Baseline on the development machine (Windows 11 Pro, AMD Ryzen 5 3600 6-core / 12 threads, 64 GiB, Node 23.10.0):

| Measurement                                                          | Result                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 10 runs in parallel (`GG_MAX_CONCURRENT_RUNS=10`), 1,011 events each | all 10 succeeded; wall 6.7 s; each run 6.5 to 6.7 s; about 1,500 events/s appended overall |
| SSE replay of a finished run's 1,011 events over a socket            | first event 91 ms, all events and stream end 103 ms                                        |
| SSE live tail of a run started as the client connects                | first event 20 ms, all 1,011 events and stream end 747 ms (the run's own duration)         |

Finding fixed while measuring: libsql's local client does its work in native code and settles its promises without returning to the event loop, so a run appending events back to back starved every socket and timer. Before the fix the live tail's first event arrived after 755 ms, at the end of the run, and a 5 ms interval timer fired 3 times in an 800 ms run. The serialised database client (`packages/infrastructure/src/sqlite/db.ts`) now yields with `setImmediate` before a statement whenever 10 ms have passed since its last yield; throughput is unchanged. Appends cost about 0.7 ms each (one transaction per event: max `seq`, insert, update `last_event_seq`), which is far above what a real harness streams; batching appends is the lever if that ever matters.

## Disposable API process lifecycle (#317)

`apps/api/src/main.test.ts` uses `src/testing/api-subprocess.ts` against the built
`apps/api/dist/main.js`. API subprocess tests build the API first through Turbo's
`test` and `test:coverage` task dependencies. Direct package test commands bypass
Turbo, so run `pnpm build` first; a missing entry reports that command explicitly.
Each fixture owns a temporary `gg-api-process-*` directory and a free loopback port
from 5600 to 5699, clears inherited `GG_*` configuration, and creates its API key
through the binary. CLI dispatch is proved by exit codes 0/1/2. Corrupt SQLite
refusal, occupied-port cleanup and Linux native signal shutdown are distinct
evidence. The corrupt database fails before HTTP setup; a literal `*` static asset
supplies a separate real post-container route-registration fault on POSIX.

Signal cases run only on Linux. Node force-kills children on SIGINT/SIGTERM on
win32 and does not execute JavaScript handlers. The literal wildcard asset also
skips win32 because Windows rejects that filename. CI on `ubuntu-latest` supplies
those native cases; captured process callbacks establish none of these claims.
A Linux FIFO at the supported master-key file path keeps startup asynchronously
pending while a real signal is handled: the shutdown log must precede readiness,
ownership remains held, and after releasing the FIFO startup completes before a
clean exit releases the lock and closes the listener. The fixture uses Ubuntu
coreutils `mkfifo`; native SQLite busy waits alone can block the JS event loop.
The harness proves listener closure, lock release, one shutdown and exit codes;
#224 extends drain/force behavior later. Forced child termination in fixture
cleanup is never counted as graceful shutdown evidence.

Subprocess waits, lifecycle cases and fixture cleanup have 60-second budgets for loaded hosts; the rest of
the API suite retains its defaults. Child V8 coverage is off by default, including
inherited `NODE_V8_COVERAGE`; `GG_API_SUBPROCESS_V8_COVERAGE=1` opts into diagnostic
reports inside the disposable directory, separate from Vitest package coverage.
The helper remains in the normal source denominator, with no exclusion or
threshold adjustment.

Process fixtures stop their children and best-effort remove their temporary
stores and reports, retrying native handle release. The `gg-publish-*` fixtures
use separate real SQLite connections to arrange draft/publish interleavings,
then close both clients and best-effort remove their temporary database directory.
No owner process, store, or port is used.
