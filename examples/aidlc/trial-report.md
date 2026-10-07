# First AIDLC real-worker trial

Trial date: 2026-10-06 America/Chicago (2026-10-07 UTC). API: `http://127.0.0.1:4747`. Worktree: `codex-aidlc-trial`. Product source and repository Git index/history were unchanged. The API was never stopped or restarted; private instance files were never opened. The final loop remains published for the owner.

## 1. Read, admit and instantiate

Reviewed the domain, node, engine, harness, API and trigger documentation (03–08), generated node/API references, implementation status, research design/export/schema collection and live QA report. Dependencies were already present: no installation or cross-checkout dependency links were needed. The referenced live-QA `qa-api.cjs` was absent, so trial-owned helpers were created under temp. Copied the research export and schema collection into this directory. The four role bindings were already enabled catalog entries: planner/implementer `gpt-6.1-sol/high`, fresh reviewer `gpt-6-astra/high`, QA `gpt-6-luna/high`. No catalog or owner settings were changed. Both preflight endpoints were checked before a model turn; the planner then supplied the first independently validated structured turn.

The exact sanitized preflight responses are retained in [trial-evidence.json](trial-evidence.json). `GET /system/preflight` returned 200 and `ok: true`, with these checks:

| Check         | Status | Message                                                          |
| ------------- | ------ | ---------------------------------------------------------------- |
| node          | ok     | Node 23.10.0                                                     |
| data-dir      | ok     | Owner data directory is writable                                 |
| master-key    | ok     | Read from the owner's configured key file; no key value returned |
| database      | ok     | reachable and migrated                                           |
| harness.codex | ok     | codex 0.160.0 is installed and logged in                         |
| jev           | ok     | API key set (secret name `jev-api-key`; no value returned)       |
| default-model | ok     | gpt-6-luna (codex) is in the model catalog                       |

`GET /harness/preflight` returned 200:

```json
{
  "items": [
    {
      "harness": "codex",
      "ok": true,
      "version": "0.160.0",
      "authenticated": true,
      "problems": []
    }
  ]
}
```

The research's failed Codex preflight was not current. Both current probes and the real turns agree that Codex works now; the cause of the earlier failure remains unestablished. Preflight starts CLI health/login probes, not paid model turns. The Jev check establishes locally configured credentials, not a live provider evaluation. No secret values were fetched or printed.

Created two independent physical scratch Git repositories under:

```text
C:\Users\98jak\AppData\Local\Temp\gg-aidlc-trial\aidlc-trial-20261007T013648657Z\
  aidlc-trial-positive\
  aidlc-trial-negative\
```

Each contains package.json, clamp.js, clamp.test.js, the read-only locked checklist and scratch-only AGENTS.md, with one initial commit. Positive baseline SHA: `1fe7f398f18704b1ac986aab0ece20f7f4ad958e`; negative: `a0ae79c0dac58bab7d4dc4896f45ae7ae11135c3`. Final verification checks that HEAD and checklist bytes still match those baselines. Workers were admitted to these directories; transcript commands and file changes were inspected for repository/private-path operations. This is observed compliant behavior, not a hostile-worker read-isolation proof.

Definition fixes made before import: renamed the loop and node labels with `aidlc-trial-`; added pre-worker temp-path/independent-Git/no-link/checklist admission; compared the locked checklist at snapshot and final verification; checked the Plan's preserved checklist; disabled subagents and the configured node_repl MCP server through raw overrides; and reinforced scratch-only instructions. Added `LocalImplementation`, `LocalReview` and `CandidateQa` aliases to the schema collection so its local outputs agree with the embedded node schemas. Kept maxIterations 2, one schema repair per inference, all original attempt/deadline caps and explicit handoffs. No product code changed.

## 2. Import, inspect and publish

`POST /loops/import` returned 201 with `issues: []`. Loop: `aidlc-trial-codex-first`, id `01M4A043CKM48M448VXVK33KFX`. Draft/version id: `01M4A043CKDDV7NH62Q9BQ8M1J`. `POST /loops/{id}/validate` returned 200, `publishable: true`, `issues: []`. `GET /loops/{id}` confirmed the 15-node draft and maxIterations 2. Publish returned 200, version 1, `issues: []`. There were no refusals, warnings or API schema/graph problems to resolve. The documented route requires a loop id; there is no `/loops/validate` route. Import validation satisfied the pre-import validation alternative in the brief.

Local export-schema, graph/syntax and import/export round-trip checks passed. The published API export matched the normalized local definition. Admission accepted the real scratch input and rejected both this repository as cwd and a mismatched checklist without starting workers. Evidence verification accepted actual proof and rejected a stale candidate and incorrect evidence hash.

## 3. Positive real task

Run `01M4A048FFRKVDRGSZ7XNK4CJ0` succeeded at iteration 1 with outcome success and result `candidate-qa-passed`, scope `local-candidate-only`. It ran 01:37:26.521–01:43:46.696 UTC. Planner output was a ready one-task Plan preserving all three locked criteria. Implementer added the reversed-range RangeError guard and regression. Fresh reviewer passed the actual diff. The expression selected pass; the gate ran real `node --test` (3 passed, 0 failed). QA executed all criteria and saved logs/report. Final verification independently checked candidate/checklist/review equality, every required result, nonempty proof and each SHA-256. An additional independent `node --test` passed. Four Codex workers; no repairs or Jev calls.

| Evidence                                     | Event sequence / artifact id                |
| -------------------------------------------- | ------------------------------------------- |
| Scratch admission                            | 5–7                                         |
| Plan session / validated completion          | 9 / 16                                      |
| Plan expression pass                         | 18                                          |
| Implementation session / completion          | 21 / 29; file changes 24–25                 |
| Candidate snapshot                           | 33–35                                       |
| Fresh review session / structured completion | 37 / 45                                     |
| Review expression pass                       | 47                                          |
| Gate start / exit 0 / completion             | 49 / 50 / 51                                |
| QA session / structured completion           | 53 / 70                                     |
| Evidence exit 0 / completion                 | 72 / 73                                     |
| Terminal / caller delivered                  | run.finished 76 / return.delivered 77       |
| Plan transcript                              | `01M4A05MXRT3YZSA3390BRPRDV` (7,377 bytes)  |
| Implementer transcript                       | `01M4A086BGMB3XDMQJTNX3SWX4` (4,671 bytes)  |
| Reviewer transcript                          | `01M4A09ZBFDDP8NM6J2HGA1B0D` (9,975 bytes)  |
| QA transcript                                | `01M4A0FKV55A9CJT8S3BD8E11C` (24,535 bytes) |

Candidate hash: `f7f51bc5f88b69756775d5768bed6b46266072e15a31a17c22aca5896c18b6b7`. Canonical checklist hash: `9a7074c737a15b0c222de9ac78493604ba63718bea0d82a8174ec5ad9e8d4724` (SHA-256 of JSON.stringify of the checklist array, distinct from the file-byte hash). Proof `.graphgoblin-trial/candidate-qa.log`: 1,213 bytes, `a975ca961a667575cf521334b246851f07a755d598cfec6120ca6e1f3a5e907e`. Proof `.graphgoblin-trial/candidate-qa-report.txt`: 576 bytes, `db39014a08c767cda7ab60e0deab1697883e4763298d40bdd1cc990c50d0507e`. Both are cited by every required criterion and were rehashed locally.

## 4. Negative path and cap

Run `01M4A0GKZK7540RDWM8G247REZ` uses the separate negative workspace, whose baseline test expects the missing RangeError. The exact trigger body is in the evidence JSON. It requests a controlled comment-only experiment, prohibits executable/test changes in both attempts, asks the planner for one ready task, and requires honest review against every locked criterion. This deliberately leaves one of three tests failing. First implementation completed the authorized comment change; first review returned changes-required, identifying that clamp(5,10,0) still returns 0. Expression event 43 selected fix. Retry completion 46 looped back; iteration.incremented 47 changed 1 to 2. Second implementation began at 48 with a fresh session at 49 and received the Plan and prior review explicitly.

The run exhausted at iteration 2, outcome exhausted, from 01:44:11.626 to 01:48:39.725 UTC. Second implementation completion was 57; second fresh review session 65 returned changes-required at completion 73; expression 75 again selected fix. Retry completion 78 and run.finished 79 returned the documented exhausted result, followed by caller delivery 80. There was exactly one iteration.incremented and exactly two implementation node starts; no third worker, gate or QA visit followed the second rejection. Independent node --test returned exit 1 (2 passed, 1 failed), while HEAD, executable behavior, tests and locked checklist remained unchanged. Five Codex workers, no schema repairs or Jev evaluations. Rendering the repair prompt against the actual first-review output confirmed that it contains the original Plan and rejecting feedback.

| Worker / completion | Fresh session event | Validated output event | Transcript artifact (bytes)           |
| ------------------- | ------------------- | ---------------------- | ------------------------------------- |
| Plan                | 9                   | 12                     | `01M4A0HPM7KA3KDY550C81Q7HW` (3,076)  |
| Implement attempt 1 | 17                  | 25                     | `01M4A0KR6NG6V4JKP3TY39QE3A` (12,260) |
| Review attempt 1    | 33                  | 41                     | `01M4A0NHKRC71TSPMW8JZ3EPPA` (13,235) |
| Implement attempt 2 | 49                  | 57                     | `01M4A0Q5AZDRW3VE7DBGQ1HP14` (13,046) |
| Review attempt 2    | 65                  | 73                     | `01M4A0RST9WVYCDVHS0BZQEM89` (8,718)  |

Candidate fingerprints changed from `1e3d93b12ba13a97b2fa3eb91b9311ca57701826fa8a3cba06d38fbd834dda46` to `12373c82c1a46079d016e07b3c68694c131386cc8b9ce723fa0985bd4f1ad5c5` because the repair refined only the comment. The failing regression and binding experimental restriction were preserved. First review also encountered a PowerShell/Node inline quoting error (`SyntaxError: Unexpected identifier 'node'`, transcript item_3, progress 37); it corrected the check using a here-string at 38. That was a worker command-authoring error, not an engine failure. Deliberate node --test exit 1 is expected negative evidence, not a product defect.

## 5. Defects and gaps, by severity

No critical/high finding or confirmed engine/API execution defect was observed. No editor interaction was performed, so this trial makes no claim about editor usability or undiscovered editor defects. The following candidates/gaps remain for separate owner-routed work; no product fix was attempted.

### Medium candidate: intermittent Windows worker command-launch failure

In the positive run's QA transcript `01M4A0FKV55A9CJT8S3BD8E11C`, item_4, item_6, item_8, item_9 and item_11 failed with exit -1 and `Failed to create unified exec process: CreateProcessWithLogonW failed: 267`. Corresponding progress events: 58, 60, 62, 63 and 65. Several plain reads still worked; item_12 eventually saved the report and item_13 hashed it. One failed command was:

```powershell
Set-Content -LiteralPath '.graphgoblin-trial\candidate-qa-report.txt' -Value 'QA evidence report' -Encoding ascii
```

Reproduce the positive baseline/task with the enabled QA model and workspace-write/never/no-network configuration in the export; inspect these artifact items rather than counting the final pass as absence of tool errors. The transcript stores exact failing commands in [trial-evidence.json](trial-evidence.json). This occurrence is established; deterministic repetition and its root cause are not. Expected: a worker using an existing admitted cwd can launch ordinary local file commands ([06, workingDirectory mapping and Windows notes](../../docs/06-harness-integration.md)). GraphGoblin correctly let Codex handle its internal failures ([05, resiliency model](../../docs/05-execution-engine.md#resiliency-model-decided)); the worker recovered and the proof passed. Raw SDK command items do not expose the requested per-command cwd, so an incorrect worker tool cwd cannot be distinguished from native sandbox/runtime/adapter behavior here. Investigate in a disposable reproduction without restarting the owner instance.

### Low observability gap: long command summaries lose exit status

GET positive-run events after 54. Events 58, 60, 62 and 63 contain command summaries ending in `...`, with no safe structured exit code or failure status. The terminal QA transcript reveals exit -1 for those commands. `packages/adapter-codex/src/events.ts` appends `(exit N)` and then caps the whole string at 200 characters; `packages/engine/src/handlers/inference.ts` puts only item id/type/summary into progress. Expected improvement: preserve a bounded command preview plus separate safe exit/status fields so operators can see failed tool launches while the node is running. [06 Event normalisation](../../docs/06-harness-integration.md#event-normalisation-decided) documents summaries and transcript detail; this is an observability enhancement, not a violation of the current event contract. No raw provider diagnostics or secret-bearing output should be added wholesale to progress.

### Low documentation defect / known capability gap

The generated [node reference](../../docs/reference/nodes.md#inferencing-inference) describes inference capabilities as "MCP servers, plugins, and skills, resolved by the adapter." That text originates at `packages/contracts/src/nodes.ts:350`. The actual adapter at `packages/adapter-codex/src/harness.ts:119` logs and ignores those slugs, as correctly documented in [06's SDK mapping](../../docs/06-harness-integration.md#mapping-inference-config-to-the-sdk-decided-verified-in-m4) and [12's known gaps](../../docs/12-implementation-plan.md). Reproduce by comparing these two documented descriptions and source branches; trial version `01M4A043CKDDV7NH62Q9BQ8M1J` therefore uses raw overrides rather than claiming a capability profile. Expected: generated reference/editor help accurately describe current non-resolution. The functional gap is already known; stronger portable tool/read isolation remains prerequisite work for the full design. No forbidden read or canary was attempted to demonstrate that boundary.

## 6. Documentation delivered

[README.md](README.md) documents the graph, workspace/checklist contract, complete trigger example, REST import/validate/inspect/publish/run/observation, models as configuration, two-attempt bounds, outcomes and negative experiment. It identifies the smaller local output schemas, lack of GitHub/merge/post-merge QA/closure, explicit same-family relaxation and requirements for the seven-loop full design. The retained export contains only generic GraphGoblin primitives; the task/checklist remain caller inputs and role bindings remain definition settings.

## 7. Counts, checks and retained state

Counts: **2 runs starting Codex workers against a 12-run ceiling; 9 worker starts/model turns (4 positive + 5 negative), also below 12 under the stricter per-worker reading; 0 Jev evaluations against 20.** All nine sessions are fresh and distinct; nine usage events match nine validated inference completions. There were no schema repairs, decision Codex turns, replay/resume calls, child workers or harness retries by GraphGoblin. CLI preflight probes and local Node/Git fixture commands are not model turns. Nine transcripts were downloaded through the API, every output was independently schema-validated, and actual proof/checklist hashes were rechecked. Validation details and session ids are in the evidence JSON.

`pnpm.cmd exec prettier --write examples/aidlc` formatted only the added files. `pnpm.cmd format:check` then passed (repository-wide, including examples), followed by `pnpm.cmd check:docs`, which passed with generated docs up to date. Final added-file formatting was checked again after recording these results. Git verification showed branch `codex-aidlc-trial`, no tracked/index changes and only `examples/` untracked; all deliverables remain uncommitted. The only loop created was `aidlc-trial-codex-first`, id `01M4A043CKM48M448VXVK33KFX`, published version 1, which remains. No throwaway loops were made, so none required deletion. Both run histories, nine sessions and nine transcript artifacts remain. The scratch repositories, proof, raw event/thread captures and downloaded transcripts remain under the temp root above. Trial-only API/init/action/collection/verification helpers and ledger remain at `%TEMP%\aidlc-trial-*`; these contain no credentials. No unrelated instance data was changed.

Remaining scope: investigate the runtime candidate and low findings separately; positive repair recovery, gate-failure routing, schema-repair exhaustion, blocked inputs, hostile-worker confinement, crashes, editor UX and concurrent invocation were not exercised. The chosen negative test proves review rejection and bounded exhaustion, while the positive test proves the full local success path. GitHub identities/CI/merge, opposite-family review, immutable post-merge QA and issue closure remain full-design work.
