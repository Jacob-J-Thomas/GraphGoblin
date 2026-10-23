# WP-G2 requested-page isolation (#231, #236)

## 1. Branch and worktree

Branch: `codex-wp-g2-paging-summaries`; base: `d67228b5`.
Worktree: `<local>/source/repos/GraphGoblin/.claude/worktrees/codex-wp-g2-paging-summaries`.
This report covers the round-three acceptance defect. Owner acceptance of both
bolts remains required. No owner application or store is part of verification.

## 2. Per bolt

### #231: requested-page isolation

Confirmed against the public API over disposable file-backed SQLite: a succeeded
manual run returned seq 1, `nextAfter: 1`, `hasMore: true` for
`GET /runs/{id}/events?after=0&limit=1`. Changing only seq 2's stored payload to `{}`
made that unchanged request fail before the fix:

> expected 500 to be 200
> `{"code":"STORED_EVENT_INVALID","detail":"Stored run event does not conform: run <id>, seq 2, type run.started"}`

The same failure occurred with syntactically invalid JSON in seq 2. Inbound paging
also reproduced the defect independently for its `payload` and `run_ids` columns:

> expected 500 to be 200
> `{"code":"INTERNAL_ERROR","detail":"something went wrong on the server"}`

Before production changes, the two API regression files reported **4 failed,
5 passed**. With the page boundary fixed, those same nine cases pass. Restoring
seq 2 also preserves the original successful response. A requested corrupt row,
whether alone or in the middle of a three-event page, still rejects the entire
page with `500 STORED_EVENT_INVALID`; no requested event is skipped.

Paged-reader audit:

| Reader                                           | Finding and final behavior                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run-event JSON API / `SqliteEventStore`          | Affected: API requested `limit + 1` fully decoded events. Repository `page()` now trims raw rows before validation, and supplies `{items,nextAfter,hasMore}`. Unbounded/SSE `read()` remains strict.                                                                                                   |
| Inbound-event API / `SqliteInboundEvents.page()` | Affected: payload parsing and Drizzle's JSON decoder for `run_ids` ran before trimming. Both columns now stay raw until the requested slice; delivery enrichment also runs only for that slice. Requested corruption still fails.                                                                      |
| Run lists / `SqliteRunRepository.page()`         | Already correct: raw columns bypass eager JSON decoding and are sliced before `readableRows`. The added API regression preserves healthy lookahead, an empty unreadable page with a cursor, and continuation to the next healthy run. Requested unreadable runs retain B1's diagnostics/skip contract. |
| MCP `read_run_events`                            | No independent lookahead or length heuristic; forwards the API's page. Added real API/SQLite regression verifies healthy-page continuation and typed errors for requested corruption. The capped resource reader also retains authoritative continuation.                                              |
| MCP `list_runs`                                  | No independent lookahead or length heuristic; maps requested API items and preserves `nextCursor`, including empty pages. Existing public-tool regression covers continuation past an empty damaged-row page.                                                                                          |
| API client / web                                 | No extra lookahead decoding. Client returns complete API pages; infinite queries follow continuation metadata even when an item array is empty. Existing contract/component tests and the Edge history spec remain verification gates.                                                                 |
| Run diagnostics                                  | Selects one extra run identity only, not a decoded run. Event batches use the exact requested bound; no extra event is decoded. No change needed.                                                                                                                                                      |

Ordering, owner checks, filters and cursor formats are unchanged. The public API
regression verifies owner isolation and an exactly full final event page followed
by an empty exhausted page.

### #236: truthful loop summaries

No summary source, count, query or migration changes in this patch. The prior
owner recipe remains applicable; this round corrects its description of Events
payloads to match the preformatted renderer.

Current API coverage passed both tests in `src/routes/loop-summaries.test.ts`:
damaged latest-run metadata remains isolated, counted and discoverable through
diagnostics; older history beyond 500 unrelated runs, timestamp ties and genuinely
empty history retain their correct summaries.

## 3. Files changed

- `packages/infrastructure/src/sqlite/events.ts`: Share raw reads and decode only the requested event-page slice.
- `packages/infrastructure/src/sqlite/triggers.ts`: Keep both inbound JSON columns raw until after trimming lookahead.
- `packages/infrastructure/src/sqlite/event-validation.test.ts`: Verify page isolation and strict requested corruption across eight malformed stored-row cases.
- `apps/api/src/routes/runs.ts`: Return the repository's authoritative event page directly.
- `apps/api/src/routes/run-event-paging.test.ts`: Add file-backed public API regressions for lookahead, requested corruption, exhaustion and owner scope.
- `apps/api/src/routes/event-paging.test.ts`: Cover malformed payload and run IDs beyond and inside the requested inbound page.
- `apps/api/src/routes/run-paging.test.ts`: Protect raw lookahead and empty unreadable-page continuation.
- `apps/mcp/src/paging.test.ts`: Verify event-page isolation and error propagation through the public MCP tool and resource reader.
- `docs/07-api-and-streaming.md`: Specify validation only within the requested page.
- `docs/09-frontend-and-pwa.md`: Describe visible preformatted payloads and preserved reading position.
- `docs/qa/2026-10-19-wp-g2-paging-summaries.md`: Correct the running-app payload QA recipe.
- `docs/qa/2026-10-19-wp-g2-paging-summaries/seed-visual.mjs`: Supply a long payload near the first page's boundary for that recipe.
- `CHANGELOG.md`: Record the user-visible page-isolation fix under #231.
- `docs/qa/2026-10-21-wp-g2-lookahead.md`: Record reproduction, reader audit and current verification.

The infrastructure/API/MCP edits are the shared seams required by this work
package. No ownership transfer or unrelated behavior change is included.

## 4. Tests

| Package        | Full-run tests                        | Lines              | Branches           |
| -------------- | ------------------------------------- | ------------------ | ------------------ |
| Infrastructure | 611 passed, 18 failed / 629           | 98.37% (1998/2031) | 94.52% (1554/1644) |
| API            | 717 passed, 6 failed, 6 skipped / 729 | 97.84% (1771/1810) | 92.98% (1260/1355) |
| API client     | 72 passed / 72                        | 100% (246/246)     | 99.37% (160/161)   |
| MCP            | 46 passed, 1 failed / 47              | 96.66% (232/240)   | 95.81% (206/215)   |
| Web            | 1366 passed, 9 failed / 1375          | 98.44% (6954/7064) | 93.97% (7093/7548) |

Infrastructure's reported-coverage run includes nine upgrade timing failures,
seven D-015 native-shutdown failures and two upgrade-scan failures. Every failure
was triaged alone without changing any timeout or threshold.

Infrastructure's initial coverage invocation: **620 passed, 9 failed, 629 total**
across 45 files. Vitest suppresses coverage reports on failure by default; the
reported-coverage invocation uses `--coverage.reportOnFailure`, with the same
tests and thresholds. Every failure was also exercised alone, sequentially, using
`pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run <file> --maxWorkers=1 -t <escaped-case-name>`:

| File / case                                                                                                                                    | Isolated result                                                      | Classification                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `sqlite/upgrade.test.ts`: requires every hash-bound review, binds repeated nodes to their stored version, and rejects stale/unused resolutions | 1 passed, 25 unselected                                              | Full-run 20 s timeout; load class.                                   |
| `sqlite/upgrade.test.ts`: refuses changed source, damaged SQL/ledger, malformed template identities and invalid definitions                    | 1 failed, 25 unselected; 20 s timeout                                | Persistent environment/timing class; no assertion or paging failure. |
| `process/scripts.test.ts`: kills and closes a real process cancelled with incomplete UTF-8 pending on both streams                             | 1 failed, 38 unselected; cancellation still required fixture cleanup | D-015 native shutdown.                                               |
| `process/scripts.test.ts`: kills the process tree on timeout                                                                                   | 1 failed, 38 unselected; 15 s timeout                                | D-015 native shutdown.                                               |
| `process/scripts.test.ts`: kills the process when the signal aborts, including when already aborted                                            | 1 failed, 38 unselected; 15 s timeout                                | D-015 native shutdown.                                               |
| `adversarial.test.ts`: 6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild                                              | 1 failed, 19 unselected; 30 s timeout                                | D-015 native shutdown.                                               |
| `claude/process.test.ts`: kills on deadline and output overflow                                                                                | 1 failed, 4 unselected; EBUSY cleanup                                | D-015 native shutdown.                                               |
| `claude/process.test.ts`: does not spawn for an already aborted signal and cancels a running process                                           | 1 failed, 4 unselected; EBUSY cleanup                                | D-015 native shutdown.                                               |
| `claude/process.test.ts`: kills the descendant that a long-lived child started                                                                 | 1 failed, 4 unselected; descendant still writing and EBUSY cleanup   | D-015 native shutdown.                                               |

A separate real, owned Node process confirmed the sandbox restriction:

> `taskkill exit: 1`
> `ERROR: Access denied`

The owned probe was stopped with `Stop-Process` in its cleanup. No test timeout,
coverage threshold, exclusion or production shutdown behavior was changed.

All 34 distinct failures have a verified one-test isolated result: **21 passed, 13 failed**. The nine initial infrastructure cases are listed above; the other 25 follow. Full-suite failures remain failed gates even when a case passes alone.

| Package / file                                            | Case                                                                                                                                     | Isolated result                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/infrastructure/src/sqlite/upgrade.test.ts`      | blocks ordinary running runs without cancelling them                                                                                     | 1 passed                                                                                                              |
| `packages/infrastructure/src/sqlite/upgrade.test.ts`      | blocks ordinary waiting runs without cancelling them                                                                                     | 1 passed                                                                                                              |
| `packages/infrastructure/src/sqlite/upgrade.test.ts`      | blocks ordinary paused runs without cancelling them                                                                                      | 1 passed                                                                                                              |
| `packages/infrastructure/src/sqlite/upgrade.test.ts`      | blocks a pending ordinary receipt and its frozen admission intent                                                                        | 1 passed                                                                                                              |
| `packages/infrastructure/src/sqlite/upgrade.test.ts`      | rolls back deletions, DDL, ledger, rewrites and marker on a failure after structural SQL                                                 | 1 passed                                                                                                              |
| `packages/infrastructure/src/sqlite/upgrade.test.ts`      | rechecks safety at commit and rolls back if the lock or backup is lost                                                                   | 1 passed                                                                                                              |
| `packages/infrastructure/src/sqlite/upgrade.test.ts`      | refuses an ordinary definition that would invoke a retired template loop                                                                 | 1 passed                                                                                                              |
| `packages/infrastructure/src/sqlite/upgrade-scan.test.ts` | merges multiple bounded fan-in passes with hash parity and removes all spill files                                                       | 1 passed                                                                                                              |
| `packages/infrastructure/src/sqlite/upgrade-scan.test.ts` | closes merge readers and cleans intermediate output when a merge read fails                                                              | 1 passed                                                                                                              |
| `apps/api/src/main.test.ts`                               | built API entry and startup failures serves authenticated requests using a binary-created key and refuses a competing process            | 1 passed                                                                                                              |
| `apps/api/src/main.test.ts`                               | built API entry and startup failures dispatches the API-key and preflight CLIs with their real exit codes                                | 1 passed                                                                                                              |
| `apps/api/src/subloop-restart.test.ts`                    | awaited subloops across process death (#242) a hard kill around child completion leaves every parent one continuation after restart      | 1 failed: Error: Timed out waiting for disposable API state                                                           |
| `apps/api/src/subloop-restart.test.ts`                    | awaited subloops across process death (#242) the built API recovers a child finished while down with one continuation per parent         | 1 failed: AssertionError: expected undefined to be 'waiting' // Object.is equality; Error: Hook timed out in 60000ms. |
| `apps/api/src/subloop-restart.test.ts`                    | awaited subloops across process death (#242) the built API recovers a parent interrupted mid-wake with one continuation per parent       | 1 failed: AssertionError: expected undefined to be 'waiting' // Object.is equality; Error: Hook timed out in 60000ms. |
| `apps/api/src/templates/catalog-package.test.ts`          | ships only declared starting-point assets and removes stale files on rebuild                                                             | 1 passed                                                                                                              |
| `apps/mcp/src/mcp.test.ts`                                | MCP server against the in-process API returns early for input, and drives input, signals, pause, resume, and cancel                      | 1 failed: Error: Test timed out in 5000ms.                                                                            |
| `apps/web/src/editor/DecisionAuthoring.test.tsx`          | decision authoring checkpoint restores active device ownership across reload with unfinished ID "review"                                 | 1 passed                                                                                                              |
| `apps/web/src/editor/DecisionAuthoring.test.tsx`          | decision authoring checkpoint keeps row ownership through invalid ids, reorders and labels, and reviews removal before one undoable edit | 1 failed: Error: Test timed out in 20000ms.                                                                           |
| `apps/web/src/editor/EditorPage.restore.test.tsx`         | restoring a set-aside copy converts a v1 draft, archives the exact original and requires explicit first-save overwrite                   | 1 passed                                                                                                              |
| `apps/web/src/editor/EditorPage.test.tsx`                 | EditorPage edits loop settings, variables, node ids, and edges                                                                           | 1 passed                                                                                                              |
| `apps/web/src/editor/NodeEditorDialog.test.tsx`           | NodeEditorDialog evaluator-specific decisions authors and saves a new classifier decision from the default editor fields                 | 1 passed                                                                                                              |
| `apps/web/src/editor/NodeEditorDialog.test.tsx`           | NodeEditorDialog evaluator-specific decisions selects each kind with only its applicable fields and keeps source issue focus             | 1 passed                                                                                                              |
| `apps/web/src/editor/NodeEditorDialog.test.tsx`           | NodeEditorDialog GitHub trigger presets applies an editable body-signed fragment as one undoable graph change                            | 1 passed                                                                                                              |
| `apps/web/src/editor/NodeEditorDialog.test.tsx`           | NodeEditorDialog disclosures across undo and redo keeps Advanced open through an undo and a redo of a basic picker, with focus restored  | 1 passed                                                                                                              |
| `apps/web/src/forms/fields/model.test.tsx`                | catalog field controls keeps a saved inherited Claude effort unverified and read-only while readiness is pending                         | 1 passed                                                                                                              |

Both assertion mismatches from web coverage (legacy draft restoration and webhook-preset configuration) passed alone. Persistent web and MCP failures are their unchanged 20 s and 5 s deadlines. The three native restart cases remain failures: one disposable API readiness deadline and two missing-wait assertions with 60 s cleanup deadlines. These are recorded separately from WP-G2 paging and summaries; their native/restart behavior was not changed by this patch.

## 5. Gates

Node 22.14.0 selected for every command.

| Command                                                                                                                                                         | Result                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                            | PASS, 20/20 tasks.                                                                                                   |
| `pnpm.cmd lint`                                                                                                                                                 | PASS, 11/11 tasks.                                                                                                   |
| `pnpm.cmd format:check`                                                                                                                                         | PASS.                                                                                                                |
| `pnpm.cmd check:docs`                                                                                                                                           | PASS, generated docs current.                                                                                        |
| `pnpm.cmd check:migrations`                                                                                                                                     | PASS, Drizzle generation is a no-op.                                                                                 |
| `pnpm.cmd check:layers`                                                                                                                                         | PASS.                                                                                                                |
| `pnpm.cmd check:deps`                                                                                                                                           | PASS, 0 errors; orphan warnings for Drizzle configuration and an existing browser trace artifact.                    |
| `pnpm.cmd --filter @graphgoblin/<package> test:coverage --maxWorkers=1 --coverage.reportOnFailure` (all five packages)                                          | All coverage thresholds PASS; only API-client's full test suite passed. Other suites retain the failed counts above. |
| `pnpm.cmd build`                                                                                                                                                | PASS, 11/11 tasks.                                                                                                   |
| `pnpm.cmd docs:generate` then `pnpm.cmd check:docs`                                                                                                             | PASS; generated references are current.                                                                              |
| `node --check docs/qa/2026-10-19-wp-g2-paging-summaries/seed-visual.mjs`                                                                                        | PASS.                                                                                                                |
| `LIVE=0`, `GG_E2E_BROWSER_CHANNEL=msedge`, `pnpm.cmd --filter @graphgoblin/web test:e2e e2e/history.spec.ts --retries=0 --output=<disposable-output-directory>` | PASS, 3/3 tests in 49.4 s, after the production build.                                                               |

API/client/MCP/web coverage also enabled verbose and JSON reporters, storing their results in worktree-local log files. The authoritative totals above are from those JSON reports and the Vitest summaries.

Turbo emitted nonfatal cache I/O access-denied warnings while the typecheck and
lint tasks succeeded. No gate result is inferred from those warnings.

## 6. Docs

Updated docs/07's paging contract, docs/09's Events behavior, the running-app recipe
and its public-API seed, and CHANGELOG (#231). No route/schema, client generation,
database schema, migration or ADR change is needed.

## 7. Decisions and parameters

Retain a single `limit + 1` SQL read with raw values, trim before decoding and use
row existence for continuation. This avoids a second query or count, preserves the
same read's page boundary and does not inspect payloads outside the request. The
engine port's strict `read()` contract and SSE replay behavior remain intact.
Inbound `run_ids` must also bypass Drizzle's eager JSON decoding; trimming only
the payload mapper would leave the second reproduced failure unfixed. No new
limits, retry policy or tolerance for requested corrupt events is introduced.

## 8. Caveats and open items

Independent review and owner product acceptance remain required for closure.
Broader suites remain red for the precisely listed native, timing and restart failures. Native shutdown is restricted by sandbox `taskkill` access denial (D-015); the missing-wait assertions still require separate restart investigation. No paging or summary test failed. The production build and Edge history spec passed. The three browser tests verify Runs filtering and append, Events reading position and keyboard focus, and older loop history beyond 500 unrelated runs with a genuine never-run control. Temporary native-test folders may remain after EBUSY cleanup; no manual directory deletion was attempted.
