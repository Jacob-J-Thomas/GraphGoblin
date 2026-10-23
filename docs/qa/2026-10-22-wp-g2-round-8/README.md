# WP-G2 round 8: unreadable latest event history and evidence retention (#236)

> Files above 1,000,000 bytes (1 in this round) are not kept in the repository; [NOT-KEPT.md](NOT-KEPT.md) records each with its size and SHA-256. Mentions of those names below, and in the JSON result files, refer to that record.

## 1. Branch and worktree

Branch `codex-wp-g2-paging-summaries`, worktree `.claude/worktrees/codex-wp-g2-paging-summaries`.
Base HEAD `f0569e7b386ab2e7beb11dccc343255e4f4a08be`. This record covers the working-tree
diff on that head. Windows PowerShell, Node `v22.14.0`, `pnpm.cmd`. The orchestrator
handles commits and independent review.

## 2. Per bolt

**#236 / D-029 B1:** reproduced before the production edit using the auditor's
[event replay](auditor-event-summary.mjs), the built API, file-backed SQLite and
fresh Edge. Its run's durable terminal event was
`{"status":"succeeded","outcome":"success"}`; the stored status remained
`running` after restart. `/loops` returned `latestRun.status: "running"` with exact
count 2, and Edge showed `running`. The public run reader returned 200, both stored
thread columns passed `ContextThreadSchema`, but events returned
`500 STORED_EVENT_INVALID`, sequence 1, type `run.queued`. Diagnostics identified
that run as `HISTORY_UNREADABLE`. The auditor replay exited 1. See
[raw result](auditor-before-results.json) and [capture](auditor-before-event-history-badge.png).

The independently maintained [restart regression](restart-regression.mjs) covers
the pin, initial thread, cached thread and event-only variants together. Each
creates an older healthy run, durably finishes a newer run, refuses only its
terminal status update while damaging one stored value, and restarts the actual
built API on the same store. It checks a newly constructed repository as well as
public HTTP and Edge. On the base build its event case failed with:

> events: repository must also report unavailable with exact count 2
>
> events: expected latestRun null; received ... "status":"running" ...
>
> events: Edge must show unavailable with diagnostics, never running, succeeded or never run

All three pin/thread controls passed on that same base build. See
[combined pre-fix results](combined-before-results.json) and
[event capture](combined-before-events.png).

After the fix, the identical original auditor script exits 0 and records
`pass: true`: null/count 2, an unchanged stale running row, typed
`STORED_EVENT_INVALID`, and Edge unavailable with diagnostics guidance. See
[after result](auditor-after-results.json) and [capture](auditor-after-event-history-badge.png).
The combined native restart replay also exits 0, **4/4 passed**, across the
repository, public API and Edge, retaining exact count 2 for every fault. See
[all four after results](combined-after-results.json) and [event capture](combined-after-events.png).

**#231:** this round changes no cursor or filter contract. The existing Runs,
Events and loop-summary browser spec is included in verification.

**B3 evidence retention:** all 29 distinct cited reporter names were recovered:
13 from round 6, 16 from round 7. There are 47 retained original reporter objects
because the 18 invalid skipped-test isolation attempts have their own originals.
Every one of the 47 citing log locations has an adjacent retained-file mapping.
The maps record original and normalized hashes, counts, citations and filename
changes; only local path prefixes were normalized. The raw objects retain their
`testResults` and `assertionResults`. The older aggregate summaries remain derived
summaries and are not described as raw reporter objects. No outputs were rerun to
replace historical results. There are no known losses among those 29 names.

- [Round-6 mapping](../2026-10-22-wp-g2-round-6/raw-reporter-preservation.json).
- [Round-7 mapping](../2026-10-22-wp-g2-round-7/raw-reporter-preservation.json).
- [Original external thread harness](../2026-10-22-wp-g2-round-6/thread-summary.mjs),
  with [hashes and normalization](../2026-10-22-wp-g2-round-6/auditor-harness-preservation.json).
  It is distinct from the portable independently authored round-6 replacement.

The first reference-checker preflight failed with six round-6 and four round-7
names. Source-document names and a log-extension example are now expressed as
repository paths/prose rather than artifact citations; the replay-output sentence
maps the successful originals to their retained names. This does not recover or
invent an artifact. One actual prior absence remains, outside the 29 reporter
names: round 6's auditor invocation crashed before writing its final result JSON.
That round's citation explicitly says **not kept (never written)**, names the
surviving stdout-derived records and distinguishes them from the missing output.
The older reconciled preflight therefore still exits 1 for round 6 (one acknowledged
loss), while round 7 exits 0. Both failed initial outputs remain retained. The
user-supplied original checker commands are run again last; their exact outputs
are retained in [round-6 final checker output](round8-refs-final-6.log.txt) and
[round-7 final checker output](round8-refs-final-7.log.txt):

```text
docs\qa\2026-10-22-wp-g2-round-6: 98 files, 181 citations, 1 recorded as not kept, 0 missing
docs\qa\2026-10-22-wp-g2-round-7: 142 files, 141 citations, 0 recorded as not kept, 0 missing
```

The current original checker resolves the disclosed loss through the new loss
register and exits 0 for both folders. The lost output has not been recreated.
No missing name from the auditor's 29-reporter inventory remains. The checker
only scans Markdown; the separate 47-location reconciliation also checks the log
citations and raw object structures.

## 3. Files changed

Production changes are confined to the latest-run summary path in the SQLite loop
repository; the engine, shared decoders and public route schemas are unchanged.
Exact changed hunks are in [source-line-ranges.json](source-line-ranges.json).
The [per-file inventory](files-changed.json) gives one description for every
changed source or evidence file.

| File                                                                          | Change / shared boundary                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/infrastructure/src/sqlite/loops.ts`, lines 12, 66-78, 156-242       | Event count, strict event validation and per-loop identity/count cache. This shared WP-C1 file changes only G2 summary selection and its helper/fields; definition pinning and admission stay unchanged. |
| `packages/infrastructure/src/sqlite/history-summaries.test.ts`, lines 201-310 | Corrupt event after durable finish, bounded scan/early stop, cache reuse/invalidation, older-run isolation and propagated storage failure.                                                               |
| `apps/api/src/routes/loop-summaries.test.ts`, lines 19-58                     | Real SQLite/public API event-only unavailable state, count, readable record/thread, typed events error and diagnostics.                                                                                  |
| `apps/web/src/loops/LoopsPage.test.tsx`, line 64                              | Event history joins the existing unavailable rendering matrix.                                                                                                                                           |
| `docs/07-api-and-streaming.md`, lines 487-500                                 | Shared doc's summary subsection only: event readability and cost/cache contract.                                                                                                                         |
| `docs/09-frontend-and-pwa.md`, lines 639-641                                  | Shared doc's loop-summary subsection only: events and restart after repairs.                                                                                                                             |
| `CHANGELOG.md`, lines 7-8                                                     | Added the unavailable-event-history bullet ending in `(#236)`.                                                                                                                                           |
| Round-6 and round-7 QA folders                                                | 47 original raw reporters, per-citation mappings, two hash/name inventories, retained historical auditor script/provenance and README corrections.                                                       |
| This round-8 folder                                                           | Portable reproductions, source ranges, raw current-run logs/reporters, results and captures, plus this report.                                                                                           |

The orchestrator-owned original QA folder is untouched.

## 4. Tests

The new repository and public API regressions both failed on the original summary
implementation with `latestRun: null` expected but a `running` summary received.
The repository case includes a damaged event in the second 100-row batch, before
the end of the log; the fixed implementation stops there. It verifies that warm
reads do no event decoding and a changed count invalidates the cache. A separate
case verifies storage failures propagate and are not cached as history damage.
The API case preserves a durable succeeded event, a valid stale running record,
readable thread, typed event failure and named diagnostics. The web component
adds event-history damage to the unavailable-versus-never-run states; its injected
response test establishes rendering, while the native replay establishes actual
restart and browser behavior.

Two repository fixture attempts failed before the valid pre-fix run: the first
omitted the required `run.started.attempt`, and the next had an incorrectly quoted
SQL string. They are retained separately as fixture/syntax errors and do not
establish the regression. The corrected pre-fix failure does. None is D-015.

Full-run counts, coverage and once-only failure isolation results follow in the
verification record. A failed full gate remains failed regardless of an isolated
diagnostic pass.

The infrastructure full run reports 718 assertions: 710 passed, seven failed and
one pending/incomplete after a worker crash in `src/sqlite/storage.test.ts`.
Its top-level reporter says zero pending, but that file's assertion object retains
the unresolved `runs a loop end to end on SQLite` case. The console reports
`Worker exited unexpectedly with exit code 3221225477` (`0xC0000005`). That crash
is not D-015. The entire storage file passes 42/42 when run once alone; the full
run still failed. Reported lines 97.17% / branches 92.60% are incomplete full-run
coverage because the worker did not finish.

All seven assertion failures also fail once alone at their original timeouts,
with exactly one active assertion selected in each reporter. These are D-015's
native termination class: the adversarial child/grandchild abort timeout; Claude
deadline/overflow and abort cleanup EBUSY; descendant heartbeat continuing with
EBUSY; script cancellation cleanup fallback; script tree timeout; and script
signal-abort timeout. The cancellation assertion is:

> native process-tree cancellation must finish before fixture cleanup: expected true to be false

No generic timing or crash failure is classified as D-015.

| Package        | Full-run tests                                      | Lines   | Branches | Result |
| -------------- | --------------------------------------------------- | ------- | -------- | ------ |
| Infrastructure | 710 passed, 7 failed, 1 incomplete (718 assertions) | 97.17%* | 92.60%*  | FAIL   |
| API            | 734 passed, 6 existing provider skips (740 total)   | 97.84%  | 92.91%   | PASS   |
| Web            | 1,497 passed across 119 files                       | 98.92%  | 94.78%   | PASS   |

Infrastructure coverage collection is incomplete after the worker crash; the
reported percentages do not qualify a complete package gate. All 16 history-query
tests, including both new cases, passed in that failed full run. The public API
summary file passed 10/10. The focused Loops component file passed 21/21.

The [infrastructure raw reporter](round8-coverage-infrastructure-results.log.txt),
[API raw reporter](round8-coverage-api-results.log.txt),
web raw reporter (`round8-coverage-web-results.log.txt`, not kept; see [NOT-KEPT.md](NOT-KEPT.md)) and
[isolation summary](round8-infrastructure-triage-summary.log.txt) retain those
distinctions. Their console logs and each isolated run's raw reporter are alongside
them, mapped by [retention-manifest.json](retention-manifest.json).

## 5. Gates

Exact commands, exits and timings are recorded in the retained gate output and
verification summary. Formatting is scoped using the retained root ignore-file
contents to preserve the orchestrator-owned QA record and unrelated main assets.
No timeout, retry, coverage threshold or exclusion is changed.
Retained console text uses UTF-8 and repository LF line endings. Driver provenance
records original and retained hashes where LF normalization changes bytes; the
47 historical raw reporter objects already used LF and their retained hashes
remain unchanged.

| Command (Node 22, root)                                                      | Result                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                         | PASS, 20/20 tasks                                                 |
| `pnpm.cmd lint`                                                              | PASS, 11/11 tasks                                                 |
| `pnpm.cmd format --ignore-path .round8-format.ignore.log`                    | PASS (scope retained)                                             |
| `pnpm.cmd format:check --ignore-path .round8-format.ignore.log`              | PASS                                                              |
| `pnpm.cmd check:docs`                                                        | PASS                                                              |
| `pnpm.cmd check:layers`                                                      | PASS                                                              |
| `pnpm.cmd check:deps`                                                        | PASS, zero errors; two existing no-orphans warnings               |
| `pnpm.cmd check:tokens`                                                      | PASS                                                              |
| `pnpm.cmd check:migrations`                                                  | PASS, Drizzle generation is a no-op                               |
| `pnpm.cmd build`                                                             | PASS, 11/11 tasks; precedes API coverage and native checks        |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1` | FAIL: seven native termination assertions plus one crashed worker |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                           | PASS                                                              |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`            | PASS, 1,497/1,497                                                 |

The original auditor event driver exits 0 (1/1). The checked-in combined restart
driver exits 0 (4/4). `GG_E2E_BROWSER_CHANNEL=msedge`, then
`pnpm.cmd --filter @graphgoblin/web exec playwright test --config <fresh fixture>/playwright.config.ts --retries=0`
passes 3/3 after the two documented harness corrections. The portable fixture
preparation is [prepare-history-edge.mjs](prepare-history-edge.mjs); it changes
support imports to the built packages and confines the running APIs to assigned
ports. No symlink or junction is created.

Coverage commands additionally pass `--coverage.reportOnFailure --reporter=default
--reporter=json --outputFile.json=<worktree>/round8-coverage-<package>-results.log`.
Raw reporter objects are retained with `.txt` appended; they are not replaced by
the coverage-summary or verification files. Turbo printed cache-write access
warnings on the successful typecheck/lint commands; their task results and exits
are retained as reported.

The first Edge history attempt failed before tests ran: the disposable config
selected Playwright's CommonJS entry, which has no named ESM `defineConfig` export.
The harness now selects its ESM entry; no repository spec assertions or timeouts
change. The failed config-load log is retained separately, not counted as a test
pass and not classified D-015.
The subsequent full spec ran two tests successfully but failed Events before its
page loaded: the copied server tried to bind a second API to its first API's port.
The failing case was run once alone and exposed the actual control response:
`500 {"error":"Error: listen EADDRINUSE: address already in use 127.0.0.1:5622"}`.
That failure and its isolated run are retained. The helper now assigns 5622 to the
base API, 5623 to the control server and 5624 to Events' separate API. The final
run starts from a fresh generated fixture; only imports, built distribution,
temporary parent and allocated ports differ from the repository support files.
The three spec bodies, assertions, retry count zero and original timeouts remain
unchanged. The final corrected full run passes **3/3**, exit 0, in 25.8 seconds;
see [final Edge log](round8-edge-history.log.txt). These are harness errors, not D-015 or successful product tests.

The original checker changed during this session to recognize a loss register.
The first final-output comparison failed because its new output added a recorded-loss
count. Both [first original outputs](round8-refs-original-first-6.log.txt) and
[the round-7 output](round8-refs-original-first-7.log.txt) remain retained; the older
[preflight checker](check-qa-refs-preflight.mjs) and [current checker](check-qa-refs.mjs)
are both preserved with separate hashes. The existing inline loss disclosure now
also has the required structured register. This is a record correction, not a
replacement result or a D-015 failure.

## 6. Docs

Docs 07 and 09 now include event-history readability in latest-summary availability
and explain cache invalidation and restarting after out-of-band repairs. The
Unreleased CHANGELOG bullet ends with `(#236)`. No route schema, generated client,
migration or ADR changes.

## 7. Decisions and parameters

Choice (b): strict bounded event checks cached by selected run identity and actual
event count. Recovery logs failures but keeps no reusable unreadable-ID set;
diagnostics reads bounded pages on demand, without a complete retained set. Using
either directly would require a new cross-layer state protocol or scan on every
listing. The SQLite repository instead uses the existing strict event reader.
It also checks finalized latest runs that startup recovery need not visit, without
depending on which diagnostics pages an operator has requested.

The summary statement still selects exactly the newest owner-scoped run and exact
run count. It also counts that run's events over the `(run_id, seq)` index. A cold
check reads at most 100 rows per batch and stops at the first unreadable event.
The count observed at selection bounds the scan even for an actively appending
run. Cost is linear in that selected history up to the first bad event; memory is
bounded by the batch's rows. A warm read still walks that run's indexed entries
to count them (linear in event count), with no payload reads or event JSON decoding.
Each loop retains one cache entry for its selected identity/count;
a different latest run or any append invalidates it. Older runs are never decoded
or substituted. Unexpected storage errors fail the request without caching.

Out-of-band edits or repairs that preserve event count require an API restart.
Normal event history is append-only. Record and thread columns are still strictly
decoded on every listing. The cache is process-local, starts empty on restart, and
never hides typed errors when an event's own page is requested.

## 8. Caveats and open items

Infrastructure qualification remains open: seven D-015 assertions and the separate
worker crash keep that full gate failed. Its isolated storage pass does not erase
the crash. API and web coverage, both native restart drivers and final Edge history
pass. The current checker recognizes round 6's explicitly acknowledged unwritten result
through its loss register; both folders have zero unexplained missing references. See the [derived verification
summary](verification.json), whose raw inputs are retained separately.
This working diff does not grant acceptance or close either bolt. The orchestrator
commits, obtains Fable review and resumes the independent audit. No owner app,
store or protected port was used, and no directories were manually deleted.
