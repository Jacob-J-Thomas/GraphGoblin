# WP-F3 / #243: independent QA, round 2

## 1. Verdict and revision

**FAIL for `5cf611272365c4bc7e0fb41602c67d2b82426d54`.**

The real F4-to-candidate migration gap is closed. API coverage is green. The harness,
API lifecycle and unchanged-UI regressions passed their feature assertions. However,
the requested interactive large-item check exposed two inspector defects: no item
detail expansion/bounded-excerpt notice, and horizontal page overflow after expanding
Node progress. Infrastructure still fails locally in D-015 native termination cases.
CI passed its coverage-threshold step on this exact head, but that does not establish
working Windows process-tree termination inside this sandbox.

This is the same independent QA thread, working alone. The checkout is detached at
the requested head. The prepared F4 checkout was used **read-only**, verified at
`31f485e3060532f672ecdbb0e92fc2c743807fe0`, with migrations 0000â€“0014. No product
file, dependency, Git index, commit, owner app/store or paid provider was changed.
Round-1 evidence remains in the parent directory; all round-2 work is here.

Windows PowerShell, Node 22.14.0 first on PATH, `pnpm.cmd`, built API/storage/engine
and web assets, headless Microsoft Edge. Owned listeners used 5900, 5905 and 5907.
All inference is **fake-only**; native evidence means actual subprocesses and HTTP.
The built base/candidate servers use public composition and fake-harness/admission
ports, not test-only production exports or private access.

## 2. Defects and round-1 gap disposition

### QA-243-R2-01 â€” major: item detail cannot be expanded and its bound is not disclosed

Reproduce with `node docs/qa/2026-10-22-wp-f3-qa/round-2/interactive-detail.mjs`.
It creates an isolated built API and a real native fake Claude turn producing 20,000
ASCII characters, with transcript capture enabled. The script opens the succeeded run
in Edge at 1440 and 390 px, opens Node progress, selects the inference progress event,
then selects the terminal event and expands Full thread JSON.

Expected: expand the message item's detail, see the 16,384-character excerpt and an
explicit bounded/excerpt notice, with a complete final result.

Actual: **zero item-detail/transcript expansion controls** and **no bounded/excerpt
notice** at either width. Node progress exposes the 200-character summary. The latest
thread JSON contains the transcript artifact reference, but no interactive transcript
viewer. The artifact itself really contains 16,384 text characters, and the API and
visible Result really contain all 20,000. This is an inspector access/disclosure
failure, not loss of the final result.

Evidence: [interactive-detail-results.json](interactive-detail-results.json) records
the controls, compressed visible text, latest transcript presence and exact lengths.
`ProgressDrawer.tsx:67â€“79` renders summaries/progress JSON; `ThreadViewer.tsx:103`
only offers Full thread JSON. The bounded text is created at
`packages/infrastructure/src/claude/protocol.ts:429`.

This closes the round-1 **testing gap with a failed acceptance result**. It does not
close the behavior gap or identify this as a regression introduced by the F4 merge;
the inspector source was unchanged.

### QA-243-R2-02 â€” minor: expanding Node progress causes horizontal page overflow

On the same completed native-fake run, measure document width before and after opening
Node progress. Full thread JSON can then be opened without changing the outcome.

Expected: content fits the document width, with any large data scrolling within its
own panel. Actual:

| Viewport | Before Node progress | After Node progress | After latest Full thread JSON |
| -------- | -------------------- | ------------------- | ----------------------------- |
| 1440 px  | 1440 px              | 2123 px             | 2123 px                       |
| 390 px   | 390 px               | 1508 px             | 1508 px                       |

The expansion, rather than the initial large Result, triggers the overflow. The full
result remains complete. Evidence: `interactive-detail-results.json`, with the
earlier independent observation preserved in `interactive-primary-results.json`.

### Round-1 gaps

| Gap                                               | Round-2 disposition                                                                                                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-01 / M1: actual F4 base store startup migration | **CLOSED, PASS**. Actual prepared F4 code build created the store; candidate startup applied 0015, recovered work, preserved damage and was idempotent.                                                                                 |
| Q-02: infrastructure coverage                     | **Still locally failed / host-qualified**. Eight native termination cases reproduce individually. Fresh single-worker collection and CI evidence are distinguished below. No clean local Windows process-tree qualification is claimed. |
| Q-03: API coverage                                | **CLOSED, PASS** in this round; no 5646 collision or load deadline recurred.                                                                                                                                                            |
| Interactive large-item expansion                  | **TESTED, FAIL**; QA-243-R2-01 and R2-02. Storage/final-result assertions pass.                                                                                                                                                         |

## 3. Per-check steps, expected, actual and evidence

| Check                               | Steps / expected                                                                                                                                                                                                                                              | Actual / disposition                                                                                                                                                   | Evidence                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Build                               | Node 22; `pnpm.cmd build`; build candidate before serving.                                                                                                                                                                                                    | **PASS**, 11 tasks.                                                                                                                                                    | `build.log`, `gate-summary.txt`                                               |
| F4 source admission                 | Read prepared base HEAD and migration journal; do not build/write there. Expect code head 31f485e3 and no 0015.                                                                                                                                               | **PASS**, exact SHA verified; journal ends at 0014. A Git dubious-ownership warning was resolved only with invocation-local `-c safe.directory`, not a global setting. | `migration-base.json`; this report's source revision                          |
| Actual old store                    | Start F4 built API with fresh TEMP store; publish omitted-settings and visits-4 loops and finish each; pause an input wait; create queued work and saved inbound intent through public admission port. Expect old pins without limits and 15 journal entries. | **PASS**; four pre-existing runs including queued/paused, pending saved receipt/inbound event, no limits in base pins.                                                 | `migration-base.json`, `migration-check.mjs`                                  |
| Candidate migration                 | Stop/confirm old process exit; start candidate over same disk store. Expect 0015 once, definition-derived 10/4 visits and null deadlines on all existing run pins and run.queued events.                                                                      | **PASS**, 16 journal entries; every pre-existing run/event has expected limits.                                                                                        | `migration-results.json`, first check                                         |
| Saved intent                        | Inspect saved receipt's run and queued-event pins after real startup. Expect both limits populated with 10/null.                                                                                                                                              | **PASS**; both match. Receipt remained available after recovery.                                                                                                       | `migration-results.json`                                                      |
| Queued inbound recovery             | Observe pre-existing queued run and saved webhook intent's reserved run ID after candidate starts. Expect completion, one admitted run per intent, retained inbound link.                                                                                     | **PASS**, both succeeded; total runs grew by exactly one reserved saved-intent run; receipt admitted, inbound linked.                                                  | `migration-results.json` recovery check                                       |
| Paused migration                    | Resume pre-existing paused wait; send correctly shaped observed input. Expect succeeds with 4/null pin.                                                                                                                                                       | **PASS**, result `ok`; original failed QA payload is retained separately.                                                                                              | `migration-results.json`; `migration-fixture-error.json`                      |
| Idempotent startup                  | Stop/confirm candidate exit; restart same store. Expect unchanged migration records, run rows, queued events and saved intents.                                                                                                                               | **PASS**, exact comparisons unchanged, journal count 16.                                                                                                               | `migration-results.json` second-start check                                   |
| Damaged old row                     | Physical copy of closed F4 store; change one pin to malformed JSON; start candidate. Expect damaged bytes preserved, healthy rows migrate, unreadable row reported.                                                                                           | **PASS**; `{damaged-qa` unchanged; healthy pin 10/null; GET damaged run reports HTTP 500 `STORED_RUN_INVALID`, malformed JSON in pinned.                               | `migration-results.json` damage check                                         |
| Migrated inspector                  | Open real migrated 10/4 runs in Edge at 390 px. Expect matching limits card/no deadline.                                                                                                                                                                      | **PASS**, both cards visible.                                                                                                                                          | `migration-results.json` Edge check                                           |
| Native old/default limit            | Run replayable native recipe against rebuilt candidate. Expect default pin 10/null and finite cap failure, not hidden deadline.                                                                                                                               | **PASS**.                                                                                                                                                              | `native-recipe.log`                                                           |
| Native Unlimited / cancel           | Observe >20 fake turns, cancel via built API; separately cancel stalled fake and verify PID exited. Expect bounded cancellation.                                                                                                                              | **PASS**; loop cancel **61 ms**; stalled fake exit/cancel **70 ms**.                                                                                                   | `native-recipe.log`                                                           |
| Native deadline/error classes       | Recipe authored 5-second deadline and quota/transport/unknown fakes. Expect typed terminal outcomes.                                                                                                                                                          | **PASS**, all five recipe scenarios passed.                                                                                                                            | `native-recipe.log`                                                           |
| Claude launch options               | Replay native fake Claude through public runner. Expect no inference `--max-turns` and no independent adapter turn timer.                                                                                                                                     | **PASS**, false/null request facts. No-turn help probe is distinct.                                                                                                    | `claude-results.json`                                                         |
| Node watchdog                       | Native stalled fake, authored node timeout 10 s. Expect one invocation and `INFERENCE_TIMEOUT`.                                                                                                                                                               | **PASS code/count**, observed **12,375 ms**; native stop is D-015-qualified, with the finite fake exiting at 12 s. Not a claim of prompt process-tree kill.            | `claude-results.json` stall                                                   |
| Native typed transport/quota        | Emit documented native assistant error categories. Expect truthful failure and no uncertain resubmission.                                                                                                                                                     | **PASS**, `HARNESS_TRANSPORT_FAILED` / `HARNESS_QUOTA_EXHAUSTED`, one native fake invocation each.                                                                     | `claude-results.json` and its invocation log                                  |
| Native stream bound                 | Emit >4 MiB of individually valid assistant records. Expect failure, not successful final truncation.                                                                                                                                                         | **PASS**, `HARNESS_OUTPUT_LIMIT`, one invocation.                                                                                                                      | `claude-results.json` overflow                                                |
| Bounded detail / final              | Real native 20,000-char result plus transcript; inspect stored artifact and visible Result. Expect detail 16,384 and final 20,000.                                                                                                                            | **PASS** storage and complete API/visible final. Interactive access/disclosure fails separately.                                                                       | `claude-results.json`; `interactive-detail-results.json`                      |
| Merged result acceptance            | Native result-only fake remains alive 500 ms after valid result; observe public submission event versus runner return. Expect `claude.result` before process exit.                                                                                            | **PASS**, about **0.5 s** before runner return in the final measurement; earlier valid observation about 520 ms retained.                                              | `interactive-detail-results.json`, `interactive-timeline-selector-error.json` |
| Published pin API                   | Replay API checks; publish omitted loop and run. Expect 10/null.                                                                                                                                                                                              | **PASS**.                                                                                                                                                              | `api-results.json` first check                                                |
| Deadline/input terminality          | Input wait with authored 5 seconds; submit correctly shaped late input. Expect non-resumable deadline failure and no resurrection.                                                                                                                            | **PASS**, **5,519 ms**, code `RUN_DEADLINE_EXCEEDED`, resumable false, late input rejected. Round-2 script corrects round-1's invalid `value` field to `input`.        | `api-results.json`                                                            |
| Pause/restart deadline              | Pause authored wait; stop actual API process; wait past deadline; start new API over same store. Expect same absolute start+5 deadline and failure.                                                                                                           | **PASS**, identical start/limits and derived absolute deadlines.                                                                                                       | `api-results.json`                                                            |
| No default deadline                 | Replay native short wait/restart observation. Expect still waiting with null pin.                                                                                                                                                                             | **PASS**, 7 s native observation; round-1's 24-hour fake-clock evidence remains historical, not rerun here.                                                            | `api-results.json`                                                            |
| Unlimited marked gate               | Visits null, gate passes null; run >20 fake work visits and cancel.                                                                                                                                                                                           | **PASS**, 21 visits, cancel **69 ms**.                                                                                                                                 | `api-results.json`                                                            |
| Safe retry                          | Fake port reports retriable definitely-not-submitted transport failure. Expect exactly two invocations, no third.                                                                                                                                             | **PASS**, two. This is fake-port evidence, not native CLI proof of a pre-submission network refusal.                                                                   | `api-results.json`                                                            |
| Retry negatives                     | Uncertain transport, non-retriable transport, quota, auth, timeout and output-limit errors. Expect exactly one invocation each.                                                                                                                               | **PASS**, six negative cases, one each. Native uncertainty/quota/output/timeout counts also one.                                                                       | `api-results.json`, `claude-results.json`                                     |
| Child cancellation                  | Replay built API parent deadline awaiting input child. Expect parent failed/non-resumable and child cancelled.                                                                                                                                                | **PASS**, parent elapsed **5,791 ms**, child cancelled.                                                                                                                | `child-inspector-results.json`                                                |
| Synthetic migrated inspector replay | Replay existing child-and-inspector script on separate current-build store. Expect reconstructed pin visible.                                                                                                                                                 | **PASS**; supplementary only, actual-base migration above is stronger evidence.                                                                                        | `child-inspector-results.json`                                                |
| Interactive expansion               | Open message progress then terminal event, Node progress and Full thread JSON at desktop/390. Expect item detail plus bound disclosure.                                                                                                                       | **FAIL**, no such controls/notice; latest transcript reference is present.                                                                                             | `interactive-detail-results.json`, R2-01                                      |
| Large-item layout                   | Compare document width before/after progress expansion, desktop/390. Expect document stays within viewport.                                                                                                                                                   | **FAIL**, expansion causes 2123/1508 px document widths.                                                                                                               | `interactive-detail-results.json`, R2-02                                      |
| Three existing Edge specs           | Run unchanged unlimited-mode, definition-pins, editor-modal once to completion, zero retries.                                                                                                                                                                 | **PASS**, 10 tests, **21.7 s**; initial runner abort on PowerShell stderr warning was not a completed test run.                                                        | `edge-specs.log`, `edge-runner-abort.log`                                     |
| Existing Edge extras                | Replay `edge-extra.mjs` once on fresh store. Expect Settings, Loop controls, pin card, gate validation and no API budget fields; 390 px.                                                                                                                      | **PASS**, five checks, all measured widths 390.                                                                                                                        | `edge-extra-results.json`, `edge-extra.log`                                   |

## 4. Coverage and failure triage

Requested commands ran consecutively after the build, before other native tests:

```powershell
pnpm.cmd --filter @graphgoblin/infrastructure test:coverage -- --maxWorkers=1
pnpm.cmd --filter @graphgoblin/api test:coverage -- --maxWorkers=1
```

Infrastructure: **8 failed / 652 passed, 660 total**, 47 files. API: **738 passed /
6 skipped, 744 total**, 55 files; lines **97.93% (1803/1841)**, branches **93.11%
(1284/1379)**. No API port collision or load timeout occurred.

The literal second `--` is forwarded to Vitest. Fresh public `parseCLI` evidence shows
it puts `--maxWorkers=1` in `options["--"]`, leaving `maxWorkers` unset. Therefore a
second, justified collection used the corrected worker option, one package after the
other and no concurrent intentional test work:

```powershell
pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --coverage.reportOnFailure
pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1
```

`--coverage.reportOnFailure` only emits coverage on failed tests; thresholds,
assertions, exclusions and timeouts are unchanged. Final single-worker results and
fresh denominators are in `single-worker-infrastructure.log`, `single-worker-api.log`
and `gate-summary.txt`. Infrastructure retained **8 failed / 652 passed** with **98.64% lines (2046/2074)** and **94.69% branches (1661/1754)**. Its original failed qualification is retained.

The correctly applied single-worker API run also **passed: 738 passed / 6 skipped**,
with **97.93% lines (1803/1841)** and **93.11% branches (1284/1379)**. It finished in
341.2 seconds; infrastructure finished in 240.2 seconds. Neither had a load deadline
or port collision. Both original exact-command results remain preserved.

Every initial failed infrastructure case was also rerun **alone**, one worker, in
`triage-native.ps1`; all eight reproduced. See `triage-summary.txt` and named logs.

| Case                                              | Isolated result / class                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| adversarial ProcessScripts child/grandchild abort | Failed, 30 s timeout waiting for native process-tree termination: **D-015**, not load  |
| Claude process deadline/output overflow           | Failed, locked fixture cleanup after native stop: **D-015**                            |
| Claude already-aborted/running abort              | Failed, locked fixture cleanup: **D-015**                                              |
| Claude descendant                                 | Failed, descendant marker still grew after cancellation, plus EBUSY: **D-015**         |
| Claude no-turn hang probe                         | Failed, got termination-unconfirmed diagnostic instead of confirmed timeout: **D-015** |
| ProcessScripts partial UTF-8 cancel               | Failed native-stop confirmation/cleanup assertion: **D-015**                           |
| ProcessScripts timeout                            | Failed, 15 s native termination wait: **D-015**, not load                              |
| ProcessScripts abort                              | Failed, 15 s native termination wait: **D-015**, not load                              |

These are preserved failed host qualifications, not suppressed or converted to passes.

CI run [39725272314](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/39725272314)
was read live: exact head matches, **Unit tests with coverage thresholds succeeded**.
The overall run failed later at **Dependency audit**. `ci-run.json` is the API job/step
record; detailed logs could not be fetched (HTTP 403, admin rights required), recorded
in `ci-log-extract.log`. Do not describe the entire CI run as green or infer exact
per-package command output from step metadata alone.

## 5. Evidence and QA fixture corrections

All artifacts are small text/JSON/scripts here. Large repeated fake text in browser
observations is compressed to a character-count marker; the actual measured result
and artifact were read in full. No screenshots, traces, credentials or owner data
were persisted. Paths are sanitized before handoff.

Replay scripts are round-1 copies with relative imports/output moved into this
directory. Corrections affected QA only: the observed input body key; the early
submission observer initially watched only `claude.result` even though the large
fixture had already emitted `claude.assistant`; the timeline's progress label contains
the node ID, not its summary; and PowerShell needed Continue to collect a harmless
native stderr color warning. Failed setup attempts are preserved in
`migration-fixture-error.json`, `interactive-fixture-error.json`,
`interactive-timeline-selector-error.json`, `interactive.log`,
`interactive-corrected.log` and `edge-runner-abort.log`.

The second completed interactive run was a targeted diagnosis: select latest terminal
thread too, and measure initial/progress/full-JSON widths separately. Both independent
completed observations retained the same product failures. No broad suite was retried
to erase a failure; the additional coverage collection corrects the verified worker
argument defect and reports missing denominators.

## 6. Documentation and decisions

The existing #243 plan, owner recipe and D-027 remain the authority: visits default
10, no default run deadline, authored deadlines include waits/pauses/downtime, explicit
Unlimited, one safe retry, no cost/token/provider-turn budget. The merged F4 change
is separately qualified by the result-only native submission timing check.

No numbered document, ADR, CHANGELOG or generated reference was edited. Known #205
model-picker failures elsewhere were not run or used as exceptions to these passing
ten Edge cases. CI Dependency audit is outside WP-F3; no dependency repair was made.

## 7. Cleanup

All real base/candidate migration processes were stopped through the QA control and
confirmed exited before their stores/copy were removed. Each migration result file
records those exits and its cleanup outcomes. Native recipe/API replay stores removed
themselves after their processes exited. The Edge wrapper confirms its owned Node
PID exited before removal (`edge-cleanup.json`). The interactive server/browser were
closed before removal (`interactive-detail-results.json`).

The Claude replay's five feature checks passed, but its command exited **1** on a
Windows EBUSY removing the DB sidecar; this failed cleanup is preserved in `claude.log`.
After that Node invocation was confirmed exited, the exact remaining store was handled
separately; see `claude-cleanup.json` and the final cleanup manifest.

Native infrastructure tests own their default fixture names rather than the explicit
QA store prefix. Any remaining directory whose child termination is unconfirmed is
listed in `cleanup-manifest.json`; no unknown process is killed and no such directory
is removed while its process ownership/exit is uncertain. Final listener and Git
boundary checks are recorded in `final-boundary.txt`.

Final inventory: **zero dedicated `gg-qa-243-*` stores remain**. Nine owned native-test
fixture directories remain under `%TEMP%`, with child termination unconfirmed:

```text
gg-claude-process-0ISQr7
gg-claude-process-296lcK
gg-claude-process-G90owW
gg-claude-process-GuZvOx
gg-claude-process-I7f7D5
gg-claude-process-IHfQC5
gg-claude-process-UeB51v
gg-claude-process-jLNaHZ
gg-claude-process-lwkb5s
```

## 8. Files changed and open work

Only new round-2 QA evidence/scripts under this directory. No product changes, staging,
commit, push, issue/PR comment, owner environment action or sub-agent. Final HEAD and
empty tracked/index diffs are recorded at closing.

For acceptance: address or explicitly disposition R2-01/R2-02; retain the D-015 Windows
native-process qualification separately from passing CI coverage. Q-01 and Q-03 need
no further replay on this evidence. No real provider, one-hour native soak or live
provider budget/cost test is claimed or needed for these fake-only checks.
