# Independent QA round 2: WP-F3 bolt #270

## 1. Verdict

**PASS WITH MINOR DEFECTS** at `827c4f39eb906a0df0bfe6acc07c613e8fda5ae4`: the functional D2/D3 corrections and deadline regressions passed; the requested generated-reference wording check fails (R2-D1, minor). This is independent QA, not implementation, review, merge approval, or integrated acceptance of #306/#288. No production code, tests, Git index, or commits were changed. Only this round-2 evidence directory was added.

Branch `codex-qa-wp-f3-270-2`; worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-f3-270-2`; comparison base `0a1ff340dc8e0eb0ad6621b4020d100dcdc3be71`. Exact head and nonempty local dependencies were confirmed before building. Node **22.14.0** was first on PATH for build, gates, and runtime scripts. The build passed **11/11 tasks**, with no cache hits. [Environment](environment.json), [build](build.log.txt), [binding instructions and issues](requirements.log.txt), [complete candidate diff](candidate-diff.log.txt).

Built API composition roots, built web assets, real child processes and real SQLite files were exercised at **127.0.0.1:5880**. API-created keys were generated; fake harness and fake structured-completion ports were injected through supported constructors. **No live provider turns** occurred. Microsoft Edge ran headless at **1440 x 1000** and **390 x 1000**; [installed version](edge-version.json). All manually created data/runtime directories use `gg-qa-f3-270-2-` under system Temp. The explicitly requested upgrade suite and package tests own their own fixture directories. No owner ports/store or main checkout were used.

All owned API children exited through cooperative stdin shutdown. Native process-tree termination is unavailable in this sandbox (**D-015**), and no OS process-tree cleanup or live provider termination is claimed. Port 5880 was bindable after the owned instances stopped. Disposable folders and generated coverage directories were retained for orchestrator cleanup: [generated directories](generated-directories.log.txt), [inventory](temporary-directories.log.txt), [main processes](processes.json), [main resources](temporary-resources.json), [supplement resources](supplemental-resources.json), and [final webhook resources](webhook-final-results.json).

## 2. Defects

### R2-D1 - Minor: generated references omit the completion-limit scope

1. Inspect the generated `docs/reference/api.md` and `docs/reference/nodes.md` at the tested head.
2. Search for `structuredTimeoutMs`, LLM decision evaluation, output-transform repair and the same-session schema-repair exception.
3. Inspect `structuredTimeoutMs` in generated `packages/api-client/openapi.json`.

Expected: the generated reference states that this limit bounds LLM decision evaluations and output-transform repairs through StructuredPort, while same-session schema repairs follow the node timeout. Actual: both Markdown references contain **zero** field/scope mentions. OpenAPI has **9** field mentions and the nullable numeric shape, but **zero** scope wording mentions and no field description. The Loop tab, schema metadata, numbered docs, ADR and CHANGELOG have the correct wording; this finding is limited to the explicitly requested generated-reference check. Generation freshness alone does not establish this requirement.

Evidence: [counts, sizes and SHA-256](generated-reference-evidence.json), [kept generated API reference](generated-api-reference.log.txt), [kept generated node reference](generated-node-reference.log.txt), [kept generated OpenAPI](generated-openapi.json), and `generated-reference-scope` in [supplemental results](supplemental-results.json). No corrective production change was made.

Round-1 **D2 and D3 are fixed** at this head for the tested cases. Round-1 **D1 was disposed by the owner/orchestrator**; this run uses the clarified node-timeout semantics and does not reopen that disposition.

## 3. Coverage of criteria

Touched systems: additive contracts and nullable defaults; engine decision and repair boundaries; cancellation and queue capacity; per-run definition/limit pins; Codex adapter cancellation boundary; SQLite migration ledger, definitions, immutable snapshots, run/event pins and webhook admission intents; startup recovery; REST definition/version/export/import/run routes; web editor controls/help, Settings and inspector; generated client/OpenAPI and generated references; operator upgrade instructions. Public constructors/ports, REST, SQL fixture injection and real browser/process boundaries were used; no component under test was monkey-patched and no private member was accessed.

| Case / system                                 | Steps and expected                                                                                                                                                      | Actual and verdict                                                                                                                                                                                                            | Kept evidence                                                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact head and dependencies                   | Verify requested HEAD and nonempty node_modules before work                                                                                                             | PASS: exact full hash; local dependencies present; no install/link                                                                                                                                                            | [environment](environment.json)                                                                                                                                                               |
| Build before runtime                          | Select Node 22 and build all apps/packages                                                                                                                              | PASS: 11/11 tasks, 0 cached; 263.113 s                                                                                                                                                                                        | [build](build.log.txt)                                                                                                                                                                        |
| Genuine migration-0017 fixture                | Migrate an independent SQLite file only through 0017; populate valid API-created data with pre-field shapes                                                             | PASS: **18 ledger entries**, last 0017; **10 versions**, **3 runs**, **3 queued events** and a saved admission intent exported                                                                                                | [script](qa.mjs.txt), [before rows and ledger](store-before.json), [fixture IDs](fixture-identities.json)                                                                                     |
| Pre-#243 and post-#243 definitions            | Drafts/published versions missing both fields or only structuredTimeoutMs; read detail/version/export                                                                   | PASS: all **8 healthy loop fixtures** reopen; version/export reads are 200; missing values materialized as null                                                                                                               | [public reads](upgrade-public-reads.json), [script](supplemental.mjs.txt)                                                                                                                     |
| Authored values                               | Preserve deadline-only 9876 and explicitly authored 765 ms / 456 s                                                                                                      | PASS: values unchanged through migration and browser reopening                                                                                                                                                                | [reads](upgrade-public-reads.json), [authored desktop](authored-1440.png), [authored narrow](authored-390.png)                                                                                |
| Draft-run snapshot and finished pin           | Migrate a snapshot pinned by a completed draft run; read snapshot and finished run                                                                                      | PASS: both null defaults present; original finished run still succeeded                                                                                                                                                       | [before](store-before.json), [reads](upgrade-public-reads.json)                                                                                                                               |
| Snapshot protection                           | Attempt an UPDATE outside migration                                                                                                                                     | PASS: SQLite refuses with LOOP_VERSION_SNAPSHOT_IMMUTABLE                                                                                                                                                                     | [guard and restart comparison](store-after-and-second-start.json)                                                                                                                             |
| Waiting-run recovery                          | Cold-start old waiting run, submit its observed waitId, finish                                                                                                          | PASS: original run is succeeded after input; waiting and input history retained                                                                                                                                               | [before rows](store-before.json), [run and events](upgrade-public-reads.json)                                                                                                                 |
| Queued Event recovery                         | Save a real inbound Event's queued run while admission is stopped; cold start                                                                                           | PASS: original Event run admits and succeeds; null pinned limit retained                                                                                                                                                      | [source fixture](fixture-identities.json), [before rows](store-before.json), [after run](upgrade-public-reads.json)                                                                           |
| Webhook admission recovery                    | Create receipt via public RunManager.receiveWebhook while stopped; clone, restore pre-0020 pin shape/0017 ledger, cold start built API                                  | PASS: same run succeeds, receipt admitted, exactly one run.queued, null limits in run and queued pin                                                                                                                          | [public-port fixture script](webhook-final.mjs.txt), [before](webhook-final-before.json), [after](webhook-final-results.json), [process log](webhook-final-cold-api.log.txt)                  |
| Nested admission fields                       | Check run pin, queued pin and optional snapshot settings after SQL migration                                                                                            | PASS: both missing deadlines become null in all nested locations                                                                                                                                                              | [nested values](direct-migration-nested-values.json)                                                                                                                                          |
| Damaged JSON                                  | Cold-start mixed store containing literal malformed JSON; retain existing refusal; separately migrate through public DB interface with definition prevalidation skipped | PASS for preservation: startup retains DATA_UPGRADE_REQUIRED; direct migration leaves exact bytes `{broken` unchanged. Mixed damaged store cannot serve healthy loops because the existing guard refuses it before migrations | [refusal and split-store method](damaged-row-evidence.json), [cold-start log](damaged-cold-start.log.txt), [post-migration rows](direct-migration-nested-values.json)                         |
| Second native start / no rewrite              | Stop the original process; start PID 40600 on the same store; compare raw definition/pin/event/intent bytes and migration rows                                          | PASS: 19 ledger entries; 0020 recorded once; all captured raw values unchanged; snapshot guard restored                                                                                                                       | [before/after equality](store-after-and-second-start.json), [processes](processes.json)                                                                                                       |
| LLM decision timeout and capacity             | Stall fake completion at 400 ms; queue quick successor; expect typed failure and slot release                                                                           | PASS: child abort at **412 ms**; STRUCTURED_COMPLETION_TIMEOUT; queued successor succeeds                                                                                                                                     | [decision case](results.json), [observations](observations.json), [server](server.mjs.txt)                                                                                                    |
| Late decision result                          | Release valid answer after failure, compare failure/thread and terminal count                                                                                           | PASS: failure/thread unchanged; exactly one terminal event; no overwrite                                                                                                                                                      | [decision before/after](results.json)                                                                                                                                                         |
| Run pin survives draft edit                   | Edit draft limit to null while 400 ms execution runs                                                                                                                    | PASS: current run remains pinned at 400 ms and times out                                                                                                                                                                      | [pin case](results.json)                                                                                                                                                                      |
| D3 output-transform repair                    | Invalid inference output; stall structured coerce repair at 350 ms; inspect timeout                                                                                     | PASS: details.timeoutMs=350; details.provenance provider=codex, model=gpt-6-luna, effort=low; resumable typed failure                                                                                                         | [repair case](results.json), [observations](observations.json)                                                                                                                                |
| Repair late barrier and Resume                | Release late 7, compare state; make repair fast, deliberately Resume                                                                                                    | PASS: late repair cannot mutate prior failure/thread; Resume succeeds                                                                                                                                                         | [repair before/late/after](results.json)                                                                                                                                                      |
| Same-session schema repair                    | Set structured limit 100 ms, node timeout 2 s; delay repair 4 s                                                                                                         | PASS: running past structured cutoff; INFERENCE_TIMEOUT at node timeout; zero StructuredPort calls                                                                                                                            | [node-timeout case](results.json), [harness observations](observations.json)                                                                                                                  |
| Unlimited and explicit Cancel                 | Null completion/run deadlines; stall beyond 2 s; count completion timers, cancel and release late result                                                                | PASS: running after **2179 ms**; timer count **3 to 3**; cancelled with no timeout failure; late result unchanged                                                                                                             | [Unlimited case](results.json), [timer instrumentation](server.mjs.txt)                                                                                                                       |
| Fast decision                                 | Return prompt fake route before 1000 ms                                                                                                                                 | PASS: succeeds                                                                                                                                                                                                                | [fast case](results.json)                                                                                                                                                                     |
| API boundaries and export/import              | Accept null, 1 and 31536000000; refuse 0, -1, fraction, string, boolean and above maximum; roundtrip finite export                                                      | PASS: accepted values exact; invalid requests 400; finite export/import remains 1000 ms                                                                                                                                       | [boundary responses](results.json)                                                                                                                                                            |
| Migrated editor, both widths                  | Open all 8 healthy fixture editors at 1440 and 390                                                                                                                      | PASS: 16 opens; Unlimited except authored finite fixture; no page errors                                                                                                                                                      | [browser results](browser-results.json), [desktop](preDraft-1440.png), [narrow](preDraft-390.png)                                                                                             |
| D1 help / keyboard / validation / persistence | Read scope text; choose Limited by keyboard; reject invalid numbers; save 650; reload and read second tab                                                               | PASS at both widths: suggestion 120000; visible alerts and aria-invalid; 650 persists; correct node-timeout exception                                                                                                         | [browser results](browser-results.json), [desktop help](help-saved-1440.png), [narrow help](help-saved-390.png), [desktop invalid](validation-1440.png), [narrow invalid](validation-390.png) |
| Browser export/import                         | Download actual export and import through API                                                                                                                           | PASS at both widths; 650 ms roundtrips                                                                                                                                                                                        | [desktop export](ui-export-1440.json), [narrow export](ui-export-390.json), [browser results](browser-results.json)                                                                           |
| Settings and inspector                        | Show no default deadline; inspect a waiting run's 650 ms pin                                                                                                            | PASS at both widths; visually inspected desktop editor and narrow editor/inspector captures                                                                                                                                   | [desktop Settings](settings-1440.png), [narrow Settings](settings-390.png), [desktop inspector](inspector-1440.png), [narrow inspector](inspector-390.png)                                    |
| Generated reference wording                   | Inspect both generated references and OpenAPI field descriptions                                                                                                        | FAIL R2-D1: explanation absent                                                                                                                                                                                                | [counts/hashes](generated-reference-evidence.json), [kept references](generated-api-reference.log.txt), [OpenAPI](generated-openapi.json)                                                     |
| Upgrade instructions                          | Compare CHANGELOG upgrade note and actual cold migration                                                                                                                | PASS: automatic 0020 migration and nullable/client/embedding changes described; authored limits preserved                                                                                                                     | [candidate diff](candidate-diff.log.txt), [public migration evidence](upgrade-public-reads.json)                                                                                              |

### Gates and package coverage

All commands below used Node 22.14.0. The initial `pnpm.cmd test:upgrade` was launched before build completion and failed on a missing dist module; it is retained as a QA sequencing error, not a product defect. The required post-build run **passed: 21 passed, 0 failed, 3 platform skips, 438566.1123 ms**. Skips are Windows FIFO and unavailable symlink fixtures. [Initial output](upgrade-gate.log.txt), [post-build output](upgrade-gate-built.log.txt).

| Command                                                                                                               | Result                  | Evidence                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                  | PASS (98.33 s; exit 0)  | [typecheck](typecheck.log.txt)                                                                                       |
| `pnpm.cmd lint`                                                                                                       | PASS (235.93 s; exit 0) | [lint](lint.log.txt)                                                                                                 |
| `pnpm.cmd format:check`                                                                                               | PASS (377.53 s; exit 0) | [format-check](format-check.log.txt)                                                                                 |
| `pnpm.cmd check:layers`                                                                                               | PASS (0.63 s; exit 0)   | [layers](layers.log.txt)                                                                                             |
| `pnpm.cmd check:deps`                                                                                                 | PASS (15.12 s; exit 0)  | [deps](deps.log.txt)                                                                                                 |
| `pnpm.cmd check:docs`                                                                                                 | PASS (6.29 s; exit 0)   | [docs](docs.log.txt)                                                                                                 |
| `pnpm.cmd check:tokens`                                                                                               | PASS (10.71 s; exit 0)  | [tokens](tokens.log.txt)                                                                                             |
| `pnpm.cmd check:migrations`                                                                                           | PASS (14.03 s; exit 0)  | [migrations](migrations.log.txt)                                                                                     |
| `pnpm.cmd --filter @graphgoblin/contracts test:coverage`                                                              | PASS (21.84 s; exit 0)  | [contracts-coverage](contracts-coverage.log.txt)                                                                     |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage`                                                                 | PASS (49.15 s; exit 0)  | [domain-coverage](domain-coverage.log.txt)                                                                           |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                                                                 | PASS (99.84 s; exit 0)  | [engine-coverage](engine-coverage.log.txt)                                                                           |
| `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage`                                                          | FAIL (70.41 s; exit 1)  | [adapter-codex-coverage](adapter-codex-coverage.log.txt)                                                             |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage`                                                         | FAIL (134.76 s; exit 1) | [infrastructure-coverage](infrastructure-coverage.log.txt)                                                           |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage`                                                             | FAIL (38.69 s; exit 1)  | [api-client-coverage](api-client-coverage.log.txt)                                                                   |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`                                                                    | PASS (480.85 s; exit 0) | [web-coverage](web-coverage.log.txt)                                                                                 |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/stored-loop-defaults.test.ts src/structured-deadline.test.ts` | PASS (18.40 s; exit 0)  | [api-focused](api-focused.log.txt)                                                                                   |
| `pnpm.cmd --filter @graphgoblin/adapter-codex exec vitest run src/probe-directory.test.ts`                            | PASS (9.27 s; exit 0)   | [adapter-codex-isolated-src-probe-directory-test-ts](adapter-codex-isolated-src-probe-directory-test-ts.log.txt)     |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/adversarial.test.ts`                               | FAIL (41.05 s; exit 1)  | [infrastructure-isolated-src-adversarial-test-ts](infrastructure-isolated-src-adversarial-test-ts.log.txt)           |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/process.test.ts`                            | FAIL (34.08 s; exit 1)  | [infrastructure-isolated-src-claude-process-test-ts](infrastructure-isolated-src-claude-process-test-ts.log.txt)     |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/readiness.test.ts`                          | FAIL (55.36 s; exit 1)  | [infrastructure-isolated-src-claude-readiness-test-ts](infrastructure-isolated-src-claude-readiness-test-ts.log.txt) |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/process/scripts.test.ts`                           | FAIL (50.52 s; exit 1)  | [infrastructure-isolated-src-process-scripts-test-ts](infrastructure-isolated-src-process-scripts-test-ts.log.txt)   |
| `pnpm.cmd --filter @graphgoblin/api-client exec vitest run src/templates.test.ts`                                     | PASS (13.67 s; exit 0)  | [api-client-isolated-src-templates-test-ts](api-client-isolated-src-templates-test-ts.log.txt)                       |

| Package        | Gate result | Coverage summary (statements / branches / functions / lines, as emitted)                                                       | Evidence                               |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| contracts      | PASS        | Statements: 99.5% ( 399/401 ); Branches: 95% ( 190/200 ); Functions: 100% ( 58/58 ); Lines: 99.74% ( 385/386 )                 | [log](contracts-coverage.log.txt)      |
| domain         | PASS        | Statements: 97.32% ( 2328/2392 ); Branches: 95.78% ( 2274/2374 ); Functions: 97.11% ( 437/450 ); Lines: 98.47% ( 2007/2038 )   | [log](domain-coverage.log.txt)         |
| engine         | PASS        | Statements: 96.87% ( 2823/2914 ); Branches: 92.93% ( 2182/2348 ); Functions: 98.66% ( 517/524 ); Lines: 98.06% ( 2585/2636 )   | [log](engine-coverage.log.txt)         |
| adapter-codex  | FAIL        | No passing coverage denominator established                                                                                    | [log](adapter-codex-coverage.log.txt)  |
| infrastructure | FAIL        | No passing coverage denominator established                                                                                    | [log](infrastructure-coverage.log.txt) |
| api-client     | FAIL        | No passing coverage denominator established                                                                                    | [log](api-client-coverage.log.txt)     |
| web            | PASS        | Statements: 98.03% ( 8527/8698 ); Branches: 94.95% ( 7738/8149 ); Functions: 98.48% ( 2269/2304 ); Lines: 98.93% ( 7435/7515 ) | [log](web-coverage.log.txt)            |

The new README and NOT-KEPT files were separately formatted and checked with pnpm.cmd exec prettier --write/--check; see [report formatting](report-format.log.txt).

Full API package coverage (pnpm.cmd --filter @graphgoblin/api test:coverage) was **not run**: its current native subprocess helper explicitly selects ports 5600-5699, outside this assignment's 5880-5889 range; see [live helper evidence](api-coverage-port-constraint.log.txt). Focused in-process API tests are listed above and do not establish a full package denominator. `check:licenses` was not run because the candidate changes no dependencies. No coverage thresholds or exclusions were changed. No command reported ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK; no direct-tool fallback was used. 7 recorded gate/isolated commands returned nonzero; passing isolated rechecks never replace their original failed run. Package failure logs and isolated commands remain above. Native process-control failures are classified under D-015 only when their actual log supports that cause. Timing failures in unchanged files receive one isolated run after the broad gates; both outputs are retained.

### Limits and interpretation

- #270's configured timeout/capacity/late-result/cancel criterion was tested and passed through built APIs with fake providers. Adapter unit/port evidence is fake-only. No real successful provider response, native provider subprocess shutdown, or OS descendant inventory was tested: live provider turns are explicitly out of scope and native termination is denied (D-015).
- D2's healthy current-format upgrade, authored values, snapshots, finished/waiting/queued runs, due webhook intent and second-start stability passed. A combined malformed-and-healthy store cannot serve any loop: the unchanged strict startup guard refuses malformed JSON before 0020. Damaged-byte preservation was therefore separately established with the public migration API and the explicit prevalidation bypass; this is not claimed as a successful damaged-store cold start.
- D3 passed, including late barrier and deliberate Resume. D1's clarified same-session node-timeout behavior and UI help passed; its generated-reference wording is incomplete (minor R2-D1).
- #306 is covered only for this bolt's visible/persisted/runtime completion-limit seam. No overall #306 or #288 acceptance is claimed. Live MCP and whole-application regression were not exercised. New real-time Unlimited dwell is about two seconds plus timer-allocation evidence; round 1's two-minute dwell is historical, not a result of this run. Exact-boundary cancellation is covered only to the extent established by the retained engine test run, not by a claimed exact-tick HTTP delivery.
- 400/350/100 ms fixtures, the two-second node timeout and dwell, and polling/watchdog windows are QA engineering choices, not product defaults or owner-approved policy.

### QA fixture corrections and original observations

No production code or production tests were added or changed. The first mixed fixture was deliberately refused before migration because it contained malformed JSON; subsequent healthy checks used an independent physical copy, with the damaged-loop case preserved separately. The original script then produced connection-refused cascades because it continued after that startup refusal. Those are incomplete checks, not product failures. [Initial script/results/logs](initial-attempt/qa.mjs.txt), [initial result](initial-attempt/results.json), [initial runtime log](initial-attempt/qa.log.txt).

The first hand-built webhook receipt omitted its due timestamp, then a second version referenced a not-yet-stored snapshot and lacked the corresponding inbound claim. The existing engine refused the target as WEBHOOK_TARGET_REMOVED; it did not demonstrate a migration defect. The final case uses public receiveWebhook to generate all claim/intent/inbound metadata and preserves the exact identity through migration. [Initial receipt diagnostic](receipt-diagnostic.json), [first supplemental results](supplement-initial-attempt/supplemental-results.json), [final public-port fixture](webhook-final-before.json), [final result](webhook-final-results.json). A supplemental launch also had a QA path-expansion error for the redacted %USERPROFILE% path; the original failure is retained.

The first browser wording assertion expected plural `evaluations` while the product says singular `evaluation`; the corrected assertion checks the actual required meaning. Both original failures and the final passing checks are retained: [initial browser results](browser-initial-results.json), [final results](browser-results.json), [final script](browser.mjs.txt). The generated-reference failure remains a product documentation finding after this harness correction. No failed product result was silently retried to green.

## 4. Report path and evidence folder

Report: `docs/qa/2026-10-24-wp-f3-270-qa/round-2/README.md`. Evidence: this directory and its linked initial-attempt subdirectories. Every retained file is linked in the artifact inventory below. Captures over 1,000,000 bytes are recorded with their exact size and SHA-256 in [NOT-KEPT.md](NOT-KEPT.md); no unkept capture is cited as evidence. Scripts are retained as .mjs.txt and logs as .log.txt. Local user paths use %USERPROFILE%.

## 5. Observations outside scope

- D-015 limits native process-tree termination evidence. Owned fake-harness API processes stopped cooperatively; this does not establish provider-tree termination.
- The unchanged strict current-format preflight refuses any malformed stored definition before migration. Retaining that diagnostic means the combined damaged store does not start; see the limitation and separated evidence above.
- Full API coverage's current subprocess helper selects 5600-5699, which conflicts with this assignment's 5880-5889 range. No such subprocess suite was launched in this round. **Environment deviation:** API-client component tests use listen(port:0), unconstrained to the assigned range; actual allocated ports were not captured. See [kept source excerpt](api-client-listener-constraint.json). This does not change the controlled built-app port of 5880.
- The adapter probe file had two 5000 ms timeouts; the API-client template file had a test timeout and a hook timeout. Infrastructure failures were in src/adversarial.test.ts, src/claude/process.test.ts, src/claude/readiness.test.ts and src/process/scripts.test.ts; native process cancellation/cleanup is constrained by D-015, and other assertions are retained without automatically attributing them to that limitation. Exact test names, errors and reproduction commands are in [gate failure details](gate-failure-details.json). Gate/environment failures and unresolved denominators are reported above; no fix, threshold change, dependency install, GitHub write, stage, or commit was attempted.

## Artifact inventory

- [NOT-KEPT.md](NOT-KEPT.md)
- [README.md](README.md)
- [adapter-codex-coverage.log.txt](adapter-codex-coverage.log.txt)
- [adapter-codex-isolated-src-probe-directory-test-ts.log.txt](adapter-codex-isolated-src-probe-directory-test-ts.log.txt)
- [api-client-coverage.log.txt](api-client-coverage.log.txt)
- [api-client-isolated-src-templates-test-ts.log.txt](api-client-isolated-src-templates-test-ts.log.txt)
- [api-client-listener-constraint.json](api-client-listener-constraint.json)
- [api-coverage-port-constraint.log.txt](api-coverage-port-constraint.log.txt)
- [api-focused.log.txt](api-focused.log.txt)
- [artifact-manifest.json](artifact-manifest.json)
- [authored-1440.png](authored-1440.png)
- [authored-390.png](authored-390.png)
- [browser-final.log.txt](browser-final.log.txt)
- [browser-initial-results.json](browser-initial-results.json)
- [browser-results.json](browser-results.json)
- [browser-supplement-api.log.txt](browser-supplement-api.log.txt)
- [browser-targets.json](browser-targets.json)
- [browser.log.txt](browser.log.txt)
- [browser.mjs.txt](browser.mjs.txt)
- [build.log.txt](build.log.txt)
- [candidate-diff.log.txt](candidate-diff.log.txt)
- [contracts-coverage.log.txt](contracts-coverage.log.txt)
- [damaged-cold-start.log.txt](damaged-cold-start.log.txt)
- [damaged-row-evidence.json](damaged-row-evidence.json)
- [deps.log.txt](deps.log.txt)
- [direct-migration-nested-values.json](direct-migration-nested-values.json)
- [docs.log.txt](docs.log.txt)
- [domain-coverage.log.txt](domain-coverage.log.txt)
- [edge-version.json](edge-version.json)
- [engine-coverage.log.txt](engine-coverage.log.txt)
- [environment.json](environment.json)
- [finalize.mjs.txt](finalize.mjs.txt)
- [fixture-identities.json](fixture-identities.json)
- [format-check.log.txt](format-check.log.txt)
- [gate-failure-details.json](gate-failure-details.json)
- [gates-run.log.txt](gates-run.log.txt)
- [gates.json](gates.json)
- [gates.mjs.txt](gates.mjs.txt)
- [generated-api-reference.log.txt](generated-api-reference.log.txt)
- [generated-directories.log.txt](generated-directories.log.txt)
- [generated-node-reference.log.txt](generated-node-reference.log.txt)
- [generated-openapi.json](generated-openapi.json)
- [generated-reference-evidence.json](generated-reference-evidence.json)
- [help-saved-1440.png](help-saved-1440.png)
- [help-saved-390.png](help-saved-390.png)
- [infrastructure-coverage.log.txt](infrastructure-coverage.log.txt)
- [infrastructure-isolated-src-adversarial-test-ts.log.txt](infrastructure-isolated-src-adversarial-test-ts.log.txt)
- [infrastructure-isolated-src-claude-process-test-ts.log.txt](infrastructure-isolated-src-claude-process-test-ts.log.txt)
- [infrastructure-isolated-src-claude-readiness-test-ts.log.txt](infrastructure-isolated-src-claude-readiness-test-ts.log.txt)
- [infrastructure-isolated-src-process-scripts-test-ts.log.txt](infrastructure-isolated-src-process-scripts-test-ts.log.txt)
- [initial-attempt/browser-results.json](initial-attempt/browser-results.json)
- [initial-attempt/browser-targets.json](initial-attempt/browser-targets.json)
- [initial-attempt/browser.log.txt](initial-attempt/browser.log.txt)
- [initial-attempt/browser.mjs.txt](initial-attempt/browser.mjs.txt)
- [initial-attempt/fixture-identities.json](initial-attempt/fixture-identities.json)
- [initial-attempt/processes.json](initial-attempt/processes.json)
- [initial-attempt/qa.log.txt](initial-attempt/qa.log.txt)
- [initial-attempt/qa.mjs.txt](initial-attempt/qa.mjs.txt)
- [initial-attempt/results.json](initial-attempt/results.json)
- [initial-attempt/server.mjs.txt](initial-attempt/server.mjs.txt)
- [initial-attempt/source-api.log.txt](initial-attempt/source-api.log.txt)
- [initial-attempt/store-before.json](initial-attempt/store-before.json)
- [initial-attempt/temporary-resources.json](initial-attempt/temporary-resources.json)
- [initial-attempt/upgraded-api.log.txt](initial-attempt/upgraded-api.log.txt)
- [inspector-1440.png](inspector-1440.png)
- [inspector-390.png](inspector-390.png)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [migrations.log.txt](migrations.log.txt)
- [observations.json](observations.json)
- [preDraft-1440.png](preDraft-1440.png)
- [preDraft-390.png](preDraft-390.png)
- [processes.json](processes.json)
- [qa.log.txt](qa.log.txt)
- [qa.mjs.txt](qa.mjs.txt)
- [receipt-before.json](receipt-before.json)
- [receipt-diagnostic.json](receipt-diagnostic.json)
- [receipt-recovery-api.log.txt](receipt-recovery-api.log.txt)
- [report-format.log.txt](report-format.log.txt)
- [report-script-check.log.txt](report-script-check.log.txt)
- [requirements.log.txt](requirements.log.txt)
- [results.json](results.json)
- [second-api.log.txt](second-api.log.txt)
- [server.mjs.txt](server.mjs.txt)
- [settings-1440.png](settings-1440.png)
- [settings-390.png](settings-390.png)
- [source-api.log.txt](source-api.log.txt)
- [store-after-and-second-start.json](store-after-and-second-start.json)
- [store-before.json](store-before.json)
- [supplement-initial-attempt/supplemental-resources.json](supplement-initial-attempt/supplemental-resources.json)
- [supplement-initial-attempt/supplemental-results.json](supplement-initial-attempt/supplemental-results.json)
- [supplement-initial-attempt/supplemental.log.txt](supplement-initial-attempt/supplemental.log.txt)
- [supplemental-resources.json](supplemental-resources.json)
- [supplemental-results.json](supplemental-results.json)
- [supplemental.log.txt](supplemental.log.txt)
- [supplemental.mjs.txt](supplemental.mjs.txt)
- [temporary-directories.log.txt](temporary-directories.log.txt)
- [temporary-resources.json](temporary-resources.json)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [ui-export-1440.json](ui-export-1440.json)
- [ui-export-390.json](ui-export-390.json)
- [upgrade-gate-built.log.txt](upgrade-gate-built.log.txt)
- [upgrade-gate.log.txt](upgrade-gate.log.txt)
- [upgrade-public-reads.json](upgrade-public-reads.json)
- [upgraded-api.log.txt](upgraded-api.log.txt)
- [validation-1440.png](validation-1440.png)
- [validation-390.png](validation-390.png)
- [verification.json](verification.json)
- [verify.mjs.txt](verify.mjs.txt)
- [web-coverage.log.txt](web-coverage.log.txt)
- [webhook-final-before.json](webhook-final-before.json)
- [webhook-final-cold-api.log.txt](webhook-final-cold-api.log.txt)
- [webhook-final-results.json](webhook-final-results.json)
- [webhook-final.log.txt](webhook-final.log.txt)
- [webhook-final.mjs.txt](webhook-final.mjs.txt)
- [webhook-source-api.log.txt](webhook-source-api.log.txt)
