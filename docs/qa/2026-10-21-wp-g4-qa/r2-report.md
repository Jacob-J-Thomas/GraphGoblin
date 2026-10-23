# Round 2 independent QA: WP-G4 (#129), PR #366

**Verdict: PASS with a minor documentation defect on `5d2783359dbcb95aa719146416f02dc303cbd1ed`.** The served recipe, D1 fallback, six Edge regressions and three isolated inspector files passed. Full coverage and any isolated follow-ups are recorded below.

## Revision and environment

- Exact tested head: `5d2783359dbcb95aa719146416f02dc303cbd1ed`; detached worktree `codex-qa-wp-g4`.
- Node `v22.14.0`, first on PATH; PowerShell `5.1.26100.9711`.
- Native API: `127.0.0.1:5641`; successful store `%TEMP%\gg-qa-129-r2-native-EI3s8w`.
- Microsoft Edge, headless and isolated. Actual browser version is recorded in [r2-browser.json](r2-browser.json); viewports 1440×900 and 768×900.
- Fake-only browser regression APIs: ports 5642–5648; control 5640; repository fake classifier 5649. [r2-regression-environment.json](r2-regression-environment.json).
- Frozen install skipped as instructed; the orchestrator supplied dependencies. No global runtime or execution-policy configuration changed. No paid turns or owner app/store access at 4747/4748.
- Round-1 evidence was retained unchanged. Round-2 files use the `r2-` prefix, plus `r2-browser-output/`. No product file, maintained test body, index or commit changed.

The round-1 G1 load disposition and the prior cleanup were supplied by the orchestrator. They are context, not a substitute for the current measurements. D1 is retested directly below.

## Per-check results

The JSON evidence stores the actual inspector/editor text and API/event responses. IDs identify individual checks. All twelve final served checks passed.

| Check                        | Steps                                                                                                                                   | Expected                                                                                                                          | Actual                                                                                                     | Verdict / evidence                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Build                        | Node 22; `pnpm.cmd build`                                                                                                               | Successful build before serving apps                                                                                              | 11/11 tasks succeeded, 9 cached; exit 0. Cache I/O access-denied warnings were emitted                     | PASS; [r2-build.txt](r2-build.txt)                                                                     |
| Recipe §2                    | Run the documented PowerShell `Invoke-RestMethod -InFile` import and JSON `{}` publish commands for gate, suppressed, quiet and history | Four loops import and publish without content-type/quoting errors                                                                 | Four published current versions; PS 5.1 recorded                                                           | PASS; [r2-import.ps1](r2-import.ps1), [r2-imports.json](r2-imports.json)                               |
| Gate authoring, §3           | Open Gate; inspect Routes/Id/Label help; duplicate Again label, restore Done; inspect at 768 px                                         | Every quoted help sentence, uniqueness error and restoration; contained dialog                                                    | Exact text and accessibility-description assertions passed; duplicate error clears; dialog bounds recorded | PASS; [r2-before-checks.json](r2-before-checks.json), `gate-editor`                                    |
| Gate completion, §3          | Runs → New run; choose gate fixture; inspect final decision                                                                             | exhausted; Result 3; exact last-gate sentence; route again, port limit-reached, label Again, previous/current 3/3, Maximum passes | All expected UI values and final event details recorded                                                    | PASS; same file, `gate-run`                                                                            |
| None editor, §4              | Open suppressed Done exit                                                                                                               | None text and exact two-destination suppression help                                                                              | Both quoted sentences present                                                                              | PASS; same file, `suppressed-editor`                                                                   |
| None completion, §4          | Start fixture through New run; inspect top and exit.evaluated                                                                           | succeeded; no Result or return delivery; exact suppression explanation in both locations                                          | Exact explanation in both locations; zero return events                                                    | PASS; same file, `suppressed-run`                                                                      |
| Quiet authoring, §5          | Open Quiet, Kept and a newly added Exit; inspect caller default; undo palette addition                                                  | Quoted quiet help, ordinary expression help, singular default-caller suppression warning                                          | All authoring checks passed                                                                                | PASS; same file, `quiet-editor`                                                                        |
| Quiet completion, §5         | Start fixture through New run; inspect run and exit detail                                                                              | succeeded; no Result/delivery; exact quiet explanation                                                                            | Exact explanation in both locations; zero return events                                                    | PASS; same file, `quiet-run`                                                                           |
| Fourth-loop authoring        | Open imported history Done                                                                                                              | Returns null expression, caller destination and ordinary destinations help                                                        | Full ordinary help recorded, including its final quiet-exit sentence                                       | PASS; same file, `history-editor`                                                                      |
| History before amendment, §6 | Start QA 129 omitted null through New run; inspect before stopping                                                                      | succeeded; API owns result:null; visible Result null; no exit-returns sentence                                                    | All four assertions passed; full before text and events retained                                           | PASS; same file, `history-before`                                                                      |
| Canonical amendment, §6      | Stop owned built API; verify health refusal; run the documented mjs command in PS 5.1 against the same store and recorded ID            | Exactly 1 run.finished event and 1 run row amended                                                                                | `amended run 01M5GJ12HHGEF4G1AMV3K6P0W9: 1 run.finished event(s), 1 run row(s)`                            | PASS; [r2-amend-counts.txt](r2-amend-counts.txt), [r2-native-lifecycle.json](r2-native-lifecycle.json) |
| History after restart, §6    | Start a new built process on same store; open amended history and exit.evaluated                                                        | No Result; exact ambiguous-expression sentence in both locations; no Returns None claim                                           | Exact sentence in top card and detail, no Result                                                           | PASS; [r2-after-checks.json](r2-after-checks.json), `history-amended`                                  |
| None/quiet after restart, §6 | Reopen original two runs                                                                                                                | Their distinct Returns None and quiet-exit explanations survive                                                                   | Both exact explanations remain; no Result                                                                  | PASS; same file, `suppressed-restart`, `quiet-restart`                                                 |
| D1 fallback                  | Fresh browser context; block immutable-version GET with controlled 404; inspect amended history and selected exit detail                | Reworded unavailable-definition sentence; literal “Returns is None” absent                                                        | Exact new sentence in both places; literal substring absent from inspector body; no Result                 | PASS; same file, `missing-definition`                                                                  |

The D1 fallback observed was:

> No value was recorded for this run. The pinned definition is not available, so the exit’s Returns setting cannot be shown.

The amended-history sentence observed was:

> No value was recorded for this run. The exit’s Returns is an expression, so the history alone does not show whether it returned nothing or a null that an older build did not record.

The native lifecycle called the actual built `apps/api/dist/main.js` in separate processes, PIDs 46248 then 41600. Process termination was owned by the disposable fixture; HTTP refusal was verified before amendment and a fresh PID/healthy listener after it. The commands from the recipe were executed literally with actual paths/ID substituted, using reviewed PowerShell text rather than unsigned `.ps1` execution. The terminal Ctrl+C keystroke was not retested; this is no graceful-signal claim. The checked-in `omit-null-result.mjs` was used unchanged; there was no replacement SQL implementation.

## Targeted regression results

Existing spec bodies ran unchanged against the built web and built API, with repository fake harness/classifier answers. The QA-only server adapter changes fixture ports, temporary prefixes and import locations. This is fake-only provider evidence.

Command from `apps/web`, with `GG_E2E_BROWSER_CHANNEL=msedge`:

```text
pnpm.cmd exec playwright test --config ../../docs/qa/2026-10-21-wp-g4-qa/r2-regression.config.cjs
```

| Existing check                       | Steps / expected                                                                                | Actual | Verdict / evidence                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| classifiers.spec.ts #129 Choice gate | List/field help, unique-label refusal, fake classifier run, label/criterion/pass/limit evidence | Passed | PASS; [r2-browser-regressions.txt](r2-browser-regressions.txt), test 1 |
| exit-primitives.spec.ts, repeat      | Author/run gate; force limit route and retain result/evidence                                   | Passed | PASS; same log, test 2                                                 |
| exit-primitives.spec.ts, done        | Final pass takes chosen done route rather than forced exhaustion                                | Passed | PASS; same log, test 3                                                 |
| exit-primitives.spec.ts, suppressed  | None plus caller/log stays understandable with no result/delivery                               | Passed | PASS; same log, test 4                                                 |
| exit-primitives.spec.ts, quiet       | No destinations remains valid and explained                                                     | Passed | PASS; same log, test 5                                                 |
| exit-primitives.spec.ts, long label  | 120-character unbroken label wraps at 768 px without page overflow or squeezing selected port   | Passed | PASS; same log, test 6                                                 |

**6/6 Edge tests passed; retries 0; runner exit 0.** [r2-browser-output/.last-run.json](r2-browser-output/.last-run.json).

The three requested inspector files were each run alone, in separate invocations:

```text
pnpm.cmd --filter @graphgoblin/web exec vitest run <one file> --maxWorkers=1
```

Default and JSON reporters were added for compact evidence capture; test selection and assertions were unchanged.

| File                                          | Expected       | Actual              | Verdict / evidence                                                                                               |
| --------------------------------------------- | -------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| src/runs/projections.test.ts                  | All tests pass | 19 passed, 0 failed | PASS; [r2-projections-summary.json](r2-projections-summary.json), [log](r2-projections.txt)                      |
| src/runs/RunInspectorPage.test.tsx            | All tests pass | 23 passed, 0 failed | PASS; [r2-run-inspector-summary.json](r2-run-inspector-summary.json), [log](r2-run-inspector.txt)                |
| src/runs/inspector/EvaluationDetails.test.tsx | All tests pass | 27 passed, 0 failed | PASS; [r2-evaluation-details-summary.json](r2-evaluation-details-summary.json), [log](r2-evaluation-details.txt) |

**69/69 tests passed across the three isolated files.**

## Full web coverage and isolated triage

One full run, after the browser and isolated inspector checks finished:

```text
pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1
```

PowerShell renders pnpm's normal stderr command echo as a NativeCommandError record in captured text; actual process exit codes and structured test results govern the verdict. Default and JSON reporters were added. One worker limits this QA session’s contention on the shared machine; no test timeout, coverage threshold, include list or exclusion changed. No second full run is authorized or used by this harness. A failed file, if any, is run alone without coverage and mapped back to every original failed assertion. The original full exit status remains in the evidence.

Full-run exit: **0**. Tests: **1490 passed, 0 failed, 0 pending**, 1490 total; 116 file results.

Coverage emitted by this run: **lines 98.95%; branches 94.9%**; statements 98.03%; functions 98.51%. The repository's existing thresholds were applied unchanged.

Evidence: [r2-full-coverage-summary.json](r2-full-coverage-summary.json), [compact original log](r2-full-coverage.txt), [r2-coverage-triage.json](r2-coverage-triage.json).

No failed files were reported, so **no isolated failure reruns were needed**. This was the only full coverage run.

## Defects, harness notes and scope limits

**D2 — Minor documentation inventory mismatch.** The owner recipe introduction still says “This folder holds three loops” and its introductory table lists only three, while §2 correctly imports four and §6 describes the fourth. Reproduction: read `docs/qa/2026-10-19-wp-g4-exit-evidence/README.md`, introduction/table and §§2/6. Expected: inventory says four and includes history-loop.json. Actual: stale count/table. The recipe’s executable import/amendment path passed. See [r2-doc-inventory.txt](r2-doc-inventory.txt). No product/docs fix was made by QA.

**D1 — Cleared on this head.** The unavailable-definition browser check passed the literal no-“Returns is None” condition. The successful history and None/quiet controls remain distinct.

Harness-only attempts are retained separately: [r2-native-first-harness.json](r2-native-first-harness.json) records this host refusing unsigned `.ps1` execution; no product check ran in that attempt. [r2-native-initial-served.json](r2-native-initial-served.json) and [r2-before-initial-served.json](r2-before-initial-served.json) retain a supplemental help assertion that expected a truncated ordinary destinations description. The assertion was corrected to include the existing final sentence. Neither is a product defect or a retry of a failed product assertion. The driver removed those disposable stores before recreating the final one.

The script generator’s initial `node -e` call also encountered Windows PowerShell quoting; it generated no browser artifacts. The reviewed generator was then executed from a CJS file. This does not affect the canonical recipe mjs command, which was tested directly in PS 5.1.

No independent broad type/lint/layer/license reruns or new CI/integration/merge sign-off are claimed by this bounded round-2 verification. No live-provider behavior is established by fake answers.

## Cleanup and files

The native API is stopped. Both initial harness stores and the successful native store were removed by the managed fixture. The seven regression API stores and regression runtime directory were removed by their normal teardown. Inspector and full-coverage temporary log/report directories were removed. Final `gg-qa-129-*` directory inventory: **empty**. See [r2-cleanup.json](r2-cleanup.json). No current cleanup rejection or leftover owned store remains.

No commits, staging, source fixes or GitHub posts. Final head/index/working-tree and evidence-sanitization checks are in [r2-workspace.txt](r2-workspace.txt). Evidence consists of small text files under this directory. Round-1 files remain historical evidence; the verdict above applies only to `5d2783359dbcb95aa719146416f02dc303cbd1ed`.
