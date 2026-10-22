# WP-F3 / #243: round 3 replayable evidence

## 1. Verdict and scope

**PASS for the requested #243 replay scope on
`a3dd50ea74c4bbcc926ec43a37134737ce600f07`, with the native-process timing qualification below.**

The lost replay kit has been recreated and exercised against this head's build.
These are **fresh round-3 observations**, not recovered copies of deleted round-1/2
JSON or logs. All requested replay checks passed. No new in-scope product defect was
found. The prior inspector observations remain visible and are explicitly outside
#243 under the round-3 dispatch; they are not acceptance failures for this replay.

Independent QA, same thread, working alone. No product edits, staging, commits,
publication, owner listeners/store, installed runtime changes or paid provider turns.
The head differs from the preceding product head only by curated QA evidence.

Node **22.14.0**, PowerShell, `pnpm.cmd`, real built API processes, real native fake
CLIs and headless Microsoft Edge. Manual listeners stayed within **5900–5909**.
All inference is **fake-only**. Native process evidence does not establish behavior
of a live provider. Product/component imports resolve from computed `<repo>` paths.

## 2. Per-check results

Each row states the procedure, expected behavior, actual result and preserved evidence.

| Check                            | Steps and expected                                                                                                                                                                          | Actual                                                                                                                                         | Evidence                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate build                  | Node 22 first on PATH; `pnpm.cmd build`.                                                                                                                                                    | **PASS**, 11 tasks; nine cached, two rebuilt.                                                                                                  | [build.log](build.log)                                                                                                                   |
| Native defaults                  | Run the recreated native recipe; expect 10 visits, no deadline, `MAX_NODE_VISITS` at the finite default.                                                                                    | **PASS**, omitted deadline pinned null and default cap enforced.                                                                               | [native-recipe.mjs](native-recipe.mjs), [native-worker.mjs](native-worker.mjs), [native-recipe-results.json](native-recipe-results.json) |
| Native Unlimited/cancel          | Execute beyond 20 fake turns; cancel; separately cancel stalled native fake and confirm PID exits. Expect bounded cancellation without substitute budget.                                   | **PASS**, loop cancel **39 ms**; stalled fake exit/cancel **63 ms**.                                                                           | [native-recipe-results.json](native-recipe-results.json)                                                                                 |
| Native deadline and typed errors | Recipe authored 5 seconds plus quota, transport and unknown fixtures. Expect deadline failure and truthful typed failures.                                                                  | **PASS**, all five native recipe scenarios.                                                                                                    | [native-recipe-results.json](native-recipe-results.json)                                                                                 |
| Published defaults pin           | Publish an omitted-settings input loop; inspect API pin; cancel.                                                                                                                            | **PASS**, 10/null.                                                                                                                             | [api-checks.mjs](api-checks.mjs), [api-results.json](api-results.json)                                                                   |
| Unlimited marked gate            | Visits null and repeat passes null; observe >20 work visits; cancel.                                                                                                                        | **PASS**, **22 visits**, cancel **121 ms**.                                                                                                    | [api-results.json](api-results.json)                                                                                                     |
| Five-second input deadline       | Wait for input with authored 5 s; send correctly shaped late input and attempt resume. Expect non-resumable deadline failure and no resurrection.                                           | **PASS**, **5,464 ms**; `RUN_DEADLINE_EXCEEDED`, resumable false; late input 409 and resume refused.                                           | [api-results.json](api-results.json)                                                                                                     |
| Paused run / kill / restart      | Pause authored wait; kill owned API; confirm exit; restart same store after original deadline. Expect unchanged startedAt/limits and absolute deadline.                                     | **PASS**, original start+5 deadline retained and run failed.                                                                                   | [api-results.json](api-results.json), lifecycle entries                                                                                  |
| Default input wait               | Kill/restart a run without a deadline; observe another 7 s. Expect still waiting/null pin, then cancellable.                                                                                | **PASS** native shortened observation. The focused engine test separately advances a full day.                                                 | [api-results.json](api-results.json), [engine-focused-results.json](engine-focused-results.json)                                         |
| Safe transport retry             | Public FakeHarness reports retriable and definitely-not-submitted transport failure; count invocations. Expect exactly two.                                                                 | **PASS**, two. The focused engine run also checks original task/turn identity.                                                                 | [api-results.json](api-results.json), [engine-focused-results.json](engine-focused-results.json)                                         |
| Retry negatives                  | Uncertain/non-retriable transport, quota, auth, timeout and output overflow. Expect one invocation each.                                                                                    | **PASS**, all negatives once; no substitution or allowance recovery.                                                                           | [api-results.json](api-results.json)                                                                                                     |
| Claude launch cutoffs            | Native fake CLI; inspect inference process request. Expect no `--max-turns`, adapter timeout null.                                                                                          | **PASS**, false/null launch facts. No-turn help compatibility probe is separate.                                                               | [claude-checks.mjs](claude-checks.mjs), [claude-results.json](claude-results.json)                                                       |
| Native typed errors/counts       | Native fake Claude emits transport/quota/auth categories. Expect matching run codes and no uncertain retry.                                                                                 | **PASS**, `HARNESS_TRANSPORT_FAILED`, `HARNESS_QUOTA_EXHAUSTED`, `HARNESS_NOT_AUTHENTICATED`; once each.                                       | [claude-results.json](claude-results.json), saved invocation log                                                                         |
| Node watchdog                    | Stall native fake with authored node timeout 10 s. Expect `INFERENCE_TIMEOUT`, one invocation.                                                                                              | **PASS code/count**; **12,954 ms** including native process-close wait. See host qualification in section 5.                                   | [claude-results.json](claude-results.json)                                                                                               |
| Stream resource bound            | Native fake streams >4 MiB of individually valid records. Expect failure, not successful truncated final output.                                                                            | **PASS**, `HARNESS_OUTPUT_LIMIT`, one invocation.                                                                                              | [claude-results.json](claude-results.json), [fake-claude.mjs](fake-claude.mjs)                                                           |
| Detail versus final result       | Native fake returns 20,000 chars; read stored transcript and final API value.                                                                                                               | **PASS**, stored text **16,384**, final **20,000**.                                                                                            | [claude-results.json](claude-results.json), [interactive-detail-results.json](interactive-detail-results.json)                           |
| F4 result acceptance             | Native result-only fake stays alive 500 ms after valid result. Expect `claude.result` observable before runner return.                                                                      | **PASS**, about **510 ms** before native process return.                                                                                       | [claude-results.json](claude-results.json)                                                                                               |
| Child deadline                   | Parent authored 5 s awaits input child. Expect parent non-resumable failure and child cancelled.                                                                                            | **PASS**, parent **5,537 ms**, child cancelled.                                                                                                | [child-and-inspector.mjs](child-and-inspector.mjs), [child-inspector-results.json](child-inspector-results.json)                         |
| Authored inspector card          | Open failed parent at 390 px. Expect pinned 10 visits, 5-second limit and correct absolute deadline.                                                                                        | **PASS**, both card and absolute timestamp visible.                                                                                            | [child-inspector-results.json](child-inspector-results.json)                                                                             |
| Actual old store                 | Read-only prepared F4 `31f485e3` build creates finished omitted/4-visit runs, paused input run, queued run and pending webhook admission. Expect 15 migrations and old pins without limits. | **PASS**, four pre-existing runs and pending saved intent.                                                                                     | [migration-check.mjs](migration-check.mjs), [migration-results.json](migration-results.json)                                             |
| Real startup migration           | Stop/confirm F4 exit, start candidate on same disk. Expect 0015 once and definition-derived 10/4 visits plus null deadline on every old run/event pin and both saved intent pins.           | **PASS**, journal 15 to 16, all matching.                                                                                                      | [migration-results.json](migration-results.json)                                                                                         |
| Queue/admission recovery         | Observe queued run and saved-intent run after candidate starts. Expect one execution each, retained inbound link.                                                                           | **PASS**, succeeded, exactly one additional reserved saved-intent run; receipt admitted.                                                       | [migration-results.json](migration-results.json)                                                                                         |
| Paused migration continuation    | Resume old paused run; provide observed input. Expect completion and preserved 4/null pin.                                                                                                  | **PASS**, result `ok`.                                                                                                                         | [migration-results.json](migration-results.json)                                                                                         |
| Migration idempotency            | Stop/confirm candidate exit and restart same store. Expect identical migration rows, runs, queued payloads and receipts.                                                                    | **PASS**, unchanged, 16 journal rows.                                                                                                          | [migration-results.json](migration-results.json)                                                                                         |
| Damaged old pin                  | Independently copy closed F4 store; corrupt one pin; candidate startup. Expect bytes retained, healthy rows migrated, explicit diagnostic.                                                  | **PASS**, `{damaged-qa` retained; `STORED_RUN_INVALID` reported; healthy 10/null pin.                                                          | [migration-results.json](migration-results.json)                                                                                         |
| Migrated inspector               | View real migrated omitted/finite runs at 390 px. Expect cards show 10/4 visits and no deadline.                                                                                            | **PASS**, both cards.                                                                                                                          | [migration-results.json](migration-results.json)                                                                                         |
| Supplemental SQL matrix          | Synthetic real-libSQL old rows: omitted, 4, null visits; run/event/saved-intent pins; repeated SQL; malformed JSON.                                                                         | **PASS**, three cases; all pin locations match, malformed run/event/intent bytes preserved. This supplements, not replaces, actual F4 startup. | [migration-supplement.mjs](migration-supplement.mjs), [migration-supplement-results.json](migration-supplement-results.json)             |
| Three unchanged Edge specs       | Unlimited-mode, definition-pins, editor-modal; built candidate, one worker, zero retries.                                                                                                   | **PASS**, **10 tests**, **29.1 s**.                                                                                                            | [edge-specs.mjs](edge-specs.mjs), [edge.config.mjs](edge.config.mjs), [edge-specs-results.json](edge-specs-results.json)                 |
| Extra Edge checks                | 390 px Settings/Loop defaults, keyboard Unlimited/warning, published pin, finite-cap gate warning, passes Unlimited and no API budget fields.                                               | **PASS**, five checks; measured pages 390 px without overflow in these views.                                                                  | [edge-extra.mjs](edge-extra.mjs), [edge-extra-results.json](edge-extra-results.json)                                                     |
| Focused engine                   | Run `src/unlimited.test.ts` with one worker. Expect all deadline, late-result, retry, gate, child, draining and 24-hour wait/recovery scenarios.                                            | **PASS**, **19 tests**.                                                                                                                        | [engine-focused.mjs](engine-focused.mjs), [engine-focused-results.json](engine-focused-results.json)                                     |
| Complete visible large result    | Open native large result at desktop and 390 px; parse visible Result.                                                                                                                       | **PASS**, complete 20,000 at both widths. Follow-up inspector observations are recorded separately.                                            | [interactive-detail.mjs](interactive-detail.mjs), [interactive-detail-results.json](interactive-detail-results.json)                     |

## 3. Inspector follow-up disposition

Per the explicit round-3 dispatch, QA-243-R2-01 and QA-243-R2-02 are pre-existing
inspector gaps outside #243, to be filed as follow-ups. No product repair was attempted.
The recreated interactive script preserves both observations, separately from its
positive storage/final-result checks:

- No item-detail/transcript expansion control or bounded-excerpt notice.
- Node progress expansion can produce horizontal document overflow; initial Result
  view fits. Exact initial/progress/latest-thread measurements are in the JSON.

These are not described as fixed or newly introduced by this head. They do not
change this scope's PASS verdict. Their original severity remains historical; no
new in-scope major/minor defect is asserted.

## 4. Replay instructions

From `<repo>` in PowerShell:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
node --version # v22.x
powershell.exe -NoProfile -ExecutionPolicy Bypass -File docs/qa/2026-10-22-wp-f3-qa/round-3/gates.ps1
```

[gates.ps1](gates.ps1) builds once, runs each replay serially, records exits and
refreshes preservation links. Its process-local execution-policy setting does not
alter the installed runtime or machine policy. Each `.mjs` can also be invoked
individually with Node 22 after building. This collection used serial individual
invocations, avoiding a duplicate whole-kit rerun just to exercise the wrapper.

The shared [qa-lib.mjs](qa-lib.mjs) owns bounded HTTP/process operations, assertions,
actual HEAD stamping, safe cleanup and JSON reporting. [server.mjs](server.mjs)
imports the candidate build or the prepared sibling F4 build read-only, injects
public fakes and exposes QA-only controls on the disposable instance. The Claude
fixture has no provider/network capability. [native-worker.mjs](native-worker.mjs)
is the shipped integration recipe with only its TEMP prefix changed.

`gates.ps1` accepts an `Only` array when invoked from PowerShell, for example
`-Only @('engine-focused')`. It otherwise runs every listed scenario. No live or
paid provider invocation is part of the kit.

## 5. Host limits and evidence boundaries

- The native 10-second node watchdog produced the expected failure after about
  12.95 seconds, including waiting for the finite fake to close. This preserves the
  prior Windows D-015 termination qualification; it does not certify prompt native
  process-tree termination for Claude. Native Codex cancellation separately confirmed
  the fake PID exited in 63 ms.
- No ten-minute wall-clock soak was performed: the adapter's public process request
  records `timeoutMs:null`, and inference launch omits `--max-turns`. The overnight
  no-deadline behavior is covered by public fake-clock engine scenarios, not a real
  one-hour paid soak.
- Safe pre-submission transport retry is fake-port evidence. Native uncertain
  transport is correctly invoked once. No blanket claim of retry-safe real-provider
  failures is made.
- Full package coverage suites and CI were not rerun for this evidence-only head;
  the focused engine run is fresh. The prior coverage/adapter/migration dispositions
  stand as instructed. Deleted historical raw artifacts are not represented as
  recovered or freshly verified coverage output.

## 6. Cleanup and boundaries

Each server runs in an owned child process. Graceful stop or the deliberate kill
is followed by an observed process exit before its TEMP store is removed. The
migration check independently copies the closed base store and removes both stores
after candidate exits. JSON files record those process and cleanup outcomes.

All stores created by this round were removed; final inventory is recorded in
[final-boundary.json](final-boundary.json). No unknown process or previous-round
fixture directory was touched. Listener/Git/privacy checks and retention verification
are preserved below. No staging or commit was performed.

## 7. Restoration and preservation

The replay code is functionally equivalent to the lost scripts, reorganized around
shared support and child-process cleanup. All observations are new. Supplementary
SQL saved-intent/damaged-row assertions were added after its first passing run and
that small supplement alone was rerun; broad suites were not retried to green.

Every file intended for curation is linked **directly from this README**, including
scripts, JSON, text logs and nested Edge output. The same complete inventory is in
[ARTIFACTS.md](ARTIFACTS.md). [finalize-evidence.mjs](finalize-evidence.mjs) regenerates
both inventories and [retention-check-results.json](retention-check-results.json).
The finalizer must run again if artifacts are added or renamed. JSON command results
also retain sanitized stdout, so the meaningful observations are durable even when
reading without the separate log files. Preserve explicitly linked files during
curation, including any `.log` files ignored by normal Git discovery.

## 8. Files changed

Only round-3 QA scripts, observations and documentation under this directory.
No product source, existing test, numbered doc, ADR, CHANGELOG, generated reference,
package manifest, lockfile or Git index changed. This is a local evidence handoff;
there was no GitHub write or commit.

<!-- QA-ARTIFACTS-START -->

## Complete preservation links

- [ARTIFACTS.md](ARTIFACTS.md)
- [README.md](README.md)
- [api-checks.log](api-checks.log)
- [api-checks.mjs](api-checks.mjs)
- [api-results.json](api-results.json)
- [build.log](build.log)
- [child-and-inspector.log](child-and-inspector.log)
- [child-and-inspector.mjs](child-and-inspector.mjs)
- [child-inspector-results.json](child-inspector-results.json)
- [claude-checks.log](claude-checks.log)
- [claude-checks.mjs](claude-checks.mjs)
- [claude-results.json](claude-results.json)
- [edge-extra-results.json](edge-extra-results.json)
- [edge-extra.log](edge-extra.log)
- [edge-extra.mjs](edge-extra.mjs)
- [edge-output/.last-run.json](edge-output/.last-run.json)
- [edge-specs-results.json](edge-specs-results.json)
- [edge-specs.log](edge-specs.log)
- [edge-specs.mjs](edge-specs.mjs)
- [edge.config.mjs](edge.config.mjs)
- [engine-focused-results.json](engine-focused-results.json)
- [engine-focused.log](engine-focused.log)
- [engine-focused.mjs](engine-focused.mjs)
- [fake-claude.mjs](fake-claude.mjs)
- [final-boundary.json](final-boundary.json)
- [finalize-evidence.mjs](finalize-evidence.mjs)
- [format.log](format.log)
- [gates.ps1](gates.ps1)
- [interactive-detail-results.json](interactive-detail-results.json)
- [interactive-detail.log](interactive-detail.log)
- [interactive-detail.mjs](interactive-detail.mjs)
- [migration-check.log](migration-check.log)
- [migration-check.mjs](migration-check.mjs)
- [migration-results.json](migration-results.json)
- [migration-supplement-results.json](migration-supplement-results.json)
- [migration-supplement.log](migration-supplement.log)
- [migration-supplement.mjs](migration-supplement.mjs)
- [native-recipe-results.json](native-recipe-results.json)
- [native-recipe.log](native-recipe.log)
- [native-recipe.mjs](native-recipe.mjs)
- [native-worker.mjs](native-worker.mjs)
- [qa-lib.mjs](qa-lib.mjs)
- [replay-summary.json](replay-summary.json)
- [retention-check-results.json](retention-check-results.json)
- [server.mjs](server.mjs)

<!-- QA-ARTIFACTS-END -->
