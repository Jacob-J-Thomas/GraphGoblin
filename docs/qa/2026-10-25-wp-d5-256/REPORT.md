# WP-D5: eligibility-aware Resume and Replay (#256)

## 1. Branch and worktree

Branch `codex-wp-d5-256`, worktree `%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-d5-256`, base and unchanged HEAD `a5a600bff5d1ef7982919970011633b401c21135`. Uncommitted; ready for orchestrator commit after review and resolution of the reported baseline formatting blocker. Orchestrator owns the index and commit. No sub-agents, GitHub writes, commits, branch changes, owner ports/store or main-checkout modifications.

Runtime verified: `node --version` -> `v22.23.4`; `(Get-Command node).Source` -> `%USERPROFILE%/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe`. See [runtime evidence](runtime.log.txt). Every gate selects this runtime before pnpm. Live-provider flags were off. New disposable fixtures use system temp with `gg-wp-d5-`; API tests use 5700..5749, other test port allocation uses 5800..5949, and browser main/native script instances use 6370..6389. Turbo gate cache is isolated under system temp `gg-wp-d5-turbo`.

## 2. Per bolt

**#256 - controls match current server eligibility and explain unavailable actions.** The single engine policy returns `recovery` on the run read, consumed by the inspector and MCP. Resume/Replay recheck it with the reviewed event sequence. The API eligibility matrix exercises every refusal below, including unreadable history while preserving a readable run row, missing definitions, parent ownership, session/script choices, cancellation and shutdown. Unavailable controls expose visible, associated text. Opening or cancelling dialogs performs no command.

**Resume identity and attempt following.** API parent recovery retries the same child and root IDs. The six engine effect-boundary checks and the maintained child/failure suites cover repeated attempts, graph paths, read state and cancellation interleavings. Browser parent/child and stale-client cases verify exact IDs; the existing #116 follower is retained, with its reconciliation fixture now using a proven pre-start refusal so it does not authorize repeating known script work.

**Replay identity and repeat/stale intent protection.** A conditional `run.replay_requested` audit on the source consumes its reviewed sequence before fork admission. The fork has a new ID, recorded seed and `replayOf`; the inspector navigates to it and links the exact source. Source execution data stays unchanged except the audit sequence/history. API simultaneous and repeated commands admit one intent; browser races and actual double-clicks exercise pending controls and server refusal.

**Consumed external effects and explicit recovery.** Replay refuses graph paths, including loopbacks, which could revisit recorded external work or webhook/file deliveries. Replaying after a completed script uses recorded state without dispatching it again. Uncertain scripts require explicit consent; known completed script failures cannot use plain Resume. Missing provider sessions keep #265's separate fresh-start choice. The real marker browser spec proves no third marker when the consumed script is refused and when a fork starts after it. Provider behavior elsewhere is controlled by fakes; no live provider turn is claimed.

| API refusal code (409 unless stated) | Server check                                                                                                                                                                                       | Inspector explanation                                                                                                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RUN_ACTIVE`                         | Queued, running or waiting, or Resume admission already recorded                                                                                                                                   | This run is still active. Pause it before continuing with Resume.                                                                                                                                                                          |
| `RUN_PAUSED`                         | Replay of a paused run                                                                                                                                                                             | This run is paused. Resume continues this existing run.                                                                                                                                                                                    |
| `RUN_FINISHED`                       | Resume of a succeeded or exhausted run                                                                                                                                                             | This run has finished. Resume only continues paused runs or supported failures.                                                                                                                                                            |
| `RUN_CANCELLED`                      | Cancellation requested or cancelled                                                                                                                                                                | This run was cancelled; recovery is unavailable.                                                                                                                                                                                           |
| `FAILURE_NOT_RESUMABLE`              | Failed node has no supported retry or resolved child-session cause                                                                                                                                 | This failure cannot be resumed. Inspect its cause or choose an eligible Replay node.                                                                                                                                                       |
| `SCRIPT_CONSENT_REQUIRED`            | Current uncertain script; ordinary command lacks explicit consent                                                                                                                                  | **Resume:** The script may already have produced its effect. Choose Recover script to explicitly retry. **Replay:** Replay would retry an uncertain script. Choose Recover script to explicitly allow this effect.                         |
| `SESSION_RECOVERY_REQUIRED`          | Missing session has not been explicitly recovered                                                                                                                                                  | **Resume:** Choose Start fresh session on the failed inference run before resuming. **Replay:** Choose Start fresh session on the failed inference run before replaying.                                                                   |
| `PARENT_RECOVERY_REQUIRED`           | Failed parent identifies this exact child                                                                                                                                                          | Recovery belongs to parent run `<id>`. Open that parent to review its recovery choices.                                                                                                                                                    |
| `REPLAY_NODE_NOT_REACHED`            | Selected node absent or no recorded start                                                                                                                                                          | This run never reached this node.                                                                                                                                                                                                          |
| `DEFINITION_UNAVAILABLE`             | Pinned definition missing or refused by current contracts                                                                                                                                          | The pinned definition is unavailable or cannot execute.                                                                                                                                                                                    |
| `STATE_UNAVAILABLE`                  | Initial state or current node missing, or recovery history unreadable                                                                                                                              | The recorded starting state or current node is unavailable. Unreadable history: The recorded recovery state cannot be read. Repair or explicitly delete this history before recovering.                                                    |
| `EXTERNAL_EFFECT_CONSUMED`           | Script disposition or `SCRIPT_EXIT_CODE` proves completed execution for Resume; Replay can revisit recorded external work/delivery or a current uncertain script, even without its dispatch marker | **Resume:** The failed script already executed. Resume would repeat its external work; start a deliberate new execution instead. **Replay:** Replay here could repeat recorded external work or deliveries. Choose a node after that work. |
| `RECOVERY_STALE`                     | Observed sequence changed, another command won, or the record advanced during its recovery read                                                                                                    | The run changed since it was shown. Refresh and review its current recovery choices. **Concurrent read:** The run changed while its recovery state was being read. Refresh and review its current recovery choices.                        |
| `SHUTTING_DOWN` (503)                | Independent recovery admission closed                                                                                                                                                              | The server is shutting down. Try recovery after it restarts.                                                                                                                                                                               |
| `RUN_NOT_FOUND` (404)                | Run absent, deleted or owned by someone else                                                                                                                                                       | The inspector's run read shows the existing not-found state.                                                                                                                                                                               |

Malformed requests and authorization retain their existing transport errors. The table lists recovery eligibility, plus absence/deletion. The code and [ADR-0061](../../decisions/ADR-0061-recovery-eligibility.md) define precedence. A concurrent state change may replace an initially observed reason with the current typed refusal.

## 3. Files changed

**packages/contracts/**

- `packages/contracts/src/events.ts`
- `packages/contracts/src/run.ts`

**packages/engine/**

- `packages/engine/src/adversarial.test.ts`
- `packages/engine/src/awaited-children.test.ts`
- `packages/engine/src/child-creation.test.ts`
- `packages/engine/src/child-failure-parity.test.ts`
- `packages/engine/src/errors.ts`
- `packages/engine/src/finalization.test.ts`
- `packages/engine/src/handlers/script.test.ts`
- `packages/engine/src/own-session.test.ts`
- `packages/engine/src/recovery.test.ts`
- `packages/engine/src/replay.test.ts`
- `packages/engine/src/run-manager.test.ts`
- `packages/engine/src/run-manager.ts`
- `packages/engine/src/run-recovery.test.ts`
- `packages/engine/src/run-recovery.ts`
- `packages/engine/src/script-recovery.test.ts`
- `packages/engine/src/stored-definition.test.ts`

**apps/api/**

- `apps/api/src/api.test.ts`
- `apps/api/src/definition-pins.test.ts`
- `apps/api/src/edges.test.ts`
- `apps/api/src/guide-examples.test.ts`
- `apps/api/src/missing-session.test.ts`
- `apps/api/src/openapi-registry.ts`
- `apps/api/src/pinned-run-restart.test.ts`
- `apps/api/src/plugins/errors.ts`
- `apps/api/src/prompt-evidence-matrix.test.ts`
- `apps/api/src/prompt-failure-boundaries.test.ts`
- `apps/api/src/prompt-provenance.test.ts`
- `apps/api/src/prompt-sdk-storage-matrix.test.ts`
- `apps/api/src/recovery-eligibility.test.ts`
- `apps/api/src/repair-start.test.ts`
- `apps/api/src/replay.test.ts`
- `apps/api/src/routes/run-paging.test.ts`
- `apps/api/src/routes/runs.ts`
- `apps/api/src/script-persistence-restart.test.ts`
- `apps/api/src/script-restart.test.ts`
- `apps/api/src/shutdown-process.test.ts`
- `apps/api/src/shutdown.test.ts`
- `apps/api/src/sse-completion.test.ts`
- `apps/api/src/subloop-failure.test.ts`
- `apps/api/src/testing/test-app.ts`
- `apps/api/src/testing/thread-history.ts`
- `apps/api/src/thread-history.test.ts`
- `apps/api/src/version-migration.test.ts`

**packages/api-client/**

- `packages/api-client/openapi.json`
- `packages/api-client/src/contract.test.ts`
- `packages/api-client/src/generated/schema.ts`
- `packages/api-client/src/resources.ts`

**apps/mcp/**

- `apps/mcp/src/describe.ts`
- `apps/mcp/src/mcp.test.ts`
- `apps/mcp/src/thread-history.test.ts`
- `apps/mcp/src/tools.ts`

**apps/web/**

- `apps/web/e2e/bounded-history.spec.ts`
- `apps/web/e2e/execution-evidence.capture.ts`
- `apps/web/e2e/missing-session.spec.ts`
- `apps/web/e2e/qa.spec.ts`
- `apps/web/e2e/recovery-eligibility.spec.ts`
- `apps/web/e2e/replay-seed.spec.ts`
- `apps/web/e2e/script-recovery.spec.ts`
- `apps/web/e2e/thread-history.spec.ts`
- `apps/web/e2e/webhook-delivery.spec.ts`
- `apps/web/scripts/replay-seed-repro.ts`
- `apps/web/src/__fixtures__/fake-api.ts`
- `apps/web/src/runs/RunInspectorPage.test.tsx`
- `apps/web/src/runs/RunInspectorPage.tsx`
- `apps/web/src/runs/ScriptRecovery.test.tsx`
- `apps/web/src/runs/inspector/RunControls.tsx`
- `apps/web/src/runs/inspector/ScriptRecovery.tsx`
- `apps/web/src/runs/inspector/WaitPanel.tsx`
- `apps/web/src/runs/projections.ts`
- `apps/web/src/runs/recovery-controls.test.tsx`

**docs/**

- `docs/05-execution-engine.md`
- `docs/07-api-and-streaming.md`
- `docs/09-frontend-and-pwa.md`
- `docs/decisions/ADR-0061-recovery-eligibility.md`
- `docs/guide/03-run-and-observe.md`
- `docs/reference/api.md`

**CHANGELOG.md**

- `CHANGELOG.md`

Shared surfaces with #187/#322 are additive: appended recovery DTOs in `contracts/src/run.ts`; snapshot/read, Resume and Replay regions in `apps/api/src/routes/runs.ts`; generated client/schema/reference output; inspector controls and origin display. `run-manager.ts` edits are confined to imports/types, recovery read/policy/command serialization, Resume/Replay, and consent propagation to `resumeChild`. Other workers' admission, shutdown and thread reconstruction regions were not reformatted. Exact changed hunk ranges, including every shared tracked file, are in [shared-regions.json](shared-regions.json). WAVE ownership callouts: WP-G1 (#116/#245) shares the run read, MCP run tools, Replay region and `projections.ts` (only the new audit-event description); thread/snapshot reconstruction is untouched. WP-C2 shares `WaitPanel.tsx` (type narrowed to the stored `RunRecord`, with no wait behavior change). WP-A4 shares guide 03 and its executable examples (observed commands and no second provider invocation). WP-B1/C1 share the contracts surface (appended recovery DTOs/event fields, unchanged stored run row). Docs/05, /07 and /09 receive the recovery sections required by this bolt. WP-D4 admission, WP-C7 shutdown and WP-G1 thread implementation regions are not reformatted. After combining the parallel work, regenerate the API client and references from the combined route/schema source.

## 4. Tests

New maintained tests: `apps/api/src/recovery-eligibility.test.ts`, `packages/engine/src/run-recovery.test.ts`, `apps/web/src/runs/recovery-controls.test.tsx`, and `apps/web/e2e/recovery-eligibility.spec.ts`. Existing script recovery, parent/child, pin, attempt/thread, client/MCP and guide tests were updated for observed commands and current effect eligibility. Tests that previously repeated executed scripts now either prove refusal or use a positively identified pre-start failure for their separate retry/reconciliation purpose. Run-paging and shutdown assertions distinguish stored execution from the dynamic recovery read; guide Replay tests assert the recorded summary is reused with one provider call, rather than supplying a second provider result.

Named browser checks in `apps/web/e2e/recovery-eligibility.spec.ts`:

- "child directs recovery to its parent; two tabs Resume the same parent and child exactly once"
- "stale inspector Resume is refused after API recovery, with no second attempt"
- "two tabs Replay one observed intent into one separate linked run; repeat clicks cannot add a fork"
- "repeat browser clicks admit one Resume and one Replay intent and preserve the exact identities"

The first Edge run passed five cases and exposed two test assumptions: a global text selector also matched the closed Replay dialog, and a physical double-click produced two HTTP requests before the pending render. The child check now targets the visible associated explanation. The double-click check requires one accepted command, all additional responses to be typed 409 `RECOVERY_STALE` with explanatory text, and exactly one resumed attempt/fork in history. This implements the brief's "idempotent or refused with a clear message" criterion without claiming one HTTP request. The first failure log, text contexts and selected screenshots are included in `browser-before.log.txt` and `browser-before/`. Compressed traces are excluded from delivery; adjacent `NOT-KEPT.md` files record their sizes, original hashes and local temp filenames as required by COMMON.md D-030/D-034. Screenshot review also found the long parent explanation crowding the header; the controls now use the existing `max-w-xl` token so explanations wrap within their column.

The maintained `script-recovery.spec.ts` checks the real interrupted-script marker and then forks after the consumed script. `replay-seed.spec.ts` checks inherited counters/values at the first event; `missing-session.spec.ts` checks decline, reload, explicit fresh start and following through success. Component checks in `recovery-controls.test.tsx` cover accessible parent explanation, same-ID Resume and unavailable/cancelled/frozen-sequence Replay. The `recovery effect boundaries (#256)` engine suite covers all six effect and cancellation scenarios described above.

Verified rebuilt Edge captures: [parent-owned child recovery](screenshots/child-recovery.png), [same parent after Resume](screenshots/parent-resumed.png), [new Replay identity and source link](screenshots/replay-identity.png), [explicit script consent](screenshots/inspector-uncertain.png), and [Replay after the consumed script](screenshots/replay-after-consumed-script.png). Visual readback confirms the parent explanation and full link wrap within the header, the fork shows both exact IDs, and the consent dialog explains that the effect can repeat. The earlier crowded header is retained in `layout-before/child-recovery.png`.

Regression evidence: restoring the baseline run route from HEAD while retaining the new engine guards made the three active-read tests fail with `TypeError: Cannot read properties of undefined (reading 'resume')`. The stale repeated Replay regression returned a second 202 where 409 was required (`expected 202 to be 409`). See [baseline read](gg-wp-d5-baseline-read-2.log.txt) and [baseline Replay](baseline-repeated.log.txt). At the earlier integration point, restoring the implementation gave 21/21 focused API passes in [api-focused.log.txt](api-focused.log.txt). The controlled cancellation interleaving first returned `INVALID_STATE` instead of `RUN_CANCELLED`; after the fix all six effect-boundary checks pass. See [before](cancel-race-before.log.txt) and [after](effect-boundaries.log.txt).

An additional controlled public event-port regression at #321's pre-dispatch acknowledgement boundary confirmed that absent dispatch evidence could incorrectly allow Replay from an earlier node into the uncertain script: the engine read returned `allowed: true`, and the API returned 202 instead of 409. See [engine before](uncertainty-without-dispatch-before.log.txt) and [API before](uncertainty-api-before.log.txt). The policy now treats the recorded current uncertainty as a reachable effect independently of the marker. Only the failed script node can use the explicit consent path. The API case uses disposable SQLite through public repositories; this is policy evidence, not a native-process claim for marker absence. The repaired focused checks pass 16 API cases and 15 engine cases; see [API after](uncertainty-api-after.log.txt) and [engine after](uncertainty-engine-after.log.txt). The native browser scenario also checks that selecting an earlier node stays disabled before consent and leaves the marker count at one.

A second public-port regression removes optional script provenance from a real completed script failure while retaining its typed `SCRIPT_EXIT_CODE`. Before the guard, the policy returned `allowed: true`; see [before](known-script-exit-before.log.txt). The typed exit cause now independently refuses Resume. Afterward the script call count stays at one and the focused checks pass 16 API and 15 engine cases in `known-script-exit-api-after.log.txt` and `known-script-exit-engine-after.log.txt`.

A fast-failure UI regression also reproduced two accepted Resumes from one pointer multi-click after the first continuation had failed and refreshed eligibility (`expected 2 to be 1`). See `fast-failure-doubleclick-before.log.txt`. The inspector now uses the browser click count to keep that gesture in one intent, with no custom debounce interval. A separate keyboard activation can make a new decision. The controlled server stub checks observation sequences and accepted commands, and the complete focused inspector checks pass 30 cases in `fast-failure-doubleclick-after.log.txt`. Full web coverage is refreshed after this UI change.

Controlled read/command interleavings exposed two additional consent hazards. A concurrent retry from script A to script B made the old reader attach B's observation to A's consent target (`expected a to be b`); the API mixed record version 7 with observation 15. Separately, a paused script failing during validation caused two script calls without an explicit retry flag. See `consent-observation-race-before.log.txt`, `snapshot-observation-api-before.log.txt` and `paused-script-race-before.log.txt`. The manager now reads history before its decision record, returns that same record through `getSnapshot`, refuses a raced newer record as stale, and executes the validated Resume status branch. Focused checks pass 17 engine and 18 API cases in `recovery-read-races-engine-after.log.txt` and `recovery-read-races-api-after.log.txt`. These are controlled public-port and disposable SQLite checks; no native-process claim is made for these interleavings.

Coverage uses the full changed-package denominators and unchanged thresholds. No test retry, timeout increase, coverage exclusion or threshold reduction was added. Initial concurrent engine runs hit timing checks; final commands below bound workers. The initial web run was stopped after its inspector controls test failed. A focused run exposed the concrete defect: `Found multiple elements with the text: /nope/` because a closed Replay dialog retained a second recovery error. The controls now render one error at a time; the test also waits for the server decision and pending state before further commands. See `web-controls-duplicate-error-before.log.txt` and `web-controls-focused.log.txt`. Final web coverage uses the repository-configured two workers and includes every recovery behavior change. The subsequent width-only `max-w-xl` adjustment is checked in rebuilt Edge screenshots. The interrupted, superseded web attempt is retained in `checks.json` and `web-coverage-before-pending-state.log.txt`; it is not a final coverage result. Failed runs remain recorded with the required host redactions; final gate exits are reported without treating an earlier failed run as success.

| Package    | Lines   | Branches | Functions | Statements | Gate exit |
| ---------- | ------- | -------- | --------- | ---------- | --------- |
| contracts  | 99.74%  | 95.00%   | 100.00%   | 99.51%     | 0         |
| engine     | 97.02%  | 91.16%   | 97.43%    | 95.78%     | 0         |
| API        | 97.36%  | 92.30%   | 93.49%    | 95.61%     | 0         |
| API client | 100.00% | 98.42%   | 100.00%   | 99.35%     | 0         |
| MCP        | 96.74%  | 93.99%   | 94.11%    | 95.18%     | 0         |
| web        | 98.62%  | 94.50%   | 97.95%    | 97.68%     | 0         |

## 5. Gates

| Command                                                                                                                                                                  | Exit | Evidence                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | -------------------------------------------------------- |
| `pnpm.cmd build`                                                                                                                                                         | 0    | [build.log.txt](build.log.txt)                           |
| `pnpm.cmd typecheck`                                                                                                                                                     | 0    | [typecheck.log.txt](typecheck.log.txt)                   |
| `pnpm.cmd lint`                                                                                                                                                          | 0    | [lint.log.txt](lint.log.txt)                             |
| `pnpm.cmd format:check`                                                                                                                                                  | 1    | [format.log.txt](format.log.txt)                         |
| `pnpm.cmd check:layers`                                                                                                                                                  | 0    | [layers.log.txt](layers.log.txt)                         |
| `pnpm.cmd check:deps`                                                                                                                                                    | 0    | [deps.log.txt](deps.log.txt)                             |
| `pnpm.cmd check:docs`                                                                                                                                                    | 0    | [docs.log.txt](docs.log.txt)                             |
| `pnpm.cmd check:tokens`                                                                                                                                                  | 0    | [tokens.log.txt](tokens.log.txt)                         |
| `pnpm.cmd check:migrations`                                                                                                                                              | 0    | [migrations.log.txt](migrations.log.txt)                 |
| `pnpm.cmd --filter @graphgoblin/contracts test:coverage --maxWorkers=1`                                                                                                  | 0    | [contracts-coverage.log.txt](contracts-coverage.log.txt) |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=1`                                                                                                 | 0    | [client-coverage.log.txt](client-coverage.log.txt)       |
| `pnpm.cmd --filter @graphgoblin/mcp test:coverage --maxWorkers=1`                                                                                                        | 0    | [mcp-coverage.log.txt](mcp-coverage.log.txt)             |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=1 --coverage.reportOnFailure`                                                                          | 0    | [engine-coverage.log.txt](engine-coverage.log.txt)       |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2`                                                                                                        | 0    | [api-coverage.log.txt](api-coverage.log.txt)             |
| `python %USERPROFILE%/AppData/Local/Temp/gg-wp-d5-final-format.py`                                                                                                       | 0    | [changed-format.log.txt](changed-format.log.txt)         |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2`                                                                                                        | 0    | [web-coverage.log.txt](web-coverage.log.txt)             |
| `pnpm.cmd exec playwright test e2e/recovery-eligibility.spec.ts e2e/script-recovery.spec.ts e2e/replay-seed.spec.ts e2e/missing-session.spec.ts --retries=0 --workers=1` | 0    | [browser.log.txt](browser.log.txt)                       |
| `pnpm.cmd docs:generate`                                                                                                                                                 | 0    | [generate-docs.log.txt](generate-docs.log.txt)           |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                                                                                                     | 0    | [generate-client.log.txt](generate-client.log.txt)       |
| `pnpm.cmd exec playwright test e2e/bounded-history.spec.ts --retries=0 --workers=1 --output %USERPROFILE%/AppData/Local/Temp/gg-wp-d5-history-browser-results`           | 0    | [browser-history.log.txt](browser-history.log.txt)       |

Additional regeneration commands: `pnpm.cmd docs:generate` and `pnpm.cmd --filter @graphgoblin/api-client generate` passed. Browser command runs from `apps/web`, channel `msedge`, with `--retries=0 --workers=1`. Coverage commands run directly rather than through Turbo cache. `check:licenses` was not needed because no dependency changed. The changed-file formatting helper records the expanded pnpm command in `changed-format.log.txt`. `check:deps` passes with two existing no-orphans warnings (`packages/infrastructure/drizzle.config.ts:1` and `apps/web/e2e/shutdown.config.ts:1`); these files are unchanged.

## 6. Docs

Updated docs/05, docs/07, docs/09 and the run-and-observe guide. ADR-0061 records the policy, refusal table, effect protection, observed intent claim and crash/acknowledgement limit. CHANGELOG has the #256 bullet and required caller upgrade notes, ending `(#256)`. Generated API reference, client OpenAPI and TypeScript schema are regenerated. No SQL migration or data reset is needed; reserved migration 0023 is unused.

## 7. Decisions and parameters

- Server read and both commands share one engine eligibility policy; the historical failure flag is not current permission.
- Resume retains IDs. A failed parent owns ordinary recovery of its named child; its explicit retry recursively uses the same child. A parent interrupted before adopting a failure does not own independent child recovery.
- Replay is conservative across recorded external work and loopbacks. Proven pre-start refusals consumed nothing; a completed failed script cannot be resumed. Only the current uncertain script has a dedicated repeat-effect consent path.
- Dialogs freeze the reviewed sequence. Replay consumes its intent durably before admission. A crash between the audit and admission can leave the requested fork absent; inspect the requested ID, then review a new snapshot for any new decision. No exactly-once external-effect guarantee or automatic uncertain replay is claimed.
- Coverage worker limits bound host contention; they change no business limit, deadline or retry policy. Browser retries remain zero. No new numeric product parameter was introduced.

## 8. Caveats and open items

**Observed outside scope:** Root formatting has a pre-existing blocker: `docs/qa/2026-10-25-wp-d1-integration/README.md:30` is byte-identical to HEAD and unformatted. SHA-256 `8ec7462a612a696a60f44bae3d46d09850ca097049d6be25d726a306cf12e238`; see [baseline-format.json](baseline-format.json). COMMON.md section 2 says: "Something outside scope that looks wrong goes into your report ... do not fix it." The orchestrator must handle this in its owning scope. WP-D5 adds no formatting exclusion.

Ordering required by the brief: #375 lands first. Independent review and the owner's product acceptance remain delivery gates. No unresolved owner implementation decision blocks this change: the conservative effect rule implements the stated requirement. A broader repeat-effect Replay mode would require a separate scoped decision.

Full status is determined by the gate table, including failures; this report does not waive a failing check. Evidence is UTF-8 with host identity replaced by `%USERPROFILE%`, `%COMPUTERNAME%` and `<SID>`; those substitutions also apply to captured command paths. Retained coverage/report/browser directories are left for the orchestrator to inspect and clean, per COMMON.md. No manual directory deletion was performed. No live-provider or owner-environment acceptance is claimed.
