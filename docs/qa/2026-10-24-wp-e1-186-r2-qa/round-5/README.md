# Independent QA round 5 — WP-E1 #186 round 2

## 1. Verdict

**FAIL (required infrastructure gate); targeted round-5 browser fixes pass.** Revision `d6760dcdcb719a3d98c0b3e06a0a6d15d80cbdc9`, PR #405 / implementation branch `codex-wp-e1-186-r2`. Comparison base: `9a3eded1`. HEAD matched before testing. The worktree initially had a populated `node_modules` and a clean index/worktree. Round 4 was absent, so API, API-client and infrastructure coverage are included alongside web; domain and tooling are also included because the comparison touches them.

Local QA branch: `codex-qa-wp-e1-186-r2-5`.

Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-e1-186-r2-5`. Node **v22.14.0** was first on PATH for every command; Microsoft Edge **156.0.4314.42**, headless. `LIVE=0`, retries **0**, workers **1**. No provider turn, sub-agent, production edit, index action, commit, branch operation, GitHub write, owner-store access or owner-listener operation occurred. Only this round's evidence is a deliverable. Build/coverage/scratch directories remain for the orchestrator.

Disposable manual/browser app listeners use **6150–6159**. Long-lived auxiliary E2E apps use unique loopback addresses `127.0.1.n:6152`, and classifier fakes use `127.0.2.n:6153`, keeping the original suite's instance lifetime without exhausting ten ports. Main/control are `127.0.0.1:6150/6151`; native shutdown fixtures scan 6154–6158; the webhook receiver uses 6159. Browser temporary directory prefixes start `gg-qa-e1-186r2-5-`. Required API subprocess gates receive `GG_TEST_PORT_START=6152`, `GG_TEST_PORT_COUNT=8`, `GG_TEST_STORE_PREFIX=gg-qa-e1-186r2-5-gate-`; original unit fixtures retain their internal disposable subdirectory names beneath the assigned temporary root and their ordinary OS-assigned ephemeral HTTP transport listeners. The manual/browser instances and API subprocess helper use the assigned range.

The standard browser API uses in-memory SQLite and fake harness/classifier boundaries. The delayed-thread fixture uses physical disposable SQLite, and shutdown cases launch the built API with controlled native executables. These are **fake-provider-only** results. The full suite retains the original service-worker policy, timeouts, assertions and performance bounds. Direct layout probes block service workers to identify the built revision. Coverage jobs run after the browser checks, without concurrent browser load from this QA thread.

The QA-only copies relocate imports, disposable paths and listener addresses/ports, and retain fixture directories. [The assertion audit](harness-assertion-audit.json) compares all **5,718** checked call expressions (every `expect` call and `to*` call, including nested matcher chains) across all **52** specs and finds them unchanged. The [preparation script](prepare-edge.mjs.txt), [harness diff](harness-adaptations.diff.txt), [environment](environment.json), [comparison diff](source.diff.txt) and [command ledger](commands.jsonl) make these adaptations reviewable.

## 2. Defects

No new #186 production defect was established. All targeted fixes pass. The infrastructure gate is red and is not waived; the complete Edge command also retains its original QA fixture failure alongside the corrected diagnostic.

### QA-R5-VERIFY-001 ??? major verification blocker ??? D-015 native termination and cleanup

Reproduction: with Node 22 on this Windows sandbox, run `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2`. Expected: native cancellation stops the owned child/descendant work and permits cleanup, and the configured package gate passes. Actual: **6 failed / 801 passed tests**, **4 failed / 52 passed files**, with seven error entries because one case also fails cleanup. No fresh coverage summary was emitted. [Complete log](infrastructure-coverage.log.txt).

| Case                                                     | Steps / expected                                                              | Actual                                                          | Result / cause                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| adversarial 6/QA-LIMIT-001                               | Abort a real child/grandchild; both stop and directory cleanup succeeds       | EBUSY removing the disposable process-tree directory            | FAIL; native stop/cleanup boundary, D-015-limited                 |
| Claude process: deadline and output overflow             | Exercise both stopping triggers; owned work stops and resources close         | EBUSY removing the disposable directory                         | FAIL; native stop/cleanup boundary, D-015-limited                 |
| Claude process: already aborted and running cancellation | No spawn for an aborted signal; cancel a running fake executable and clean it | EBUSY during cleanup of the running-process case                | FAIL; native stop/cleanup boundary, D-015-limited                 |
| Claude process: descendant                               | Cancel the parent and require the descendant marker to stop changing          | Marker grows from `xxx` to `xxxxxx`; cleanup also reports EBUSY | FAIL; descendant continued after cancellation, D-015-limited      |
| Claude readiness: hang                                   | Deadline yields the expected did-not-answer message                           | Returns check process did not confirm that it stopped           | FAIL; stop confirmation unavailable, not an ordinary timing retry |
| ProcessScripts: incomplete UTF-8 cancellation            | Cancel a real process with partial output; PID must no longer exist           | `process.kill(pid, 0)` still succeeds                           | FAIL; child remains detectable, D-015-limited                     |

These four failing test files are unchanged by the comparison against `9a3eded1`. The observations are consistent with the brief's D-015 process-tree-control limit; they do not establish a new #186 regression. The controlled native shutdown/force/restart Edge cases passed for their tested executables. Arbitrary descendant termination remains unestablished. No native gate was retried to green or repaired by a production change.

### QA-R5-HARNESS-001 ??? minor, resolved diagnostic ??? golden fixture relocation

Steps: run the full Edge command. Expected: #170 I1 reads the tracked current golden JSON and exercises placement/save/reload. Actual: the QA copy's relative URL resolves under `apps/web/packages`, producing ENOENT before the product check. The original full result is **420 passed / 1 failed / 1 LIVE skip**, zero retries. Correcting only that QA fixture URL and running I1 exactly once alone gives **1 passed**. [Failure context](edge-full-golden-path-error-context.md.txt), [full log](edge-full.log.txt), [correction](golden-path-correction.json), [isolated log](isolated-golden.log.txt). The full command remains recorded as failed.

### QA-R5-HARNESS-002 ??? minor, resolved ??? completed scratch copies entered lint

Steps: run `pnpm.cmd lint` while the QA-only runtime copies still have TypeScript extensions under `apps/web/.tmp/qa5`. Expected: repository source lint passes. Actual: 66 project-service parsing errors, all pointing at those extra copies outside the web tsconfig. Retiring only those completed copies to text preserves every byte and leaves production/tests/configuration untouched; a second exact `pnpm.cmd lint` passes all 11 tasks. [Initial result](lint.log.txt), [byte-preserving retirement](retired-harness.json), [passing result](lint-after-retirement.log.txt). No lint or coverage rule was relaxed.

### QA-R5-OBS-001 ??? minor intermittent wait failure ??? untouched responsive case

The interrupted exploratory attempt's unchanged `responsive dark > screens and transient states fit at 360, 768, 1024, and 1440 px` times out after 10 seconds waiting for `responsive sweep` following the scripted API outage. Read-only extraction shows successful `/loops` responses initially contain 171 records including that seed; after the second outage they contain 10 records without it. This explains the immediate missing-label assertion; the underlying state change is unresolved. All captured URLs in these excerpts use the disposable browser listeners. The later complete run passes this case, and the required **exactly one once-alone diagnostic passes** (32.6 s test / 42.2 s suite). Neither pass erases the earlier failure, and the observation is not called disproven. [Original context](exploratory-responsive-error-context.md.txt), [response excerpts](exploratory-responsive-network.json), [extraction script](inspect-responsive-trace.mjs.txt), [once-alone result](isolated-responsive.log.txt), [all browser cases](browser-cases.md). No out-of-scope fix was made.

### Other minor QA setup failures

[The setup ledger](qa-setup-attempts.json) retains the native argument quoting, relocated dependency resolution, file-URL extension, overbroad temp-prefix replacement, Fetch response-method, and snapshot-selector failures. They are separate from product results. The invalid pulse expectation is preserved in [its audit](invalid-harness-assertion-audit.json) and [diff](invalid-harness-adaptations.diff.txt); the corrected assertion audit passes for all 52 specs. The exploratory attempt has no final full-suite result because it was interrupted; the two available failure contexts are explicitly retained rather than invented into a complete result.

## 3. Coverage of criteria

Touched systems: SQLite history windows and indexed observations; API events/thread/observation reads and authorization; API-client resources; paged domain replay; browser event retention, cache, SSE acknowledgement, history browsing and exact selection; whole-history projections and cancellation evidence; Timeline windowing, keyboard navigation, pulse and shared Input; performance observers; adjacent inspector, PWA, Events, shutdown and delivery flows exercised by the complete Edge suite.

### Direct browser checks

Steps for each matrix row: start a held scripted inference run; open its inspector with the stated viewport/theme/pointer; inspect the Timeline dot and Edge accessibility tree; measure the Event sequence field; submit 0 and then 1 using the keyboard; check focus; enable reduced motion and reload; cancel the run and reopen its completed stream. Expected: one running pulse excluded from accessibility, no pulse animation under reduced motion, no live dot after stream completion, an accessible field within the viewport, at least 44 px touch height, rejection of 0, exact selection of event 1, and Tab reaching Go to event. Actual: every row passed, no page error. Complete values, animation keyframes, accessibility ignored reasons, invalid-input state and process exit are in [manual-ui-results.json](manual-ui-results.json); steps are in [inspect-ui.mjs.txt](inspect-ui.mjs.txt).

| Viewport | Theme | Pointer | Input width × height (px) | Live/AX/reduced/reload | Complete: dot absent | Result |
| -------- | ----- | ------- | ------------------------- | ---------------------- | -------------------- | ------ |
| 1440     | dark  | fine    | 315.703125 × 36           | PASS                   | PASS                 | PASS   |
| 1440     | dark  | coarse  | 315.703125 × 44           | PASS                   | PASS                 | PASS   |
| 1440     | light | fine    | 315.703125 × 36           | PASS                   | PASS                 | PASS   |
| 1440     | light | coarse  | 315.703125 × 44           | PASS                   | PASS                 | PASS   |
| 390      | dark  | fine    | 220.25 × 36               | PASS                   | PASS                 | PASS   |
| 390      | dark  | coarse  | 220.25 × 44               | PASS                   | PASS                 | PASS   |
| 390      | light | fine    | 220.25 × 36               | PASS                   | PASS                 | PASS   |
| 390      | light | coarse  | 220.25 × 44               | PASS                   | PASS                 | PASS   |

The dot has `aria-hidden=true`; Edge's accessibility tree independently reports it ignored. With normal motion its CSS animation is `gg-pulse` and running; reduced motion yields `animation-name: none`, opacity 1, and zero animations, including after reload. The completed-stream cases use real cancellation through REST, not an edited DOM. Screenshots at both widths in both themes were visually inspected; fields, labels and Go to event remain visible without horizontal overflow.

### Required focused Edge cases

Command from `apps/web`: `pnpm.cmd exec playwright test -c .tmp/qa5/playwright.config.ts e2e/issue-7-qa.spec.ts e2e/responsive.spec.ts e2e/thread-history.spec.ts --grep "I7-QA-03|on a coarse pointer|persisted failure" --retries=0 --workers=1 --reporter=list,json --output=.tmp/qa5/edge-focused-results`.

| Check                 | Expected                                                                                                                                                 | Actual | Evidence                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| I7-QA-03              | Running and live pulses stop at full opacity under reduced motion, including reload                                                                      | PASS   | [Focused log](edge-focused.log.txt)             |
| Coarse pointer, dark  | Controls on all traversed screens/dialogs reach 44 px; includes Event sequence                                                                           | PASS   | [Focused log](edge-focused.log.txt)             |
| Coarse pointer, light | Same bounds in light theme                                                                                                                               | PASS   | [Focused log](edge-focused.log.txt)             |
| Thread history        | Existing/reloaded inspectors exactly equal API thread across failure, disconnected resume, unfinished work and success; reads do not mutate stored bytes | PASS   | [Thread observations](edge-focused-thread.json) |

### Assertions changed since round 3

[The exact three-file diff](spec-changes-since-round3.diff.txt) contains no assertion loosening without a product reason.

- `qa.spec.ts`: replaces an impossible requirement to mount all 1,200 progress rows with a nonempty, contiguous, bounded live suffix and paged checks of every durable sequence. It still requires exactly 1,200 progress events, one session/usage event, and now one turn/submission event; exit evidence remains visible. It derives lifecycle overhead from the completed run record and still checks the exact heading. The separate bounded-history spec requires exactly 80 mounted rows. Selecting event 601 uses the product's sequence control, and both performance bounds remain unchanged. The failure reason remains an exact typed-code assertion, corrected to the engine's uncertain-delivery classification.
- `inspector-large-values.spec.ts`: fixes an obsolete ordinary-row selector to the pinned `Work (work)` label; exact large-value, preview, width, focus and cache checks remain.
- `thread-history.spec.ts`: only the known transient Preparing the preview note becomes an unmatched poll value. Other malformed JSON/schema errors still fail. Deep equality with the API remains required, and the helper returns the exact value that matched, removing a second-read race. Failure/resume/success, reload, expected vars and unchanged stored bytes remain asserted.

### Required gates and complete suite

Every command used Node v22.14.0. Coverage ran directly per package with two workers, without Turbo coverage cache hits; no threshold, exclusion or denominator changed. No pnpm store-lock fallback was needed.

| Exact command                                                                | Expected               | Actual                                                                                                 | Evidence                                                   |
| ---------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `pnpm.cmd build`                                                             | Pass configured checks | PASS; exit 0; 3.744s. Tasks: 11 successful, 11 total                                                   | [build](build.log.txt)                                     |
| `pnpm.cmd typecheck`                                                         | Pass configured checks | PASS; exit 0; 52.502s. Tasks: 20 successful, 20 total                                                  | [typecheck](typecheck.log.txt)                             |
| `pnpm.cmd lint`                                                              | Pass configured checks | FAIL; exit 1; 106.851s. Tasks: 10 successful, 11 total                                                 | [lint](lint.log.txt)                                       |
| `pnpm.cmd lint`                                                              | Pass configured checks | PASS; exit 0; 105.087s. Tasks: 11 successful, 11 total                                                 | [lint-after-retirement](lint-after-retirement.log.txt)     |
| `pnpm.cmd format:check`                                                      | Pass configured checks | PASS; exit 0; 125.685s.                                                                                | [format-check](format-check.log.txt)                       |
| `pnpm.cmd check:layers`                                                      | Pass configured checks | PASS; exit 0; 0.241s.                                                                                  | [check-layers](check-layers.log.txt)                       |
| `pnpm.cmd check:deps`                                                        | Pass configured checks | PASS; exit 0; 6.907s.                                                                                  | [check-deps](check-deps.log.txt)                           |
| `pnpm.cmd check:docs`                                                        | Pass configured checks | PASS; exit 0; 1.165s.                                                                                  | [check-docs](check-docs.log.txt)                           |
| `pnpm.cmd check:tokens`                                                      | Pass configured checks | PASS; exit 0; 1.063s.                                                                                  | [check-tokens](check-tokens.log.txt)                       |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2`            | Pass configured checks | PASS; exit 0; 639.211s. Test Files 145 passed (145); Tests 1770 passed (1770)                          | [web-coverage](web-coverage.log.txt)                       |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2`            | Pass configured checks | PASS; exit 0; 408.612s. Test Files 84 passed \| 2 skipped (86); Tests 1456 passed \| 11 skipped (1467) | [api-coverage](api-coverage.log.txt)                       |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=2`     | Pass configured checks | PASS; exit 0; 21.981s. Test Files 9 passed (9); Tests 96 passed (96)                                   | [api-client-coverage](api-client-coverage.log.txt)         |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2` | Pass configured checks | FAIL; exit 1; 92.785s. Test Files 4 failed \| 52 passed (56); Tests 6 failed \| 801 passed (807)       | [infrastructure-coverage](infrastructure-coverage.log.txt) |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage --maxWorkers=2`         | Pass configured checks | PASS; exit 0; 19.779s. Test Files 32 passed (32); Tests 612 passed (612)                               | [domain-coverage](domain-coverage.log.txt)                 |
| `pnpm.cmd --filter @graphgoblin/tooling test:coverage`                       | Pass configured checks | PASS; exit 0; 8.881s.                                                                                  | [tooling-coverage](tooling-coverage.log.txt)               |

Initial lint failure: 66 temporary QA TypeScript copies were outside the web tsconfig. [Retirement](retired-harness.json) renamed only those completed scratch copies to text, preserving their bytes; the original source/configuration and coverage scope were untouched. The second exact `pnpm.cmd lint` result is separate from the first.

`check:docs` was required because routes and generated read contracts changed; `check:tokens` was required because web source changed. `check:licenses` was not run because no dependency/lockfile changed. The existing tooling `test:coverage` script runs Node tests without a coverage percentage report, so this round does not certify a tooling line/branch percentage.

| Package        |              Lines |           Branches | Qualification                                              |
| -------------- | -----------------: | -----------------: | ---------------------------------------------------------- |
| web            |  98.7% (7829/7932) |  94.6% (8305/8779) | PASS                                                       |
| api            | 97.35% (2244/2305) | 92.37% (1612/1745) | PASS                                                       |
| api-client     |     100% (273/273) |   98.42% (187/190) | PASS                                                       |
| infrastructure |        not emitted |        not emitted | FAILED gate; percentages, if emitted, do not waive failure |
| domain         | 98.48% (2017/2048) | 95.81% (2288/2388) | PASS                                                       |

No stale coverage file is substituted for a failed gate: [coverage-summary.json](coverage-summary.json) checks file freshness against each command start.

Complete command from `apps/web`: `pnpm.cmd exec playwright test -c .tmp/qa5/playwright.config.ts --retries=0 --workers=1 --reporter=list,json --output=.tmp/qa5/edge-full-results`. The config/paths select only the documented QA environment adaptations; functional assertions, service workers, budgets and retries are unchanged.

| Browser invocation  | Expected                                            | Actual                                   | Evidence                                                                                                |
| ------------------- | --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| edge-focused        | All selected assertions pass; LIVE remains disabled | 4 passed; 0 failed; 0 skipped; 0 flaky   | [All cases and errors](browser-results.json), [per-case steps/expected/actual ledger](browser-cases.md) |
| edge-full           | All selected assertions pass; LIVE remains disabled | 420 passed; 1 failed; 1 skipped; 0 flaky | [All cases and errors](browser-results.json), [per-case steps/expected/actual ledger](browser-cases.md) |
| isolated-golden     | All selected assertions pass; LIVE remains disabled | 1 passed; 0 failed; 0 skipped; 0 flaky   | [All cases and errors](browser-results.json), [per-case steps/expected/actual ledger](browser-cases.md) |
| isolated-responsive | All selected assertions pass; LIVE remains disabled | 1 passed; 0 failed; 0 skipped; 0 flaky   | [All cases and errors](browser-results.json), [per-case steps/expected/actual ledger](browser-cases.md) |

The complete run had no timing assertion failure. Its untouched golden-file failure was an ENOENT from QA import relocation; the corrected once-alone pass does not turn that original full command into a pass. The interrupted exploratory run also had an unchanged responsive case time out waiting for its seed label after a scripted outage. That case was run exactly once alone and passed; its original failure, network response excerpts and both later results remain recorded. See [original context](exploratory-responsive-error-context.md.txt), [network excerpts](exploratory-responsive-network.json) and [once-alone log](isolated-responsive.log.txt). The sole full-suite skip is the explicit LIVE=0 provider test. The complete suite was not repeated after its result.

### Bolt criteria and adjacent systems

| Criterion/system                                                         | Steps and expected                                                                                                                                        | Actual / qualification                                                                                                                                | Evidence                                                                                                                               |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| #186 bounded per-run retention and cache                                 | Exercise long stream, count/byte limits, oversized identity, storage denial, reload cursor and exact selection                                            | Web gate passes 1,770 tests; full bounded-history and all six large-value Edge cases pass; no altered stored context                                  | [Web coverage](web-coverage.log.txt), [browser ledger](browser-cases.md)                                                               |
| #186 older browsing, ordering and live acknowledgement                   | Browse frozen older pages while live advances; join identical timestamps without gaps/duplicates; ignore stale selection responses                        | Component scenarios pass; full long-run keyboard/selection/reload scenario passes; current API/SQLite gate results above qualify server evidence      | [Web coverage](web-coverage.log.txt), [API coverage](api-coverage.log.txt), [infrastructure coverage](infrastructure-coverage.log.txt) |
| #186 bounded replay and slow/stalled consumer recovery                   | Public transport tests pause a real HTTP reader, require typed slow-consumer failure, resume from delivered cursor; client tests validate controls        | Covered by the API/client gate commands above; no fresh before/after memory benchmark is claimed                                                      | [API coverage](api-coverage.log.txt), [client coverage](api-client-coverage.log.txt)                                                   |
| #186 correct whole-history projections                                   | Compare API and both browser tabs across failed/resumed/succeeded states and delayed stored snapshots; browse beyond retained history                     | Focused and full thread-history pass, exact thread/vars checks pass, reads leave stored bytes unchanged                                               | [Focused observations](edge-focused-thread.json), [full observations](edge-full-thread.json), [browser ledger](browser-cases.md)       |
| #186 windowed Timeline and keyboard/focus                                | Require exactly 80 mounted rows for long history; Home/PageDown, event 1, older pages, reload and Follow live                                             | Full bounded-history case passes; no 1,200-row DOM requirement remains                                                                                | [Browser ledger](browser-cases.md), [spec amendment audit](spec-changes-since-round3.diff.txt)                                         |
| Round-5 pulse and coarse-pointer Input                                   | Eight viewport/theme/pointer combinations, invalid 0, select 1, Tab, live/reduced/reload/completed stream, AX tree                                        | 16/16 direct checks and all four focused cases pass; detailed matrix above                                                                            | [Direct result](manual-ui-results.json), [focused log](edge-focused.log.txt)                                                           |
| Adjacent inspector, Events, PWA, model/effort, cancellation and delivery | Run complete Edge suite with original assertions and LIVE disabled                                                                                        | 420 passed, one explicit LIVE skip, one QA fixture lookup failure; corrected lookup passes alone                                                      | [Full log](edge-full.log.txt), [isolated lookup](isolated-golden.log.txt)                                                              |
| Native stop/restart                                                      | Built-API shutdown cases drain controlled work, offer choices, confirm controlled native harness interruption, release ownership and reopen durable store | Both Edge shutdown cases pass; this does not establish arbitrary descendant-tree termination beyond the tested executables; D-015 limits below remain | [Full browser result](browser-results.json)                                                                                            |

### Limits

**D-015:** this sandbox cannot establish native process-tree termination. Native stop/descendant failures must be reported, not waived or called #186 regressions without evidence. No live-provider claim or owner acceptance is made. A fresh before/after heap pair, native paused-socket remeasurement, cross-browser comparison and integrated I01–I07 acceptance are not repeated by this focused round; historical measurements are not presented as current-head measurements.

## 4. Report path and evidence folder

Report: `docs/qa/2026-10-24-wp-e1-186-r2-qa/round-5/README.md`. Evidence: this `round-5/` folder. [Artifact manifest](artifact-manifest.json) records retained byte counts and SHA-256. [NOT-KEPT](NOT-KEPT.md) and [its inventory](not-kept-inventory.json) record every Playwright output folder and oversized capture with exact size and SHA-256; no unretained capture is cited as report evidence. The retained response excerpts and error contexts support the observations above.

All text is UTF-8 without BOM; local user paths are normalized to `%USERPROFILE%`. Logs retain their messages with ANSI formatting removed and user paths normalized. Images retain their original bytes. [Final verification](report-verification.json) checks links, artifacts, encoding, unchanged tracked/index state and exact HEAD. Root format passed before final report assembly; [the final scoped format check](final-format-check.log.txt) validates the finished QA Markdown. Every retained artifact is linked below. No production code, original test, earlier-round report, index entry or commit was changed.

<!-- ARTIFACTS START -->

- [NOT-KEPT.md](NOT-KEPT.md)
- [api-client-coverage.log.txt](api-client-coverage.log.txt)
- [api-coverage.log.txt](api-coverage.log.txt)
- [artifact-manifest.json](artifact-manifest.json)
- [audit-harness.mjs.txt](audit-harness.mjs.txt)
- [browser-cases.md](browser-cases.md)
- [browser-results.json](browser-results.json)
- [build.log.txt](build.log.txt)
- [check-deps.log.txt](check-deps.log.txt)
- [check-docs.log.txt](check-docs.log.txt)
- [check-layers.log.txt](check-layers.log.txt)
- [check-tokens.log.txt](check-tokens.log.txt)
- [collect-results.mjs.txt](collect-results.mjs.txt)
- [commands.jsonl](commands.jsonl)
- [complete-1440-light-fine.png](complete-1440-light-fine.png)
- [complete-390-dark-coarse.png](complete-390-dark-coarse.png)
- [correct-golden-path.mjs.txt](correct-golden-path.mjs.txt)
- [coverage-summary.json](coverage-summary.json)
- [domain-coverage.log.txt](domain-coverage.log.txt)
- [edge-focused-thread.json](edge-focused-thread.json)
- [edge-focused.json](edge-focused.json)
- [edge-focused.log.txt](edge-focused.log.txt)
- [edge-full-golden-path-error-context.md.txt](edge-full-golden-path-error-context.md.txt)
- [edge-full-thread.json](edge-full-thread.json)
- [edge-full.json](edge-full.json)
- [edge-full.log.txt](edge-full.log.txt)
- [edge-setup-import-failure.log.txt](edge-setup-import-failure.log.txt)
- [edge-setup-ts-resolution.json](edge-setup-ts-resolution.json)
- [edge-setup-ts-resolution.log.txt](edge-setup-ts-resolution.log.txt)
- [edge-targeted.json](edge-targeted.json)
- [edge-targeted.log.txt](edge-targeted.log.txt)
- [environment.json](environment.json)
- [exploratory-responsive-error-context.md.txt](exploratory-responsive-error-context.md.txt)
- [exploratory-responsive-network.json](exploratory-responsive-network.json)
- [final-format-check.log.txt](final-format-check.log.txt)
- [finalize-report.mjs.txt](finalize-report.mjs.txt)
- [format-check.log.txt](format-check.log.txt)
- [format-report.log.txt](format-report.log.txt)
- [golden-path-correction.json](golden-path-correction.json)
- [harness-adaptations.diff.txt](harness-adaptations.diff.txt)
- [harness-adaptations.json](harness-adaptations.json)
- [harness-assertion-audit.json](harness-assertion-audit.json)
- [harness-fake-classifier.ts.mjs.txt](harness-fake-classifier.ts.mjs.txt)
- [harness-global-setup.ts.mjs.txt](harness-global-setup.ts.mjs.txt)
- [harness-playwright.config.mjs.txt](harness-playwright.config.mjs.txt)
- [harness-server.ts.mjs.txt](harness-server.ts.mjs.txt)
- [harness-test-app.ts.mjs.txt](harness-test-app.ts.mjs.txt)
- [harness-thread-history.ts.mjs.txt](harness-thread-history.ts.mjs.txt)
- [infrastructure-coverage.log.txt](infrastructure-coverage.log.txt)
- [inspect-responsive-trace.mjs.txt](inspect-responsive-trace.mjs.txt)
- [inspect-ui.mjs.txt](inspect-ui.mjs.txt)
- [invalid-harness-adaptations.diff.txt](invalid-harness-adaptations.diff.txt)
- [invalid-harness-assertion-audit.json](invalid-harness-assertion-audit.json)
- [isolated-golden.json](isolated-golden.json)
- [isolated-golden.log.txt](isolated-golden.log.txt)
- [isolated-responsive.json](isolated-responsive.json)
- [isolated-responsive.log.txt](isolated-responsive.log.txt)
- [lint-after-retirement.log.txt](lint-after-retirement.log.txt)
- [lint.log.txt](lint.log.txt)
- [manual-failure-1440-dark-coarse.png](manual-failure-1440-dark-coarse.png)
- [manual-failure-1440-dark-fine.png](manual-failure-1440-dark-fine.png)
- [manual-failure-1440-light-coarse.png](manual-failure-1440-light-coarse.png)
- [manual-failure-1440-light-fine.png](manual-failure-1440-light-fine.png)
- [manual-fetch-setup.json](manual-fetch-setup.json)
- [manual-fetch-setup.log.txt](manual-fetch-setup.log.txt)
- [manual-server.log.txt](manual-server.log.txt)
- [manual-snapshot-setup.log.txt](manual-snapshot-setup.log.txt)
- [manual-stalled-attempt.log.txt](manual-stalled-attempt.log.txt)
- [manual-ui-results.json](manual-ui-results.json)
- [manual-ui.log.txt](manual-ui.log.txt)
- [not-kept-inventory.json](not-kept-inventory.json)
- [prepare-edge.mjs.txt](prepare-edge.mjs.txt)
- [qa-setup-attempts.json](qa-setup-attempts.json)
- [record-inputs.mjs.txt](record-inputs.mjs.txt)
- [report-verification.json](report-verification.json)
- [requirements-186.txt](requirements-186.txt)
- [requirements-287.txt](requirements-287.txt)
- [requirements-303.txt](requirements-303.txt)
- [requirements-COMMON.txt](requirements-COMMON.txt)
- [requirements-QA-COMMON.txt](requirements-QA-COMMON.txt)
- [requirements-owner-ledger.txt](requirements-owner-ledger.txt)
- [requirements-round5.txt](requirements-round5.txt)
- [retire-harness.mjs.txt](retire-harness.mjs.txt)
- [retired-harness.json](retired-harness.json)
- [run.mjs.txt](run.mjs.txt)
- [source.diff.txt](source.diff.txt)
- [spec-changes-since-round3.diff.txt](spec-changes-since-round3.diff.txt)
- [timeline-1440-dark-coarse.aria.txt](timeline-1440-dark-coarse.aria.txt)
- [timeline-1440-dark-coarse.png](timeline-1440-dark-coarse.png)
- [timeline-1440-dark-fine.aria.txt](timeline-1440-dark-fine.aria.txt)
- [timeline-1440-dark-fine.png](timeline-1440-dark-fine.png)
- [timeline-1440-light-coarse.aria.txt](timeline-1440-light-coarse.aria.txt)
- [timeline-1440-light-coarse.png](timeline-1440-light-coarse.png)
- [timeline-1440-light-fine.aria.txt](timeline-1440-light-fine.aria.txt)
- [timeline-1440-light-fine.png](timeline-1440-light-fine.png)
- [timeline-390-dark-coarse.aria.txt](timeline-390-dark-coarse.aria.txt)
- [timeline-390-dark-coarse.png](timeline-390-dark-coarse.png)
- [timeline-390-dark-fine.aria.txt](timeline-390-dark-fine.aria.txt)
- [timeline-390-dark-fine.png](timeline-390-dark-fine.png)
- [timeline-390-light-coarse.aria.txt](timeline-390-light-coarse.aria.txt)
- [timeline-390-light-coarse.png](timeline-390-light-coarse.png)
- [timeline-390-light-fine.aria.txt](timeline-390-light-fine.aria.txt)
- [timeline-390-light-fine.png](timeline-390-light-fine.png)
- [tooling-coverage.log.txt](tooling-coverage.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [update-report-metadata.mjs.txt](update-report-metadata.mjs.txt)
- [verify-report.mjs.txt](verify-report.mjs.txt)
- [web-coverage.log.txt](web-coverage.log.txt)
- [write-gate-tables.mjs.txt](write-gate-tables.mjs.txt)

<!-- ARTIFACTS END -->

## 5. Observations outside scope

The six native infrastructure failures remain **D-015** verification limits in unchanged files, with the failed gate preserved. The responsive wait failure has an observed API-list state change but an unresolved underlying cause; its complete-run and once-alone passes remain separate evidence. The existing tooling coverage command passes 85 Node tests but emits no line/branch percentages, so those percentages are not certified here.

API coverage passes 1,456 tests with 11 pre-existing skips (two wholly skipped files): live-provider smoke and opt-in performance modes are disabled, and Linux-only signal cases do not run on this Windows host. The complete Edge run's sole skip is the explicitly disabled LIVE test. This round does not supply live-provider/session-recall evidence, a fresh before/after heap pair, cross-browser coverage, arbitrary forced descendant-stop acceptance, owner product acceptance or integrated I01???I07 acceptance.

The ignored scratch/build/coverage outputs and disposable stores remain for the orchestrator. Native-failure stores may retain open handles or descendants under D-015. No independent-QA recursive directory deletion was issued. No observation outside scope was fixed or posted to GitHub.
