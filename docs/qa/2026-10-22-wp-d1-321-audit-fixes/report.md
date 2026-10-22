# WP-D1 #321 round 3: final-audit corrections

## 1. Branch and worktree

Branch `codex-wp-d1-child-recovery`, worktree `<local>` (`.claude/worktrees/codex-wp-d1-child-recovery`), base `ccb69b812b04a4128a671c581a5c731de5bd3def`, verified before other repository work. Uncommitted; ready for orchestrator commit after review. No index, commit, push, merge, rebase, stash, branch switch, owner runtime or provider operation was performed. No directories were manually deleted.

## 2. Per bolt

**#321 / B1 — confirmed before correction, corrected.** A real marker script produced one effect. In the disposable SQLite file a trigger refused `node.progress` or `node.finished` for that run's script, separately. Both became resumable `INTERNAL_ERROR` with no script provenance; a hard API restart preserved it. Repair and explicit Resume produced a second effect. Both new regressions failed the expected code comparison: `- "code": "SCRIPT_OUTCOME_UNCERTAIN"`, `+ "code": "INTERNAL_ERROR"`. [Before native output](before-api.log.txt).

The failure recorder now checks durable script history before recording `run.failed`. A failure disposes a dispatch only when the node, visit and dispatch identities match. A generic post-dispatch bookkeeping failure becomes typed `SCRIPT_OUTCOME_UNCERTAIN`, preserving the original provenance and recovery guidance. Matching completed/start-failed provenance retains its class. This covers the handler's progress-write catch and the outer completion-write catch without edits to finalization/delivery. The same real-store tests now pass across restart, preserving count 1 until explicit Resume creates a new dispatch and count 2. [Fixed native output](api-fixed.log.txt), `apps/api/src/script-persistence-restart.test.ts`.

**#321 / B2 — confirmed before correction, corrected.** Produced an effect, killed the real API, released and observed its orphan exit, then removed only the tail dispatch event and corrected `last_event_seq`. This constructs the target build's valid unfinished prefix; no archived binary is claimed. Recovery succeeded automatically with marker count 2: `AssertionError: expected 2 to be 1 // Object.is equality`. [Before native output](before-api.log.txt).

The handler's existing visit guard now refuses re-entry after an earlier unfinished script start without a marker. It records uncertainty with the visit identity and no invented dispatch ID. The native regression passes: count 1, typed failure, no dispatch on two restarts, then one fresh dispatch and count 2 only after explicit Resume. No stored marker or migration was added. Fresh entry and completed/start-failed controls remain covered by the existing suites.

The API supplies the existing inspector's `Recover script` visibility inputs (`failed`, resumable, node ID, typed script failure) and MCP summary provenance. Web and MCP runtime presentation were not changed. This is implementer verification; independent review and QA are outstanding. B3 is owned by the orchestrator; its protected QA bundle is untouched.

## 3. Files changed

- Engine production: `packages/engine/src/handlers/script-dispatch.ts` (visit evidence, exact failure identity, classification helper); `packages/engine/src/run-manager.ts` (one import and classification before the failure append).
- Engine tests: `handlers/script-dispatch.test.ts` (generic/mismatched failure and markerless-prefix regressions, accurate typed disposition fixture); `script-recovery.test.ts` (pre-dispatch acknowledgement-loss now conservatively requires a choice).
- API test: new `apps/api/src/script-persistence-restart.test.ts`, real SQLite fault triggers and built-process restart/upgrade tests.
- Docs: CHANGELOG, numbered docs 04 and 05, guide 07, package plan and this evidence bundle.

Shared production ranges in the final tree: `run-manager.ts` line 63 and lines 1897–1910, solely failure classification; `handlers/script-dispatch.ts` line 1 and lines 7–89. Exact hunks and new-file lengths are in `changed-files.json`. No #320 child/admission logic, finalization/delivery method, admission policy, process runner/output capture, script handler, web runtime, MCP runtime or protected `docs/qa/2026-10-22-wp-d1-321-qa/` file was changed.

## 4. Tests

Every new regression and the changed pre-dispatch recovery assertion failed on the unchanged production head before correction:

- Real SQLite progress and completion refusal: expected `SCRIPT_OUTCOME_UNCERTAIN`, received `INTERNAL_ERROR` (two native failures).
- Constructed pre-change prefix: `expected 2 to be 1` (one native failure).
- Generic/different-visit/different-dispatch failures and markerless re-entry: `expected [Function] to throw an error` (four unit failures).
- Recovery after lost pre-dispatch acknowledgement: `expected [ { command: 'effect', …(5) } ] to have a length of +0 but got 1` (one changed engine regression).

[Before engine](before-engine.log.txt): five failed, eleven passed. [Fixed engine selection](engine-fixed.log.txt): 16/16 passed. [Before native](before-api.log.txt): 0/3 passed. [Fixed native](api-fixed.log.txt): 3/3 passed. The new tests use public interfaces, real storage faults and native subprocesses, with no production monkey-patching or private access.

| Package | Full result                       | Lines  | Branches | Statements | Functions |
| ------- | --------------------------------- | ------ | -------- | ---------- | --------- |
| engine  | 560 passed                        | 98.09% | 92.48%   | 96.89%     | 98.71%    |
| MCP     | 44 passed                         | 96.65% | 95.85%   | 95.07%     | 93.97%    |
| API     | 708 passed / 1 failed / 6 skipped | 97.83% | 92.90%   | 96.41%     | 94.05%    |

Coverage denominators, exclusions and thresholds are unchanged; all four metrics exceed 90% for all three packages. Direct package runs avoid Turbo test-cache reuse. The full API command remains red: the #320 zero-delay test failed at `apps/api/src/child-creation-restart.test.ts:22`, its `afterEach`, with `Error: Hook timed out in 60000ms.` Its cardinality checks logged one child for all 24 parents. This is the retained QA-321-01 fixture-disposal class; the hook alone does not establish native termination denial, so it is not relabelled D-015. The case passed unchanged once in [isolation](isolate-child-zero.log.txt): 1 passed / 2 skipped, 25.26 seconds, all 24 parents with one child. The C6 restart suite and all new regressions passed in the full run. Web source is unchanged, so the conditional web coverage/browser gate is not required this round. No historical web metrics are substituted for current evidence.

## 5. Gates

Node 22.14.0 was selected first on PATH for every pnpm command. All commands ran from this worktree root, using `pnpm.cmd`.

| Command                                                                                         | Result                                                            | Evidence                                     |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| `pnpm.cmd build` on the original head                                                           | PASS                                                              | [baseline build](before-build.log.txt)       |
| `pnpm.cmd typecheck`                                                                            | PASS, 20 tasks                                                    | [typecheck](typecheck.log.txt)               |
| `pnpm.cmd build` after correction                                                               | PASS, 11 tasks                                                    | [build](build.log.txt)                       |
| `pnpm.cmd lint`                                                                                 | PASS, 11 tasks                                                    | [lint](lint.log.txt)                         |
| `pnpm.cmd format:check`                                                                         | FAIL: 3 protected QA Markdown files                               | [format](format.log.txt)                     |
| `pnpm.cmd check:layers`                                                                         | PASS                                                              | [layers](layers.log.txt)                     |
| `pnpm.cmd check:deps`                                                                           | PASS, 0 errors / 2 existing orphan warnings                       | [dependencies](deps.log.txt)                 |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=1 --coverage.reportOnFailure` | PASS                                                              | [engine](coverage-engine.log.txt)            |
| `pnpm.cmd --filter @graphgoblin/mcp test:coverage --maxWorkers=1 --coverage.reportOnFailure`    | PASS                                                              | [MCP](coverage-mcp.log.txt)                  |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --config $apiConfig`                          | FAIL: 708 passed / 1 failed / 6 skipped; coverage thresholds pass | [API](coverage-api-admitted.log.txt)         |
| `pnpm.cmd test:recovery-process`                                                                | PASS, 1/1                                                         | [process recovery](recovery-process.log.txt) |

The temporary API configuration preserves the package's source scope and thresholds, runs one worker with serial files, reports coverage on failure, and retargets only fixture store prefixes/API ports to this round's allocation. See [configuration source](api-resource-config.mts.txt) and [resource configuration](resource-config.json), which supplies `$apiConfig` under `%TEMP%`. The first coverage launch stopped before test loading: Vite attempted its bundle cache under `<user>/node_modules/.vite-temp` and received `EPERM`. An empty cache directory under the owned temporary configuration admitted the suite; no dependency was installed or linked. [Initial admission failure](coverage-api.log.txt).

The root format check reports only `docs/qa/2026-10-22-wp-d1-321-qa/report.md`, `round-2/README.md` and `round-3/README.md`. The brief explicitly protects that bundle, so these baseline files remain untouched for the orchestrator. A diagnostic `pnpm.cmd format:check --log-level debug`, captured outside the checked tree after the original check stayed silent, also found the newly written `bundle-validation.json`; that new metadata file was formatted. Both full-run outputs are preserved, including the [diagnostic trace](format-debug.log.txt). The debug trace shows traversal of historical QA files/screenshots; no cause is inferred for the long runtime. The separate [changed-file formatting check](format-changed.log.txt) passes; it does not replace the red root gate.

The built-process recovery fixture's port start and store prefix were temporarily retargeted to 5690 and `gg-wp-d1-recovery-process-`; the exact original bytes were restored in `finally` and verified equal. No assertions were changed. Dependency warnings remain the inherited infrastructure Drizzle config and standalone script-recovery Playwright config. No schema, route or dependency changed, so generation, license checks and the web token check are not required.

## 6. Docs

Updated `docs/04-node-catalog.md:129`, `docs/05-execution-engine.md:251` and its deliberate recovery/upgrade paragraphs, `docs/guide/07-troubleshooting.md:9`, `CHANGELOG.md:7` (the bullet still ends `(#321)`) and the package plan's round-3 status. The **Upgrade:** note tells the operator that an earlier unfinished markerless script fails uncertain on recovery/next execution, to inspect external effects before Resume or Replay, or leave it failed with Cancel. No stored rewrite, reset or migration is required. No new ADR or generated reference change: this applies #278's existing deliberate external-effect recovery decision and ADR-0020, using existing events and optional provenance.

## 7. Decisions and parameters

- **Exact no-dispatch rule:** the executor durably appends a `node.started` before each handler entry. A first fresh entry with no earlier unfinished start can execute. A previous unfinished start followed by re-entry is ambiguous even without `script.dispatched`, and fails `SCRIPT_OUTCOME_UNCERTAIN` before the runner. This applies equally to pre-change active history and a current-build crash before dispatch; absence of a marker alone is not proof of no effect. The failure has the original visit ID and omits an unknown dispatch ID.
- A completion ends the visit. With no pending dispatch, a recorded failure ends that attempt; leaving a failed run still requires an explicit Resume. When a dispatch is pending, only typed failure provenance matching its node, visit and dispatch disposes it. A generic bookkeeping failure or another attempt's provenance cannot do so. Each deliberate retry records a fresh dispatch ID while retaining the visit.
- Classification occurs immediately before recording a failure, from the durable log rather than the mutable cursor alone. This handles both executor catches with one script-specific guard and preserves completed/start-failed authored evidence. If recording the failure is itself unavailable, the unmatched dispatch remains for recovery; no in-memory completion is invented as durable proof.
- No production timeout, retry limit or polling interval changed. Native regressions use the existing marker's 60-second bound, 180-second test budget and 60-second teardown budget, consistent with the existing restart tests. Polling observes actual state/effects and never silently retries a failed test.
- New explicit stores use `gg-wp-d1-` prefixes and native APIs use ports 5690–5699. `GG_WP_D1_KEEP_STORES=1` preserves this round's new regression stores. Routine existing fixture disposal is not a manual directory cleanup. No provider turn or owner service/store was used.

## 8. Caveats and open items

Implementation, native regressions, isolation and full requested coverage are complete. Typecheck, lint, layers, dependencies, build and built-process recovery passed; root formatting and full API coverage remain red as recorded above. Independent Claude review and QA must evaluate this uncommitted patch; this report does not approve PR #377 or its audited parent. No commit or GitHub mutation was made.

Non-blocking audit items remain recorded: N1 needs a client-observed failure/attempt precondition across REST/MCP/UI, outside this focused correction; N2 retains full-run failures and any single isolated outcome rather than retry-to-green; N3 safe bounded runner diagnostic capture remains open (the runner-rejection handler is unchanged); N4 inherited local-path cleanup is outside this patch. The mistaken unrestricted markerless upgrade wording was corrected. The UoW is #184/U11, not #301/U12.

Owned stores and temporary configuration are retained for orchestrator inspection under the current no-directory-deletion rule: [retained-stores.json](retained-stores.json) lists 45 directories, including nine marker stores. The marker tests observed their owned processes exit during teardown. [results.json](results.json), [coverage.json](coverage.json) and [changed-files.json](changed-files.json) record outcomes, denominators and exact hunks. No previous round's cleanup target or protected QA bundle was touched. Evidence logs use `.log.txt` so the existing `*.log` ignore rule does not hide them. The orchestrator must validate the committed bundle after its own commit; this round can validate only the uncommitted worktree.
