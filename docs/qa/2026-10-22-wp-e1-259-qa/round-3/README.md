# 1. Verdict

**PASS** for QA round 3 at **011a01296a00bf1b5427bb9a397c3c5bc2fbdaf6**. **QA-259-R2-01 is fixed:** the formerly failing live large-to-small replacement retains the keyboard on the text at tabindex -1 at both requested widths. Large replacements focus Show all, removed controls hand focus over, surviving Download controls retain it, and outside focus stays put. QA-259-01 remains fixed; QA-259-02 remains disposed.

Worktree **codex-qa-wp-e1-259**, detached at the assigned HEAD; comparison base **c26d65d814613d9ea394f58af5a99810d2df7cd5**. Independent QA only: no production or maintained-test edits, index changes, commits, stashes, branch switches, sub-agents, GitHub writes or live provider turns. New evidence is uncommitted, ready for orchestrator commit. The [tracked change since round 2](round-three-change.diff.txt) contains only BoundedValue and its unit/Edge tests. [Final state](final-state.json) confirms the same HEAD and an empty tracked diff.

The product verdict is separate from the repository-wide formatting result: the inherited round-2 JSON artifacts produce formatting warnings; changed production/test files pass their formatting check. See the exact gate results below.

# 2. Defects and previous dispositions

**No new product defects found within this round's scope.**

## QA-259-R2-01 — closed by fresh Edge verification

Reproduced the original steps exactly: create a real mutate/wait run with a 20,000-character Variables marker, expand it, press Shift+Tab into its named region, and deliver the wait input through HTTP while focus remains there. The next mutate node writes the 19-character small object. Repeat with a scripted fake inference turn delayed 500 ms before that mutation. Expected: text holds focus at tabindex -1, then Tab reaches Full thread JSON and removes tabindex.

| Width   | Fake delay | Actual immediately after replacement | Actual after Tab                | Result   |
| ------- | ---------- | ------------------------------------ | ------------------------------- | -------- |
| 1440 px | 0 ms       | PRE, tabindex -1                     | Full thread JSON; tabindex null | **PASS** |
| 1440 px | 500 ms     | PRE, tabindex -1                     | Full thread JSON; tabindex null | **PASS** |
| 390 px  | 0 ms       | PRE, tabindex -1                     | Full thread JSON; tabindex null | **PASS** |
| 390 px  | 500 ms     | PRE, tabindex -1                     | Full thread JSON; tabindex null | **PASS** |

The [four exact reproductions](focus-small-repro.json) retain complete focus/DOM traces and run events; the [script](focus-small-repro.mjs.txt) and [log](focus-small.log.txt) are kept. The direct small replacement preserves focus on the same pre element without a focus-in transition. The delayed case first focuses Show all for an intermediate large reconstruction, then correctly hands focus to the small text when that control disappears.

“Never BODY” here means the settled focus after a replacement or commit. During an ordinary blur/focus transfer, focusout listeners can synchronously observe BODY between the old and new focus targets, including while pressing Tab. Those intermediate focusout samples are retained, not treated as a persistent focus loss. Mutation-observer samples and after-replacement assertions show the intended target. The four screenshots show **the following Tab's Full thread JSON focus**, not the held-text stage.

## QA-259-01 — remains fixed

At both widths the original 2,322,721-character Variables fixture passes A -> B -> A and B -> A -> B. A is replace node.finished; B is seed node.finished. Every newly selected value has 4,096 characters plus an ellipsis and offers Show all. Maximum pre length is 4,097 characters; no full value remains laid out. Across eight CDP-dispatched selections, observed input-to-two-animation-frame wall time is **28.4–118.4 ms**, with **zero browser long tasks** (50 ms threshold). Wall time includes automation scheduling and is not an owner-approved SLA. See [measurements](followup-results.json).

## QA-259-02 — disposition retained

No new value-difference claim was found or reopened. Full thread JSON remains a client reconstruction whose property order can differ from live API serialization. The broader semantic comparison remains [round-2 evidence](../round-2/README.md); this round's fresh strict-byte spot-check is Variables, as requested.

# 3. Coverage of criteria

## Environment, touched systems and isolation

- Windows, Node **v22.14.0** selected first on PATH; dependencies already installed; pnpm build completed before serving built API/web files.
- Microsoft Edge **155.0.4283.62**, headless through Playwright, **1440 x 900** and **390 x 844**.
- Disposable API **127.0.0.1:5720**, fake control server **127.0.0.1:5721**, system-temp data directory **gg-qa-e1-Gyo7PW**. API-created QA keys were used only as setup metadata; tokens are not retained. [Environment](browser-environment.json), [key metadata](api-key-metadata.json), [server source](server.mjs.txt), [server log](server.log.txt).
- **Fake-only provider evidence:** the real HTTP/SQLite/engine/mutate/wait paths run with FakeHarness and FakeStructured. No real provider or CLI adapter was called. The 80 ms and 500 ms fake delays create controlled update schedules, not performance thresholds.
- Touched systems tested: BoundedValue expansion and focus ownership; control removal/survival; held-text Tab cleanup; live event reconstruction and historic selection; Full thread JSON on completion; strict JSON download and stored thread/events/run preservation; narrow layout and browser errors. Adjacent result, progress and wait surfaces are also covered by the maintained Edge spec and affected unit files.
- Both disposable ports were unreachable after stopping this round's native process, which exited with code 0. [Shutdown](shutdown.json), [shutdown log](shutdown.log.txt). The temp store and test-output directories are left for the orchestrator; no directories were deleted. Owner ports/store were not accessed.

## Round-2 retention audit

**Nothing cited is missing:** all **141** unique linked/backtick file references in the round-2 README exist. However, **140 are untracked** on the assigned HEAD; only the referenced round-1 README is tracked. The initial status already listed the round-2 directory as untracked, contrary to the handoff's “committed” description. [Per-file existence, tracked state, sizes and SHA-256](round-two-audit.json). All 141 referenced files stayed byte-for-byte unchanged throughout this run, confirmed by [final hashes](final-state.json). They need the orchestrator's retention/commit handling, not a product fix.

## Requested checks

There are **30 final independent matrix cases**, plus the **four exact prior-failure reproductions**, all passing. Each matrix record includes the case, expected behavior, actual focus/attributes, run ID and any timing/trace evidence. Common live steps are: create a public-API mutate/wait run, load and synchronize its timeline, expand Variables, position focus on the stated region/control, submit the observed wait ID externally, then inspect focus after the new events paint. Steps are implemented in the linked [initial script](browser-matrix.mjs.txt) and [corrected targeted follow-up](targeted-followup.mjs.txt).

| System                   | Case / steps                                                    | Expected                                                                                          | Actual                                                                                                                                   | Result   | Evidence                             |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------ |
| BoundedValue / inspector | 1440: live large-to-large region hand-off                       | New bounded value; Show all focused; no BODY; Tab leaves no tabindex                              | BUTTON Show all of Variables; 4097 characters; Tab -> BUTTON Download Variables as JSON                                                  | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 1440: live small replacement with keyboard on Show less         | Removed control hands focus to small pre at -1; Tab reaches Full thread JSON and removes tabindex | From BUTTON Show less of Variables; PRE Variables, tabindex -1; Tab -> BUTTON Full thread JSON; pre tabindex null                        | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 1440: live small replacement with keyboard on Download          | Removed control hands focus to small pre at -1; Tab reaches Full thread JSON and removes tabindex | From BUTTON Download Variables as JSON; PRE Variables, tabindex -1; Tab -> BUTTON Full thread JSON; pre tabindex null                    | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 1440: live small replacement with keyboard on Show all          | Removed control hands focus to small pre at -1; Tab reaches Full thread JSON and removes tabindex | From BUTTON Show all of Variables; PRE Variables, tabindex -1; Tab -> BUTTON Full thread JSON; pre tabindex null                         | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 1440: surviving Download keeps keyboard on large replacement    | Expanded value collapses; surviving Download stays focused                                        | BUTTON Download Variables as JSON -> BUTTON Download Variables as JSON; pre 4097 characters, tabindex null                               | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 1440: outside timeline focus during large replacement           | Outside target retains focus; no focusable collapsed text                                         | BUTTON #6node.finishedseed → out, 1 change, 0 ms -> BUTTON #6node.finishedseed → out, 1 change, 0 ms; pre 4097 characters, tabindex null | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 1440: outside timeline focus during small replacement           | Outside target retains focus; no focusable collapsed text                                         | BUTTON #6node.finishedseed → out, 1 change, 0 ms -> BUTTON #6node.finishedseed → out, 1 change, 0 ms; pre 19 characters, tabindex null   | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 1440: outside heading focus during large replacement            | Outside target retains focus; no focusable collapsed text                                         | H1 -> H1; pre 4097 characters, tabindex null                                                                                             | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 1440: outside heading focus during small replacement            | Outside target retains focus; no focusable collapsed text                                         | H1 -> H1; pre 19 characters, tabindex null                                                                                               | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 1440: rapid appends finish on large value                       | No errors or focus loop; final large Show all or small held text; stable after 250ms              | 25 events appended; 1 focus-in events; final BUTTON Show all of Variables; stable 250 ms; 4097 characters                                | **PASS** | [Case record](followup-results.json) |
| BoundedValue / inspector | 1440: rapid appends finish on small value                       | No errors or focus loop; final large Show all or small held text; stable after 250ms              | 25 events appended; 2 focus-in events; final PRE Variables, tabindex -1; stable 250 ms; 19 characters                                    | **PASS** | [Case record](followup-results.json) |
| BoundedValue / inspector | 1440: run finishes while Full thread JSON expanded and focused  | New thread starts bounded with focus on Show all; no BODY                                         | Show all of Full thread JSON; 4097 characters; Tab leaves pre without tabindex                                                           | **PASS** | [Case record](followup-results.json) |
| BoundedValue / inspector | 1440: unchanged historical value stays expanded while appending | Selected seed and full Variables region keep expansion and focus                                  | 20018 characters; PRE Variables, tabindex 0; selected seed unchanged                                                                     | **PASS** | [Case record](followup-results.json) |
| BoundedValue / inspector | 1440: original 2322721-character A/B/A and B/A/B regression     | Return to any previous value starts bounded without a whole-value long task                       | 2,322,721 full characters; 29.2, 28.4, 45.7, 118.4 ms; 0 long tasks; max pre 4097                                                        | **PASS** | [Case record](followup-results.json) |
| BoundedValue / inspector | 1440: exact Variables download and stored value preservation    | Download bytes equal API pretty JSON; opening/collapsing does not alter thread, events or result  | 20018 bytes; identical SHA-256; thread, events and run result unchanged                                                                  | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: live large-to-large region hand-off                        | New bounded value; Show all focused; no BODY; Tab leaves no tabindex                              | BUTTON Show all of Variables; 4097 characters; Tab -> BUTTON Download Variables as JSON                                                  | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: live small replacement with keyboard on Show less          | Removed control hands focus to small pre at -1; Tab reaches Full thread JSON and removes tabindex | From BUTTON Show less of Variables; PRE Variables, tabindex -1; Tab -> BUTTON Full thread JSON; pre tabindex null                        | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: live small replacement with keyboard on Download           | Removed control hands focus to small pre at -1; Tab reaches Full thread JSON and removes tabindex | From BUTTON Download Variables as JSON; PRE Variables, tabindex -1; Tab -> BUTTON Full thread JSON; pre tabindex null                    | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: live small replacement with keyboard on Show all           | Removed control hands focus to small pre at -1; Tab reaches Full thread JSON and removes tabindex | From BUTTON Show all of Variables; PRE Variables, tabindex -1; Tab -> BUTTON Full thread JSON; pre tabindex null                         | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: surviving Download keeps keyboard on large replacement     | Expanded value collapses; surviving Download stays focused                                        | BUTTON Download Variables as JSON -> BUTTON Download Variables as JSON; pre 4097 characters, tabindex null                               | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: outside timeline focus during large replacement            | Outside target retains focus; no focusable collapsed text                                         | BUTTON #6node.finishedseed → out, 1 change, 0 ms -> BUTTON #6node.finishedseed → out, 1 change, 0 ms; pre 4097 characters, tabindex null | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: outside timeline focus during small replacement            | Outside target retains focus; no focusable collapsed text                                         | BUTTON #6node.finishedseed → out, 1 change, 0 ms -> BUTTON #6node.finishedseed → out, 1 change, 0 ms; pre 19 characters, tabindex null   | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: outside heading focus during large replacement             | Outside target retains focus; no focusable collapsed text                                         | H1 -> H1; pre 4097 characters, tabindex null                                                                                             | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: outside heading focus during small replacement             | Outside target retains focus; no focusable collapsed text                                         | H1 -> H1; pre 19 characters, tabindex null                                                                                               | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: rapid appends finish on large value                        | No errors or focus loop; final large Show all or small held text; stable after 250ms              | 25 events appended; 1 focus-in events; final BUTTON Show all of Variables; stable 250 ms; 4097 characters                                | **PASS** | [Case record](followup-results.json) |
| BoundedValue / inspector | 390: rapid appends finish on small value                        | No errors or focus loop; final large Show all or small held text; stable after 250ms              | 25 events appended; 2 focus-in events; final PRE Variables, tabindex -1; stable 250 ms; 19 characters                                    | **PASS** | [Case record](followup-results.json) |
| BoundedValue / inspector | 390: run finishes while Full thread JSON expanded and focused   | New thread starts bounded with focus on Show all; no BODY                                         | Show all of Full thread JSON; 4097 characters; Tab leaves pre without tabindex                                                           | **PASS** | [Case record](followup-results.json) |
| BoundedValue / inspector | 390: unchanged historical value stays expanded while appending  | Selected seed and full Variables region keep expansion and focus                                  | 20018 characters; PRE Variables, tabindex 0; selected seed unchanged                                                                     | **PASS** | [Case record](browser-results.json)  |
| BoundedValue / inspector | 390: original 2322721-character A/B/A and B/A/B regression      | Return to any previous value starts bounded without a whole-value long task                       | 2,322,721 full characters; 29.0, 28.8, 32.7, 58.3 ms; 0 long tasks; max pre 4097                                                         | **PASS** | [Case record](followup-results.json) |
| BoundedValue / inspector | 390: exact Variables download and stored value preservation     | Download bytes equal API pretty JSON; opening/collapsing does not alter thread, events or result  | 20018 bytes; identical SHA-256; thread, events and run result unchanged                                                                  | **PASS** | [Case record](browser-results.json)  |

All four rapid-update runs append **25 events** after the starting wait, including two controlled fake turns and several mutations before finishing. Large-final cases produce one focus-in hand-off; small-final cases produce two. Focus stays stable for the following 250 ms, without a loop or browser error. [Initial error capture](browser-errors.json) and [follow-up error capture](followup-errors.json) are empty. Captured document scroll widths equal the viewport widths.

The page heading is normally non-focusable. The outside-heading probe adds tabindex -1 **only to that H1 in the disposable browser DOM**, then focuses it; its original attribute state and text are recorded. The component under test is unchanged. The timeline target is focused without activating it, so the inspector continues to follow the latest event and the replacement really occurs.

The fresh Variables downloads at both widths are **20,018 UTF-8 bytes**, byte-identical to JSON.stringify of the API value with two-space indentation. Both SHA-256 values are **2367eae086c4b8471dee0cc3e07f5db4a4ed707f9abfe4b719453976232d9648**. Raw downloads and API bytes are kept with .json.txt extensions. Thread, event log and complete run record compare unchanged before/after expansion, download and collapse.

## Probe corrections and limits

The complete first-run record is preserved, including **nine blocked/invalid checks**. Six completion waits incorrectly expected the last REST event after the terminal event; the [diagnostic](timeline-diagnosis.json) shows return.delivered at seq 25/33 after run.finished at seq 24/32, while SSE closes at the terminal event. Two A/B/A checks initially replaced the original 20,000-character change field with one character and correctly failed the fixture-size guard. One desktop historical-expansion mouse click did not reach Playwright's stable-element condition within 15 seconds; that first result remains, and the targeted historical probe uses keyboard focus plus Enter.

Only those blocked checks were run again after explicit probe changes; passed cases were not repeated. [Corrections and rationale](probe-corrections.json), [correction generator](prepare-followup.mjs.txt), [initial log](browser.log.txt), [targeted log](followup.log.txt). No retry option or force-click was used. The initial unit command also had five incorrect file filters and therefore exercised only two files; its [log](initial-unit-filter.log.txt) remains. The corrected command ran all seven intended files once. The first artifact-validation pass preceded its own output files; its [initial result](validation-initial.json.txt) and [log](validation-initial.log.txt) are retained. Final validation runs after those files exist.

This round does not repeat the entire round-1/round-2 adversarial matrix, native restart/session/storage-reset campaign, live provider behavior, unrelated editor flows, or full-package coverage. The user explicitly narrowed this round and waived full coverage. The current independent download/storage spot-check and the historic-value append checks are fresh; prior broader acceptance remains historical. Actual screen-reader software was not run; this focus round inspects DOM roles, names and keyboard behavior in Edge.

## Tests, regression provenance and gates

The seven affected unit files pass **68/68 tests**. BoundedValue covers value-change rebounding, retained expansion for an unchanged value, large/large region hand-off, large/small held text, Tab cleanup, outside focus, removed Show all/Download controls and surviving Download. The maintained Edge file passes **5/5** with retries disabled, covering large Result/progress and long wait prompts at both widths plus live Full thread JSON replacement. The critical small-value path is additionally verified through the four independent browser reproductions above.

The prior implementation was **not checked out or executed** this round. Its failure is established by the retained round-2 real-Edge reproduction; [the current diff](round-three-change.diff.txt) shows why the regression assertions distinguish it: it detected ownership after the DOM collapse and did not initiate hand-off for an already collapsed control. Current tests pass on the assigned HEAD. This is source reasoning plus historical before-evidence, not a fresh scratch-base test run.

| Command                                                                                                                                                                                                                                                                                                        | Result                                      | Evidence                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| pnpm.cmd build                                                                                                                                                                                                                                                                                                 | PASS                                        | [Log](build.log.txt)                        |
| pnpm.cmd --filter @graphgoblin/web exec vitest run src/components/ui/bounded-value.test.tsx src/lib/pretty-json-prefix.test.ts src/runs/RunInspectorPage.test.tsx src/runs/inspector/ProgressDrawer.test.tsx src/runs/inspector/WaitPanel.test.tsx src/runs/projections.test.ts src/events/EventsPage.test.tsx | PASS                                        | [Log](focused-tests.log.txt)                |
| pnpm.cmd lint                                                                                                                                                                                                                                                                                                  | PASS                                        | [Log](lint.log.txt)                         |
| pnpm.cmd typecheck                                                                                                                                                                                                                                                                                             | PASS                                        | [Log](typecheck.log.txt)                    |
| pnpm.cmd --filter @graphgoblin/web exec playwright test --config %TEMP%\gg-qa-e1-r3-playwright.config.mjs                                                                                                                                                                                                      | PASS                                        | [Log](playwright.log.txt)                   |
| pnpm.cmd exec prettier --check apps/web/src/components/ui/bounded-value.tsx apps/web/src/components/ui/bounded-value.test.tsx apps/web/e2e/inspector-large-values.spec.ts                                                                                                                                      | PASS                                        | [Log](source-format.log.txt)                |
| pnpm.cmd check:layers                                                                                                                                                                                                                                                                                          | PASS                                        | [Log](layers.log.txt)                       |
| pnpm.cmd check:deps                                                                                                                                                                                                                                                                                            | PASS                                        | [Log](deps.log.txt)                         |
| pnpm.cmd check:tokens                                                                                                                                                                                                                                                                                          | PASS                                        | [Log](tokens.log.txt)                       |
| pnpm.cmd format:check                                                                                                                                                                                                                                                                                          | FAIL — retained QA JSON formatting warnings | [Log](format.log.txt)                       |
| pnpm --filter @graphgoblin/web test:coverage                                                                                                                                                                                                                                                                   | NOT RUN — explicitly waived for this round  | User's round-3 scope                        |
| pnpm check:docs                                                                                                                                                                                                                                                                                                | NOT RUN — no node schema or route changed   | [Tracked diff](round-three-change.diff.txt) |
| pnpm check:licenses                                                                                                                                                                                                                                                                                            | NOT RUN — no dependencies changed           | [Tracked diff](round-three-change.diff.txt) |

Build/typecheck logs include nonfatal Turbo cache-write Access denied warnings; their tasks completed successfully. Full root formatting is read-only and does not alter inherited evidence. The focused source-format command passes for all three changed maintained files. No numbered docs, ADR, CHANGELOG or generated references were changed by QA. No thresholds, dependencies or production parameters were changed.

# 4. Report path and evidence folder

Report: **docs/qa/2026-10-22-wp-e1-259-qa/round-3/README.md**. Evidence folder: **docs/qa/2026-10-22-wp-e1-259-qa/round-3/**. Only this directory was added by this round. All kept artifacts are linked below; raw downloads remain untouched by JSON formatters. [Artifact/link/path/download validation](validation.json), [validation log](validation.log.txt).

- [api-key-metadata.json](api-key-metadata.json)
- [browser-environment.json](browser-environment.json)
- [browser-errors.json](browser-errors.json)
- [browser-matrix.mjs.txt](browser-matrix.mjs.txt)
- [browser-results.json](browser-results.json)
- [browser-runs.json](browser-runs.json)
- [browser.log.txt](browser.log.txt)
- [build.log.txt](build.log.txt)
- [deps.log.txt](deps.log.txt)
- [diagnose-timeline.mjs.txt](diagnose-timeline.mjs.txt)
- [environment.json](environment.json)
- [final-state.json](final-state.json)
- [finish.mjs.txt](finish.mjs.txt)
- [focus-small-1440-0.png](focus-small-1440-0.png)
- [focus-small-1440-500.png](focus-small-1440-500.png)
- [focus-small-390-0.png](focus-small-390-0.png)
- [focus-small-390-500.png](focus-small-390-500.png)
- [focus-small-repro.json](focus-small-repro.json)
- [focus-small-repro.mjs.txt](focus-small-repro.mjs.txt)
- [focus-small.log.txt](focus-small.log.txt)
- [focused-tests.log.txt](focused-tests.log.txt)
- [followup-environment.json](followup-environment.json)
- [followup-errors.json](followup-errors.json)
- [followup-key-metadata.json](followup-key-metadata.json)
- [followup-results.json](followup-results.json)
- [followup-runs.json](followup-runs.json)
- [followup.log.txt](followup.log.txt)
- [format-qa.log.txt](format-qa.log.txt)
- [format.log.txt](format.log.txt)
- [initial-unit-filter.log.txt](initial-unit-filter.log.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [make-report.mjs.txt](make-report.mjs.txt)
- [playwright.config.mjs.txt](playwright.config.mjs.txt)
- [playwright.log.txt](playwright.log.txt)
- [prepare-followup.mjs.txt](prepare-followup.mjs.txt)
- [probe-corrections.json](probe-corrections.json)
- [round-three-change.diff.txt](round-three-change.diff.txt)
- [round-two-audit.json](round-two-audit.json)
- [run-command.mjs.txt](run-command.mjs.txt)
- [server.log.txt](server.log.txt)
- [server.mjs.txt](server.mjs.txt)
- [setup.mjs.txt](setup.mjs.txt)
- [shutdown.json](shutdown.json)
- [shutdown.log.txt](shutdown.log.txt)
- [source-format.log.txt](source-format.log.txt)
- [targeted-followup.mjs.txt](targeted-followup.mjs.txt)
- [timeline-diagnosis.json](timeline-diagnosis.json)
- [timeline-diagnosis.log.txt](timeline-diagnosis.log.txt)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [validate.mjs.txt](validate.mjs.txt)
- [validation-initial.json.txt](validation-initial.json.txt)
- [validation-initial.log.txt](validation-initial.log.txt)
- [validation.json](validation.json)
- [validation.log.txt](validation.log.txt)
- [variables-api-1440.json.txt](variables-api-1440.json.txt)
- [variables-api-390.json.txt](variables-api-390.json.txt)
- [variables-download-1440.json.txt](variables-download-1440.json.txt)
- [variables-download-390.json.txt](variables-download-390.json.txt)

# 5. Observations outside scope

- The round-2 evidence is present but untracked, as described in the retention audit. It was left unchanged for the orchestrator.
- The REST event tail can extend beyond the SSE terminal event (the return delivery observation above). SSE's terminal set is defined at apps/api/src/sse.ts:5; this was treated as a synchronization boundary, not reopened as a #259 focus defect.
- One initial desktop Playwright mouse-click stabilization timeout is retained without attributing a product root cause. The historical keyboard interaction and selection/expansion assertions pass in the corrected targeted check.
- Root formatting warnings on inherited round-2 JSON remain outside the production fix. No unrelated fixes or owner-environment changes were attempted.
