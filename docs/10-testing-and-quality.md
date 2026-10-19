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

The infrastructure HTTP tests use a local server with an unanswered route for timeout checks and destroy all accepted sockets in teardown. They assert `TimeoutError` and use a pre-aborted caller signal to check `AbortError`, avoiding races between response and abort timers. Ordinary probe and webhook requests allow 20 s for machine load; the timeout test also has a 20 s test budget.

Domain adversarial probes run untrusted expressions in disposable native Node processes. Their shared TypeScript source loader uses `node:module.register`, available on the verified Node 22.14 baseline, and requires no prior build. Heap caps, external watchdogs, evaluator deadlines and rejection assertions remain enforced; the loader does not patch the evaluated component.

Historical conversion tests use frozen contracts: the v1-to-v2 stage uses `V2*`, and the v2-to-v3 stage uses `V3*`. Their minimal-loop and thread factories stay pinned to the `12e5b87` capture, independently of current authoring fixtures. Complete parser-result hashes and conversion snapshots remain unchanged when current contracts move. These tests prove historical-stage output, not conversion to format 4; the final offline cutover owns that stage.

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
5. Migration generation is a no-op (`pnpm check:migrations`): generate against a temporary copy of shipped migrations and fail if Drizzle writes SQL.
6. Design token guard: no palette classes or colour literals in web components (`pnpm check:tokens`).
7. Unit tests with coverage thresholds.
8. Licence allowlist check over the full dependency tree.
9. Generated reference docs are current (`pnpm check:docs`).
10. Design token contrast table is current and every enforced pair passes (`pnpm check:contrast`).
11. Dependency audit for known vulnerabilities, failing on high and critical.
12. Build every package and app.
13. Playwright E2E on the built app.
14. Build the container image on the default branch.

Nightly: live smoke suite, and the test matrix against both SQLite and Postgres once `adapter-postgres` exists.

### Dependency-aware task caching (#127)

`transit` is a task without a package script. Its recursive `^transit` dependency hashes direct and transitive workspace source inputs. `test`, `test:coverage`, `lint` and `typecheck` depend on their package's `transit` task; `typecheck` also retains `^build`. This follows [Turbo's transit-node pattern](https://turborepo.com/docs/crafting-your-repository/configuring-tasks#dependent-tasks-that-can-be-run-in-parallel). Tests and type-aware lint resolve dependency TypeScript through the `development` export condition, so their cache keys must include those sources even when no build output changes.

This adds hash traversal without running dependency test or lint suites. CI retains `turbo run test:coverage --concurrency=1`: the number of executed coverage tasks and their serialization are unchanged. No CI wall-time improvement is claimed; changed dependency sources correctly cause more cache misses. Unrelated packages retain cache reuse.

Verify this behavior through Turbo itself rather than a test that merely repeats the JSON configuration. The [WP-A1 evidence record](qa/2026-10-18-wp-a1-runtime-gates.md) preserves the measured before/after proof. To repeat it on Node 22:

1. Use a writable cache (in a restricted worktree, set `TURBO_CACHE_DIR` to an absolute path under that worktree). Warm `pnpm exec turbo run test --filter=@graphgoblin/engine --concurrency=1 -- src/handlers/exit.test.ts --maxWorkers=1`, then repeat it to confirm a hit. The worker limit bounds host contention without changing assertions, exclusions, timeouts or coverage thresholds.
2. Save `packages/domain/src/expression.ts` byte for byte. Temporarily change `evaluateExpression`'s returned promise to `.then(() => 'WP-A1 behavioral seed')`. Repeat the same test command: the engine must rerun and its authored-return assertions must fail. Restore the original bytes in a `finally` block. Measured before the fix: five tests replayed successfully with `Cached: 1 cached, 1 total`. After the fix: `Cached: 0 cached, 1 total`, three failed assertions received the seeded string instead of `{ value: 42 }`.
3. Warm engine `typecheck` and `lint` with the same filter. Temporarily append `export const threadView = 22;` to domain's public entry point. Domain's export is valid, but engine callers require a function. Typechecking must fail; type-aware lint must rerun and report changed diagnostics (`no-unsafe-argument` and `no-unnecessary-type-assertion` in this probe). Restore the entry point. The pre-existing `^build` edge already protected typechecking; do not describe it as an old false green.
4. After restoring dependencies, append a comment to `packages/adapter-jev/src/index.ts` and repeat the engine test command. It must hit the healthy cache, since that package is not an engine dependency. Restore the comment. The measured control retained `Cached: 1 cached, 1 total`.
5. Exercise a disposable `A -> B -> C` workspace with an unrelated D, using a copy of this `turbo.json`, a private cache and ignored `.turbo` logs. A's `test:coverage` script runs a Node assertion over B's public entry point, which calls C's public entry point. Change B and C independently, confirming a cached false pass before the fix and a rerun/failure after it; restore each seed, and confirm changing D still hits. This fixture tests the coverage task's direct/transitive invalidation; it does not measure GraphGoblin coverage. It needs no installed dependencies or external links; disable pnpm's automatic pre-run installation only in this fixture.
6. Repeat the behavior seed with the full `pnpm exec turbo run test:coverage --filter=@graphgoblin/engine --concurrency=1` task, warming and confirming a healthy hit under each configuration before seeding. The measured original configuration replayed 455 passing tests with `Cached: 1 cached, 1 total`; the fixed configuration reran with `Cached: 0 cached, 1 total` and 78 failures, including `expected 'WP-A1 behavioral seed' to be 42`. After restoring the source, an unrelated adapter comment retained `Cached: 1 cached, 1 total`. Preserve earlier unseeded timing failures too: they are unresolved observations, not green coverage gates. Use `--force` for full verification: a replayed test log is cache evidence, not a fresh test execution.

`pnpm check:migrations` runs Drizzle Kit against the current schema and a disposable copy of the shipped migration ledger and snapshots. It never changes shipped SQL, snapshots, or the ledger. Additive schema drift is covered by a tooling regression test.

Storage readiness tests distinguish the format baseline from the migration head. Format 3 requires `0008_github_triggers`: preflight checks its SQL-derived catalogue, a current complete marker, a timestamp-only shipped-ledger prefix containing that baseline, and strict definitions before writes. Stores at 0008, 0009 or 0010 migrate normally to 0011. Post-migration validation requires the full head catalogue and exact timestamp list. Tests cover baseline damage/non-prefix ledgers before writes, historical applied SQL hashes, and a head ledger with missing additive structure after a no-op migration. Definitions are parsed once only when the preflight database is covered by the data-directory lock; external database URLs are reparsed. Offline-sort tests force multiple bounded fan-in passes, assert hash/issue ordering parity and exercise scratch cleanup after failure.

`pnpm check` also runs `check:tokens` after `check:layers` and `check:contrast` at the end. The token guard checks web source (`.ts`, `.tsx`, `.css`), `index.html`, and `vite.config.ts` for Tailwind palette colour utilities and colour literals in CSS declarations, style/colour properties, and arbitrary colour utilities. CSS named colours are checked only in these colour-setting contexts; prose, identifiers, URLs, and non-colour hex data are permitted. `transparent`, `current`, `currentColor`, and token references are permitted. This static check does not evaluate computed JavaScript values. Tests and `__fixtures__` are skipped. `src/styles/` is the only directory allowlist; there are no inline suppressions. The explicit `CONFIG_EXCEPTIONS` list in the script starts empty and may contain one named, exact palette declaration per config file (a theme-colour meta tag in HTML or a named constant in Vite), never a whole-file or whole-value exemption.

`pnpm docs:contrast` generates `docs/qa/design-contrast.md` from `apps/web/src/styles/tokens.css` and `tooling/scripts/design-contrast.pairs.json`; `check:contrast` rejects a missing/stale table or an enforced pair below 4.5:1 for text or 3:1 for non-text, in either theme. Focus-ring pairs cover every declared surface; decorative pairs are reported without enforcement. The approved palette uses opaque sRGB hex values; unsupported colours fail clearly. Use `--tokens <css>` or `GG_DESIGN_TOKENS` to override the input and `--output <md>` for a temporary test table. Node's built-in runner discovers the tooling unit and CLI fixture tests through the existing `tooling` test commands.

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
