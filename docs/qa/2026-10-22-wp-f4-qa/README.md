# Independent QA round 2: WP-F4 / #244

**Round 5 audit qualification:** the D-029 audit's initial matrix was **88 passed, one failed**
before the intended Claude init boundary; its isolated pass does not make that a clean 89/89
gate. The historical report below is retained. See the [qualification and corrected fixture](matrix-qualification.md)
and [original failure evidence](matrix-initial-failure.json).

## Verdict and revision

**Verdict: pass for the scoped #244 functional checks on `31f485e3060532f672ecdbb0e92fc2c743807fe0`; gates remain red with named exceptions.** All 89 repeated runtime checks, all five shipped native restart cases, and all three independent Edge provenance cases passed. Engine and API coverage passed. Infrastructure has eight D-015 native process-control failures, and the shipped Edge spec has the two expected #205 picker failures. No new #244 defect was reproduced. This is not clean-CI, merge or owner-acceptance sign-off.

Worktree: `.claude/worktrees/codex-qa-wp-f4`; detached HEAD as supplied by the orchestrator. The prior round's untracked QA report/evidence were present at entry and preserved. This round changes only this evidence folder. No product/test file, dependency, Git index or branch was changed; no commit, push, merge, rebase or stash occurred. Work was performed alone.

Environment: Windows, Node `v22.14.0`, pnpm `12.8.1`, PowerShell with `pnpm.cmd`. Existing dependencies were used. Additional disposable probes used ports **5850/5851** and `%TEMP%/gg-qa-244-*` stores. As requested, the repository's shipped restart/browser/coverage programs were run unchanged, with their own fixture-selected ports and prefixes: restart used 5840; E2E and coverage select their usual disposable listeners. No action targeted the owner's 4747/4748 instance or store.

All inference evidence is **fake-provider only**: public fake harness ports and the repository's fake Node CLI processes. No installed provider CLI or paid turn was used. The Edge checks used the actual installed **Microsoft Edge 155.0.4283.62**, headless, against the built app.

## Defects and known failures

No new #244 product defect was reproduced.

| ID     | Severity / scope                           | Reproduction                                                     | Expected                             | Actual                                                          | Disposition and evidence                                                                    |
| ------ | ------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| E-205a | Existing #205 picker failure, outside #244 | Run `claude-harness.spec.ts`, narrow editor with readiness false | Readiness status text visible        | Expected status text absent; 10-second locator expectation      | Known baseline failure explicitly allowed by this brief; [edge-claude.txt](edge-claude.txt) |
| E-205b | Existing #205 picker failure, outside #244 | Same spec, narrow editor with readiness true                     | Model control visible and selectable | Hidden Model control; 60-second test deadline in `selectOption` | Known baseline failure, not a generic load timeout; [edge-claude.txt](edge-claude.txt)      |

The two standalone Edge driver construction errors are documented in [driver-corrections.txt](driver-corrections.txt): CommonJS import interop, then a text collector's assumed `main` selector. The corrected driver uses the actual Playwright export and `body`; no product fix or gate retry was involved. Earlier failed attempts stopped their children and cleared their store files.

## Coverage of requested checks

### 1. Validated result before process exit

Command: `pnpm.cmd build`, then `pnpm.cmd test:prompt-restart`. The actual shipped tests start the built API, use real SQLite and a real scripted Claude child, and hard-kill/restart the API. The CLI emits init plus a validated successful result without an assistant record, then stalls. It answers the real no-turn readiness probes, so manual admission runs through the restacked pinned-plan readiness path.

| Policy   | Steps                                                                                                                | Expected                                                                                                              | Actual                                                                                                                                                               | Result |
| -------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Previous | Complete A; B inherits its session; wait for `claude.result.hold`; read durable events; kill API; restart same store | B has `submitted` / `claude.result` with visit/turn IDs before kill, no usage/finish; recovery continues same session | `acceptanceBeforeKill: true`; run `01M5GWXV24EM3PFF6FQ8N7FYZA` succeeded; zero fresh calls, one continuation on `11111111-1111-4111-8111-111111111111`; same B visit | PASS   |
| Named    | Same recipe with named `shared` policy                                                                               | Same, without a missing-session or non-resumable stop                                                                 | `acceptanceBeforeKill: true`; run `01M5GWYWMABY0KX5MNP6KGYJNC` succeeded; zero fresh calls, one continuation on the same UUID; same B visit                          | PASS   |

Evidence: [restart.txt](restart.txt). The executed assertions also require no B `harness.usage` or `node.finished` before the kill, two B turn intents, and continuation-kind recovery on the original visit. The exact assertions and acceptance boundary are retained in [source-excerpts.txt](source-excerpts.txt). The infrastructure coverage run includes the two public-component result-acceptance tests, which additionally assert no premature B output and one acceptance event before usage after exit is released.

No before-fix execution is claimed by this QA round. The implementer's earlier failing-baseline record is background; these are fresh results on the requested head.

An additional independent collector repeated the recipe on ports **5852/5853**, retaining the actual turn and acceptance records instead of only the shipped test's boolean. Both passed: previous run `01M5GY95A9FH208V8V3N2BE8PJ`, named run `01M5GY9N02D7DX3JGBJ1G9MC6A`. Before each kill, the run was still `running`, the inherited UUID matched, `claude.result` was durable with matching visit/turn IDs, and B had neither usage/finish nor output. After restart both succeeded with no `run.failed` event, zero fresh calls, and exactly one same-session continuation on the original visit. Evidence: [result-before-exit.txt](result-before-exit.txt); collector: [result-driver.txt](result-driver.txt).

### 2. Repeated matrix and all shipped restart cases

The [89-row matrix](matrix-checks.md) records **steps, expected, actual and pass/fail for every runtime check**. [matrix.txt](matrix.txt) retains compact run/failure identifiers, flags, process exits and cleanup. [api-driver.txt](api-driver.txt) preserves the assertions used. The matrix starts the built main entry point for key/auth smoke, then composes built production container/app/stores with public external-port injection for controlled turns. `inspect()` compares REST, generated api-client and MCP `get_run` via linked MCP protocol transports and real HTTP.

| System / criterion                            | Positive and negative cases                                                                                                                                    | Actual                                                                                                               | Result |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| Three failure classes and saved authored work | CLI pre-start/arguments/auth/init/accepted/missing scenarios; fake class matrix; fresh/previous/named                                                          | Exact authored resubmission for eligible definite refusals; uncertainty never blindly resends; missing sessions stop | PASS   |
| Family eligibility / pinned refusals          | Non-retriable generic Codex versus Claude; retriable accepted cases; arguments/configuration/unsupported-policy refusals even with false positive retryability | Codex continues when safe; Claude needs retry evidence; pinned refusals stay non-resumable                           | PASS   |
| D-022                                         | A completes; B previous/named has only inherited ID and no acceptance; explicit Resume and exact intent-before-adapter crash                                   | Uncertain, non-resumable, Resume 409; zero recovery calls; no B output                                               | PASS   |
| Codex Resume                                  | Kill actual fake CLI after durable `turn.started`; Resume; also kill API before held CLI and restart                                                           | Same thread, exact continuation prompt, original logical visit, success                                              | PASS   |
| Isolation / repeated visits                   | Replay fork, subloop child, concurrent runs, two visits with refused retries                                                                                   | New visit provenance for forks/children; visit prompts `1,1,2,2`; concurrent run visits distinct                     | PASS   |
| Cancellation                                  | Cancel accepted held turn, then actual restart                                                                                                                 | Remains cancelled; zero recovery calls                                                                               | PASS   |
| Upgrade / boundaries                          | Synthetic pre-change log without turn/submission; 100001 template refusal; 100000 template and 262165 rendered prompt                                          | Warning's blind resend reproduced; oversize template 400; valid rendered prompts saved/resubmitted exactly           | PASS   |
| Restacked readiness compatibility             | All manual API matrix admissions, shipped native admissions, and full API `nested-readiness.test.ts` coverage                                                  | Cases reach intended turn boundary; no admission regression; API suite all 738 enabled tests pass                    | PASS   |

The shipped restart suite is now complete, not replaced with source reasoning or a simulated callback:

| Shipped case                | Steps / expected                                                                    | Actual                                                     | Result |
| --------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ |
| Accepted fake turn          | Wait for durable acceptance, kill built API, restart; one same-session continuation | Succeeded; original visit; no fresh start                  | PASS   |
| Unaccepted previous         | Kill after B intent with inherited ID; restart must stop                            | Typed uncertain/non-resumable, Resume 409, zero calls      | PASS   |
| Unaccepted named            | Same with named selection                                                           | Typed uncertain/non-resumable, Resume 409, zero calls      | PASS   |
| Claude result-only previous | Recipe above                                                                        | Durable result acceptance, same-session recovery succeeded | PASS   |
| Claude result-only named    | Recipe above                                                                        | Durable result acceptance, same-session recovery succeeded | PASS   |

Evidence: [restart.txt](restart.txt), **5/5**, 129.51 seconds. The ordinary script's own guarded cleanup remains unchanged.

### 3. Actual served Edge inspector

The standalone browser probes use the built web/API over fake ports, not a mocked page. For each case they correlate REST turn/submission visit and turn IDs, select both timeline rows, activate via keyboard Enter, reload, and repeat selection at **390 × 844** after the desktop **1440 × 900** check. Three screenshots were visually inspected, then removed as disposable binaries; compact DOM text and assertions are retained in [edge-provenance.txt](edge-provenance.txt). Driver: [edge-driver.txt](edge-driver.txt).

| Case                     | Expected                                                                                         | Actual                                                                                                          | Result |
| ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------ |
| Accepted                 | `harness.turn` and positive submission are selectable; same visit/turn identity; successful page | `submitted` / `fake.accepted`, matching API IDs; rows select correctly; succeeded; no page error                | PASS   |
| Uncertain                | Init-only failed turn has uncertain submission; page remains usable and displays correct failure | `delivery-uncertain`; `HARNESS_DELIVERY_UNCERTAIN` banner; matching IDs and selection across reload/narrow view | PASS   |
| Definitely not submitted | Auth refusal has no positive marker; retained authored intent and definite refusal               | `definitely-not-submitted`; `HARNESS_NOT_AUTHENTICATED` banner; matching IDs and selection                      | PASS   |

The timeline renders event type and node labels. Raw visit/turn/marker/class values were correlated through the event API; this report does not claim an additional raw-provenance detail panel exists. All three observed pages remained readable in the narrow screenshots. This is a focused inspector check, not a full accessibility audit.

The requested `claude-harness.spec.ts` ran once with **`GG_E2E_BROWSER_CHANNEL=msedge`**, `--retries=0`: **5 passed, 2 known #205 failures**. The inspector case passed its new provenance assertions and timeline selection, effort/policy artifact checks, and confirmed/unconfirmed cancellation behavior. The other passing cases cover family selection/publish/run, enabled catalogue support versus CLI readiness, settings refresh, and keeping a ready model field editable through focus refetch. Full output: [edge-claude.txt](edge-claude.txt).

## Commands, coverage and gates

Every gate uses Node 22 and direct package coverage (no Turbo coverage cache hit). Suites were not retried to green; thresholds, exclusions and committed deadlines were unchanged.

| Command                                                                                                                         | Actual                                                          | Evidence                                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                                                | Exit 0; 11 successful tasks, 5 cached                           | [build.txt](build.txt)                                         |
| `pnpm.cmd test:prompt-restart`                                                                                                  | Exit 0; 5/5 actual kill/restart cases                           | [restart.txt](restart.txt)                                     |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=1 --coverage.reportOnFailure`                                 | Exit 0; 578 passed; lines 98.06%, branches 92.45%               | [engine-coverage.txt](engine-coverage.txt)                     |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --coverage.reportOnFailure`                                    | Exit 0; 738 passed, 6 skipped; lines 97.93%, branches 93.11%    | [api-coverage.txt](api-coverage.txt)                           |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --coverage.reportOnFailure`                         | **Exit 1**; 649 passed, 8 failed; lines 98.64%, branches 94.70% | [infrastructure-coverage.txt](infrastructure-coverage.txt)     |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/claude-harness.spec.ts --retries=0 --output <temp>/gg-qa-244-edge` | Exit 1; 5 passed, 2 known #205 failures                         | [edge-claude.txt](edge-claude.txt)                             |
| `node <temp>/gg-qa-244-matrix.mjs`                                                                                              | Exit 0; 89/89                                                   | [matrix-checks.md](matrix-checks.md), [matrix.txt](matrix.txt) |
| `node <temp>/gg-qa-244-edge-provenance.mjs`                                                                                     | Corrected driver exit 0; all three actual Edge cases pass       | [edge-provenance.txt](edge-provenance.txt)                     |

The gate runner source is [gate-driver.txt](gate-driver.txt). Turbo cache-write permission warnings and PowerShell's stderr wrappers are retained separately from actual exit status. No browser or dependency download was required. Six live API tests remained skipped; no paid-provider test was enabled.

Additional common gates all passed: `pnpm.cmd typecheck --concurrency=2` (20 tasks, 10 cached; [typecheck.txt](typecheck.txt)), `pnpm.cmd lint --concurrency=2` (11 tasks, no cache hits; [lint.txt](lint.txt)), `pnpm.cmd check:docs` ([docs.txt](docs.txt)), `pnpm.cmd check:layers` ([layers.txt](layers.txt)), and `pnpm.cmd check:deps` (zero errors, one existing `drizzle.config.ts` orphan warning; [deps.txt](deps.txt)). No dependency or web production source changed, so license/token checks were not required. Final formatting and artifact checks are recorded in [final-checks.txt](final-checks.txt).

### Each infrastructure failure triaged alone

Each diagnostic uses `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run <file> --maxWorkers=1 -t <exact case name>`; the full command and output are in its linked record. All eight reproduced individually. The original full coverage gate stays **red** despite coverage above 90%; no separate SQLite/load deadline occurred in this run.

| Case                                                           | Expected                                        | Full-suite actual                                              | Isolated actual / evidence                                                                                                   | Classification                                       |
| -------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `adversarial.test.ts`: QA-LIMIT-001 child/grandchild abort     | Owned tree closes after abort                   | 30-second deadline                                             | Same deadline; [triage-tree-abort.txt](triage-tree-abort.txt)                                                                | D-015 native tree termination                        |
| `claude/process.test.ts`: deadline/output overflow             | Cutoff releases child and directory             | `EBUSY`, `gg-claude-process-BhyzWK`                            | `EBUSY`, `gg-claude-process-tCpxdj`; [triage-claude-overflow.txt](triage-claude-overflow.txt)                                | D-015 handle release                                 |
| `claude/process.test.ts`: already-aborted/running cancellation | No spawn for initial abort; active child closes | `EBUSY`, `gg-claude-process-cZYMMR`                            | `EBUSY`, `gg-claude-process-LQhW8A`; [triage-claude-cancel.txt](triage-claude-cancel.txt)                                    | D-015 cancellation/handle release                    |
| `claude/process.test.ts`: descendant termination               | Descendant marker stops growing                 | Marker still grew; cleanup `EBUSY`, `gg-claude-process-WfuhqQ` | Marker still grew; cleanup `EBUSY`, `gg-claude-process-ytzBir`; [triage-claude-descendant.txt](triage-claude-descendant.txt) | D-015 descendant shutdown; two diagnostics, one test |
| `claude/readiness.test.ts`: hang                               | Check-deadline message                          | Termination-unconfirmed message instead                        | Same mismatch; [triage-readiness-hang.txt](triage-readiness-hang.txt)                                                        | D-015 shutdown confirmation                          |
| `process/scripts.test.ts`: incomplete UTF-8 cancellation       | Cancellation before safety cleanup              | `cleanupRequired: true` at 8 seconds                           | Same assertion; [triage-utf8-cancel.txt](triage-utf8-cancel.txt)                                                             | D-015 native cancellation                            |
| `process/scripts.test.ts`: tree timeout                        | Tree closes inside test deadline                | 15-second deadline                                             | Same deadline; [triage-script-timeout.txt](triage-script-timeout.txt)                                                        | D-015 native tree termination                        |
| `process/scripts.test.ts`: abort/already-aborted               | Active tree closes after abort                  | 15-second deadline                                             | Same deadline; [triage-script-abort.txt](triage-script-abort.txt)                                                            | D-015 native abort/termination                       |

These were inspected from this run, not copied from the earlier report. The scoped result-acceptance tests pass; native process-control gates still require confirmation outside this sandbox. The two #205 browser failures are selector/visibility failures, not relabelled as D-015 or load problems.

## Docs, decisions and evidence provenance

- The live source uses result validation as acceptance independently of process exit, while buffering usage/completion until a verified outcome. Docs 06 describes that exact boundary. [source-excerpts.txt](source-excerpts.txt) preserves source lines and the native/browser assertions.
- D-022 / ADR-0045 remains in force for unaccepted authored work on an inherited handle. Both ordinary uncertain recovery and accepted result-only recovery were tested; no fresh-session fallback was added by QA.
- The 89-case replay/upgrade checks preserve the prior documented behavior; no history migration or compatibility path was introduced.
- The matrix fixes preflight readiness to ready to reach controlled turn failures. The shipped result recipe uses the real Claude adapter's readiness calls over the scripted CLI, and full API coverage verifies pinned root/child readiness admission. These are different evidence tiers.
- Fake CLI process results do not establish provider-side acceptance/durability. The Codex adapter cases use its public SDK-client seam over real fake child processes; native SDK executable/provider integration is outside scope.

## Files, cleanup and outside scope

Only this folder was added; product and repository test source remain unchanged. The previous round's QA artifacts were preserved. The detached revision, runtime versions and clean tracked diff are recorded in [environment.txt](environment.txt). `pnpm.cmd format:check` passed, followed by scoped formatting verification of the final report/index. Link, privacy and Git checks are in [final-checks.txt](final-checks.txt).

All dedicated API/CLI/browser handles were closed and stores cleared by the drivers. The ownership monitor recorded 151 process identities across the remaining suites; none remained alive at final audit, with no identity-check denial or forced host-process cleanup required ([process-audit.txt](process-audit.txt)). No listener remained on 5850–5853. Files in all six additional QA store directories, the disposable Edge artifact root, and six named native-fixture directories were removed; **13 roots have zero remaining files**. Screenshots were viewed and removed, with hashes recorded. No directory deletion command was issued; empty directories remain listed for orchestrator removal ([cleanup.txt](cleanup.txt)). The shipped restart fixture performed its own unchanged guarded store cleanup.

Retained evidence is text only, without API key tokens or local user paths. Task-owned scratch files are removed individually after their evidence copies and final links are verified. The evidence is uncommitted and ready for the orchestrator; no publication or merge action follows from this report.

Outside scope: real provider turns (D-005), provider retention/session availability, #33 own-session policy, #265 fresh-session recovery UI, the known #205 picker fixes, full application/browser regression, remote CI and owner acceptance. No GitHub issue/PR state was mutated.
