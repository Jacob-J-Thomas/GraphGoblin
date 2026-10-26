# Independent QA round 2: WP-F4 bolt #265

## 1. Verdict

**FAIL** at `08acef6cebd40e7f6acbb896d950c7de2d62e9d6`. All four new own-session policy/reset cases passed. The requested serial coverage reruns did not all pass; local coverage blockers remain. No #265 functional defect was demonstrated by these fake-provider checks. Round 1 functional recovery/refusal/restart/subloop/Edge results remain accepted by the orchestrator; this round adds the specifically missing policy/reset evidence and preserves every new gate and file-rerun result.

Branch `codex-qa-wp-f4-265`; comparison base `c63db24590d23263a3f7253eda13249f9252ec16`; worktree `%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-qa-wp-f4-265`. QA evidence is uncommitted; no production changes, index changes, commits, sub-agents or GitHub mutations. See [final-state.json](final-state.json).

Node v22.14.0, dependencies present/nonempty; fresh `pnpm.cmd build` passed (11 tasks, 9 cached). Evidence: [environment.json](environment.json), [build-result.json](build-result.json), [build.log.txt](build.log.txt). The real built API/container/engine and physical SQLite stores ran with public fake harness ports on port 6046, data directory `%USERPROFILE%\AppData\Local\Temp\gg-qa-f4-265-r2-xoHFrs`. The process exited normally through fixture IPC before coverage began; [functional-complete.json](functional-complete.json). **Provider evidence is fake-only**; no live provider turn was performed. Edge was not rerun in round 2; its accepted 1440/390 px evidence remains in the [round 1 report](../README.md).

## 2. Defects

**R2-1 — major verification blocker (adapter-codex).** Reproduce at this head with Node 22 using `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage --maxWorkers=1`. Expected: exit 0 with all tests passing and coverage above the existing thresholds. Actual: exit 1; 1 failed | 8 passed | 1 skipped (10); 2 failed | 494 passed | 5 skipped (501). No fresh coverage summary was emitted; no stale or CI percentage is substituted. Evidence: [coverage-adapter-codex.log.txt](coverage-adapter-codex.log.txt). Failing files: `src/probe-directory.test.ts`. Each listed file was rerun exactly once alone; its result follows. No production attribution is inferred from a timeout alone.

**R2-2 — major verification blocker (api).** Reproduce at this head with Node 22 using `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --config ../../docs/qa/2026-10-24-wp-f4-265-qa/round-2/api-allocation.vitest.mjs`. Expected: exit 0 with all tests passing and coverage above the existing thresholds. Actual: exit 1; 3 failed | 71 passed | 2 skipped (76); 5 failed | 1359 passed | 11 skipped (1375). No fresh coverage summary was emitted; no stale or CI percentage is substituted. Evidence: [coverage-api-corrected.log.txt](coverage-api-corrected.log.txt). Failing files: `src/prompt-sdk-storage-matrix.test.ts`, `src/shutdown-process.test.ts`, `src/subloop-restart.test.ts`. Each listed file was rerun exactly once alone; its result follows. No production attribution is inferred from a timeout alone.

| Package       | Failing test/suite                                                                                                                                                  | Recorded error excerpt                            | Evidence                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| adapter-codex | src/probe-directory.test.ts > Codex readiness probe directory > runs the fake CLI under a 226-character TEMP/TMP/TMPDIR root and removes its probe                  | Error: Test timed out in 5000ms.                  | [coverage-adapter-codex.log.txt](coverage-adapter-codex.log.txt) |
| adapter-codex | src/probe-directory.test.ts > Codex readiness probe directory > preserves 1 existing collision directories and bounds retries                                       | Error: Test timed out in 5000ms.                  | [coverage-adapter-codex.log.txt](coverage-adapter-codex.log.txt) |
| api           | src/prompt-sdk-storage-matrix.test.ts > keeps SDK/SQLite HARNESS_TERMINATION_UNCONFIRMED at launch retry=false storage=ok                                           | Error: Test timed out in 20000ms.                 | [coverage-api-corrected.log.txt](coverage-api-corrected.log.txt) |
| api           | src/shutdown-process.test.ts > native further force exits nonzero after failed stop cleanup, leaves lock, and restart reclaims it                                   | Error: Test timed out in 120000ms.                | [coverage-api-corrected.log.txt](coverage-api-corrected.log.txt) |
| api           | src/subloop-restart.test.ts > awaited subloops across process death (#242) > a hard kill around child completion leaves every parent one continuation after restart | Error: Timed out waiting for disposable API state | [coverage-api-corrected.log.txt](coverage-api-corrected.log.txt) |
| api           | src/subloop-restart.test.ts > awaited subloops across process death (#242) > the built API recovers a child finished while down with one continuation per parent    | Error: API child did not exit:                    | [coverage-api-corrected.log.txt](coverage-api-corrected.log.txt) |
| api           | src/subloop-restart.test.ts > awaited subloops across process death (#242) > the built API recovers a parent interrupted mid-wake with one continuation per parent  | Error: Timed out waiting for disposable API state | [coverage-api-corrected.log.txt](coverage-api-corrected.log.txt) |

**Resolved QA tooling issue — minor:** the initial artifact audit read a UTF-16LE build capture as UTF-8, so interleaved NULs hid one local path from the literal path check. Reproduction: apply the former UTF-8-only reader to that PowerShell capture. Expected: normalized user paths; actual: one decoded build-log path remained. The capture was converted to UTF-8 and normalized, and the audit now rejects UTF-16/non-UTF-8 or NUL-containing text. Before/after sizes, hashes and checks are retained in [artifact-repair.json](artifact-repair.json), with the earlier audit in [qa-audit-before-repair.json](qa-audit-before-repair.json). Test outcomes were unchanged.

The Codex probe-directory failures are in an unchanged file. D-032 was followed by a fresh, one-worker package run and a single file rerun. The fresh gate is still failed; this is not a waiver or a retry-to-green result. The orchestrator supplied that exact-head Linux CI run 40135298347 passed all gates; this is context from the round 2 task, not an independently fetched CI result or a replacement for local evidence. No fix was attempted.

## 3. Coverage of criteria

Systems exercised this round: strict loop-definition admission, published/pinned definitions, API missing-session and explicit-choice routes, inference own-session selection/reset counting, durable provider/session/visit/choice events, SQLite-backed session records, prompt/model/effort provenance, and adjacent Codex adapter/API/web component gates. Round 1 covers the other #265 criteria and neighbouring #33/#251/#244 behaviour.

### Policy after the explicit choice

The valid shape follows `docs/reference/nodes.md`, the current contract, and the existing public `@graphgoblin/engine/testing.singleNodeLoop` fixture. Execution limits are under `settings`; no unknown top-level `limits` key is sent. The complete definition is parsed before POST, accepted (201), published and read back. A three-pass decision and API-input waits make provider deletion happen between actual logical visits. The missing provider record is a physical file belonging to the fake harness, not a stubbed run-manager response. Source and assertions: [own-policy.mjs.txt](own-policy.mjs.txt), [gateway.mjs.txt](gateway.mjs.txt); aggregate results: [own-policy-results.json](own-policy-results.json), [checks.json](checks.json).

| Case            | Check                    | Steps                                                               | Expected                                                                    | Actual                                                                                                   | Result | Evidence                                                                         |
| --------------- | ------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| codex-no-reset  | Current definition       | Validate complete current schema, POST/publish, read pinned version | 201; no unknown top-level limits; correct configured policy                 | Accepted and published; pinned policy matched                                                            | PASS   | [codex-no-reset-definition.json](codex-no-reset-definition.json)                 |
| codex-no-reset  | Visit 1                  | Run until input wait; inspect calls and sessions                    | Fresh A; finished session row A                                             | Fresh ca76f445-a1ff-4217-8f9d-65e644dfa06b; finished row                                                 | PASS   | [codex-no-reset-visit-1.json](codex-no-reset-visit-1.json)                       |
| codex-no-reset  | Visit 2 missing          | Delete A provider file, submit wait input                           | Resume A fails with handle and resume-own origin; failed row A              | HARNESS_SESSION_MISSING; origin resume-own; A failed                                                     | PASS   | [codex-no-reset-visit-2-missing.json](codex-no-reset-visit-2-missing.json)       |
| codex-no-reset  | Plain Resume             | POST /resume at missing-session failure                             | 409, deliberate choice required                                             | 409 in traffic; no extra provider call                                                                   | PASS   | [traffic.json](traffic.json)                                                     |
| codex-no-reset  | Explicit choice          | POST recover-session for worker and observed failure sequence       | One durable choice, actor/time, failure answered, no prior context; fresh B | run.resumed seq 25, failureSeq 24, priorContextCarried false; fresh 0849c678-0342-4178-845d-3c1afc52ad2c | PASS   | [codex-no-reset-visit-2-recovered.json](codex-no-reset-visit-2-recovered.json)   |
| codex-no-reset  | Visit 3                  | Submit second wait input                                            | No reset: resume B; resetAfterVisits 2: fresh C                             | resume 0849c678-0342-4178-845d-3c1afc52ad2c; finished row                                                | PASS   | [codex-no-reset-visit-3.json](codex-no-reset-visit-3.json)                       |
| codex-no-reset  | Session announcements    | Inspect durable harness.session events                              | No resumed claim for missing provider turn                                  | fresh, fresh, resumed                                                                                    | PASS   | [codex-no-reset-visit-3.json](codex-no-reset-visit-3.json)                       |
| codex-no-reset  | Visits and completion    | Count worker turn/finished events and run.finished                  | 4 calls within 3 logical visits; 3 worker completions; run completes once   | 4 turns, 3 visits, 3 worker completions, 1 run.finished                                                  | PASS   | [codex-no-reset-visit-3.json](codex-no-reset-visit-3.json)                       |
| codex-no-reset  | Configuration/provenance | Compare pinned full version before/after; every provider request    | Policy/reset unchanged; exact authored prompt/model/effort                  | Full version deep-equal; all four calls retained authored prompt/model/effort                            | PASS   | [own-policy-results.json](own-policy-results.json)                               |
| codex-reset-2   | Current definition       | Validate complete current schema, POST/publish, read pinned version | 201; no unknown top-level limits; correct configured policy                 | Accepted and published; pinned policy matched                                                            | PASS   | [codex-reset-2-definition.json](codex-reset-2-definition.json)                   |
| codex-reset-2   | Visit 1                  | Run until input wait; inspect calls and sessions                    | Fresh A; finished session row A                                             | Fresh ffef573c-f73c-4083-8cfe-86177f7426d1; finished row                                                 | PASS   | [codex-reset-2-visit-1.json](codex-reset-2-visit-1.json)                         |
| codex-reset-2   | Visit 2 missing          | Delete A provider file, submit wait input                           | Resume A fails with handle and resume-own origin; failed row A              | HARNESS_SESSION_MISSING; origin resume-own; A failed                                                     | PASS   | [codex-reset-2-visit-2-missing.json](codex-reset-2-visit-2-missing.json)         |
| codex-reset-2   | Plain Resume             | POST /resume at missing-session failure                             | 409, deliberate choice required                                             | 409 in traffic; no extra provider call                                                                   | PASS   | [traffic.json](traffic.json)                                                     |
| codex-reset-2   | Explicit choice          | POST recover-session for worker and observed failure sequence       | One durable choice, actor/time, failure answered, no prior context; fresh B | run.resumed seq 25, failureSeq 24, priorContextCarried false; fresh ca0f8e9e-3513-44cf-a2c6-e131d3d32258 | PASS   | [codex-reset-2-visit-2-recovered.json](codex-reset-2-visit-2-recovered.json)     |
| codex-reset-2   | Visit 3                  | Submit second wait input                                            | No reset: resume B; resetAfterVisits 2: fresh C                             | fresh f6be7621-4643-4381-aafd-07087ce961e3; finished row                                                 | PASS   | [codex-reset-2-visit-3.json](codex-reset-2-visit-3.json)                         |
| codex-reset-2   | Session announcements    | Inspect durable harness.session events                              | No resumed claim for missing provider turn                                  | fresh, fresh, fresh                                                                                      | PASS   | [codex-reset-2-visit-3.json](codex-reset-2-visit-3.json)                         |
| codex-reset-2   | Visits and completion    | Count worker turn/finished events and run.finished                  | 4 calls within 3 logical visits; 3 worker completions; run completes once   | 4 turns, 3 visits, 3 worker completions, 1 run.finished                                                  | PASS   | [codex-reset-2-visit-3.json](codex-reset-2-visit-3.json)                         |
| codex-reset-2   | Configuration/provenance | Compare pinned full version before/after; every provider request    | Policy/reset unchanged; exact authored prompt/model/effort                  | Full version deep-equal; all four calls retained authored prompt/model/effort                            | PASS   | [own-policy-results.json](own-policy-results.json)                               |
| claude-no-reset | Current definition       | Validate complete current schema, POST/publish, read pinned version | 201; no unknown top-level limits; correct configured policy                 | Accepted and published; pinned policy matched                                                            | PASS   | [claude-no-reset-definition.json](claude-no-reset-definition.json)               |
| claude-no-reset | Visit 1                  | Run until input wait; inspect calls and sessions                    | Fresh A; finished session row A                                             | Fresh 0933b6e1-b96e-40ca-aa73-568ca9b50fca; finished row                                                 | PASS   | [claude-no-reset-visit-1.json](claude-no-reset-visit-1.json)                     |
| claude-no-reset | Visit 2 missing          | Delete A provider file, submit wait input                           | Resume A fails with handle and resume-own origin; failed row A              | HARNESS_SESSION_MISSING; origin resume-own; A failed                                                     | PASS   | [claude-no-reset-visit-2-missing.json](claude-no-reset-visit-2-missing.json)     |
| claude-no-reset | Plain Resume             | POST /resume at missing-session failure                             | 409, deliberate choice required                                             | 409 in traffic; no extra provider call                                                                   | PASS   | [traffic.json](traffic.json)                                                     |
| claude-no-reset | Explicit choice          | POST recover-session for worker and observed failure sequence       | One durable choice, actor/time, failure answered, no prior context; fresh B | run.resumed seq 25, failureSeq 24, priorContextCarried false; fresh 07b025bc-54e5-4113-8053-862c188ec3ef | PASS   | [claude-no-reset-visit-2-recovered.json](claude-no-reset-visit-2-recovered.json) |
| claude-no-reset | Visit 3                  | Submit second wait input                                            | No reset: resume B; resetAfterVisits 2: fresh C                             | resume 07b025bc-54e5-4113-8053-862c188ec3ef; finished row                                                | PASS   | [claude-no-reset-visit-3.json](claude-no-reset-visit-3.json)                     |
| claude-no-reset | Session announcements    | Inspect durable harness.session events                              | No resumed claim for missing provider turn                                  | fresh, fresh, resumed                                                                                    | PASS   | [claude-no-reset-visit-3.json](claude-no-reset-visit-3.json)                     |
| claude-no-reset | Visits and completion    | Count worker turn/finished events and run.finished                  | 4 calls within 3 logical visits; 3 worker completions; run completes once   | 4 turns, 3 visits, 3 worker completions, 1 run.finished                                                  | PASS   | [claude-no-reset-visit-3.json](claude-no-reset-visit-3.json)                     |
| claude-no-reset | Configuration/provenance | Compare pinned full version before/after; every provider request    | Policy/reset unchanged; exact authored prompt/model/effort                  | Full version deep-equal; all four calls retained authored prompt/model/effort                            | PASS   | [own-policy-results.json](own-policy-results.json)                               |
| claude-reset-2  | Current definition       | Validate complete current schema, POST/publish, read pinned version | 201; no unknown top-level limits; correct configured policy                 | Accepted and published; pinned policy matched                                                            | PASS   | [claude-reset-2-definition.json](claude-reset-2-definition.json)                 |
| claude-reset-2  | Visit 1                  | Run until input wait; inspect calls and sessions                    | Fresh A; finished session row A                                             | Fresh 031bdc66-31e1-4283-a1e1-acdff72b4bc1; finished row                                                 | PASS   | [claude-reset-2-visit-1.json](claude-reset-2-visit-1.json)                       |
| claude-reset-2  | Visit 2 missing          | Delete A provider file, submit wait input                           | Resume A fails with handle and resume-own origin; failed row A              | HARNESS_SESSION_MISSING; origin resume-own; A failed                                                     | PASS   | [claude-reset-2-visit-2-missing.json](claude-reset-2-visit-2-missing.json)       |
| claude-reset-2  | Plain Resume             | POST /resume at missing-session failure                             | 409, deliberate choice required                                             | 409 in traffic; no extra provider call                                                                   | PASS   | [traffic.json](traffic.json)                                                     |
| claude-reset-2  | Explicit choice          | POST recover-session for worker and observed failure sequence       | One durable choice, actor/time, failure answered, no prior context; fresh B | run.resumed seq 25, failureSeq 24, priorContextCarried false; fresh 3d6f13f9-9b88-4bc0-9194-c23e06ec500e | PASS   | [claude-reset-2-visit-2-recovered.json](claude-reset-2-visit-2-recovered.json)   |
| claude-reset-2  | Visit 3                  | Submit second wait input                                            | No reset: resume B; resetAfterVisits 2: fresh C                             | fresh bcb15a2b-461e-4560-9d6e-62f68ea57830; finished row                                                 | PASS   | [claude-reset-2-visit-3.json](claude-reset-2-visit-3.json)                       |
| claude-reset-2  | Session announcements    | Inspect durable harness.session events                              | No resumed claim for missing provider turn                                  | fresh, fresh, fresh                                                                                      | PASS   | [claude-reset-2-visit-3.json](claude-reset-2-visit-3.json)                       |
| claude-reset-2  | Visits and completion    | Count worker turn/finished events and run.finished                  | 4 calls within 3 logical visits; 3 worker completions; run completes once   | 4 turns, 3 visits, 3 worker completions, 1 run.finished                                                  | PASS   | [claude-reset-2-visit-3.json](claude-reset-2-visit-3.json)                       |
| claude-reset-2  | Configuration/provenance | Compare pinned full version before/after; every provider request    | Policy/reset unchanged; exact authored prompt/model/effort                  | Full version deep-equal; all four calls retained authored prompt/model/effort                            | PASS   | [own-policy-results.json](own-policy-results.json)                               |

### Every provider call

A is the original own conversation; B is the fresh conversation chosen on visit two; C exists only for the configured reset on visit three. The failed resume request and successful recovery are the same logical visit. All requests retain the exact authored prompt, configured model and low effort; the complete request records are in [provider-calls.json](provider-calls.json).

| Case            | Call number | Fresh/resume | Handle                                 | Result                  |
| --------------- | ----------- | ------------ | -------------------------------------- | ----------------------- |
| codex-no-reset  | 1           | fresh        | `ca76f445-a1ff-4217-8f9d-65e644dfa06b` | success                 |
| codex-no-reset  | 2           | resume       | `ca76f445-a1ff-4217-8f9d-65e644dfa06b` | HARNESS_SESSION_MISSING |
| codex-no-reset  | 3           | fresh        | `0849c678-0342-4178-845d-3c1afc52ad2c` | success                 |
| codex-no-reset  | 4           | resume       | `0849c678-0342-4178-845d-3c1afc52ad2c` | success                 |
| codex-reset-2   | 5           | fresh        | `ffef573c-f73c-4083-8cfe-86177f7426d1` | success                 |
| codex-reset-2   | 6           | resume       | `ffef573c-f73c-4083-8cfe-86177f7426d1` | HARNESS_SESSION_MISSING |
| codex-reset-2   | 7           | fresh        | `ca0f8e9e-3513-44cf-a2c6-e131d3d32258` | success                 |
| codex-reset-2   | 8           | fresh        | `f6be7621-4643-4381-aafd-07087ce961e3` | success                 |
| claude-no-reset | 9           | fresh        | `0933b6e1-b96e-40ca-aa73-568ca9b50fca` | success                 |
| claude-no-reset | 10          | resume       | `0933b6e1-b96e-40ca-aa73-568ca9b50fca` | HARNESS_SESSION_MISSING |
| claude-no-reset | 11          | fresh        | `07b025bc-54e5-4113-8053-862c188ec3ef` | success                 |
| claude-no-reset | 12          | resume       | `07b025bc-54e5-4113-8053-862c188ec3ef` | success                 |
| claude-reset-2  | 13          | fresh        | `031bdc66-31e1-4283-a1e1-acdff72b4bc1` | success                 |
| claude-reset-2  | 14          | resume       | `031bdc66-31e1-4283-a1e1-acdff72b4bc1` | HARNESS_SESSION_MISSING |
| claude-reset-2  | 15          | fresh        | `3d6f13f9-9b88-4bc0-9194-c23e06ec500e` | success                 |
| claude-reset-2  | 16          | fresh        | `bcb15a2b-461e-4560-9d6e-62f68ea57830` | success                 |

### Session records at each checkpoint

These are the real API's SQLite-backed rows, retained with full event/thread snapshots. Rows are keyed by node and attempt, so a later logical visit may update an earlier attempt row; the phase snapshots preserve the original/missing/replacement handles rather than inferring history from final rows alone.

| Case            | Checkpoint        | Attempt | Session handle                         | Status   | Evidence                                                                         |
| --------------- | ----------------- | ------- | -------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| codex-no-reset  | visit-1           | 1       | `ca76f445-a1ff-4217-8f9d-65e644dfa06b` | finished | [codex-no-reset-visit-1.json](codex-no-reset-visit-1.json)                       |
| codex-no-reset  | visit-2-missing   | 1       | `ca76f445-a1ff-4217-8f9d-65e644dfa06b` | failed   | [codex-no-reset-visit-2-missing.json](codex-no-reset-visit-2-missing.json)       |
| codex-no-reset  | visit-2-recovered | 1       | `ca76f445-a1ff-4217-8f9d-65e644dfa06b` | failed   | [codex-no-reset-visit-2-recovered.json](codex-no-reset-visit-2-recovered.json)   |
| codex-no-reset  | visit-2-recovered | 2       | `0849c678-0342-4178-845d-3c1afc52ad2c` | finished | [codex-no-reset-visit-2-recovered.json](codex-no-reset-visit-2-recovered.json)   |
| codex-no-reset  | visit-3           | 2       | `0849c678-0342-4178-845d-3c1afc52ad2c` | finished | [codex-no-reset-visit-3.json](codex-no-reset-visit-3.json)                       |
| codex-no-reset  | visit-3           | 1       | `0849c678-0342-4178-845d-3c1afc52ad2c` | finished | [codex-no-reset-visit-3.json](codex-no-reset-visit-3.json)                       |
| codex-reset-2   | visit-1           | 1       | `ffef573c-f73c-4083-8cfe-86177f7426d1` | finished | [codex-reset-2-visit-1.json](codex-reset-2-visit-1.json)                         |
| codex-reset-2   | visit-2-missing   | 1       | `ffef573c-f73c-4083-8cfe-86177f7426d1` | failed   | [codex-reset-2-visit-2-missing.json](codex-reset-2-visit-2-missing.json)         |
| codex-reset-2   | visit-2-recovered | 1       | `ffef573c-f73c-4083-8cfe-86177f7426d1` | failed   | [codex-reset-2-visit-2-recovered.json](codex-reset-2-visit-2-recovered.json)     |
| codex-reset-2   | visit-2-recovered | 2       | `ca0f8e9e-3513-44cf-a2c6-e131d3d32258` | finished | [codex-reset-2-visit-2-recovered.json](codex-reset-2-visit-2-recovered.json)     |
| codex-reset-2   | visit-3           | 2       | `ca0f8e9e-3513-44cf-a2c6-e131d3d32258` | finished | [codex-reset-2-visit-3.json](codex-reset-2-visit-3.json)                         |
| codex-reset-2   | visit-3           | 1       | `f6be7621-4643-4381-aafd-07087ce961e3` | finished | [codex-reset-2-visit-3.json](codex-reset-2-visit-3.json)                         |
| claude-no-reset | visit-1           | 1       | `0933b6e1-b96e-40ca-aa73-568ca9b50fca` | finished | [claude-no-reset-visit-1.json](claude-no-reset-visit-1.json)                     |
| claude-no-reset | visit-2-missing   | 1       | `0933b6e1-b96e-40ca-aa73-568ca9b50fca` | failed   | [claude-no-reset-visit-2-missing.json](claude-no-reset-visit-2-missing.json)     |
| claude-no-reset | visit-2-recovered | 1       | `0933b6e1-b96e-40ca-aa73-568ca9b50fca` | failed   | [claude-no-reset-visit-2-recovered.json](claude-no-reset-visit-2-recovered.json) |
| claude-no-reset | visit-2-recovered | 2       | `07b025bc-54e5-4113-8053-862c188ec3ef` | finished | [claude-no-reset-visit-2-recovered.json](claude-no-reset-visit-2-recovered.json) |
| claude-no-reset | visit-3           | 2       | `07b025bc-54e5-4113-8053-862c188ec3ef` | finished | [claude-no-reset-visit-3.json](claude-no-reset-visit-3.json)                     |
| claude-no-reset | visit-3           | 1       | `07b025bc-54e5-4113-8053-862c188ec3ef` | finished | [claude-no-reset-visit-3.json](claude-no-reset-visit-3.json)                     |
| claude-reset-2  | visit-1           | 1       | `031bdc66-31e1-4283-a1e1-acdff72b4bc1` | finished | [claude-reset-2-visit-1.json](claude-reset-2-visit-1.json)                       |
| claude-reset-2  | visit-2-missing   | 1       | `031bdc66-31e1-4283-a1e1-acdff72b4bc1` | failed   | [claude-reset-2-visit-2-missing.json](claude-reset-2-visit-2-missing.json)       |
| claude-reset-2  | visit-2-recovered | 1       | `031bdc66-31e1-4283-a1e1-acdff72b4bc1` | failed   | [claude-reset-2-visit-2-recovered.json](claude-reset-2-visit-2-recovered.json)   |
| claude-reset-2  | visit-2-recovered | 2       | `3d6f13f9-9b88-4bc0-9194-c23e06ec500e` | finished | [claude-reset-2-visit-2-recovered.json](claude-reset-2-visit-2-recovered.json)   |
| claude-reset-2  | visit-3           | 2       | `3d6f13f9-9b88-4bc0-9194-c23e06ec500e` | finished | [claude-reset-2-visit-3.json](claude-reset-2-visit-3.json)                       |
| claude-reset-2  | visit-3           | 1       | `bcb15a2b-461e-4560-9d6e-62f68ea57830` | finished | [claude-reset-2-visit-3.json](claude-reset-2-visit-3.json)                       |

### Serial package coverage and one file rerun per failure

Commands ran in order, with one worker and no other tests launched by this QA thread. Other shared-PC activity was not controlled. The API allocation config preserves every test, pool/GC/global-setup setting, timeout, coverage input and threshold. It wraps only the existing test fixture's supported resource options, including files whose explicit port options override environment defaults, to enforce ports 6040–6049 and `gg-qa-f4-265-r2-api-` stores. [api-allocation.vitest.mjs.txt](api-allocation.vitest.mjs.txt), [api-allocation.fixture.mjs.txt](api-allocation.fixture.mjs.txt), [api-allocation.log.txt](api-allocation.log.txt). The temporary executable copies were removed after use; retained scripts use `.mjs.txt`.

The first API allocation config had a QA fixture error: its suffix-only alias left a relative-path prefix before the absolute replacement. That attempt exited 1; 7 failed | 67 passed | 2 skipped (76); 8 failed | 1337 passed | 4 skipped (1349). It is retained in [coverage-api.log.txt](coverage-api.log.txt), [gates-setup-attempt.json](gates-setup-attempt.json), [coverage-complete-setup-attempt.json](coverage-complete-setup-attempt.json) and [api-allocation.vitest-setup-attempt.mjs.txt](api-allocation.vitest-setup-attempt.mjs.txt). The independently reproduced string-replacement check and corrected whole-import alias are in [allocation-alias-check.json](allocation-alias-check.json), [allocation-check.mjs.txt](allocation-check.mjs.txt) and [api-allocation.vitest.mjs.txt](api-allocation.vitest.mjs.txt). The original attempt's file reruns are also retained in the archive and artifact index. A new full API package run with that corrected resource config was necessary to exercise the missing native-test modules; [api-recheck.mjs.txt](api-recheck.mjs.txt), [api-recheck-complete.json](api-recheck-complete.json). The setup failure is not counted as a product defect or a qualifying API gate. All three corrected-gate file isolations ran after that gate. No adapter or web package gate was repeated.

The corrected config first passed a collection-only check of main.test.ts, with no test bodies executed: [api-allocation-collection.log.txt](api-allocation-collection.log.txt), [api-allocation-collection-result.json](api-allocation-collection-result.json). The initial attempt's eight executed-test timeouts (six readiness-evidence and two nested-readiness cases) are separate from the module-collection error. Their isolated passes do not erase those original failures or establish the alias as their cause.

Initial API setup-attempt file reruns (each once, retained with the failed collection and timing results):

| File                                | Exit | Test result    | Seconds | Evidence                                   |
| ----------------------------------- | ---- | -------------- | ------- | ------------------------------------------ |
| `src/main.test.ts`                  | 1    | no tests       | 9.95    | [retry-api-1.log.txt](retry-api-1.log.txt) |
| `src/retired-event-startup.test.ts` | 1    | no tests       | 6.77    | [retry-api-2.log.txt](retry-api-2.log.txt) |
| `src/shutdown-process.test.ts`      | 1    | no tests       | 1.56    | [retry-api-3.log.txt](retry-api-3.log.txt) |
| `src/shutdown-startup.test.ts`      | 1    | no tests       | 8.84    | [retry-api-4.log.txt](retry-api-4.log.txt) |
| `src/subloop-restart.test.ts`       | 1    | no tests       | 7.47    | [retry-api-5.log.txt](retry-api-5.log.txt) |
| `src/nested-readiness.test.ts`      | 0    | 19 passed (19) | 14.83   | [retry-api-6.log.txt](retry-api-6.log.txt) |
| `src/readiness-evidence.test.ts`    | 0    | 9 passed (9)   | 26.30   | [retry-api-7.log.txt](retry-api-7.log.txt) |

Exact command/timestamps/exit codes: [gates.json](gates.json); orchestration: [coverage.mjs.txt](coverage.mjs.txt); completion: [coverage-complete.json](coverage-complete.json). No thresholds were relaxed. Coverage percentages below are lines / branches / statements / functions, from fresh emitted summaries only. Orchestrator dispositions and the supplied CI context are recorded in [round-2-task.md](round-2-task.md).

| Package       | Command                                                                                                                                            | Gate | Exit | Test result                                  | Seconds | Coverage % L/B/S/F            | Evidence                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | -------------------------------------------- | ------- | ----------------------------- | ---------------------------------------------------------------- |
| adapter-codex | `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage --maxWorkers=1`                                                                        | FAIL | 1    | 2 failed \| 494 passed \| 5 skipped (501)    | 293.42  | Not emitted by failed run     | [coverage-adapter-codex.log.txt](coverage-adapter-codex.log.txt) |
| web           | `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`                                                                                  | PASS | 0    | 1705 passed (1705)                           | 3443.08 | 98.92 / 94.87 / 97.99 / 98.42 | [coverage-web.log.txt](coverage-web.log.txt)                     |
| api           | `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --config ../../docs/qa/2026-10-24-wp-f4-265-qa/round-2/api-allocation.vitest.mjs` | FAIL | 1    | 5 failed \| 1359 passed \| 11 skipped (1375) | 2482.20 | Not emitted by failed run     | [coverage-api-corrected.log.txt](coverage-api-corrected.log.txt) |

| Package       | File rerun once                         | Exit | Test result                | Seconds | Evidence                                                       |
| ------------- | --------------------------------------- | ---- | -------------------------- | ------- | -------------------------------------------------------------- |
| adapter-codex | `src/probe-directory.test.ts`           | 1    | 1 failed \| 3 passed (4)   | 30.87   | [retry-adapter-codex-1.log.txt](retry-adapter-codex-1.log.txt) |
| api           | `src/prompt-sdk-storage-matrix.test.ts` | 0    | 360 passed (360)           | 104.39  | [retry-api-corrected-1.log.txt](retry-api-corrected-1.log.txt) |
| api           | `src/shutdown-process.test.ts`          | 0    | 8 passed \| 3 skipped (11) | 331.41  | [retry-api-corrected-2.log.txt](retry-api-corrected-2.log.txt) |
| api           | `src/subloop-restart.test.ts`           | 0    | 3 passed (3)               | 376.92  | [retry-api-corrected-3.log.txt](retry-api-corrected-3.log.txt) |

Each qualifying gate's failing file was rerun once alone after that gate, using the normal timeout: one Codex file and three API files. The initial setup attempt and its seven file executions are retained separately above. A later file pass does not change the failed coverage-gate result. Detailed failure names, source lines, expectations and timeout/response excerpts are retained in the linked logs.

### Scope and limitations

| Criterion                                                                                     | Round 2 status                                                                                                               |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| #265 / #33: next own visit resumes the newly chosen conversation                              | Tested and passed for both harnesses; calls fresh A, failed resume A, fresh B, resume B.                                     |
| #265 / #33: configured reset on visit three remains effective                                 | Tested and passed for both harnesses with resetAfterVisits 2; final call fresh C.                                            |
| Configured policy/reset and authored task/model/effort unchanged                              | Tested and passed; full pinned version deep-equal and every request checked.                                                 |
| Truthful choice/session events and once-only completion                                       | Tested and passed: one choice, three logical visits, no resumed announcement for missing turn, one run.finished in each run. |
| Three requested quiet coverage reruns                                                         | Completed serially; results above. D-032 is not a coverage waiver.                                                           |
| Other #265 modes, refusals, restart points, subloops, inspector at both widths, #251 and #244 | Not rerun this round; accepted round 1 evidence remains linked from the parent report.                                       |
| Live-provider session retention/recall or native process-tree termination                     | Not testable under fake-only scope and D-015; no such claim is made.                                                         |

No new production/test implementation, numbered documentation, ADR or CHANGELOG changes were made. The requested new QA probes are retained as standalone scripts. Full typecheck/lint/layers/deps/docs/token gates were not repeated at this unchanged head; their round 1 results remain in the parent report. This round reruns build and the three specifically requested coverage gates, then checks report formatting and artifact integrity.

## 4. Report path and evidence folder

Report: `docs/qa/2026-10-24-wp-f4-265-qa/round-2/README.md`. Evidence: the same folder; all kept artifacts are linked below. The parent report points here while retaining historical round 1 results. Artifact sizes/hashes: [artifact-manifest.json](artifact-manifest.json); integrity checks: [qa-audit.json](qa-audit.json). Oversized original captures, if any: [NOT-KEPT.md](NOT-KEPT.md).

- [NOT-KEPT.md](NOT-KEPT.md)
- [allocation-alias-check.json](allocation-alias-check.json)
- [allocation-check.mjs.txt](allocation-check.mjs.txt)
- [api-allocation-collection-result.json](api-allocation-collection-result.json)
- [api-allocation-collection.log.txt](api-allocation-collection.log.txt)
- [api-allocation.fixture.mjs.txt](api-allocation.fixture.mjs.txt)
- [api-allocation.log.txt](api-allocation.log.txt)
- [api-allocation.vitest-setup-attempt.mjs.txt](api-allocation.vitest-setup-attempt.mjs.txt)
- [api-allocation.vitest.mjs.txt](api-allocation.vitest.mjs.txt)
- [api-recheck-complete.json](api-recheck-complete.json)
- [api-recheck.mjs.txt](api-recheck.mjs.txt)
- [artifact-manifest.json](artifact-manifest.json)
- [artifact-repair.json](artifact-repair.json)
- [artifact-repair.mjs.txt](artifact-repair.mjs.txt)
- [audit.mjs.txt](audit.mjs.txt)
- [build-result.json](build-result.json)
- [build.log.txt](build.log.txt)
- [checks.json](checks.json)
- [claude-no-reset-definition.json](claude-no-reset-definition.json)
- [claude-no-reset-visit-1.json](claude-no-reset-visit-1.json)
- [claude-no-reset-visit-2-missing.json](claude-no-reset-visit-2-missing.json)
- [claude-no-reset-visit-2-recovered.json](claude-no-reset-visit-2-recovered.json)
- [claude-no-reset-visit-3.json](claude-no-reset-visit-3.json)
- [claude-reset-2-definition.json](claude-reset-2-definition.json)
- [claude-reset-2-visit-1.json](claude-reset-2-visit-1.json)
- [claude-reset-2-visit-2-missing.json](claude-reset-2-visit-2-missing.json)
- [claude-reset-2-visit-2-recovered.json](claude-reset-2-visit-2-recovered.json)
- [claude-reset-2-visit-3.json](claude-reset-2-visit-3.json)
- [cleanup-inventory.json](cleanup-inventory.json)
- [codex-no-reset-definition.json](codex-no-reset-definition.json)
- [codex-no-reset-visit-1.json](codex-no-reset-visit-1.json)
- [codex-no-reset-visit-2-missing.json](codex-no-reset-visit-2-missing.json)
- [codex-no-reset-visit-2-recovered.json](codex-no-reset-visit-2-recovered.json)
- [codex-no-reset-visit-3.json](codex-no-reset-visit-3.json)
- [codex-reset-2-definition.json](codex-reset-2-definition.json)
- [codex-reset-2-visit-1.json](codex-reset-2-visit-1.json)
- [codex-reset-2-visit-2-missing.json](codex-reset-2-visit-2-missing.json)
- [codex-reset-2-visit-2-recovered.json](codex-reset-2-visit-2-recovered.json)
- [codex-reset-2-visit-3.json](codex-reset-2-visit-3.json)
- [coverage-adapter-codex.log.txt](coverage-adapter-codex.log.txt)
- [coverage-api-corrected.log.txt](coverage-api-corrected.log.txt)
- [coverage-api.log.txt](coverage-api.log.txt)
- [coverage-complete-setup-attempt.json](coverage-complete-setup-attempt.json)
- [coverage-complete.json](coverage-complete.json)
- [coverage-summary-web.json](coverage-summary-web.json)
- [coverage-web.log.txt](coverage-web.log.txt)
- [coverage.mjs.txt](coverage.mjs.txt)
- [environment.json](environment.json)
- [final-state.json](final-state.json)
- [finalize.mjs.txt](finalize.mjs.txt)
- [format-before-repair-result.json](format-before-repair-result.json)
- [format-before-repair.log.txt](format-before-repair.log.txt)
- [format-result.json](format-result.json)
- [format.log.txt](format.log.txt)
- [functional-complete.json](functional-complete.json)
- [gates-setup-attempt.json](gates-setup-attempt.json)
- [gates.json](gates.json)
- [gateway.log.txt](gateway.log.txt)
- [gateway.mjs.txt](gateway.mjs.txt)
- [own-policy-results.json](own-policy-results.json)
- [own-policy.mjs.txt](own-policy.mjs.txt)
- [provider-calls.json](provider-calls.json)
- [qa-audit-before-repair.json](qa-audit-before-repair.json)
- [qa-audit.json](qa-audit.json)
- [report.mjs.txt](report.mjs.txt)
- [retry-adapter-codex-1.log.txt](retry-adapter-codex-1.log.txt)
- [retry-api-1.log.txt](retry-api-1.log.txt)
- [retry-api-2.log.txt](retry-api-2.log.txt)
- [retry-api-3.log.txt](retry-api-3.log.txt)
- [retry-api-4.log.txt](retry-api-4.log.txt)
- [retry-api-5.log.txt](retry-api-5.log.txt)
- [retry-api-6.log.txt](retry-api-6.log.txt)
- [retry-api-7.log.txt](retry-api-7.log.txt)
- [retry-api-corrected-1.log.txt](retry-api-corrected-1.log.txt)
- [retry-api-corrected-2.log.txt](retry-api-corrected-2.log.txt)
- [retry-api-corrected-3.log.txt](retry-api-corrected-3.log.txt)
- [round-2-task.md](round-2-task.md)
- [traffic.json](traffic.json)

## 5. Observations outside scope

The failed force-shutdown case is Windows-only (`apps/api/src/shutdown-process.test.ts:655`, also shown in the kept API failure log); a Linux CI pass does not exercise that case. File rerun results retain their reported skipped-test counts without implying that every platform-dependent branch ran.

The local gate failures above require orchestrator disposition and are not attributed to #265 without evidence. D-015 remains the restriction on native process-tree termination; no process-tree kill was attempted by this QA driver. Disposable generated build/coverage directories and test stores are left for orchestrator cleanup, as directory deletion is prohibited; the remaining directories are listed in [cleanup-inventory.json](cleanup-inventory.json). The original round 1 fixture errors remain retained there: ordinary pre-send failure auto-retry was correct, and the top-level-limits own-policy probe did not exercise the intended case. This round replaces that missing case with accepted, current-format definitions for both harnesses and both reset configurations.
