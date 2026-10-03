# 10 - Testing and quality

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

## CI gates (Decided, in order)

1. Install with a frozen lockfile.
2. Typecheck every package, test files included.
3. Lint.
4. dependency-cruiser: layer rules and no circular imports.
5. Unit tests with coverage thresholds.
6. Licence allowlist check over the full dependency tree.
7. Generated reference docs are current (`pnpm check:docs`).
8. Dependency audit for known vulnerabilities, failing on high and critical.
9. Build every package and app.
10. Playwright E2E on the built app.
11. Build the container image on the default branch.

Nightly: live smoke suite, and the test matrix against both SQLite and Postgres once `adapter-postgres` exists.

## Fixture and SDK drift management (Decided)

- `@openai/codex-sdk` and `@typesafe-ai/sdk` are pinned to exact versions. Renovate opens upgrade PRs; the nightly live job and the recorded fixtures tell us whether the event shapes changed.
- A fixture is re-recorded with a small script in the adapter package, never hand-edited.

## Definition of done for any change (Decided)

- Tests added or updated, thresholds still met.
- OpenAPI document regenerated if a route changed, and the generated client rebuilt.
- Docs updated: the relevant numbered doc, and an ADR if a decision changed.
- No new dependency without a licence check and a line in `research/licenses.md`.

## Performance baseline (Decided by measurement, 2026-10-03)

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
