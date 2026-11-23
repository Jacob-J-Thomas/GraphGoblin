# #486 D204 bounded correction author report

Author work is ready for root inspection as an unstaged diff. This is not independent QA, a review approval, completion of the issue, merge readiness, or owner acceptance.

## Binding and ownership

- Editable checkout: `G:/ggq/gg-i4-486-review-fixes/GraphGoblin`, branch `codex/gg-i4-486-review-fixes`.
- Verified clean starting HEAD: `633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9`; tree `d0e38c6c0212e312e6b605ac3d6bc8f7af5a129f`.
- Preparation receipt read and copied verbatim under `inputs/preparation-receipt.json`. The brief, D204 and original Fable cycle-1 report are preserved under `inputs/`; their SHA256 bindings are in `binding.json`.
- Runtime: explicit `C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe`, verified `v22.23.4`. All driver commands use that runtime first on PATH and canonical `TEMP=TMP=G:\ggq\qa-scratch\i4-486-review-fixes-author-01`.
- Initial Git index bytes were SHA256-captured before source edits and remain identical. Exact initial/final hash and index path are recorded in `initial-index.json` and `binding.json`.
- No staging, unstaging, commit, push, provider dispatch, real provider call, GitHub mutation, owner application/store/port access, new worktree, or edits to the original author/delivery/active QA checkouts occurred. The no-write boundary is from this worker's actions; this report does not independently attest another active worker's state.

## Final paths changed

1. `packages/engine/src/failure-publication.ts`: optional engine-owned diagnostic stored in an ECMAScript `#diagnostic` field, read through a prototype getter. Neither the field nor getter becomes an enumerable own property.
2. `packages/engine/src/handlers/inference-context.ts`: only the canonical system-template rerender catch supplies `errorDiagnostic(error)` to that private channel.
3. `packages/engine/src/run-manager.ts`: copies the diagnostic when reconstructing an internal failure to attach node/prior inference provenance; includes that diagnostic in the existing run/node-correlated private error log.
4. `packages/engine/src/handlers/inference-context.test.ts`: both rerender positions assert safe serialization; both public RunManager cases assert correlated diagnostic presence, safe failure/event, attribution, resumability and no turn/start/resume.
5. New `packages/engine/src/handlers/inference-workspace.test.ts`: three direct workspace failures, six prior-task recovery cases, two earlier-recovery-refusal controls, and one diagnostic/provenance reconstruction case.
6. `docs/05-execution-engine.md`: one paragraph clarifies B17's restored private diagnostic behavior and unchanged A2 omission policy.

Production scope is three engine files plus the numbered diagnostic doc. No schema, dependency, ADR policy, configuration, format, storage, migration, retry, timeout, or public transport change. F3/F4 remain parked in #554.

`reviewable-complete.patch` contains the tracked diff plus the untracked new test file without using the index. `candidate-source/` preserves all six exact candidate files. `original-source633/` preserves the five tracked originals. `binding.json` records per-file SHA256 and the complete patch SHA256.

## Mechanism and preserved behavior

The private slot contains the existing diagnostic projection (original message, Error name and stack where available), not a raw enumerable error or a public RunFailure option/details field. The getter is a class prototype accessor and `#diagnostic` is an ECMAScript private slot. JSON.stringify(error), Object.assign({}, error), options, toFailure(), stored failure rows and recorded events omit it.

Only the explicit canonical-system rerender catch originates the channel. Existing typed authored boundaries still throw their safe typed failures and do not log raw evaluator messages. The logger retains the old ordinary-internal-error fallback and provider warning branch. No structural name/code lookalike classifier was added. Cancellation/deadline and unusable-uncertain/session-missing precedence remain unchanged. Node attribution, INTERNAL_ERROR copy, resumability and no new provider invocation are retained.

The reconstruction test uses supported handler injection against already durable prior-task fixtures. It does not imply natural B17 reachability with pending tasks: real pending tasks disable canonical history trimming. The canonical domain-render spy is an explicit synthetic reachability seam; no naturally occurring canonical renderer fault was found or claimed.

## Acceptance evidence

| Criterion | Evidence and result |
| --- | --- |
| F1 private diagnostic with run/node correlation | `inference-context.test.ts`: canonical rerenders 1 and 2 require logger level error, message `node failed`, exact runId/nodeId/safe failure, and private marker in the diagnostic. Both pass candidate and fail original633 exactly at that assertion. |
| F1 public omission and unchanged behavior | Same public cases assert exact safe INTERNAL_ERROR, current node `respond`, resumable true, recorded failure equals row, public row/event serialization omits marker, zero harness.turn/start/resume. Direct pure cases assert serialized error and copied enumerable properties omit marker at both rerender positions. |
| F1 prior provenance reconstruction | `inference-workspace.test.ts`: synthetic pure canonical fault against previously durable definitely-not-submitted history. Exact safe failure includes prior inference; no retry is invented, existing harness events stay identical and zero harness start/resume occurs. Marker appears only in correlated private diagnostic. |
| A2 unchanged authored control | Existing unmodified `inference.test.ts`, `inference authored fields and effects` / `classifies only the failing %s transform after an earlier real structured callback`, input and output cases, passed in the seven-suite run. They require `PRIVATE_EXPRESSION` absent from both public failure and logger lines. Existing `flow.test.ts` also checks authored source/evaluator marker omission and external lookalikes. |
| F2 direct inference workspace | Three schema-parsed published definition cases use real Liquid parse failure, real disabled-include render failure and real empty rendered workspace. Exact TEMPLATE_ERROR, boundary/cause, node `infer`, nonresumable failure and event; no workspace.resolve, session row, turn/start/resume; public Resume refused. All pass. |
| F2 prior definitely-not-submitted / delivery-uncertain | Six cases (three workspace faults times two prior states) seed durable history through supported runs/events/sessions ports and invoke public RunManager.start/waitForIdle. Exact failure retains prior provenance without retry; prior turn/submission/session events and session rows remain unchanged; no workspace resolve or harness launch. All pass. |
| Earlier guards | Unusable uncertain history gets HARNESS_DELIVERY_UNCERTAIN; session-missing history gets HARNESS_SESSION_MISSING. Both assert zero observeTemplate calls, zero workspace.resolve/launch, unchanged prior harness events/session rows. Both pass. |

The stored-history fixtures are synthetic setup, not a claim that a pinned invalid workspace previously launched successfully. They test public restart/re-entry with durable prior evidence. Uncertain-workspace cases supply a usable recorded session and durable acceptance, satisfying canContinueTurn; the separate unusable case proves the earlier guard. No private RunManager state is read. The new suites establish engine/public-method acceptance over supported fakes, not native process, REST/MCP or browser acceptance.

## Finite original-source control

`counterfactual.mjs` saved candidate bytes and original633 bytes for exactly the three changed production modules, wrote those originals only in this author checkout, ran the controls once per version, and restored candidate bytes in a finally block. New tests and numbered docs stayed candidate throughout.

- `16a-original633-f1`: exit 1, exactly 2 failed / 12 skipped. Both failures show the expected private diagnostic absent while the safe correlated failure log remains present.
- `16b-original633-f2`: exit 0, 11 passed / 1 skipped. The F1 reconstruction test was intentionally excluded from this F2-only control.
- `16c-candidate-f1`: exit 0, 2 passed / 12 skipped.
- `16d-candidate-f2`: exit 0, 11 passed / 1 skipped.
- `counterfactual/result.json` and `counterfactual/binding.json` preserve original/candidate/restored SHA256. All three restored hashes equal their pre-control candidate hashes. Raw stdout/stderr and exact scripts are retained under `commands/16*`.

This confirms F1's regression and correction. F2 passed original633 and is reported only as newly supplied evidence.

## Executed commands and outcomes

The launcher for each numbered run is the explicit Node executable above invoking `driver.mjs NAME scripts/NAME.ps1` in the author checkout. The driver sets PATH/TEMP/TMP, saves the exact PowerShell command script and records stdout, stderr, exit status, runtime, cwd and timestamps under `commands/NAME/`. The exact command text, including subcommands, is authoritative there. Driver source and scripts are included in the seal.

| Record | Executed work | Result |
| --- | --- | --- |
| Predriver inspection, detailed in `initial-exploration.md` | Brief/memory search; AGENTS, README, issue workflow; D204, full Fable report, prep receipt; clean Git/runtime/source searches | Reads passed. Initial unquoted PowerShell HEAD^{tree} and wildcard-path rg attempts failed; no source edits. First brief/memory reads preceded discovery of the per-command TEMP requirement and did no product execution. |
| 01-inspect | Runtime, TEMP, Git clean/branch/head/tree, attempted index hash | Runtime and clean binding passed; Get-FileHash unavailable under -NoProfile, exit 1. Preserved, replaced hash operation with explicit Node crypto before editing. |
| 02-inspect | Same binding, index hash capture via driver, source/docs/package reads | Passed, exit 0. |
| 03-boundaries | ADR0088, inference ordering/provenance/scenario reads, searches | Source reads passed; rg wildcard paths failed and remain in stderr. Overall script exit 0 is not claimed as a successful search. |
| 04-test-patterns | Existing test/fake/config/error type inspections | Passed, exit 0. |
| 05-existing-fixtures | Existing provenance/workspace/fake/inference/manager reads | Passed, exit 0. |
| 06-workspace-reentry | Working-directory, recovery and source searches/reads | Passed, exit 0. |
| 07-render-data | Workspace and evaluator source inspection | Reads passed; rg reported nonexistent domain thread.ts, preserved. Overall exit 0. |
| 08-admission-fixture | Supported durable-history setup and handler types | Passed, exit 0. |
| 09-patch-status | git diff stat and class read after rejected multi-file patch | Confirmed rejected patch made no changes, exit 0. |
| 10-focused-initial | pnpm engine test, context and new workspace suites | Exit 1: 18 passed, 7 failed. Missing model in synthetic pinned fixture reached MODEL_UNRESOLVED before workspace. Fixed fixture with explicit model/effort; no product change. |
| 11-focused-fixture-correction | Same suites with model fix and extra reconstruction fixture | Exit 1: 25 passed, 1 failed. Incorrectly spread defaultHandlers function omitted other handlers. Fixed call to defaultHandlers(). |
| 12-handler-registry | Inspect actual defaultHandlers/HandlerRegistry shape | Passed, exit 0. |
| 13-focused-format | Scoped prettier --write, same focused suites | Formatting passed; tests exit 1: 25 passed, 1 failed. New task facts inside the current handler correctly defeat the no-new-turn reconstruction guard. |
| 14-fixture-reachability-repair | Node script archives prior fixture bytes, moves prior-state setup to durable history | Passed, exit 0. The exact pre-repair test is `fixture-03-before.ts`. No production guard was changed. |
| 15-focused-final | Scoped prettier --write, same focused suites | Exit 0: 26 passed. |
| 16 / 16a-16d | Finite baseline/candidate controls above | Outer exit 0; expected baseline F1 exit 1; F2 and restored candidate controls pass. |
| 17-typecheck | pnpm engine typecheck | Exit 1: synthetic handler's unreachable success return lacked NodeResult fields. Corrected to explicit unexpected-success throw; no cast, assertion removal or production change. |
| 18-lint-format | pnpm engine lint; six-path prettier --check; git diff --check | Exit 0, all passed. |
| 19-controls | pnpm engine test for inference-context, inference-workspace, inference, flow, prompt-provenance, prompt-recovery, run-manager | Exit 0: 7 files / 262 tests passed. This ran before the subsequent unreachable fixture return typing correction. |
| 20-typecheck-final | pnpm engine typecheck after fixture typing correction | Exit 0. |
| 21-final-scoped-checks | Final inference-workspace suite; scoped eslint; six-path prettier --check; git diff --check | Exit 0: 12 tests passed, lint/format/diff checks passed on exact final bytes. |
| 22-final-inspection | Git stat/status/full tracked diff, A2 marker searches, full new test source | Exit 0. |
| 23-a2-control-inspection | Read unchanged A2 controls, head/tree, git diff --cached --exit-code | Exit 0; HEAD/tree unchanged and no staged diff. |
| 24-capture | Node capture of candidate/original bytes, complete patch, original inputs and source/index bindings | Exit 0; index byte-identical. Exact hashes in binding.json. |
| Final seal command, `seal.mjs` | Verify current source/index, SHA256-seal originals and driver/report records, verify every sealed hash | Result in seal-verification.json; final response reports its output. |

The finite fixture corrections and every failed outcome are listed explicitly; they are not attributed to product regressions. Environment/search corrections were separate from source test-fixture corrections. No repeated unchanged retry, assertion deletion, timeout inflation, threshold reduction or exclusion was used.

## Limits and residual risks

- No full Windows coverage, full application build, hosted Linux gate, native process, real provider, REST/MCP, or browser run was performed. No package-coverage percentage or 90/90 gate claim is made. Thresholds were left intact.
- This worker's unit/public-method evidence is distinct from the original source633 Opus QA and from fresh corrective QA. Existing QA evidence must keep its original source binding.
- The private getter is an internal engine mechanism, not a public configuration or serialized contract. It preserves only the existing diagnostic projection; no arbitrary raw error enumerable fields are copied.
- Formal actual Fable review cycle 2, independent corrective QA, fresh Astra MAX final cycle 3, exact-current-target CI/coverage, publication/freeze and all remaining delivery gates are root-owned and pending here.
- F3/F4 cleanup and D188's selected nonresumable authored time-budget rule remain unchanged. No owner-acceptance claim is made.
