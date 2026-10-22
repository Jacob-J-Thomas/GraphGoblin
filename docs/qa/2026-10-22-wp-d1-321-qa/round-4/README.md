# Independent QA round 4: #321 citation repair

Revision: `93c22e9cddef7af5b6de7587ca14305466ba5b7c` (confirmed by git rev-parse HEAD). Detached worktree: `<repo>`, named `codex-qa-wp-d1-321`. Node 22.14.0, PowerShell. Uncommitted; ready for orchestrator commit.

This round repairs the original QA root's evidence record only. No product behavior, built API, browser, provider, native termination or coverage test was run. No original was recovered and no behavior observation was regenerated. The 28 missing paths are explicitly recorded as **original not kept** at their citations. Historical numbers, IDs, exit codes and failures remain intact. Later evidence is labelled by its actual round; it does not authenticate the lost original.

## The 28 paths

Paths below are relative to the original QA root. None of these original paths exists in supplied HEAD. The original raw-log basenames were checked in TEMP, along with the QA root and surviving QA-prefixed TEMP entries: none survived. The historic TEMP inventory now explicitly states that it is no longer a promise of availability. See [citation-dispositions.json](citation-dispositions.json).

Round 3 only rechecked the build, API suites and restart-port split. A round-3 browser/MCP/full-package gate replacement cannot be claimed. Matching retained round-2 verification is linked where available; otherwise **no equivalent replacement is claimed**. The latter losses remain losses, rather than reasons to repeat behavior in this record-only round.

| #   | Original path                      | Disposition at citation                          | Labelled replacement or limit                                                                                                                                                      |
| --- | ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `build.log`                        | Original not kept; loss recorded beside citation | [round 3: round-3/build.log.txt](../round-3/build.log.txt). Later round-3 build; different revision and duration.                                                                  |
| 2   | `contracts.log`                    | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 3   | `engine.log`                       | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 4   | `recovery-process.log`             | Original not kept; loss recorded beside citation | [round 2: round-2/recovery-process.log.txt](../round-2/recovery-process.log.txt). Later round-2 built-process recovery acceptance. Round 3 did not repeat this standalone command. |
| 5   | `restart.log`                      | Original not kept; loss recorded beside citation | [round 3: round-3/pair-2.log.txt](../round-3/pair-2.log.txt). Later round-3 script/child restart pair, six passing cases.                                                          |
| 6   | `edge.log`                         | Original not kept; loss recorded beside citation | [round 2: round-2/edge.log.txt](../round-2/edge.log.txt). Later round-2 standalone Edge acceptance. No round-3 browser replacement exists.                                         |
| 7   | `mcp.log`                          | Original not kept; loss recorded beside citation | [round 2: round-2/mcp.log.txt](../round-2/mcp.log.txt). Later round-2 focused MCP tests; not the original invocation.                                                              |
| 8   | `typecheck.log`                    | Original not kept; loss recorded beside citation | [round 2: round-2/typecheck.log.txt](../round-2/typecheck.log.txt). Later round-2 full typecheck; not the original invocation.                                                     |
| 9   | `infrastructure.log`               | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 10  | `lint.log`                         | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 11  | `layers.log`                       | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 12  | `deps.log`                         | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 13  | `docs.log`                         | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 14  | `tokens.log`                       | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 15  | `native-isolated.log`              | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 16  | `client-types.log`                 | Original not kept; loss recorded beside citation | [round 2: round-2/client-types.log.txt](../round-2/client-types.log.txt). Later round-2 generated-client compile probe.                                                            |
| 17  | `native-other-isolated.log`        | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 18  | `web.log`                          | Original not kept; loss recorded beside citation | No equivalent retained round-3 gate/isolation. Historical summary only in [gate-checks.json](../gate-checks.json) and [gates.jsonl](../gates.jsonl); original transcript not kept. |
| 19  | `format.log`                       | Original not kept; loss recorded beside citation | [round 2: round-2/format.log.txt](../round-2/format.log.txt). Later round-2 full format check; round-3 format checked its evidence only.                                           |
| 20  | `corrected-results.json`           | Original not kept; loss recorded beside citation | [round 2: round-2/corrected-results.json](../round-2/corrected-results.json). Fresh round-2 API/native/Edge/MCP observations; not recovered round-1 IDs or timestamps.             |
| 21  | `corrected-edge-observations.json` | Original not kept; loss recorded beside citation | [round 2: round-2/corrected-edge-observations.json](../round-2/corrected-edge-observations.json). Fresh round-2 dialog and timeline capture; not the original capture.             |
| 22  | `independent-results.json`         | Original not kept; loss recorded beside citation | [round 2: round-2/independent-results.json](../round-2/independent-results.json). Fresh round-2 independent matrix, including narrow/keyboard/concurrent-choice checks.            |
| 23  | `edge.log.txt`                     | Original not kept; loss recorded beside citation | [round 2: round-2/edge.log.txt](../round-2/edge.log.txt). Later round-2 standalone Edge acceptance. No round-3 browser replacement exists.                                         |
| 24  | `typecheck.log.txt`                | Original not kept; loss recorded beside citation | [round 2: round-2/typecheck.log.txt](../round-2/typecheck.log.txt). Later round-2 full typecheck; not the original invocation.                                                     |
| 25  | `mcp.log.txt`                      | Original not kept; loss recorded beside citation | [round 2: round-2/mcp.log.txt](../round-2/mcp.log.txt). Later round-2 focused MCP tests; not the original invocation.                                                              |
| 26  | `format.log.txt`                   | Original not kept; loss recorded beside citation | [round 2: round-2/format.log.txt](../round-2/format.log.txt). Later round-2 full format check; round-3 format checked its evidence only.                                           |
| 27  | `prepare-fixtures.mjs`             | Original not kept; loss recorded beside citation | [round 2: round-2/prepare-fixtures.mjs](../round-2/prepare-fixtures.mjs). Round-2 reconstructed fixture generator; recipe replacement, not original source recovery.               |
| 28  | `run-gates.ps1`                    | Original not kept; loss recorded beside citation | [round 2: round-2/run-gates.ps1](../round-2/run-gates.ps1). Round-2 reconstructed runner; recipe replacement, not original source recovery.                                        |

For native-isolation losses, the retained [taskkill diagnostic](../taskkill-diagnostic.json) is supporting evidence of the specifically observed host restriction, not either missing isolated-test transcript. Eleven gate/isolation paths have no equivalent replacement; seventeen entries have later observations or reconstructed recipes already in HEAD. No dummy log or fabricated historical result was created.

The root historical commands also mention five discarded QA fixture/configuration inputs. Their per-entry loss notes and reconstructed round-2 counterparts are in the gate record and disposition manifest. Commands in the old JSONL history are archival, not a runnable root-level recipe.

## Files changed

The existing records changed are:

- [README.md](../README.md)
- [checks.json](../checks.json)
- [gate-checks.json](../gate-checks.json)
- [report.md](../report.md)
- [retained-temp-files.json](../retained-temp-files.json)

The root report annotates every affected table/prose citation; the gate and check JSON records add adjacent structured loss/replacement metadata; the root recipe links the retained reconstructed runner; the TEMP inventory is marked historical and unavailable. Existing JSON leaf values are preserved. New scripts and records are confined to this round-4 folder and linked in its preservation manifest. No other package, source, test, original fixture, numbered product document, ADR, CHANGELOG, Git index, branch, commit or owner environment changed.

## Checks and quoted outputs

| Check                     | Steps                                                                              | Expected                                                             | Actual                                                                                     | Result / evidence                                        |
| ------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Assigned revision         | git rev-parse HEAD                                                                 | Exact assigned head                                                  | 93c22e9cddef7af5b6de7587ca14305466ba5b7c                                                   | PASS                                                     |
| Original availability     | Inspect original QA root, original raw TEMP basenames and QA-prefixed TEMP entries | Recover authentic originals or explicitly record loss                | No originals survived; 28 explicit losses                                                  | PASS, [dispositions](citation-dispositions.json)         |
| Reference repair          | Check original four records, inline notes and adjacent JSON metadata               | Every one of the audit's 48 citations has a disposition              | See semantic validation below                                                              | [validation.json](validation.json)                       |
| Historical measurements   | Compare every existing leaf of gate/check JSON against HEAD                        | Preserve original results and failures                               | All original leaves preserved                                                              | [validation.json](validation.json)                       |
| Supplied filename checker | Run the supplied external script against the QA folder                             | Quote actual output without hiding missing originals                 | Reports filenames even when explicitly labelled lost; does not parse loss metadata or JSON | [orchestrator-check.log.txt](orchestrator-check.log.txt) |
| Committed membership      | git ls-tree -r --name-only HEAD docs/qa/2026-10-22-wp-d1-321-qa                    | Retained replacements in HEAD; new record edits pending orchestrator | All cited replacement paths are in HEAD; originals explicitly not kept                     | [committed-tree.log.txt](committed-tree.log.txt)         |
| Formatting                | Focused Prettier check of changed evidence                                         | Exit 0                                                               | See retained output                                                                        | [format.log.txt](format.log.txt)                         |

The supplied checker was actually executed from the supplied external path; [its retained source](orchestrator-checker.mjs.txt) and SHA-256 in [check-results.json](check-results.json) identify it without retaining a local user directory. Command: `node <supplied-orchestrator-checker> docs\qa\2026-10-22-wp-d1-321-qa`. Its exact output (exit 1) is:

```text
docs\qa\2026-10-22-wp-d1-321-qa: 108 files, 710 citations, 17 missing: client-types.log (bare), contracts.log (bare), deps.log (bare), docs.log (bare), edge.log (bare), engine.log (bare), infrastructure.log (bare), layers.log (bare), lint.log (bare), mcp.log (bare), native-isolated.log (bare), native-other-isolated.log (bare), recovery-process.log (bare), restart.log (bare), tokens.log (bare), typecheck.log (bare), web.log (bare)
```

Its nonzero result is not relabelled a pass: it treats documented lost filenames as missing and uses a basename inventory that can accept same-named files in another round. The [supplemental validator](check-dispositions.mjs) instead checks the original references' loss annotations, retains original JSON leaves and checks replacement paths against Git HEAD. Its exact result is:

```json
{
  "status": "PASS",
  "head": "93c22e9cddef7af5b6de7587ca14305466ba5b7c",
  "auditedPaths": 28,
  "originalsRecovered": 0,
  "originalJsonReferences": 29,
  "originalMarkdownReferences": 19,
  "originalReferences": 48,
  "filenameCheckerFindingsExplicitlyLost": 17,
  "preservedOriginalJsonLeaves": 404,
  "laterReplacementEntriesInHead": 17,
  "distinctReplacementPathsInHead": 13,
  "noEquivalentReplacement": 11,
  "historicalCommandInputsExplicitlyLost": 5,
  "markdownLinksChecked": 247,
  "newArtifactCount": 12,
  "allNewArtifactsDirectlyLinked": true,
  "newRound4LinksPendingOrchestratorCommit": 30,
  "noProductOrIndexChanges": true,
  "localUserDirectoriesInNewContent": false,
  "behaviorChecksRepeated": false
}
```

Command: `git ls-tree -r --name-only HEAD docs/qa/2026-10-22-wp-d1-321-qa`. Exact output (exit 0):

```text
docs/qa/2026-10-22-wp-d1-321-qa/README.md
docs/qa/2026-10-22-wp-d1-321-qa/api.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/checks.json
docs/qa/2026-10-22-wp-d1-321-qa/child-zero-isolated.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/cleanup.json
docs/qa/2026-10-22-wp-d1-321-qa/gate-checks.json
docs/qa/2026-10-22-wp-d1-321-qa/gates.jsonl
docs/qa/2026-10-22-wp-d1-321-qa/initial-results.json
docs/qa/2026-10-22-wp-d1-321-qa/report.md
docs/qa/2026-10-22-wp-d1-321-qa/retained-temp-files.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/README.md
docs/qa/2026-10-22-wp-d1-321-qa/round-2/api.config.mts
docs/qa/2026-10-22-wp-d1-321-qa/round-2/build.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/bundle-validation.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/cleanup.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/cleanup.ps1
docs/qa/2026-10-22-wp-d1-321-qa/round-2/client-config.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/client-contract.ts
docs/qa/2026-10-22-wp-d1-321-qa/round-2/client-types.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/corrected-edge-observations.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/corrected-results.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/edge.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/format.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/gate-results.jsonl
docs/qa/2026-10-22-wp-d1-321-qa/round-2/independent-results.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/independent.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/independent.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-2/infrastructure.config.mts
docs/qa/2026-10-22-wp-d1-321-qa/round-2/mcp-provenance.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/mcp-provenance.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-2/mcp-wire.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/mcp.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/native-start.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/playwright.script-recovery.config.ts
docs/qa/2026-10-22-wp-d1-321-qa/round-2/prepare-fixtures.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-2/prepare.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/process-exit.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/recovery-process.integration.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-2/recovery-process.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/restart.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/retarget.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-2/run-gates.ps1
docs/qa/2026-10-22-wp-d1-321-qa/round-2/runtime.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/sanitize.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-2/script-recovery.browser.ts
docs/qa/2026-10-22-wp-d1-321-qa/round-2/standalone-edge-dialog.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/standalone-edge-results/.last-run.json
docs/qa/2026-10-22-wp-d1-321-qa/round-2/typecheck.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-2/verify-bundle.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-2/write-report.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-3/README.md
docs/qa/2026-10-22-wp-d1-321-qa/round-3/build.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/bundle-validation.json
docs/qa/2026-10-22-wp-d1-321-qa/round-3/cleanup.json
docs/qa/2026-10-22-wp-d1-321-qa/round-3/cleanup.ps1
docs/qa/2026-10-22-wp-d1-321-qa/round-3/cli-parsing.json
docs/qa/2026-10-22-wp-d1-321-qa/round-3/coverage-process-sample.json
docs/qa/2026-10-22-wp-d1-321-qa/round-3/coverage-requested.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/coverage-two-worker-process-sample.json
docs/qa/2026-10-22-wp-d1-321-qa/round-3/coverage-two-workers.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/earlier-admission-change.diff
docs/qa/2026-10-22-wp-d1-321-qa/round-3/final-state.json
docs/qa/2026-10-22-wp-d1-321-qa/round-3/fixture-callers.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/format.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/observe-ports.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-3/pair-1.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/pair-2.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/pair-3.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/parallel-port-overlap.json
docs/qa/2026-10-22-wp-d1-321-qa/round-3/parse-cli.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-3/port-range.diff
docs/qa/2026-10-22-wp-d1-321-qa/round-3/port-search.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/process-inventory.ps1
docs/qa/2026-10-22-wp-d1-321-qa/round-3/qa.config.mts
docs/qa/2026-10-22-wp-d1-321-qa/round-3/results.jsonl
docs/qa/2026-10-22-wp-d1-321-qa/round-3/run-checks.ps1
docs/qa/2026-10-22-wp-d1-321-qa/round-3/runtime-anchor-delta.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/sanitize.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-3/static-checks.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-3/static-results.json
docs/qa/2026-10-22-wp-d1-321-qa/round-3/summarize.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-3/summary.json
docs/qa/2026-10-22-wp-d1-321-qa/round-3/triage-child-zero.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/verify-bundle.mjs
docs/qa/2026-10-22-wp-d1-321-qa/round-3/with-subloop.log.txt
docs/qa/2026-10-22-wp-d1-321-qa/round-3/write-report.mjs
docs/qa/2026-10-22-wp-d1-321-qa/taskkill-diagnostic.json
```

This is the supplied immutable HEAD, **before the orchestrator commits these edits**. New round-4 artifacts and repaired root blobs cannot appear there yet. Existing replacement evidence does appear there; every absent original has an explicit not-kept disposition. No claim that the repaired record is already committed is made.

## Replay and preservation

From <repo>, with Node 22 first on PATH, run [repair-record.mjs](repair-record.mjs) only against the assigned head to reproduce the additive corrections from HEAD. Set QA_REF_CHECKER to the externally supplied checker path, then run [capture-checks.mjs](capture-checks.mjs). Generate this report with [write-report.mjs](write-report.mjs), run [check-dispositions.mjs](check-dispositions.mjs), regenerate this report to quote its result, then format and check the changed evidence. Capture the supplied checker again after final report changes, regenerate the report and recheck it. These scripts do not run applications, tests, paid providers or cleanup.

- [capture-checks.mjs](capture-checks.mjs)
- [check-dispositions.mjs](check-dispositions.mjs)
- [check-results.json](check-results.json)
- [citation-dispositions.json](citation-dispositions.json)
- [committed-tree.log.txt](committed-tree.log.txt)
- [format.log.txt](format.log.txt)
- [orchestrator-check.log.txt](orchestrator-check.log.txt)
- [orchestrator-checker.mjs.txt](orchestrator-checker.mjs.txt)
- [repair-record.mjs](repair-record.mjs)
- [validation.json](validation.json)
- [write-report.mjs](write-report.mjs)

## 1. Verdict

**PASS for the uncommitted record-repair scope at 93c22e9cddef7af5b6de7587ca14305466ba5b7c.** This is not a fresh behavioral verdict or merge approval. All 28 original paths are explicitly not kept, all 48 affected citations are checked for loss annotations, later evidence is labelled, and original measurements remain unchanged. Orchestrator commit and the resumed audit are still required. The filename-only checker remains nonzero for declared losses; its output is retained without suppression.

## 2. Defects

1. **B3-R4a / D-028, audit P2 evidence-record defect:** the original root claimed unavailable artifacts. Reproduction: compare those paths with the quoted HEAD tree. Expected: retained original evidence or an explicit loss disposition. Actual before repair: 48 unresolved references to 28 paths. Actual after repair: loss notes at the citations, later replacements labelled, missing raw data acknowledged. Working-tree correction complete; immutable HEAD awaits orchestrator commit. The originals remain irrecoverable. No new product defect was investigated in this round.

## 3. Coverage of criteria

For #321's round-4 record scope: assigned head confirmed; all 28 paths enumerated; each original searched and recorded as lost; original citations annotated; retained recipe linked; historical values preserved; both requested checker outputs quoted; every new artifact linked; no local user directory retained. Behavior criteria, native termination, browser consent, API/client/MCP semantics, build and package coverage were **not rerun**, as requested. No current-head product acceptance is inferred. No temporary store or application process was created; cleanup manifest for this round is empty. No directory deletion was attempted. Host-native limitations were not investigated.

## 4. Report path and evidence folder

[Round-4 report](README.md), in `docs/qa/2026-10-22-wp-d1-321-qa/round-4/`. Root annotations link back here. All new non-Markdown artifacts are linked above. No production code changed and nothing was committed.

## 5. Observations outside scope

The supplied audit's B3-R4b / D-030 also identifies a contradictory implementation-verification summary and an attempt-attribution sentence in a different evidence folder. Those files are outside this thread's assigned record repair and were not changed. The inherited #320 disposal timeout's cause remains unestablished; the older round-2/3 D-015 attribution is historical, not a new diagnosis or proof of denied process-tree termination. The specifically retained taskkill diagnostic remains separate from that teardown investigation.
