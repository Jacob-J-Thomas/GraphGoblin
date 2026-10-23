# WP-F4 round 8: failure evidence precedence and repair intent (#244)

## 1. Branch and worktree

Branch `codex-wp-f4-prompt-provenance`, worktree
`.claude/worktrees/codex-wp-f4-prompt-provenance`. Starting HEAD
`aa8fb76a4c64f2fc6bbe0b0fbe3d7a67a2f8fb08`, clean before work;
`git merge-base --is-ancestor b9c4be25 HEAD` passed. Node `v22.14.0`,
PowerShell, `pnpm.cmd`. Uncommitted; ready for orchestrator commit after review.
No other agents, provider turns, owner-app access or Git index mutations.

## 2. Per bolt

All three findings were reproduced on the unchanged, newly built head before
production edits ([build](build-before.log.txt)). Original auditor drivers were
run sequentially from the worktree root:

```powershell
node "$env:TEMP\gg-audit-f4-r3-20261022\mapper-boundaries.mjs"
node "$env:TEMP\gg-audit-f4-r3-20261022\mapper-followups.mjs"
node "$env:TEMP\gg-audit-f4-r3-20261022\repair-storage-boundary.mjs"
```

| Driver         | Before result                                         | Evidence                                                                                   |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Boundaries     | 158 passed, **8 failed**                              | [JSON](mapper-boundaries-before.json), [log](mapper-boundaries-before.log.txt)             |
| Followups      | **12 semantic failures and 2 fixture setup failures** | [JSON](mapper-followups-before.json), [log](mapper-followups-before.log.txt)               |
| Repair storage | **4 failed**, including both commit-then-throw cases  | [JSON](repair-storage-boundary-before.json), [log](repair-storage-boundary-before.log.txt) |

**B4, confirmed.** Boundary case 119 stored `HARNESS_NOT_AUTHENTICATED`,
`definitely-not-submitted`, `resumable: true` despite later termination evidence.
The quoted mismatches were:

```text
code: actual HARNESS_NOT_AUTHENTICATED, expected HARNESS_TERMINATION_UNCONFIRMED
classification: actual definitely-not-submitted, expected delivery-uncertain
resumable: actual true, expected false
resume: actual 200, expected 409
extra calls: actual 1, expected 0
```

Case 156 repeated this for Claude. Cleanup cases 120/157 stored
`HARNESS_SESSION_MISSING` even though `details.adapterCode` was
`HARNESS_TERMINATION_UNCONFIRMED`. The followups also reproduced iterator/result
overrides and cancellation hiding termination. The fix retains the strongest
evidence, persists changed classifications, and applies the same termination
precedence during cleanup and final failure construction. Ordinary newer
structured events still replace ordinary earlier events; a generic final wrapper
retains the useful structured cause.

**B5, confirmed.** The four asynchronous Codex SDK cases stored
`HARNESS_DELIVERY_UNCERTAIN`, returned Resume 200 and made one additional call.
The same exception at `resumeThread()` and native-shaped message controls passed.
The adapter now classifies recognized typed metadata before native-message
fallback at promise/iterator rejection and retains authoritative failures over
generic wrappers. Explicit unconfirmed termination also survives cancellation.
This is controlled public SDK-factory injection; no claim is made that the
installed SDK currently emits the injected coded exception.

**B6, confirmed.** Both `afterCommit: true` cases recorded
`promptKind: authored`, `submission: delivery-uncertain`, `cancelled: [1]`,
`exactRetry: false`. The assertion was `Expected values to be strictly equal:
false !== true`. Only one harness call had occurred. The repair intent is now
established and the completed handle cleared before fallible persistence. An
ambiguous append is reconciled against the actual event-store port, rather than
the executor's cached history. If the intent was not committed and storage is
usable again, it is recorded before its definite-non-submission evidence. The
original storage exception keeps its diagnostics and exact repair provenance.
Before-append faults are separately exercised and qualified; they do not prove
the first append reached disk.

All post-fix auditor cases passed in one execution per driver:

| Driver                                   | After result     | Evidence                                                                                 |
| ---------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| Boundaries, unmodified                   | **166/166 PASS** | [JSON](mapper-boundaries-after.json), [log](mapper-boundaries-after.log.txt)             |
| Followups, two fixture records qualified | **14/14 PASS**   | [JSON](mapper-followups-after.json), [log](mapper-followups-after.log.txt)               |
| Repair storage, unmodified               | **4/4 PASS**     | [JSON](repair-storage-boundary-after.json), [log](repair-storage-boundary-after.log.txt) |

B4 now records missing-session or termination evidence durably, refuses Resume
with **409 and zero extra calls**, and retains termination rather than a cancelled
outcome. B5's asynchronous SDK boundaries match the synchronous controls for both
retry flags. B6 records the repair turn's own identity, definite non-submission,
`cancelled: []`, `exactRetry: true`, Resume 200 and a succeeded result. All four
storage cases made only one harness call before Resume. No earlier failed run is
relabeled as a pass.

The native restart suite passed **5/5 in one execution**, 45.81 seconds
([log](native-restart.log.txt)). It covers accepted continuation, both D-022
inherited-session blocks, and previous/named Claude result-only acceptance before
process exit. All five use disposable fake-provider stores and port 5660.

## 3. Files changed

All shared-file edits are listed below; ranges refer to final source.

| File                                                        | Ranges                                                    | Change                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/handlers/inference-failure.ts`         | 7–105                                                     | Shared evidence precedence and retained structured evidence                                                 |
| `packages/engine/src/handlers/inference.ts`                 | 123–193, 284–315, 359, 394–409, 480–487, 519–532, 567–570 | Record changed classifications; establish repair before append; reconcile storage; cleanup/final precedence |
| `packages/engine/src/handlers/inference-boundaries.test.ts` | 1–260, new                                                | Sequence, cancellation, cleanup, generic-wrapper, structured-event and append-fault regressions             |
| `packages/adapter-codex/src/events.ts`                      | 8, 188–220, 296, 323–344                                  | Typed-error classification and accumulator precedence                                                       |
| `packages/adapter-codex/src/harness.ts`                     | imports, 185–202                                          | Preserve thrown metadata; termination overrides cancellation                                                |
| `packages/adapter-codex/src/harness.test.ts`                | 38–89, 369–395                                            | Public-factory parity and cancellation regressions                                                          |
| `packages/adapter-codex/src/events.test.ts`                 | 157–175, 224–237                                          | Metadata fallback and precedence controls                                                                   |
| `apps/api/src/prompt-provenance.test.ts`                    | 11–66                                                     | Extend synchronous controls to both asynchronous SDK boundaries                                             |
| `apps/api/src/prompt-failure-boundaries.test.ts`            | 1–210, new                                                | REST sequence/cancellation/cleanup and commit-then-throw assertions                                         |
| `docs/05-execution-engine.md`                               | 268–274                                                   | Explain precedence and repair-intent durability                                                             |
| `CHANGELOG.md`                                              | 7                                                         | Extend the existing #244 bullet, preserving the upgrade warning                                             |
| This round-8 directory                                      | all new                                                   | Sanitized evidence and report                                                                               |

No production `run-manager.ts`, readiness code, contracts, dependency files,
web source, native restart script or other QA directory was edited. Docs/05's
shared recovery section is changed; its replay section is untouched.

## 4. Tests

Regression commands and their pre-fix failures:

- Engine handler file: **18 failed / 2 passed**, including both families' later
  missing/termination, cancellation, cleanup and four append-fault cases
  ([log](engine-before.log.txt)). Expected `promptKind: repair` and
  `definitely-not-submitted`; received `authored` and `delivery-uncertain`.
- Codex harness file: **4 failed / 25 passed**. Expected `HARNESS_SESSION_MISSING`
  / `session-missing`; received `HARNESS_TURN_FAILED` / `delivery-uncertain`
  ([log](codex-before.log.txt)). The two synchronous controls passed.
- API files: **14 failed / 7 passed**. REST assertions included
  `AssertionError: expected 200 to be 409` and an unwanted extra call
  ([log](api-before.log.txt)).

Focused post-fix runs passed 91 engine, 39 Codex and 25 API tests
([engine](engine-focused.log.txt), [Codex](codex-focused.log.txt), [API](api-focused.log.txt)).
Additional Codex metadata/cancellation controls were added for full coverage.
During implementation, two ordinary-later-structured-event checks exposed an
overly broad retention rule: expected `HARNESS_DELIVERY_UNCERTAIN`, received
`HARNESS_NOT_AUTHENTICATED` ([log](structured-event-before.log.txt)). Those were
implementation regressions, not additional baseline findings. The mapper was
corrected, and both are included in the final engine suite.

| Final coverage | Tests                           | Lines  | Branches |
| -------------- | ------------------------------- | ------ | -------- |
| Engine         | PASS 615                        | 98.05% | 92.68%   |
| Codex          | PASS 111; 5 existing live skips | 98.82% | 95.00%   |
| API            | PASS 768; 6 existing live skips | 98.04% | 93.25%   |

All tests use supported ports/constructors. Engine tests inject `HarnessPort` and
`EventStorePort`; API tests use real SQLite and REST with public port injection;
Codex tests use its public SDK factory. No private-method access, casts to `any`,
test-only production exports, threshold reductions or new permanent skips.

## 5. Gates

All commands use Node 22 first on PATH, from the worktree root.

| Command                                                                                                | Result                                                                              |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                   | Initial failure; final PASS 20 tasks ([log](typecheck-final.log.txt))               |
| `pnpm.cmd lint`                                                                                        | Final PASS 11 tasks ([log](lint-final.log.txt))                                     |
| `pnpm.cmd format --ignore-path .prettierignore --ignore-path <protected-ignore>`                       | PASS ([log](format.log.txt))                                                        |
| `pnpm.cmd check:layers`                                                                                | PASS ([log](layers.log.txt))                                                        |
| `pnpm.cmd check:deps`                                                                                  | PASS; existing drizzle configuration orphan warning ([log](deps.log.txt))           |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=2 --coverage.reportOnFailure`        | Final PASS 615 ([log](engine-coverage-final.log.txt))                               |
| `pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage --maxWorkers=1 --coverage.reportOnFailure` | PASS 111 / 5 skipped ([log](codex-coverage.log.txt))                                |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --coverage.reportOnFailure`           | PASS 768 / 6 skipped, 768.32 seconds; built API first ([log](api-coverage.log.txt)) |
| `pnpm.cmd build`                                                                                       | Final PASS 11 tasks ([log](build-final.log.txt))                                    |
| Three auditor drivers                                                                                  | PASS 166/166, qualified 14/14, 4/4; links above                                     |
| `pnpm.cmd test:prompt-restart`                                                                         | PASS 5/5, one execution ([log](native-restart.log.txt))                             |

The first typecheck **failed**, `TS18048: 'pending' is possibly 'undefined'`,
inside the storage-reconciliation callback ([log](typecheck.log.txt)). Capturing
the current turn ID fixes the narrowing. Initial engine coverage passed 613
tests; it was repeated after the source/type fix and the two structured-event
regressions, yielding the final 615-test result. Typecheck, lint and build were
likewise repeated because source changed, not to replace an unexplained failure.

Root formatting explicitly excludes **all** `docs/qa/**`, honoring the no-touch
instruction. This round's own folder is formatted separately. Final formatting
verification checks the changed source and new evidence only.

## 6. Docs

Docs/05 and the existing CHANGELOG #244 bullet describe authoritative evidence,
Codex typed SDK errors and repair-intent ordering. The existing operational
upgrade warning is retained. No schema, route, stored failure shape or settled
product decision changed; no generated references, migration or ADR is required.
All other QA evidence and matrix artifacts remain untouched.

## 7. Decisions and parameters

- Unconfirmed termination outranks missing-session evidence and cancellation;
  missing-session evidence outranks an ordinary earlier error. Later equally
  authoritative evidence wins. Generic final wrappers retain useful structured
  causes; ordinary later structured events retain their existing precedence.
- Codex recognizes a fixed allowlist of typed adapter failure codes before
  message fallback; arbitrary unknown codes do not become trusted classifications.
- Repair identity/body and handle ownership change before persistence. Recovery
  of an ambiguous append reads the actual durable port; it does not retry a
  provider call or blindly duplicate a committed intent.
- API coverage uses one worker and the auditor's external allocated-port guard
  to reduce the parallel listener collision recorded in round 7. Its stock stores
  are nested under `%TEMP%/gg-wp-f4-round8-unit`. Original auditor drivers retain
  their own `gg-audit-f4-r3-repair-*` prefixes because they were explicitly requested.
- Auditor JSON headers hardcode `b9c4be25`; the actual tested base is `aa8fb76a`.
  Source hashes and qualification are in [environment.json](environment.json).
  Original driver sources are retained as `.mjs.log.txt` text.
- The followup driver has two schema-invalid Claude fixtures. The final qualified
  copy uses the auditor's corrected init/result records (`StructuredOutput` tool
  and `structured_output`). It changes only those two fixture records; all 14
  cases and assertions remain intact. Original setup failures stay in the before
  record. Both versions are retained for comparison.

## 8. Caveats and open items

The initial typecheck, baseline regression failures, two followup fixture setup
failures and two implementation-regression failures remain failures in their
retained logs. Final required gates all passed; no D-015 waiver was used.
Root tasks emitted nonfatal Turbo cache-write access-denied warnings while
exiting zero. During the long serial API run, a scoped CIM process query was
denied (`HRESULT 0x80041003`); this diagnostic restriction was not classified as
D-015 or used to stop/retry the passing gate.

No live-provider or owner-instance evidence is claimed. Stock fixtures perform
their existing cleanup; no directory deletion command was issued. Original
auditor sources remain unchanged; retained source-as-text files normalize line
endings to LF and source hashes refer to the originals. Orchestrator commit,
Fable review and audit continuation remain outstanding.

Final allocated-port availability, five native-store cleanup checks, source
hashes and retained-directory inventory are in [final-state.json](final-state.json).
The six auditor execution stores and `%TEMP%/gg-wp-f4-round8-unit` remain for the
orchestrator to clean up; the final-state inventory names only this round's stores.
