# WP-G2 delivery evidence (#231, #236)

## 1. Branch and worktree

Branch: `codex-wp-g2-paging-summaries`.
Worktree: `<local>/source/repos/GraphGoblin/.claude/worktrees/codex-wp-g2-paging-summaries`.
Starting commit: `11f32322c284905f07f847102bf995080db33b8c`.
Uncommitted; no index operations, commits, GitHub writes, or owner-instance actions.
Uncommitted; ready for orchestrator review. Commit/closure readiness still requires Opus review,
the unrestricted native gate, and owner product acceptance; no green-gate claim is made.

## 2. Per bolt

### #231 - opaque history cursors and validated filters

**Confirmed baseline reproductions.** The real SQLite/in-process API/MCP regression
`apps/mcp/src/paging.test.ts` failed before implementation:

> expected { items: [ { ... } ], ... } to have property "nextCursor"

The baseline tool returned `nextBefore` from the last run's `createdAt`. For three
records at `2026-10-02T12:00:00.000Z`, the timestamp-only bound selects zero of
the tied records. The retained MCP test verifies this explicitly, then verifies
that the new cursor contract retrieves all four matching tied records exactly once
with limit one and unchanged loop/status/parent/before filters.

A two-event real SQLite log, read with limit two, failed before the fix:

> Expected "hasMore": false; Received "hasMore": true; "nextAfter": 2

The first event fixture lacked its required actor and was corrected before recording
this regression result. It is not counted as evidence of a product failure.

After `pnpm.cmd build`, both baseline browser tests reported:

> getByRole('button', { name: 'Load more' }): Expected visible; element(s) not found

Each had 101 seeded records and only 100 visible rows. The final tests assert
101 distinct run IDs or event rows after appending, filter retention, exhaustion,
and the existing rows and reading position remaining in place.

**Status-filter report not reproduced on this baseline.** Current `status=unknown`
already returned the required typed 4xx before a corrective change to validation.
The error plugin and status validation are retained; their exact live response was:

```http
400 application/problem+json; charset=utf-8
{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/status","message":"Use comma-separated run statuses."}]}
```

Acceptance evidence:

- API tuple ordering, limit-one ties, every ordinary filter and combined filters,
  exhaustion, invalid cursors/statuses, owner isolation and concurrent insertions:
  `apps/api/src/routes/run-paging.test.ts` (retains landed tests and adds filter-page regressions).
- Inbound Events ties/type/before/owner scope, exact-full exhaustion and invalid inputs:
  `apps/api/src/routes/event-paging.test.ts`; repository bounds and >500 records:
  `packages/infrastructure/src/sqlite/history-summaries.test.ts`.
- API-client page contracts and unchanged filter/cursor forwarding, request cancellation:
  `packages/api-client/src/resources.test.ts` and `contract.test.ts`.
- MCP real API/SQLite pages and authoritative event tails, including exactly full capped
  resource reads: `apps/mcp/src/paging.test.ts`; existing tool tests updated.
- Browser next-page controls, failed-page retry without remounting loaded rows,
  filter changes, busy guards and cancellation: Runs/Events component tests and
  `apps/web/e2e/history.spec.ts`.

Paging contract by consumer:

| Consumer                                              | Contract                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Runs API / `runs.list`                                | `{items, nextCursor: string or null}`; repeat filters and copy opaque `nextCursor` to `cursor`                                        |
| MCP `list_runs`                                       | Same continuation; compact items; `before` is a time bound, not a continuation                                                        |
| Inbound Events API / `events.list`                    | Same continuation, ordered by `(receivedAt, id)` descending; repeat `type`/`before`                                                   |
| Run-event API / `runs.events` / MCP `read_run_events` | `{items, nextAfter, hasMore}`; existing sequence-number `after` remains numeric; API lookahead decides `hasMore`                      |
| Web Runs / Events                                     | Infinite queries keyed by filters; Load more appends; final footer retains height; failure retains rows/disclosures and permits retry |

### #236 - truthful latest-run summaries

**Confirmed.** Real SQLite API test seeded two old tied runs, 501 newer unrelated
runs and a genuinely empty loop. `/runs?limit=500` omitted the old loop entirely;
`/loops` lacked the required summary/count. Before the fix:

> expected { ... } to match object { latestRun: { ... }, runCount: 2 }

A baseline browser run with 501 newer unrelated runs showed:

> row "older history ... published never run Edit older history Export older history Delete older history"

A first browser fixture used equal timestamps with random ULIDs and therefore did
not guarantee that the old loop fell outside 500 records. The fixture was corrected
by advancing the public fake clock one millisecond before the unrelated runs.
Only that corrected reproduction is used for the never-run claim.

The fix adds `latestRun: {id, status, createdAt} | null` and exact `runCount` to
`GET /loops` items. One SQL statement joins each owner's loop to the run selected
by a correlated `ORDER BY created_at DESC, id DESC LIMIT 1`, and computes a
correlated count scoped by both loop and owner. It selects only compact run columns,
uses the existing loop/time index and avoids N+1 API requests, a global cap,
windowing all run payloads, or persisted summary state. No migration is needed.

Acceptance evidence:

- SQLite and API tests named "summarizes each owner loop beyond 500 unrelated runs"
  and "finds older history beyond 500 unrelated runs" verify >500, tied IDs, empty
  history, exact counts and (repository) cross-owner contamination/status changes.
- Loops component test "uses loop summaries for old history and deterministic ties
  without a global run query" and exact-count confirmation above 500.
- Browser `history.spec.ts` older-history/no-history/exact-count scenario; existing
  `loop-lifecycle.spec.ts` checks the summary after real executor completion.

Owner acceptance remains outstanding for both bolts.

## 3. Files changed

- Infrastructure: `src/sqlite/loops.ts` summary query; `triggers.ts` inbound tuple
  paging; new `history-summaries.test.ts`. `runs.ts` and engine ports are unchanged.
- API: loop/run/inbound routes; new `event-cursor.ts`, `event-paging.test.ts`,
  `loop-summaries.test.ts`; extended `run-paging.test.ts`; two existing test expectations
  updated for deterministic inbound ordering/new metadata (`api.test.ts`, `webhook-keys.test.ts`).
- API-client: resource wrappers, exported event-query type, contract/forwarding tests,
  generated `openapi.json` and `src/generated/schema.ts`.
- MCP: `tools.ts` listing/event reads only; `resources.ts` paging metadata and recent
  list shape; tool regression updates and new `paging.test.ts`.
- Web: history/loop queries, Runs/Events/Loops pages and tests, shared `HistoryState`,
  opt-in cached-data error rendering in `status.tsx`, request-aware API fixture,
  reconnect test signatures; new `e2e/history.spec.ts` and a public fake-clock control
  in `e2e/server.ts`. No manual refresh action was added.
- Docs: this report, docs/07, docs/09, CHANGELOG and generated API reference.

WAVE overlap: `packages/infrastructure/src/sqlite/loops.ts` (WP-C1) is an additive
API-only query; create/publish/pinning regions are untouched. `apps/api/src/routes/runs.ts`
(WP-C1/WP-C2) changes only listing validation composition and event-page response/read.
`apps/mcp/src/tools.ts` (WP-C1/WP-C2/WP-C4) changes only `list_runs`/`read_run_events`.
`packages/api-client/src/resources.ts` (WP-C2/WP-C4) changes only run/inbound list wrappers
and the new query type; input/wait behavior is untouched. docs/07 and CHANGELOG are
shared edits confined to this package's contracts and bullets.

## 4. Tests

All corrective regressions use supported repository, HTTP/MCP or browser interfaces.
No new dependencies, threshold changes, coverage exclusions or production test hooks.
The baseline failures and corrected-fixture limits are quoted above.

| Package        | Result                                                             | Lines              | Branches           |
| -------------- | ------------------------------------------------------------------ | ------------------ | ------------------ |
| infrastructure | 493 passed, 6 native failures; truthful report-on-failure coverage | 98.79% (1878/1901) | 94.89% (1470/1549) |
| api-client     | 51 passed                                                          | 100% (211/211)     | 99.32% (147/148)   |
| api            | 642 passed, 2 pre-existing skips                                   | 98.49% (1700/1726) | 93.55% (1234/1319) |
| mcp            | 41 passed                                                          | 95.27% (242/254)   | 95.47% (211/221)   |
| web            | 1475 passed, final footer and cleanup included                     | 98.93% (6992/7067) | 94.83% (7144/7533) |

All reported packages retain the complete configured source denominator. Infrastructure
numbers do not imply that its native gate passed. The final web command exited 0
(116 files, 1475 tests, 667.55 seconds).

## 5. Gates

All commands select Node `v22.14.0` first on PATH. The resume prerequisite
`pnpm.cmd typecheck` passed (20 tasks, baseline cache hits).

Final gate results (PowerShell `pnpm.cmd`, Node 22):

| Command                                                                                                 | Result                                                                                              |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                    | PASS, 20 tasks, including final test cleanup                                                        |
| `pnpm.cmd lint`                                                                                         | PASS, 11 tasks; corrected test cleanup lint; no suppressions                                        |
| `pnpm.cmd format:check`                                                                                 | PASS; final report formatted and checked                                                            |
| `pnpm.cmd check:layers`                                                                                 | PASS                                                                                                |
| `pnpm.cmd check:deps`                                                                                   | PASS, 0 errors; existing orphan warning for infrastructure/drizzle.config.ts                        |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage`                                           | FAIL, 13 failures / 486 passed; native and upgrade timeouts                                         |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure` | FAIL, 6 native failures / 493 passed; upgrade tests pass in this bounded run; coverage above policy |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                      | Initial FAIL: 4 intended contract-expectation changes (fixed), plus 1 unchanged template timeout    |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage`                                               | Initial FAIL: 2 unchanged template tests timed out; bounded result below is separate evidence       |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`                                                      | PASS, 1475 tests before final stable-footer refinement; coverage above policy                       |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2`                                       | PASS, 642 passed / 2 skipped, coverage above policy                                                 |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=2`                                | PASS, 51 passed, coverage above policy                                                              |
| `pnpm.cmd --filter @graphgoblin/mcp test:coverage`                                                      | PASS, 41 passed, coverage above policy                                                              |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2`                                       | PASS, exit 0; 1475 tests, final footer; coverage above policy                                       |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                                    | PASS                                                                                                |
| `pnpm.cmd docs:generate`                                                                                | PASS                                                                                                |
| `pnpm.cmd check:docs`                                                                                   | PASS                                                                                                |
| `pnpm.cmd check:tokens`                                                                                 | PASS, 162 files                                                                                     |
| `pnpm.cmd build`                                                                                        | PASS, 11 tasks, final footer built                                                                  |
| `pnpm.cmd exec playwright test e2e/history.spec.ts e2e/loop-lifecycle.spec.ts` (apps/web)               | PASS, 5 tests, 45.6 seconds, final built UI; no retries                                             |
| `git diff --check`                                                                                      | PASS                                                                                                |

No dependency changes; `check:licenses` was not required. Turbo emitted cache-write
`Access is denied` warnings but its task commands succeeded. Original coverage logs
redirected directly by Windows PowerShell include native-stderr ErrorRecords; pnpm/Vitest
summaries establish the listed test results. Final web/infrastructure capture uses cmd
redirection and an explicit native exit code to avoid that wrapper ambiguity.

Initial API coverage found
four assertions affected by the intended contract change (one ordering and three
empty-page metadata cases); these tests were updated. Initial broad API/client runs
also timed out in unchanged template tests under concurrent coverage load. The
bounded verification uses `--maxWorkers=2` without raising timeouts or changing policy.

Infrastructure's default full suite failed 13 tests (486 passed): six native process
cancellation tests and seven existing upgrade tests. A disposable child-process probe
independently returned `taskkillExit: 1, output: "ERROR: Access denied"` for
`taskkill /T /F`. Native failures include EBUSY cleanup and still-writing descendants.
This is an unresolved sandbox verification limitation; no native behavior is claimed
from the passing SQL tests. The bounded run with `--coverage.reportOnFailure` retained all six native failures,
passed the upgrade tests, and collected truthful coverage. It is not a green gate workaround.

The first corrected browser run passed Events and loops/lifecycle but exposed a
six-pixel scroll clamp in Runs when the exhausted button disappeared. The footer
now retains its height; the unchanged test assertion and all five final browser checks pass.

## 6. Docs

- docs/07: run/inbound cursor contracts, unchanged filter propagation, typed status
  errors, numeric run-event continuation with authoritative metadata, loop summaries.
- docs/09: loop latest-run/count source and five-second refresh.
- CHANGELOG: separate #231/#236 bullets. #231 has **Upgrade:** notes for page-returning
  wrappers and MCP `cursor`/`nextCursor` replacing timestamp continuation.
- API-client generator and `pnpm.cmd docs:generate` update generated contracts/reference.
- No ADR: these complete the accepted paging and summary design without a new product decision.

## 7. Decisions and parameters

- Keep landed run-cursor encoding/decoding and typed status validation. Permit `before`
  together with a cursor because it is an active time filter that must remain on every page.
- Inbound cursor mirrors the canonical bounded run cursor but carries `receivedAt`;
  list cursors are opaque to consumers and are not interchangeable with event sequences.
- Reuse existing page sizes: run/inbound default 100, max 500; MCP list default 20;
  MCP event default 100, max 1000; run-event API default 500. One extra row/event gives
  authoritative continuation. No arbitrary cap on accessible history.
- Compact SQL summaries and exact count in the existing listing are the smallest design:
  no extra endpoint, no cached summary invalidation and no global page approximation.
- Keep existing five-second run/loop refresh and pending-event polling. Paging retains
  cached rows on next-page errors and a stable-height footer at exhaustion.
- Two coverage workers are a local verification resource bound, not an owner-approved
  product parameter or a repository test-policy change.

## 8. Caveats and open items

No commits, staging, pushes, PRs, issue changes, merges or owner-instance modifications.
#240 manual Events refresh is untouched. No real provider turn is claimed.
Independent Opus review and owner product acceptance remain required before closure.
Do not call the package fully gated while infrastructure's native checks remain
unresolved. The original upgrade timeouts are separately retained as a default-concurrency
verification caveat; the bounded upgrade suite passed. No coverage threshold was lowered to get around them.

Owner QA (disposable instance and enough history; record owner acceptance separately):

1. Select Node 22, run `pnpm.cmd build`, then from `apps/web` run
   `pnpm.cmd exec playwright test e2e/history.spec.ts --headed --debug`.
   The existing harness starts an ephemeral loopback API with real in-memory SQLite,
   disposable data and fake execution providers, serving the built app. It never uses
   ports 4747/4748 or the owner's store. Use the Inspector to pause after each
   `page.goto`/Load more action and inspect the running UI before continuing.
2. Runs scenario seeds 101 completed runs in one loop. With loop/status/parent filters,
   inspect 100 rows, load more, see all 101 exactly once, the same filters, no upward
   scroll clamp, and the exhausted footer. Change a filter and confirm its own list.
3. Events scenario publishes 101 matching events plus an unrelated type. Inspect
   the first 100, expand payload/configuration details where present, load more,
   and see 101 matching rows while reading position and details stay in place.
   There is no manual refresh button in this package.
4. Loops scenario starts one old run, advances the disposable clock one millisecond,
   creates 501 unrelated runs, and also creates a no-history loop. The old loop must
   link to its succeeded run; the empty loop alone says "never run". Open the busy
   loop's delete confirmation, see exact count 501, and choose Keep.
5. For backend tie/limit-one controls run the API/MCP/SQLite paging tests above.
   These seed tied timestamps explicitly; SQL summary and browser fixtures do not
   depend on wall-clock sleeps or live-provider behavior.

Observed outside scope: native Windows process-tree termination is denied in this
sandbox, and the initial full infrastructure suite has upgrade timeouts. Source
locations: `packages/infrastructure/src/process/scripts.ts:27`,
`src/process/scripts.test.ts:60`, `src/claude/process.test.ts`,
`src/adversarial.test.ts` and `src/sqlite/upgrade.test.ts:87`. The seven upgrade timeouts
were not reproduced with two workers; the original failures remain recorded rather than
being silently retried to green. No outside-scope source was changed.

`coverage/`, ignored `wp-g2-*-coverage*.log`, and Playwright `test-results/` remain for
the orchestrator to inspect/remove. Temporary native-test directories with EBUSY cleanup
failures are identified in the ignored infrastructure log. No manual directory deletion was attempted.
