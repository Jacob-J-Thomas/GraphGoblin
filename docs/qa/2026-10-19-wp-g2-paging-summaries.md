# WP-G2 review fixes and owner QA (#231, #236)

The [round-three page-isolation report](2026-10-21-wp-g2-lookahead.md) records the
acceptance audit's lookahead defect and its current verification. The running-app
recipe below remains the owner QA entry point.

## 1. Branch and worktree

Branch: `codex-wp-g2-paging-summaries`; base: `7472895`.
Worktree: `<local>/source/repos/GraphGoblin/.claude/worktrees/codex-wp-g2-paging-summaries`.
Both bolts require owner product acceptance before closure. The independent Opus
review approved the preceding implementation with the fixes recorded here required.
No owner application or store is part of this verification.

## 2. Per bolt

### #231: paging, ordering and filters

Original real SQLite/MCP reproductions:

> expected { items: [ { ... } ], ... } to have property "nextCursor"

Timestamp-only continuation omitted other runs sharing the boundary millisecond.
The limit-one real API/MCP tests now retrieve tied records exactly once.

> Expected "hasMore": false; Received "hasMore": true; "nextAfter": 2

An exactly full final run-event page now reports the API's authoritative `hasMore: false`.

> getByRole('button', { name: 'Load more' }): Expected visible; element(s) not found

The original Runs and Events browser pages displayed only their first 100 records.
Both pages now append older rows while retaining reading position and active visible filters.
The status-filter claim of a baseline 500 was not reproduced: the recorded response was
already typed and remains the regression contract:

```http
400 application/problem+json; charset=utf-8
{"type":"https://graphgoblin.dev/problems/validation-failed","title":"validation failed","status":400,"code":"VALIDATION_FAILED","detail":"the request did not match the schema","errors":[{"path":"/status","message":"Use comma-separated run statuses."}]}
```

The review regression baselines also recorded:

> ID 3 must follow the previous ID: expected false to be true

> Unable to find role="button" and name "Load more"

The generator test checks 1,024 same-millisecond increments, and the empty-cursor
browser state exposes continuation. The exhaustion focus regression previously
received body focus instead of the end status.

Review regressions cover an empty decoded page with an opaque cursor, next-page
failure and retry, background refresh cancellation, same-millisecond ID ordering,
and keyboard focus after exhaustion. A page with a cursor always offers **Load more**.
The control is busy only during its own next-page request and uses default
`fetchNextPage()` cancellation. End-of-list text appears only after an append and
receives focus without scrolling. No manual Events refresh is included (#240).

| Consumer                                  | Paging contract                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REST runs / typed `runs.list`             | `{ items, nextCursor }`; repeat loop/status/parent/before filters and copy the opaque cursor unchanged. Empty readable pages may still carry a cursor. |
| MCP `list_runs`                           | Typed full page, compact items, opaque `cursor` and loop/status/parent filters. No timestamp continuation parameter.                                   |
| REST inbound events / typed `events.list` | `{ items, nextCursor }`; repeat type/before filters. Unknown parameters return 400; `before` must be a timestamp.                                      |
| Run-event API / MCP `read_run_events`     | Numeric `after` / `nextAfter`, with authoritative API `hasMore`; no length heuristic.                                                                  |
| Browser Runs / Events                     | Append through Load more; Runs preserves its visible loop/status/parent selects. Events has no hidden URL filters.                                     |

Cursors encode positions only: changing filters continues from the encoded position
under the new filters. Run and inbound ties use descending IDs. The shared API ULID
generator increments its random component within a millisecond, preserving creation
order within one process, including backward-clock adjustments (D-018).
`SqliteInboundEvents.page()` is the only listing path (ADR-0020).

### #236: truthful loop history

Original real SQLite/API reproduction with 501 unrelated newer runs:

> expected { ... } to match object { latestRun: { ... }, runCount: 2 }

Original browser reproduction:

> row "older history ... published never run Edit older history Export older history Delete older history"

A damaged stored latest status recorded `500 INTERNAL_ERROR` /
`expected 500 to be 200` in `routes/loop-summaries.test.ts`; the corrected API returns
200, counts the damaged row and preserves the healthy neighbor.

`GET /loops` now uses one SQL statement: owner-scoped loops joined to their newest
run by a correlated `(created_at DESC, id DESC)` subquery, plus an exact owner-scoped
count. It avoids a global 500-run limit and per-loop HTTP requests. Compact summaries
are validated independently: a damaged latest summary remains counted but produces
`latestRun: null`, while healthy loops remain readable. The browser says **latest run
unavailable** for a positive count and **never run** only for a zero count. The operator
finds damaged rows through `GET /runs/diagnostics`.

## 3. Files changed

### API

- `apps/api/src/api.test.ts`: Verify reverse creation order with tied timestamps through the public Events API.

- `apps/api/scripts/measure-loop-summaries.ts`: Reproduce 50,000-run query measurements on disposable file-backed stores.
- `apps/api/src/ids.test.ts`: Verify strict ordering, random-component carry, time advance and rollback.
- `apps/api/src/ids.ts`: Increment the ULID random component for same-millisecond IDs and clock rollback.
- `apps/api/src/routes/loop-summaries.test.ts`: Verify damaged latest status isolation and diagnostics beside healthy loops.
- `apps/api/src/routes/triggers.ts`: Describe and bound inbound cursors in OpenAPI.
- `apps/api/src/triggers.test.ts`: Use the single inbound page operation in integration tests.
- `apps/api/src/version-migration.test.ts`: Reconstruct historical schema and count removed ledger entries.
- `apps/api/src/webhook-keys.test.ts`: Use inbound page results in webhook-key tests.
- `apps/api/tsconfig.json`: Typecheck the API measurement script through its package project.

### MCP

- `apps/mcp/src/paging.test.ts`: Verify supported MCP filters, REST-only before and authoritative event tails.
- `apps/mcp/src/tools.ts`: Remove the unused unwrap import while retaining the full typed page.

### Web

- `apps/web/e2e/history.spec.ts`: Exercise keyboard paging focus and unfiltered Events in real Edge.
- `apps/web/src/api/queries.ts`: Keep infinite-page metadata available to the shared history renderer.
- `apps/web/src/components/HistoryState.tsx`: Continue empty cursor pages, avoid polling interference and focus exhaustion.
- `apps/web/src/events/EventsPage.test.tsx`: Verify append/payload/focus and removal of hidden filters.
- `apps/web/src/events/EventsPage.tsx`: Remove hidden type/before filters and read the paged event type.
- `apps/web/src/loops/LoopsPage.test.tsx`: Verify unavailable/never-run states beside healthy summaries.
- `apps/web/src/loops/LoopsPage.tsx`: Distinguish unavailable latest summaries from genuine no history.
- `apps/web/src/runs/RunsPage.test.tsx`: Verify empty cursors, retry, background refresh and keyboard exhaustion.
- `apps/web/src/runs/RunsPage.tsx`: Remove the hidden URL-only before filter.

### API client

- `packages/api-client/openapi.json`: Regenerate cursor bounds and description.
- `packages/api-client/src/generated/schema.ts`: Regenerate typed inbound cursor documentation.

### Infrastructure

- `packages/infrastructure/drizzle/0015_loop_owner_history.sql`: Create runs_loop_owner_history_idx on loop, owner, timestamp and ID.
- `packages/infrastructure/drizzle/meta/0015_snapshot.json`: Generated Drizzle snapshot for migration 0015.
- `packages/infrastructure/drizzle/meta/_journal.json`: Register migration 0015 while reserving 0014 for WP-C1.
- `packages/infrastructure/src/sqlite/catalog.test.ts`: Derive migration counts and remove the new index from historical rollback fixtures.
- `packages/infrastructure/src/sqlite/classifiers.test.ts`: Derive pending migration counts from shipped entries.
- `packages/infrastructure/src/sqlite/history-summaries.test.ts`: Verify damaged summaries, index columns and idempotent current-format upgrade.
- `packages/infrastructure/src/sqlite/loops.ts`: Validate compact summaries independently while retaining exact counts.
- `packages/infrastructure/src/sqlite/schema.ts`: Declare the owner-scoped loop/history covering index.
- `packages/infrastructure/src/sqlite/storage.test.ts`: Keep historical SQL fixtures independent of a fixed shipped count.
- `packages/infrastructure/src/sqlite/template-retirement.test.ts`: Compare ledger length with the shipped catalog.
- `packages/infrastructure/src/sqlite/testing/shipped-migrations.ts`: Count shipped test-fixture entries without assuming contiguous numbering.
- `packages/infrastructure/src/sqlite/triggers.test.ts`: Use the single inbound page operation in integration tests.
- `packages/infrastructure/src/sqlite/triggers.ts`: Remove the unused alternate inbound list path.
- `packages/infrastructure/src/sqlite/upgrade.test.ts`: Aim ledger-corruption checks at the required format baseline.

### Documentation

- `docs/07-api-and-streaming.md`: Document ID ordering, position-only cursors, strict filters and indexed summaries.
- `docs/09-frontend-and-pwa.md`: Document Events paging and unavailable/no-history summary states.
- `docs/guide/03-run-and-observe.md`: Explain Load more, visible filters and retained rows on retry.
- `docs/qa/2026-10-19-wp-g2-paging-summaries.md`: Record review evidence, measurements, verification and running-app owner QA.
- `docs/qa/2026-10-19-wp-g2-paging-summaries/seed-visual.mjs`: Portable public-API seed with URL/key arguments and exact requested counts.
- `docs/reference/api.md`: Regenerate the inbound cursor reference.

### Changelog

- `CHANGELOG.md`: Upgrade notes for strict filters, opaque cursors and indexed summaries.

Shared WAVE seams: loop summary/schema changes are additive beside WP-C1; create/publish/pinning logic is untouched. MCP retains B1's typed full page and existing description/test. Shared docs and CHANGELOG changes describe these two bolts.

## 4. Tests

Five separate `pnpm.cmd --filter @graphgoblin/api exec vitest run src/triggers.test.ts --maxWorkers=2` invocations:

| Run | Tests     | Vitest duration | Exit   |
| --- | --------- | --------------- | ------ |
|     | 1         | 83 passed       | 84.27s | 0   |
| 2   | 83 passed | 154.16s         | 0      |
| 3   | 83 passed | 91.17s          | 0      |
| 4   | 83 passed | 121.27s         | 0      |
| 5   | 83 passed | 119.50s         | 0      |     |

The generator regression checks 1,024 same-millisecond increments, carries, time
advance and clock rollback. The damaged-summary API test confirms a healthy neighbor
and diagnostics discoverability; repository and web tests check count/unavailable/never-run
states. History tests check empty cursors, retry, background polling, keyboard exhaustion,
initial-page silence and the removed URL-only filters. Historical migration fixtures
count shipped entries rather than assuming contiguous numbering.

| Package        | Tests                                                 | Lines              | Branches           |
| -------------- | ----------------------------------------------------- | ------------------ | ------------------ |
| infrastructure | 512 passed; 6 native failures and 5 upgrade timeouts  | 98.34% (1899/1931) | 94.36% (1475/1563) |
| API            | 648 passed, 6 platform skips; 1 GitHub-recipe timeout | 97.87% (1796/1835) | 92.98% (1272/1368) |
| API client     | 51 passed                                             | 100% (211/211)     | 99.32% (147/148)   |
| MCP            | 42 passed                                             | 95.27% (242/254)   | 95.43% (209/219)   |
| Web            | 1480 passed (116 files)                               | 98.93% (6986/7061) | 94.85% (7153/7541) |

Coverage uses the complete configured denominator; no threshold, exclusion or timeout
is changed. Passing percentages do not convert failing test gates into passes.

## 5. Gates

All commands use `pnpm.cmd` in PowerShell with Node 22.14.0 selected on PATH.

| Command                                                                                                 | Result                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm.cmd typecheck`                                                                                    | PASS: 20 tasks.                                                                                                                                                                                                                      |
| `pnpm.cmd lint`                                                                                         | PASS: 11 tasks, no source warnings.                                                                                                                                                                                                  |
| `pnpm.cmd format:check`                                                                                 | PASS: repository-wide Prettier check.                                                                                                                                                                                                |
| `pnpm.cmd check:migrations`                                                                             | PASS: Drizzle generation is a no-op.                                                                                                                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                                    | PASS: OpenAPI and typed schema regenerated.                                                                                                                                                                                          |
| `pnpm.cmd docs:generate`                                                                                | PASS: numbered references regenerated.                                                                                                                                                                                               |
| `pnpm.cmd check:docs`                                                                                   | PASS: generated references are current.                                                                                                                                                                                              |
| `pnpm.cmd check:tokens`                                                                                 | PASS: 162 files checked.                                                                                                                                                                                                             |
| `pnpm.cmd check:layers`                                                                                 | PASS.                                                                                                                                                                                                                                |
| `pnpm.cmd check:deps`                                                                                   | PASS: zero errors; existing drizzle.config.ts orphan warning.                                                                                                                                                                        |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --coverage.reportOnFailure` | FAIL: 11 failures (6 native process, 5 upgrade timeouts), 512 passed. Isolated follow-up below.                                                                                                                                      |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --coverage.reportOnFailure`            | FAIL: 648 passed, 6 platform skips, one GitHub-recipe timeout; its isolated file passes all five tests.                                                                                                                              |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=1`                                | PASS: 51 tests.                                                                                                                                                                                                                      |
| `pnpm.cmd --filter @graphgoblin/mcp test:coverage --maxWorkers=1`                                       | PASS: 42 tests.                                                                                                                                                                                                                      |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2`                                       | PASS: 1480 tests, complete source denominator.                                                                                                                                                                                       |
| `pnpm.cmd build`                                                                                        | PASS: 11 tasks.                                                                                                                                                                                                                      |
| `GG_E2E_BROWSER_CHANNEL=msedge`, `LIVE=0`, `pnpm.cmd --filter @graphgoblin/web test:e2e`                | FAIL: 360 unique cases accounted for across batches: 311 passed, 8 failed, 41 skipped. The interrupted first batch and its completion commands are recorded below. The five paging/lifecycle cases pass again after the final build. |
| Trigger suite, exact command above, five invocations                                                    | PASS: 83 tests each, all five exits 0.                                                                                                                                                                                               |

Additional checks:

- `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/catalog.test.ts src/sqlite/storage.test.ts src/sqlite/classifiers.test.ts src/sqlite/template-retirement.test.ts --maxWorkers=2`: PASS, 51 tests.
- `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts src/sqlite/history-summaries.test.ts --maxWorkers=1`: FAIL, 27 passed / 3 upgrade timeouts; all four summary/index tests pass. Timeouts affect hash-bound review, retired-template invocation refusal and one conflicting-owner-default case. These remain unresolved.
- `pnpm.cmd --filter @graphgoblin/api exec vitest run src/triggers/github-recipe.test.ts --maxWorkers=1`: PASS, five tests.
- `pnpm.cmd --filter @graphgoblin/api exec vitest run src/api.test.ts --testNamePattern same-millisecond --maxWorkers=1`: PASS, the selected public-API ordering test; 18 unrelated tests not selected.
- Runs/Events/Loops focused component regressions: PASS, 33 tests. The final focused check is recorded below.
- Live disposable seed recipe: PASS; exact counts and two-page exhaustion verified through public HTTP. No provider is invoked; the isolated listener is stopped.

- Final source: `pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/RunsPage.test.tsx src/events/EventsPage.test.tsx src/loops/LoopsPage.test.tsx --maxWorkers=1`: PASS, 33 tests.
- `pnpm.cmd --filter @graphgoblin/web typecheck`: PASS, including the strengthened browser assertions.
- After the final build, `GG_E2E_BROWSER_CHANNEL=msedge`, `LIVE=0`, `pnpm.cmd --filter @graphgoblin/web test:e2e e2e/history.spec.ts e2e/loop-lifecycle.spec.ts --output=<disposable-temp-directory>`: PASS, five tests in 1.3 minutes. Native Tab/Enter activation reaches Load more; both lists retain scroll position within one pixel and focus the exhausted status. The older-history link, no-history state and exact 501-run deletion count pass.
- `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts --testNamePattern 'requires every hash-bound|refuses changed source|refuses an ordinary definition|refuses invalid/conflicting owner defaults' --maxWorkers=1`: FAIL: four selected cases passed, two hash/source-review cases timed out at 20 seconds; 20 unrelated cases were not selected. These timeouts remain open..

The seven first-batch browser failures are outside the paging/lifecycle flows:

| Spec                         | Failure                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `claude-harness.spec.ts:159` | Saved Codex model label on narrow Claude editor, readiness false and true (2). |
| `drafts.spec.ts:212`         | Seeded format-3 device draft, synced state (1).                                |
| `issue-170-qa.spec.ts:237`   | Current golden bytes / inference placement and save-reload setup (1).          |
| `model-picker.spec.ts:28`    | Catalog model/effort publish and harness flow, dark and light (2).             |
| `model-picker.spec.ts:94`    | Removed saved model and explicit unknown import (1).                           |

The interrupted broad command reported 161 passed, seven failed and 41 skipped before completion batches. Its remaining 15 files use a separate
output directory to retain the first batch's failure artifacts:

```powershell
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:LIVE = '0'
$qaRestOutput = Join-Path $env:TEMP ("gg-wp-g2-edge-rest-" + [guid]::NewGuid().ToString('N'))
pnpm.cmd --filter @graphgoblin/web test:e2e `
  e2e/node-harness.spec.ts e2e/node-json.spec.ts e2e/node-placement.spec.ts `
  e2e/palette.spec.ts e2e/prereview.spec.ts e2e/pwa.spec.ts e2e/qa.spec.ts `
  e2e/responsive.spec.ts e2e/routing.spec.ts e2e/template-gallery.spec.ts `
  e2e/theme.spec.ts e2e/trigger-types.spec.ts e2e/undo.spec.ts `
  e2e/validation.spec.ts e2e/webhook-receiver.spec.ts `
  "--output=$qaRestOutput"
```

Remaining-file batch: PASS, all 138 tests in 14.1 minutes. Collection audit identified 13 further cases not reported by the interrupted batch (ten manual-edge cases and three model-picker cases); their targeted result is recorded below. Targeted collection completion: `GG_E2E_BROWSER_CHANNEL=msedge`, `LIVE=0`, `pnpm.cmd --filter @graphgoblin/web test:e2e e2e/edge-routes.spec.ts e2e/model-picker.spec.ts:151 e2e/model-picker.spec.ts:195 e2e/model-picker.spec.ts:276 --output=<disposable-temp-directory>`: 12 passed, one failed in 2.4 minutes. The additional failure is `model-picker.spec.ts:151`, catalog failure preserving current values until retry / loop-default picker.

The collection audit matched every configured file and full test title against the three batches and the fresh scoped run: **360 unique cases reported, 311 passed, 8 failed, 41 skipped; zero unreported cases**. All eight broader browser failures are listed here; none is counted as a passed gate. The five WP-G2 paging/lifecycle cases pass on the final build.

## 6. Docs

Numbered docs 07 and 09 describe paging, monotonic tie ordering, strict filters,
indexed summaries and unavailable history. Guide 03 explains Load more; guide 05
already documents opaque MCP continuation. CHANGELOG includes both bolt entries
and upgrade notes. The generated API reference, OpenAPI and client schema include
the inbound cursor bound. D-018 is the orchestrator's process-local monotonic-ID
decision; this patch adds no separate ADR.

### Owner acceptance on a running isolated app

From this worktree in PowerShell, select Node 22 and build. Port **5631** and the new
temporary data directory below belong only to this disposable instance. Keep the
printed directory to restart the same history for the failure/retry check.
`GG_MASTER_KEY` is **not required**: when unset, the API generates `master.key` in this
new data directory. These minimal manual trigger/exit loops call no provider.

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
node --version
pnpm.cmd build
$qaData = Join-Path $env:TEMP ("gg-wp-g2-owner-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qaData | Out-Null
$env:GG_DATA_DIR = $qaData
$env:GG_PORT = '5631'
$env:GG_HOST = '127.0.0.1'
$env:GG_WEB_DIST = (Resolve-Path 'apps/web/dist').Path
$env:GG_REQUIRE_API_KEY = 'false'
Remove-Item Env:GG_DB_URL, Env:GG_MASTER_KEY, Env:GG_JEV_API_KEY -ErrorAction SilentlyContinue
Write-Output $qaData
node apps/api/dist/main.js
```

In a second PowerShell at this worktree, seed through the public API:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
node docs/qa/2026-10-19-wp-g2-paging-summaries/seed-visual.mjs http://127.0.0.1:5631
```

The script accepts an optional second API-key argument for an authenticated isolated
instance. It refuses a store already containing loops, discovers the current definition
format from OpenAPI, creates four published loops with run counts **1, 0, 105, 501**,
and creates **105 inbound events**. It prints the loop IDs and the exact browser URLs.

1. Open the printed Runs URL, filtered to **paging runs**. The first page has 100
   runs. Load more appends five and shows **All runs loaded.** Existing rows stay in
   place. Change Loop to **older history**: its single run appears, without an
   end-of-list message on the initial page. Change back to paging runs. Reload to
   begin at page one; Tab to **Load more** and press Enter. Focus lands on
   **All runs loaded.**, and the page does not jump back to the top.
2. Open `http://127.0.0.1:5631/app/events`. Read a long preformatted payload near the
   end of the first page (the seeded event with `index: 5`). Load more appends five
   events, keeps the payload visible and the reading position, and shows
   **All events loaded.** Check keyboard activation as above.
3. Open `http://127.0.0.1:5631/app/loops`. **older history** links to its succeeded
   run even though 606 newer runs exist. Only **no history** says **never run**.
   Delete on **busy history** shows **all its runs (501)**; choose **Keep**.
4. For failure/retry, reload Events and leave its first page displayed. Stop only
   this API using Ctrl+C in its terminal. Press **Load more**: loaded rows and the
   visible payload remain, and the page reports the failed request. Restart
   `node apps/api/dist/main.js` in that same terminal with the same environment and
   `$qaData`; retry **Load more**. The final five events appear exactly once.
5. Repeat the first two flows in the owner's preferred themes and phone width.
   Confirm that polling never dims Load more and the control has a visible focus ring.

The recipe was verified against the built API and web app on this isolated port with a
fresh file-backed store and an automatically generated master key. Public API checks
confirmed all four counts and statuses, Runs and Events pages of `[100, 5]` with null
continuation at exhaustion, and HTTP 200 for the served Events app.

## 7. Decisions and parameters

Migration: **`0015_loop_owner_history.sql`**, generated Drizzle snapshot and journal.
`0014` is reserved for WP-C1's `0014_run_definition_pins`; no shipped migration is edited.
The index is `runs_loop_owner_history_idx (loop_id, owner_id, created_at, id)`.
The owner predicate stays in both the latest-row query and count.

Real file-backed SQLite, real in-process `GET /loops`, Node 22.14.0, four loops,
50,000 rows distributed `[1, 0, 105, 49894]`, 829-byte base thread JSON.
One warm-up followed by seven measured requests, with exact counts checked each time:

|              |                                           Without index |                                      With index |
| ------------ | ------------------------------------------------------: | ----------------------------------------------: |
| Median       |                                               715.30 ms |                                        26.81 ms |
| Mean         |                                               724.23 ms |                                        30.13 ms |
| Samples (ms) | 824.90, 526.70, 715.30, 728.85, 1187.91, 566.76, 519.18 | 50.72, 25.72, 26.69, 20.72, 26.81, 29.96, 30.27 |

The median decreased about 26.7 times; these are controlled local measurements,
not a production latency guarantee. Reproduce with
`pnpm.cmd --filter @graphgoblin/api exec tsx --conditions=development scripts/measure-loop-summaries.ts before`
and then `after`. Each invocation creates its own disposable file-backed store;
`before` removes the index only from that new store.

## 8. Caveats and open items

Owner product acceptance for both bolts remains required. The independent reviewer
must confirm these review fixes. The full infrastructure gate remains red for native
process failures and upgrade timeouts; the API coverage command remains red for the
recipe timeout despite its passing isolated follow-up. No timeout or assertion is weakened. Eight broader browser cases also remain failing (Claude/model pickers, one synced device-draft case and golden-byte setup); the five scoped history/lifecycle cases pass. Any sandbox-limited native test gate is recorded
separately from the coverage percentages; it cannot be treated as passed.
Integration requirement: WP-C1 owns migration `0014_run_definition_pins`. Combine its
schema with this branch's `0015` and regenerate the combined snapshot at integration;
`0014` is absent from this branch's base. The current branch passes migration no-op checking.
The current source and user guides use opaque continuation only. Historical B1 QA
responses and the integration register retain the obsolete parameter spelling as
historical evidence, rather than being rewritten to change what was observed.
