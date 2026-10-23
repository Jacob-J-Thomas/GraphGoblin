# Independent QA: WP-F2b / #204

**Verdict: FAIL against the complete QA brief on 013be37a820c954a9f4a3f46b3add1348b9aefbc.** The compatible-switch, inheritance, precedence, persistence and request criteria pass. One minor validation-status defect remains in the cached-catalog failure path. Cleanup is also outstanding because automatic approval review blocked removal of the identified disposable directories.

## Revision, boundaries and environment

- Branch: codex-qa-wp-f2b; worktree: <checkout> (this isolated worktree). HEAD is exactly the requested revision. Uncommitted QA evidence only; no product source, tracked file, index, branch, commit, owner app or owner store changed.
- Node v22.14.0; Windows PowerShell; pnpm.cmd; built web/API; Microsoft Edge 155.0.4283.62, headless. Build: 11/11 tasks passed.
- Native checks used executables compiled solely from tooling/fixtures/model-switch-cli.cs. Both no-turn preflights were ready. **All provider execution evidence is fake-only. No paid/provider turns were made.**
- Served native checks used port 5880. The Edge suite adapter used 5881 for its main app, 5882 for its control server and 5883 onward for its per-test apps, within 5889. The collector used 5880 in a separate, sequential process.
- D-023 governs loop, Settings, ecosystem precedence and preserved inheritance. D-024 supersedes historical owner-acceptance wording in the issue bodies and earlier recipe material. Current recipe/report already state that independent QA records acceptance. No owner confirmation was requested. The separate designated-session sign-off remains an orchestration gate, not a claim made by this QA.
- Read: QA-COMMON, COMMON, repository orientation, #278 decision/completion sections, #204, #205, #305, #288, the shipped recipe/report/before evidence and main's D-015/D-023/D-024. Earlier implementer evidence was treated as historical and rerun independently.

**Protocol deviation in the first coverage commands:** the unmodified API suite chooses its built-in 5600–5699/ephemeral test ports and gg-api-* temporary names. I ran that requested command before inspecting this helper. Subsequent native API triage and bounded coverage use an evidence-only helper copy mapped to 5883–5889 and prefixed temporary roots. No 4747/4748 listener or owner store was used. Unattributed unprefixed fixture directories were not removed.

## Defect QA-204-01 — minor: cached catalog failure still says Ready to publish

**Steps**

1. Open a valid Codex Astra/minimal node in the served editor; expand Advanced and let catalog, Settings and preflight finish.
2. Return HTTP 503 for the next model-catalog request. After the query's two-second freshness period, trigger its normal hidden-to-visible refetch. This is a controlled browser HTTP failure, with the previous catalog still cached.
3. Switch the node to Claude.
4. Inspect the notice directly below Harness and the toolbar validation status. Retry the catalog and read the public API's response to an incompatible draft write.

**Expected:** authored values stay; the notice names Retry model catalog; the toolbar shows Validation unavailable during the catalog failure; an incompatible draft cannot be saved; retry alone does not rewrite values.

**Actual:** values stay Astra/minimal; the Harness notice explicitly says “Validation is unavailable while the catalog cannot be loaded”; the toolbar still says **Ready to publish**, with **Validation unavailable absent**. The incompatible draft is rejected with HTTP 400 / EVALUATION_INVALID_CONFIGURATION / MODEL_HARNESS_MISMATCH. Retry preserves the authored values.

**Severity rationale:** misleading status and unmet explicit QA expectation; the backend still rejects the incompatible draft and no wrong-provider request is launched. Reproduced once in the adjacent-case run and again alone on this exact head. Introduction point was not established; this is not attributed to a particular earlier commit.

Evidence: [cached-alone.json](cached-alone.json), cached-catalog-failure in [checks.json](checks.json), and the original observation in [adjacent-results.json](adjacent-results.json). Source corroboration: apps/web/src/editor/EditorPage.tsx:129 and :507 retain resolved cached catalogs and only use catalog errors for the unavailable status when catalogs are unresolved. This is read-only corroboration, not a product edit.

## Touched systems and check matrix

Every record in [checks.json](checks.json) contains exact steps, expected result, actual values/responses, verdict and source evidence. There are **23 served cases: 22 PASS, 1 FAIL**, plus one environment record. The native collector adds **16 PASS cases**, including **14 saved/published/reopened executions with matching real fake-CLI requests**.

| Check / system                           | Steps and expected                                                                                                                              | Actual / result                                                                                                                                                                                    | Evidence IDs                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| B1, fully inheriting node                | Hold all three first loads; switch both directions without waiting; save, publish, reload, reopen and run                                       | No overrides authored, no waiting notice; one shared request each; Settings Opus/xhigh reaches CLI. PASS                                                                                           | B1-no-wait                                                                                  |
| B1, all lookups failed                   | Fail catalog, Settings and preflight, then switch an inheriting node both ways                                                                  | Fields remain unset; no waiting or additional requests. PASS                                                                                                                                       | B1-all-failed                                                                               |
| Effort-only, supported                   | High effort with no model override; switch, persist/reopen/run                                                                                  | Model stays absent; high retained; CLI Opus/high. PASS                                                                                                                                             | effort-only-high                                                                            |
| Effort-only, unsupported                 | Minimal with no model; switch with Settings Opus/xhigh                                                                                          | Model stays absent; xhigh selected, saved and requested. PASS                                                                                                                                      | effort-only-minimal                                                                         |
| Effort-only, clear by rule               | Controlled catalog suggests an unsupported default effort; no loop/Settings effort; loop supplies only Opus model, process supplies high effort | Both node overrides absent after switch/save/reopen; CLI Opus/high inherits process effort. PASS                                                                                                   | effort-only-cleared                                                                         |
| Effort-only failure                      | Fail catalog, then switch minimal effort-only node                                                                                              | Model unset, minimal retained; incompatible API write rejected. PASS                                                                                                                               | effort-only-failed                                                                          |
| B2, loop precedence and sibling          | Settings Opus/xhigh versus loop Fable/low; switch an explicit node and execute an inheriting sibling                                            | Both CLI requests Fable/low; saved/reopened node matches. PASS                                                                                                                                     | B2-loop-sibling                                                                             |
| Settings / ecosystem / disabled defaults | Exercise configured, absent and disabled preferences in both directions                                                                         | Correct enabled model; disabled preference stays off; no silent enablement. PASS                                                                                                                   | collector configured/absent/disabled; recipe-absent-disabled; B2-disabled-loop-and-settings |
| Catalog ecosystem flag                   | Controlled successful response flags Fable instead of Opus; Settings response has incompatible model                                            | Switch selects flagged Fable/high, proving the UI does not hard-code Opus. PASS                                                                                                                    | ecosystem-flag                                                                              |
| B3, initial loading                      | Hold catalog, Settings and preflight; switch 563 ms after the loop GET response, before first loads settle                                      | Waiting notice, old harness until completion, automatic Fable/low, one first load each; save/reopen/publish/run pass. The editor mounts after that GET, so action is within its first second. PASS | B3-first-load                                                                               |
| B3, known failure                        | Fail catalog while first Settings is still pending; switch and release Settings                                                                 | Failure reported immediately; harness changes without queueing; values remain; no later rewrite. PASS                                                                                              | B3-known-failure                                                                            |
| B3, retry after failure                  | Hold a user-requested catalog retry after a settled failure, then switch                                                                        | Not treated as a first load; values remain after recovery; explicit corrective switch saves/publishes/runs. PASS                                                                                   | B3-retry-not-first                                                                          |
| Catalog unavailable                      | Cold 503; switch; inspect status and retry; attempt API save                                                                                    | Authored values retained; Retry model catalog named below Harness; Validation unavailable shown; HTTP 400 incompatible write; recovery alone retains fields. PASS                                  | failure-catalog                                                                             |
| Settings unavailable                     | 503 Settings; switch; inspect Harness notice and API rejection                                                                                  | Values retained; notice says Reload the editor, then choose a model or switch harness again; incompatible save rejected. PASS                                                                      | failure-settings                                                                            |
| Harness not ready                        | Controlled Claude auth state; switch and retry                                                                                                  | Values retained; Retry Claude preflight matches F1 control; recovery does not rewrite; incompatible save rejected. PASS                                                                            | failure-readiness                                                                           |
| Failed cached catalog                    | Fail background catalog refetch, then switch and recover                                                                                        | Retention, retry name, no switch-triggered lookup and API rejection pass; toolbar status contradicts notice. FAIL, QA-204-01                                                                       | cached-catalog-failure                                                                      |
| Shared queries / unrelated dialogs       | After first loads, open Start and Done dialogs, reopen Infer and switch                                                                         | Catalog/Settings/preflight counts remain exactly 1/1/1. PASS                                                                                                                                       | no-extra-lookups                                                                            |
| Undo / notice / disabled entries         | Switch, one keyboard Undo/Redo; disable both Claude entries, switch, Undo warning                                                               | Dependent fields move together; warning clears; disabled flags remain false. PASS                                                                                                                  | undo-switch                                                                                 |
| Undo / persisted policy                  | Save switch; Undo once and save; Redo once and save; read API draft each time                                                                   | Codex Astra/minimal/workspace-write/never restored together; Claude Opus/xhigh/read-only/never restored together. PASS                                                                             | undo-persistence                                                                            |
| Pending action cancellation              | Hold first Settings, request switch, dismiss dialog, release and reopen                                                                         | Pending action cancels; original Codex values remain; later explicit switch persists/runs. PASS                                                                                                    | pending-dismiss                                                                             |
| Real process restart                     | Publish Fable/low; stop API; new process, same disposable store; reopen/run                                                                     | New process preserves values and launches CLI Fable/low. PASS                                                                                                                                      | restart                                                                                     |
| Complete configured recipe, UI           | Set both Settings defaults; switch all specified directions; save/reopen/reload; Publish, Open in Runs, Start run for Claude and Codex          | Loop defaults win; supported high stays; minimal becomes loop low; keyboard focus and read-only/never pass; CLI Fable/low and Astra/low. PASS                                                      | recipe-ui                                                                                   |

### Collector and shipped recipe

[collector-checks.json](collector-checks.json) expands all 16 individual cases with steps, expected, actual and PASS. [collector-results.json](collector-results.json) preserves its output, including saved definitions, reopened values, request records and disabled-preference checks.

Executed the shipped collector's logic through [collector.mjs](collector.mjs). Necessary evidence-only adaptations: import relocation, port guard 5830–5839 to 5880–5889, temporary prefix to gg-qa-204-, and output to this evidence folder. Assertions, loops, polling budgets and fixture source are unchanged. No tracked evidence was overwritten.

The configured Settings/editor/publication/run recipe and its inheritance, effort-only, absent-default, disabled-default, all-disabled, Undo, cold-failure, cached-failure and recovery steps were exercised. Normal API writes reject wrong-family values; both unchanged loaded-incompatible Edge cases verify the controlled GET fixture. The real-CLI variation was not executed because this brief expressly prohibits paid provider turns.

### Edge specifications after build

**21 PASS, exactly 4 known #205 FAIL, 25 total.** All 9 claude-harness and all 8 readiness tests pass, including both narrow-editor explicit switches (now line 166; the brief's line 159 cases) and both loaded-incompatible cases.

Known failures, separately retained:

- model-picker.spec.ts:36, dark and light — model/effort primary visibility.
- model-picker.spec.ts:102 — saved model selected-field visibility.
- model-picker.spec.ts:159 — catalog-failure notice / shared picker visibility.

All 25 cases have steps, expected, actual and verdict in [edge-results.json](edge-results.json). No browser failure is counted as a pass and assertions after a failed visible-field check are not claimed as tested.

Unchanged specs were run with zero retries, using [edge.config.ts](edge.config.ts), [edge-setup.ts](edge-setup.ts) and [edge-server.ts](edge-server.ts). The copied server serves the built web and uses built API packages. Claude was split into 5- and 4-test groups to avoid exhausting the permitted ports; model-picker and readiness ran together. Exact commands:

```powershell
pnpm.cmd --filter @graphgoblin/web exec playwright test --config ../../docs/qa/2026-10-22-wp-f2b-qa/edge.config.ts e2e/claude-harness.spec.ts --grep 'Claude inference|explicit harness switch|ready Claude model|Settings separates'
pnpm.cmd --filter @graphgoblin/web exec playwright test --config ../../docs/qa/2026-10-22-wp-f2b-qa/edge.config.ts e2e/claude-harness.spec.ts --grep 'Claude settings stay|Claude inspector|loaded saved incompatible'
pnpm.cmd --filter @graphgoblin/web exec playwright test --config ../../docs/qa/2026-10-22-wp-f2b-qa/edge.config.ts e2e/model-picker.spec.ts e2e/readiness.spec.ts
```

## Coverage, isolated triage and gates

The two initially requested commands were run with their default worker counts and overlapped. That was an avoidable QA load choice. Their failures remain recorded:

| Command                                          | Actual                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| pnpm.cmd --filter @graphgoblin/web test:coverage | FAIL: 58 failed / 1072 passed, 89 files completed; 31 workers failed to start. Coverage incomplete. |
| pnpm.cmd --filter @graphgoblin/api test:coverage | FAIL: 19 failed / 719 passed / 6 skipped, 55 files. No valid passing coverage result.               |

[web-initial-summary.json](web-initial-summary.json) and [api-initial-summary.json](api-initial-summary.json) retain each failed selection.

**Isolated triage:** all 58 web failures pass via 56 serial name selections (two selections contain repeated test names); all 19 API failures pass separately. No timeout, assertion, threshold, test isolation or exclusion was weakened. [isolated-triage.ps1](isolated-triage.ps1) runs each selection with maxWorkers=1; [web-isolated-triage.json](web-isolated-triage.json) and [api-isolated-triage.json](api-isolated-triage.json) retain every selection and result.

Named classes:

- **LOAD-WORKER:** 31 web fork-worker startup/response failures under the initial default parallel load.
- **LOAD-JSDOM:** editor, form, settings, style and DOM timing/assertion failures that pass in isolation.
- **LOAD-NATIVE:** API cold-start, subprocess, restart and hook deadlines that pass in isolation, including the three native restart cases.
- **D-015:** the register's taskkill process-tree denial class is not used to waive these results. No isolated API/web failure remained in that class; the native cases passed. The separate infrastructure process-tree suite was not run and is not claimed cleared.
- Turbo cache access-denied diagnostics are host cache warnings, separate from test failures and D-015.

A bounded full coverage invocation per package follows the isolated triage. The first bounded API invocation passed all 738 tests but the coverage gate failed (87.08% functions): the evidence-only alias bypassed the original 36-function test helper, leaving it at 0%. That adapter-induced result is retained in api-helper-copy-coverage.json. A corrected evidence-only Vite adapter (api-coverage.config.ts) changes only the original test helper setup constants in memory and retains its source identity; no product file, assertion, timeout, coverage exclusion or denominator is changed. A final bounded API invocation verified that correction. This is justified by the demonstrated worker/load failure, not an unexplained retry to green. It preserves the original thresholds and uses fresh report directories. Results and totals are in [web-bounded-coverage.json](web-bounded-coverage.json) and [api-bounded-coverage.json](api-bounded-coverage.json); the final verified totals are recorded below.

| Package | Tests                           | Lines              | Branches           | Statements         | Functions          | Gate |
| ------- | ------------------------------- | ------------------ | ------------------ | ------------------ | ------------------ | ---- |
| Web     | 1542 passed, 120 files          | 98.95% (7086/7161) | 95.00% (7272/7654) | 98.04% (8130/8292) | 98.55% (2190/2222) | PASS |
| API     | 738 passed, 6 skipped, 55 files | 97.93% (1804/1842) | 93.13% (1288/1383) | 96.49% (1985/2057) | 94.25% (394/418)   | PASS |

All four 90% global thresholds pass. The six API skips are the existing opt-in/native-platform skips, not new exclusions. The final API adapter retains the original helper identity: its 36-function denominator is unchanged and 30 functions execute, versus 0 with the discarded alias adapter. The overall API denominators remain 1842 lines / 418 functions / 1383 branches / 2057 statements.

Exact final commands:

```powershell
pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure=true --coverage.reportsDirectory=<disposable>/coverage
pnpm.cmd --filter @graphgoblin/api test:coverage --config ../../docs/qa/2026-10-22-wp-f2b-qa/api-coverage.config.ts --maxWorkers=1 --coverage.reportOnFailure=true --coverage.reportsDirectory=<disposable>/coverage
```

Other gates, exact commands and results: [gates.json](gates.json).

| Command                            | Result                                |
| ---------------------------------- | ------------------------------------- |
| pnpm.cmd build                     | PASS, 11 tasks                        |
| pnpm.cmd typecheck --concurrency=1 | PASS                                  |
| pnpm.cmd lint --concurrency=1      | PASS                                  |
| pnpm.cmd check:layers              | PASS                                  |
| pnpm.cmd check:deps                | PASS, existing drizzle orphan warning |
| pnpm.cmd check:docs                | PASS                                  |
| pnpm.cmd check:tokens              | PASS                                  |
| pnpm.cmd format:check              | PASS; see format-gate.json            |
| pnpm.cmd check:licenses            | Not required: no dependency change    |

## Criteria, decisions and open items

- **#204 AC1: PASS.** Explicit model authoring chooses compatible loop, Settings or flagged ecosystem defaults in both directions. Inheriting nodes stay inheriting; siblings and requests agree.
- **#204 AC2: PASS for value retention and enable preferences.** Disabled entries stay disabled and failures do not silently substitute authored fields. The additional requested validation-status expectation fails in the cached-error case, QA-204-01.
- **#204 AC3: PASS, fake-only.** Save/reopen/publication and native fixture requests agree; native process restart also passes.
- **#205:** exactly four known browser visibility failures; no implementation or waiver attempted.
- No Sonnet/Haiku, lifecycle migration, runtime fallback, real model entitlement or effective Claude effort claim is made.
- Historical baseline files were read, not edited. No new tests, product docs, ADRs, CHANGELOG entries, commits or GitHub posts were made. All added files are QA artifacts in this folder.
- See [qa-harness-notes.md](qa-harness-notes.md) for failed QA setup/observation attempts and why each corrected repetition was necessary.
- **Cleanup limitation:** automatic approval review rejected the command to remove 15 explicitly enumerated QA temporary directories with “blocked by policy.” No alternate deletion mechanism was attempted. The expanded final inventory, including later bounded-run directories, is in [cleanup.json](cleanup.json). All owned QA app/browser processes were stopped; retained directories require cleanup outside this session's automatic approval restriction. Original-suite unprefixed directories are not attributed by this manifest.
