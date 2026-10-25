# WP-D4 #343 round 2

## 1. Branch and worktree

Branch `codex-wp-d4-343`, worktree `%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-d4-343`; head/base `feefbfddae9f9c343879ff4ad92bd792036589f0`. Uncommitted; ready for orchestrator commit and independent QA, with full-suite gate failures recorded below. No Git mutation or directory deletion performed.

## 2. Per bolt

- **B1:** SQLite and the engine fake reserve authored node keys only for pending/admitted receipts. Real SQLite API tests exhaust admission with a runs-insert fault, then clear it and submit `{issue: 7}` under `r2` after failed `r1`; the new delivery admits exactly one run. The same sequence is covered after corrupt frozen intent produces `EVENT_INTENT_CONFLICT`. Retrying `r1` still returns its original failed delivery.
- **B2:** AC4 uses two 60-second cancellable fake turns, an explicit 20-second wait, simultaneous running-state assertions and public API cancellation in `finally`. The test has a 30-second timeout. This observes overlap without waiting for either turn to finish.
- **N2:** Each recovery sweep half catches and logs its own errors. Four engine tests inject due-read and failure-metadata-write errors in either ledger, restart the public RunManager over the same ports, and assert startup succeeds and the other delivery admits.
- **N3:** Targeted tests use fixture defaults. Removed their private prefix/port helper options after checking no other callers use them. Restart startup stdout/stderr print only when readiness fails. Manual ports and store constraints remain in force; committed subprocess tests use the repository's disposable defaults as explicitly requested.
- **N4:** Removed `setRunIds`, `findDuplicate`, `insertUnlessDuplicate`, their dedupe query type/filter, and the obsolete duplicate-path test. The surviving inbound read/page test inserts its stored run links directly; receipt admission owns atomic link updates.
- **N5:** Unicode-key guidance belongs in Inbound Events; docs 07 retains one copy. Added the Event receipt entity, webhook depth refusal summaries, correct Event upgrade-error delivery, and ADR-0047/0048 index entries.
- **N7:** A corrupt keyed retry returns safe 500 `STORED_EVENT_INVALID`, with a bounded error log, without rewriting saved data or creating another receipt/run.
- **N9:** API assertions cover request key propagation into `invocation.trigger.dedupeKey` and the `EVENT_KEY_EXPRESSION_FAILED` warn log.

The six original acceptance criteria remain covered by public API tests in `apps/api/src/targeted-events.test.ts` and actual process-death tests in `targeted-events-restart.test.ts`:

| AC                                 | Evidence                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: one eligible owned destination  | Missing target refusal; invalid identity/ownership/scope/unpublished/ineligible entry test; explicit disambiguation and recipient-scoped key test                                           |
| 2: durable acceptance and recovery | Explicit target/admission identity; two unsaved-receipt fault cases; four atomic admission fault cases; three built API crash/reopen cases                                                  |
| 3: scoped retries and one run      | Eight concurrent keyed requests reuse one delivery; changed-payload retry returns original; same key reaches two loops/two entries; both B1 failed-receipt regressions                      |
| 4: independent starts overlap      | Two 60-second cancellable fake turns are running simultaneously at capacity two; both are then cancelled through the API; passed in all five consecutive repeats                            |
| 5: truthful state and diagnostics  | GET/list pending, admitted, failed and deduplicated states; eight-failure exhaustion; corrupt intent classification; typed corrupt keyed retry; 997-level refusal/log; restored key warning |
| 6: webhook/protected boundaries    | URL-targeted webhook fixed acknowledgement, unkeyed equal-body repeats, correct destination and typed depth guard; diff confined to the files/ranges below                                  |

These use fake inference turns and real SQLite/API/process boundaries. No live-provider turn or exactly-once external-effect claim is made.

## 3. Files changed

The 16 edited source/document files and exact diff hunks/current SHA-256 values are in `files-changed.log.txt`. QA additions are confined to this round-2 directory.

| Area                  | Files and final line ranges                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API tests             | `targeted-events.test.ts`: 1, 7, 192-194, 316-322, 348-393, 511-573; `targeted-events-restart.test.ts`: 1, 19, 40-43                                                                                                                                    |
| Shared API fixtures   | `testing/test-app.ts`: removed option at old 42, default prefix at 52; `testing/api-subprocess.ts`: 36-40, 123, 131, 134                                                                                                                                |
| Shared TriggerService | `triggers/trigger-service.ts`: import 28-32 and targeted keyed intake 562-587 only; webhook handling is untouched                                                                                                                                       |
| Engine tests/fake     | `event-admission.test.ts`: 1, 5, 131-221; `testing/event-admission.ts`: 1, 57                                                                                                                                                                           |
| Shared RunManager     | `run-manager.ts`: 741-758, admission sweep only; no shutdown/drain, child recovery, finalization or thread/replay edits                                                                                                                                 |
| SQLite                | `event-admission.ts`: import 1 and status filter 125; `triggers.test.ts`: 157-177 plus deletion of the old 178-212 test; `triggers.ts`: deleted `gte` import, old 334-342 query type, 380-386 setter, 502-546 dedupe path                               |
| Shared docs           | `docs/03-domain-model.md`: Other entities table 282-293; `docs/07-api-and-streaming.md`: 37, 530; `docs/08-triggers-and-integrations.md`: 90, 154-164, removed misplaced old 254-255 paragraph; decisions index 54-57; existing CHANGELOG #343 bullet 7 |

WAVE shared-file boundaries are preserved: the RunManager edit stays in WP-D4 admission, outside WP-C7 shutdown and WP-G1 thread/replay regions. The TriggerService edit stays in targeted Event intake, with only an additive import elsewhere. No held #320/#321 or #266/#188 logic was changed.

## 4. Tests

Before any production fix, B1 failed twice in `b1-before.log.txt`: new request `r2` expected `delivery.state: "pending"` but received `"deduplicated"`, after both `EVENT_ADMISSION_EXHAUSTED` and `EVENT_INTENT_CONFLICT`. After the fix, both regressions pass: failed `r1` stays failed, new `r2` admits exactly one run with the same `{issue: 7}` payload.

`engine-before.log.txt` records six expected regressions: the fake returned `deduplicated` instead of `pending`; both sweep directions rejected startup with `Error: due fault` or `Error: metadata fault`. `n7-before.log.txt` records expected `STORED_EVENT_INVALID` versus actual `INTERNAL_ERROR`.

Focused post-fix results: 24/24 API tests (`api-focused-after.log.txt`) and 10/10 engine tests (`engine-focused-corrected.log.txt`). An earlier engine post-fix run had one fixture error (`engine-focused-after.log.txt`): the injected webhook commit fault also blocked Events through the fake's shared callback. The injection was narrowed to the webhook receipt; no production change was needed for that fixture correction.

All five consecutive post-build targeted runs passed 24/24 each (`targeted-repeat-1.log.txt` through `targeted-repeat-5.log.txt`): 24 distinct tests, 120 executions. The built-process restart suite passed 3/3 (`targeted-restart.log.txt`). Successful startup stdout/stderr is absent; milestone logs remain. B2's former `expected [] to have a length of 2 but got +0` is reviewer-provided evidence, not a local reproduction in this round.

| Full package run           | Counts                                      | Coverage (lines / branches; statements / functions)     |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| Engine                     | 1,590 passed, 1 failed; 41 files            | Unavailable: the failed run emitted no coverage summary |
| Infrastructure, one worker | 765 passed, 14 failed; 52 files             | Unavailable: the failed run emitted no coverage summary |
| API, isolated output       | 1,346 passed, 1 failed, 8 skipped; 68 files | 97.72% / 93.26%; 96.44% / 94.58%                        |

Full captures are `engine-coverage.log.txt`, `infrastructure-coverage.log.txt` and `api-coverage-isolated-output.log.txt`. API covered denominators: lines 1847/1890, branches 1343/1440, statements 2033/2108, functions 402/425; all thresholds passed. The portable full JSON summary is `api-coverage-summary.log.txt`.

The initial exact API coverage command ran zero tests because its reports directory was held by another Vitest process (PID 60832); see `api-coverage.log.txt`. That process and directory were left intact. A fresh disposable `gg-wp-d4-343-` output directory plus `--coverage.reportOnFailure` enabled the full API run and retained its percentages. Test selection, instrumentation and thresholds stayed the same. The chosen directory is recorded in `api-coverage-output.log.txt`; its runtime reports are not retained as QA artifacts apart from the copied summary.

Each failing untouched file was then run alone exactly once. The full gate results above remain failures:

| Package/file                                     | Full-run passed/total | One-file rerun passed/total | Capture                                   |
| ------------------------------------------------ | --------------------- | --------------------------- | ----------------------------------------- |
| Engine `src/run-manager.test.ts`                 | 26/27                 | 27/27                       | `engine-run-manager-rerun.log.txt`        |
| Infrastructure `src/claude/readiness.test.ts`    | 20/21                 | 20/21                       | `infra-rerun-claude-readiness.log.txt`    |
| Infrastructure `src/sqlite/upgrade.test.ts`      | 21/26                 | 21/26                       | `infra-rerun-sqlite-upgrade.log.txt`      |
| Infrastructure `src/process/scripts.test.ts`     | 36/39                 | 36/39                       | `infra-rerun-process-scripts.log.txt`     |
| Infrastructure `src/adversarial.test.ts`         | 19/20                 | 19/20                       | `infra-rerun-adversarial.log.txt`         |
| Infrastructure `src/claude/process.test.ts`      | 2/5                   | 2/5                         | `infra-rerun-claude-process.log.txt`      |
| Infrastructure `src/sqlite/upgrade-scan.test.ts` | 9/10                  | 10/10                       | `infra-rerun-sqlite-upgrade-scan.log.txt` |
| API `src/subloop-restart.test.ts`                | 2/3                   | 2/3                         | `api-rerun-subloop-restart.log.txt`       |

The engine failure was `expected 1 to be greater than 1` at `run-manager.test.ts:172` (fast-cycle timer). The API failure, in both runs, was `Hook timed out in 60000ms` at `subloop-restart.test.ts:23`, during fixture cleanup. The CI duplicate-event assertion described in #398 was not reproduced in these runs. That file and issue remain untouched.

## 5. Gates

Node `v22.14.0`, pnpm `12.8.1`; see `environment.log.txt`. All commands ran from the worktree root with Node 22 first on PATH. Exact expanded arguments, exit codes and timestamps are retained in `gates.log.txt`, `extra-gates.log.txt` and `followup-gates.log.txt`.

| Command                                                                                                                             | Result                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                | PASS: 20 tasks                                                                                            |
| `pnpm.cmd lint`                                                                                                                     | PASS: 11 tasks; existing `ThreadViewer.tsx:106` warning                                                   |
| `pnpm.cmd format`                                                                                                                   | PASS; no unrelated source edits                                                                           |
| `pnpm.cmd check:docs`                                                                                                               | PASS                                                                                                      |
| `pnpm.cmd check:migrations`                                                                                                         | PASS                                                                                                      |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                                                                               | FAIL: one untouched timer test; one-file rerun passed                                                     |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1`                                                        | FAIL: 14 tests in six untouched files; all six rerun once as above                                        |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                                                  | BLOCKED before tests by shared reports-directory lock                                                     |
| Same API command with `--coverage.reportsDirectory=<fresh path recorded in api-coverage-output.log.txt> --coverage.reportOnFailure` | FAIL: one untouched cleanup hook; coverage thresholds PASS; one-file rerun retained the same hook failure |
| `pnpm.cmd build`                                                                                                                    | PASS: 11 tasks                                                                                            |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/targeted-events.test.ts` (five consecutive runs)                            | PASS: 24/24 each                                                                                          |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/targeted-events-restart.test.ts`                                            | PASS: 3/3                                                                                                 |
| `pnpm.cmd check:layers`                                                                                                             | PASS                                                                                                      |
| `pnpm.cmd check:deps`                                                                                                               | PASS                                                                                                      |

One-file rerun commands use `pnpm.cmd --filter @graphgoblin/<package> exec vitest run <file>` with every exact package/file in the table above and full expansions in `followup-gates.log.txt`. No whole-suite retry was used to replace a failing test result; the second API coverage attempt resolved a pre-test output-lock failure. Turbo emitted cache-write OS-error-5 warnings while its successful tasks completed.

## 6. Docs

Updated numbered docs 03, 07 and 08, decisions index, and the existing #343 CHANGELOG bullet (including its Upgrade note). No route schema changed in this round, no new dependency, no migration and no new ADR; ADR-0048 remains the decision record. Generated reference drift is checked by the requested docs gate.

## 7. Decisions and parameters

The clean request remains `{loopId, triggerNodeId?, type, payload?, dedupeKey?}` with one explicitly owned destination. The refusal contract is:

| Status | Code                                                 | Reason                                                                                          |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`                                  | Required or malformed fields, including missing stable target and malformed Unicode request key |
| 404    | `LOOP_NOT_FOUND`                                     | Missing or unowned loop, without ownership disclosure                                           |
| 409    | `VERSION_NOT_PUBLISHED`, `LOOP_UPGRADE_REQUIRED`     | No published destination or a stored retired Event exit requiring explicit upgrade              |
| 422    | `EVENT_TRIGGER_NOT_FOUND`, `EVENT_TRIGGER_AMBIGUOUS` | No eligible matching entry, or an explicit entry is needed to disambiguate                      |
| 422    | `EVENT_KEY_EXPRESSION_FAILED`, `EVENT_KEY_INVALID`   | Authored payload key cannot be evaluated or stored with stable Unicode identity                 |
| 422    | `EVENT_PAYLOAD_TOO_DEEP`                             | Payload exceeds the frozen receipt nesting budget                                               |
| 503    | `EVENT_ADMISSION_FAILED`                             | Durable receipt saving cannot be confirmed; no unsaved intent is acknowledged                   |
| 500    | `STORED_EVENT_INVALID`                               | Existing keyed delivery is unreadable; preserve history and require operator inspection         |

These refusals keep invalid destinations from broadcasting, preserve ownership and distinguish sender corrections, persistence uncertainty and stored-history damage. Failed receipt request keys remain consumed; failed receipts release only their authored payload-key reservation, so a new request key can retry new work. Pending/admitted receipts and committed run envelopes still suppress that payload key.

Reused 500 `STORED_EVENT_INVALID` because the keyed delivery is persisted but unreadable, rather than a bad sender request or an unsaved intake. The response and log contain no corrupt payload or raw exception.

Concurrency test parameters are engineering choices: 60-second turns hold both runs open; an explicit 20-second scheduling wait observes both running; cancellation keeps the test bounded. Product retry policy remains eight failures with 5-to-300-second backoff. Webhook nesting refusal remains 995 and above. The admission commit union is unchanged.

## 8. Caveats and open items

Orchestrator commits and runs independent QA. PRs #390 and #394 remain open drafts at the final connector check in `coordination-final.log.txt` (the earlier snapshot is `coordination.log.txt`). No merge performed. TODO #224 integration: if #390 lands first, the orchestrator merges main and the targeted Event path then calls its public admission-open check before recording anything. #224 guards this path if it lands second. TODO #240 integration: whichever PR lands second between #389 and #394 updates `apps/web/e2e/events-refresh.spec.ts` to publish a matching Event loop and send its `loopId`.

The pre-existing #398 `subloop-restart.test.ts` race is outside scope and untouched, as are the held child-creation/uncertain-script and store-reset work. Shared `run-manager.ts` changes are confined to the admission sweep. D-015 native termination evidence in `infrastructure-coverage.log.txt`: `native process-tree cancellation must finish before fixture cleanup: expected true to be false` at `src/process/scripts.test.ts:194`. The Claude descendant marker continued from 42 to 48 characters after cancellation (`src/claude/process.test.ts:146`), and fixture removal reported `EBUSY` for `%USERPROFILE%/AppData/Local/Temp/gg-claude-process-lP4pV2`, `gg-claude-process-no2bTr` and `gg-claude-process-DAILK3`. Readiness additionally reported `Claude CLI check process did not confirm that it stopped.` The native deadline/abort tests timed out; the unrelated upgrade and scan 20-second timeouts are recorded separately without asserting a D-015 cause. No directory cleanup or unverified process termination was attempted.

All round-2 sources and evidence remain uncommitted for the orchestrator; cited names are intended tracked artifacts in that commit. No round-1 capture was rewritten. Retained round-2 logs use portable UTF-8 and `%USERPROFILE%` paths. Superseded raw capture bytes are not kept; their original byte counts/SHA-256 and retained text hashes are recorded in `NORMALIZATION.json`. Every capture is below 1,000,000 bytes. `EVIDENCE-MANIFEST.json` and `VALIDATION.log.txt` record the final integrity checks. Full-suite CI and the orchestrator's independent QA remain required; these local full-suite gates are not all green.
