# WP-F4 round 10: main merge resolution

## 1. Branch and worktree

Branch: codex-wp-f4-prompt-provenance. Worktree: GraphGoblin/.claude/worktrees/codex-wp-f4-prompt-provenance. HEAD: e830e31a93f3127a519cabc1421fe4df90b46f15. MERGE_HEAD: 7ab6ad807bf08fd66ec2cd0aca6ce555241734b8. The orchestrator started this merge. No index operation, commit, reset, checkout, branch change or directory deletion was performed by this worker. The two resolutions remain unstaged for the orchestrator.

## 2. Per bolt: #244

Resolved the Claude process and harness conflicts in place. Both result fields survive: fixed turn refusals on any invocation, and positive sign-out evidence only for no-turn readiness probes. The bounded stderr window supports both; no diagnostic body is added to the process result. F1's entire auth-status block matches main exactly, including successful-exit sign-out; F4's entire turn path matches HEAD exactly, including pre-init missing-session refusals, acceptance before process exit, and termination precedence.

Evidence: [resolution checks](resolution-check.json), [comparison with F4 HEAD](resolved-vs-HEAD.diff.log.txt), [comparison with main](resolved-vs-origin-main.diff.log.txt), [source fingerprints](source-sha256.json).

## 3. Files changed

Only two source files were edited: packages/infrastructure/src/claude/process.ts and packages/infrastructure/src/claude/harness.ts. The rest of this worker's changes are evidence in this folder. Shared-file resolutions (line numbers refer to the final worktree):

| File and lines                                            | Preserved invariant                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/infrastructure/src/claude/process.ts:15?16       | The opt-in flag authorizes readiness inference only (F1); the comment now distinguishes it from turn refusal inference.                                                                                                                        |
| packages/infrastructure/src/claude/process.ts:29?34       | Both fixed result fields coexist: turnRejection (F4) and notLoggedIn (F1), without a stderr body.                                                                                                                                              |
| packages/infrastructure/src/claude/process.ts:69?70,85?94 | F4 tracks/refers turn refusals on nonzero exits; F1 keeps failureState probe-only and tests positive sign-out even on exit 0, only when classifyDiagnostics is set.                                                                            |
| packages/infrastructure/src/claude/process.ts:116?131     | One bounded stderr window, collected on every invocation; all three F4 anchored refusal patterns remain exact. The joint-inference comment explains that only fixed classifications leave the buffer. Stdout is never mined for turn refusals. |
| packages/infrastructure/src/claude/harness.ts:11          | F4's PromptSubmission import remains alongside F1 readiness typing.                                                                                                                                                                            |
| packages/infrastructure/src/claude/harness.ts:225?261     | F1's full auth-status logic and comment are identical to main: structured or positive text sign-out, stdout/stderr and exit 0 included; process faults remain authoritative.                                                                   |
| packages/infrastructure/src/claude/harness.ts:379?538     | F4's unchanged turn path: conservative acceptance markers, immediate validated result acceptance, typed pre-init refusal, and termination/abort/timeout/overflow precedence. This range was preserved, not newly rewritten.                    |

The listed orchestrator resolutions were reviewed: distinct CHANGELOG paragraphs, both native acceptance CI steps, Codex's evidence-aware classifier, readiness wording and replay exception, guide failure rows including delivery status, and the turn fixture's sign-out flag. No inconsistency was found. [Staged-resolution review](staged-resolution-review.json) records the protected-file content check.

## 4. Tests

No test or fixture source was changed. Existing coverage tests exercise F1 sign-out and F4 submission behavior; the maintained failure-evidence matrix and native restart suite use the restacked built application. Final results are recorded in [gate results](gate-results.json) and the logs below.

Infrastructure: 748 tests, 740 passed and 8 failed, both in the requested run and in the diagnostic run. Fresh diagnostic coverage: 98.71% lines, 95.04% branches (97.85% statements, 97.92% functions); thresholds are unchanged. The failed gate is not described as passed. See [requested coverage run](infrastructure-coverage.log.txt), [coverage with failure reporting](infrastructure-coverage-diagnostic.log.txt), [fresh coverage summary](infrastructure-coverage-summary.json), and [individual triage results](infra-triage-results.json).

D-015 native-termination evidence, reproduced independently for all eight failing tests:

- UTF-8 cancellation: ?native process-tree cancellation must finish before fixture cleanup: expected true to be false? ([triage](triage-scripts-utf8.log.txt)).
- Timeout and abort: ?Test timed out in 15000ms? ([timeout](triage-scripts-timeout.log.txt), [abort](triage-scripts-abort.log.txt)).
- Real child/grandchild: ?Test timed out in 30000ms? ([triage](triage-adversarial-tree.log.txt)).
- Claude deadline and abort: ?EBUSY: resource busy or locked, rmdir? after failed process termination ([deadline](triage-claude-timeout.log.txt), [abort](triage-claude-abort.log.txt)).
- Claude descendant: the pulse file continued growing after cancellation, followed by locked cleanup ([triage](triage-claude-tree.log.txt)).
- Hanging readiness fixture: expected ?Claude CLI did not answer before the check deadline? but received ?Claude CLI check process did not confirm that it stopped? ([triage](triage-claude-readiness-hang.log.txt)).

Engine: 1,560 passed; 98.15% lines and 92.95% branches ([log](engine-coverage.log.txt), [summary](engine-coverage-summary.json)). Codex: 495 passed, five existing live tests skipped; 98.82% lines and 94.63% branches ([log](adapter-codex-coverage.log.txt), [summary](adapter-codex-coverage-summary.json)).

API: 1,280 passed, six existing live tests skipped; 98.04% lines and 93.25% branches, duration 965.13 seconds ([log](api-coverage.log.txt), [summary](api-coverage-summary.json)).

Maintained replay: 326/326 checks passed ([run log](replay.log.txt), [group summary](replay-summary.json)). Groups: classification-storage 72, classification-storage-followups 32, storage-outages 16, engine-pinned-followups 36, sdk-pinned-followups 24, sdk-sequences 146. Full case JSON and child logs are retained with the replay prefix. The storage-outages group includes eight previously qualified sustained-read-outage controls: no extra call while storage is unavailable, then restore and public stop/start recovery. These do not assert durable definite non-submission or an exact repair while terminal persistence is impossible.

Native restart: 5/5 passed on the single run, in 36.13 seconds ([log](restart.log.txt)). Accepted own-session work continued; unaccepted previous/named work was blocked with zero further calls; both previous/named kill-after-Claude-result cases logged acceptance before the kill, recovered successfully, and sent the continuation prompt to the recorded session. Raw executed script snapshots are retained as source-text logs, with formatted replayable copies beside them; [execution-copy metadata](execution-copies.json) distinguishes their hashes.

Other merge-sensitive cases passed, including positive sign-out on exit 0 for stdout and stderr, turn immunity to readiness fields, native missing-session refusal, and result-only acceptance before exit. No native/provider equivalence is inferred from fake harnesses.

## 5. Gates

| Gate                      | Result                                         | Evidence                                                                                                           |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Frozen install            | FAILED: global operation-lock access denied    | [log](install.log.txt), [LOCALAPPDATA attempt](install-scoped.log.txt), [XDG attempt](install-xdg.log.txt)         |
| Typecheck                 | PASS: 20 tasks                                 | [log](typecheck.log.txt)                                                                                           |
| Lint                      | PASS: 11 tasks                                 | [log](lint.log.txt)                                                                                                |
| Scoped root format        | PASS: both authorized source files unchanged   | [log](format.log.txt)                                                                                              |
| Generated docs            | PASS: current                                  | [log](check-docs.log.txt)                                                                                          |
| Build                     | PASS: 11 tasks                                 | [log](build.log.txt)                                                                                               |
| Layers / dependencies     | PASS: zero errors; one existing orphan warning | [layers](check-layers.log.txt), [dependencies](check-deps.log.txt)                                                 |
| Infrastructure coverage   | FAILED: 740 passed, 8 D-015 failures           | [requested run](infrastructure-coverage.log.txt), [diagnostic metrics](infrastructure-coverage-diagnostic.log.txt) |
| Engine coverage           | PASS: 1,560 tests                              | [log](engine-coverage.log.txt)                                                                                     |
| Codex coverage            | PASS: 495 tests; five live tests skipped       | [log](adapter-codex-coverage.log.txt)                                                                              |
| API coverage, after build | PASS: 1,280 tests; six live tests skipped      | [log](api-coverage.log.txt)                                                                                        |
| Maintained audit replay   | PASS: 326/326                                  | [log](replay.log.txt)                                                                                              |
| Native restart, once      | PASS: 5/5                                      | [log](restart.log.txt)                                                                                             |
| Final references          | Executed last; see authoritative receipt       | [log](refs-check.log.txt)                                                                                          |

Write-formatting changed no production source. The separate evidence formatter normalized only this folder?s Markdown and JSON; executed helper snapshots are retained, and the replay/restart helper source was unchanged ([evidence-format log](format-evidence.log.txt)).

The scoped root format check also passed ([log](format-check.log.txt)).

All commands use Node 22.14.0; package gates use pnpm.cmd. See [environment](environment.json) and [gate results](gate-results.json) for exact commands, exit codes, qualifications and logs. Failed commands remain failures. The requested install is blocked by pnpm's global operation-lock permission; process-local LOCALAPPDATA and XDG redirection also failed before installation. No alternate dependency checkout or link was used.

The read-only formatter-scope preflight found pre-existing unowned .tmp fixtures and exited 1 ([log](format-scope-check.log.txt)); these were explicitly ignored before write-format. No fixture was edited. The scoped root formatter selected only the two authorized files, both unchanged ([log](format.log.txt)).

The first infrastructure coverage invocation failed before collection because pnpm's shell removed backslashes from the preload path. Forward slashes fixed this verification setup. The next full run failed eight native-termination tests (740 passed), each reproduced alone. A separate diagnostic run enables coverage reporting on failure so the requested metrics can be reported; it does not lower thresholds, exclude tests or turn a failed gate green.

## 6. Docs

Docs 05 and 06 describe the merged behavior accurately and were not edited. The orchestrator's CHANGELOG union was retained. Generated references are current. This evidence folder is the only documentation added by the worker.

## 7. Decisions and parameters

The existing 8,192-character stderr window and three anchored refusal patterns are unchanged. F1's notLoggedIn flag requires classifyDiagnostics; failureState remains probe-only. No raw stderr is exposed in the result. F4's submission guard and transport precedence remain unchanged. No new product parameter or decision was introduced.

The audit now owns ports 5660?5669. The retained [replay copy](replay-5650.mjs) and [native restart copy](restart-5650.mjs) change only port allocation to 5650?5659 resolve the copied restart script's original fixture from the worktree root, and resolve its public engine/testing import from the maintained script's API package context. The Node 22 experimental-import-meta-resolve flag enables that package-context argument; it does not change test assertions. All assertions and fixtures are otherwise identical to the maintained scripts. The verification-only [listener guard](port-scope.cjs) restricts fixture listen(0) to the allocated range; it does not replace a GraphGoblin component. Temporary fixtures are under a task-owned directory with prefix gg-wp-f4-. Live provider turns: zero.

## 8. Caveats and open items

The install failure is not D-015. The test harness snapshots are controlled component evidence, not paid-provider turns; the infrastructure suite also exercised its installed-Claude no-turn preflight. The replay retains eight qualified sustained-outage controls as described above.

The install and infrastructure native-termination failures require an outside-sandbox rerun by the orchestrator. No claim of an all-green merge is made. All ten allocated ports were free after the runs ([port check](post-run-ports.json)). The five restart stores were removed by the suite; other raw fixtures/stores are retained, and D-015 descendant state remains unconfirmed ([temporary-store manifest](retained-temp.json)). No manual directory cleanup was attempted. The merge still needs orchestrator staging/commit, independent review and the next audit. The final reference check is run last; its authoritative receipt is [reference-check log](refs-check.log.txt).
