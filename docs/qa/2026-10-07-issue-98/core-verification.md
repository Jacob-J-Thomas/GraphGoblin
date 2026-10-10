# Issue 98 core verification — 2026-10-07

Verified in the managed child worktree `C:\Users\98jak\.codex\worktrees\decision-kinds-98\GraphGoblin`, branch `codex/decision-kinds-98`, based on main `2f98219`. This evidence covers the Choice contracts, domain model resolution/graph/export changes, engine, and Codex/Jev adapters. Repository gates, final migration verification, browser experience, and owner product acceptance remain separate gates. No local instance data was converted by these checks.

## Package checks

The final core typecheck and lint commands exited successfully:

```powershell
pnpm.cmd --filter @graphgoblin/contracts --filter @graphgoblin/domain --filter @graphgoblin/engine --filter @graphgoblin/adapter-codex --filter @graphgoblin/adapter-jev typecheck
pnpm.cmd --filter @graphgoblin/contracts --filter @graphgoblin/engine --filter @graphgoblin/adapter-codex --filter @graphgoblin/adapter-jev lint
```

Coverage commands, each completed successfully with the repository thresholds intact:

```powershell
pnpm.cmd --filter @graphgoblin/contracts test:coverage
pnpm.cmd --filter @graphgoblin/engine test:coverage
pnpm.cmd --filter @graphgoblin/adapter-codex test:coverage
pnpm.cmd --filter @graphgoblin/adapter-jev test:coverage
```

| Package       | Passed unit tests | Statements | Branches | Functions |  Lines |
| ------------- | ----------------: | ---------: | -------: | --------: | -----: |
| contracts     |               131 |       100% |     100% |      100% |   100% |
| engine        |               355 |     97.78% |   93.65% |    97.17% | 98.79% |
| adapter-codex |                73 |     98.76% |   98.01% |    97.56% | 99.65% |
| adapter-jev   |                20 |     98.68% |   98.07% |      100% |   100% |

Live tests are skipped by default in coverage runs; those skips are not counted as provider verification. The Jev file gained a separately selected live Choice test after its coverage run; its runtime adapter source did not change. Final domain coverage includes independently owned upgrade files and must be recorded after their final fixes; this document does not assert that migration gate passed.

The tests cover all three selected evaluator kinds; three and eight stable option IDs after reordering and numeric display labels; strict answer/event shapes; exact probability key membership; expression nonstring rejection; classifier minimum-confidence rejection; missing or disabled runtime configuration; typed resumability; sanitized provider failure evidence; inherited and explicit model/effort resolution at every authored level; full-thread question rendering versus separately selected evaluation context; and fresh versus unknown historical provenance. Existing cursor/replay recovery and exit evaluation ordering remain covered. A Codex exit error still records the actual resolved model when resolution succeeded before the provider failed.

## Bounded actual provider checks

Only the selected Choice test ran for each provider. Both asserted the unambiguous expected option ID `ready`, with provider-facing stable IDs differing from numeric display labels. They checked the canonical answer shape and finite confidence in [0,1]. No raw provider response, request headers, API key, or secret body is included in this evidence.

Codex command (temporarily set `$env:LIVE = '1'`, restore the prior value afterward):

```powershell
pnpm.cmd --filter @graphgoblin/adapter-codex exec vitest run src/live.test.ts --testNamePattern 'makes a canonical structured Choice with stable ids' --reporter verbose
```

Actual result: **1 passed**, 3 unrelated tests filtered out; 27.865 seconds for the selected test. One structured Choice used `gpt-6-luna` with `low` effort and a fresh read-only temporary working directory. Safe canonical observation: `{type:'choice', optionId:'ready', confidence:1, probabilities:null}`. The test asserts null probabilities because the LLM confidence is informational rather than a calibrated distribution. Session continuation and cancellation live tests were not selected.

Jev command (temporarily set `LIVE=1` and inject an already registered User/Machine API key into this test process, restore prior process environment afterward):

```powershell
pnpm.cmd --filter @graphgoblin/adapter-jev exec vitest run src/live.test.ts --testNamePattern 'verifies one canonical Choice with stable ids against TypeSafe' --reporter verbose
```

Actual result: **1 passed**, 3 unrelated tests filtered out; 689 milliseconds for the selected test. The test made exactly one TypeSafe request using `jev-latest`, a 30-second timeout, and zero SDK retries. Safe canonical observation: `{type:'choice', optionId:'ready', confidence:1, probabilities:{revise:0, discard:0, ready:1}}`. It asserts the complete declared-ID probability map. The existing Windows User/Machine key was loaded transiently; its value was never printed or persisted. Noul, Score, and the other multi-call live tests were not selected.

## Delivery boundary

Core-owned source is stable for integration gates. The issue 98 question/context behavior remains unchanged pending issue 38. This change adds no issue 33 session policy, issue 97 answer primitives, or issue 99 exit configuration. Independent migration/API peer review is tracked separately; a successful core check does not approve live data resolutions or satisfy the required owner experience check.

## Independent peer findings — FIX-IN-PR, verified

These five introduced findings were reproduced in a read-only peer check and sent to the runtime implementer/root. Each disposition is **FIX-IN-PR**. Runtime fixed all five findings with regression coverage. Root also verified the existing exit admission through API create, validate and publish, then restored availability and confirmed publication succeeds. The final integration report records the overall gates; these checks do not substitute for adversarial review or owner acceptance.

| Finding                                            | Concrete reproduction and observed failure                                                                                                                                                                                                                                                                                                                         | Required disposition                                                                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1: arbitrary user JSON rewritten as an output     | In upgrade-history.ts, pass sampleThread with vars.note={nodeId:'decide',value:{route:'yes',strategy:'expression',confidence:null}}, no events, decisionNodeIds:['decide']. upgradeRunHistoryV1 returns ok:true but replaces vars.note.value with the canonical DecisionPayload. Recursive wrapper detection mutates factual user vars outside an output envelope. | Restrict automatic conversion to documented outputs/lastOutput locations and matching patch envelopes. Preserve user vars, trigger payload, messages, and unrelated JSON. Test the exact reproduction.                               |
| P2: unrelated confidence patch refused             | Initial lastOutput={nodeId:'worker',value:{confidence:0.1},at:'2026-10-02T12:00:00.000Z'}; a node.finished worker patch replaces /lastOutput/value/confidence with 0.2; decisionNodeIds:[]. Conversion returns UPGRADE_HISTORY_REFUSED with partial historical decision output write.                                                                              | Apply partial decision-shape refusal only when the output origin is an affected decision; preserve unrelated inference patches.                                                                                                      |
| P2: existing migration-only store admitted fresh   | In an in-memory database, create __drizzle_migrations and insert one applied migration row with hash existing-history and created_at=1. guardDatabaseUpgrade returns fresh even though recorded prior state exists.                                                                                                                                                | A fresh marker must require no recorded prior migration state. Refuse nonempty migration-only damaged/unmarked stores before migrations, recovery, or marker writes.                                                                 |
| P2: exit publication warning exempted              | blocksPublication({severity:'warning',code:'MODEL_DISABLED',nodeId:'exit',path:'config.criteria.model',message:'disabled'}) returns false. HARNESS_UNAVAILABLE at config.criteria also returns false. The path-prefix exception permits unavailable exit evaluators while the same admission policy blocks other affected nodes.                                   | Remove the publication exception under the approved issue 98 all-affected-node model policy; keep existing exit evaluator schema and execution ordering unchanged until issue 99. Root confirmed this scope.                         |
| P1: approved decision override leaves broken graph | Convert a v1 mixed codex/expression decision with yes/no routes and edges e2:yes/e3:no, supplying an approved replacement Choice with ready/revise IDs and expression '"ready"'. upgradeLoopV1 returns ok:true; validateLoop then reports EDGE_PORT_MISSING for e2/e3 and PORT_UNCONNECTED for ready/revise.                                                       | Require full decision replacements to preserve the old route-ID set while labels/criteria/evaluator may change. No edge-remapping contract is approved. Test refusal without globally rejecting unrelated historical invalid drafts. |

The reproductions used pure in-memory values or a disposable in-memory SQLite database. No live GraphGoblin store was opened or converted. A stale API LIVE fixture using old process-default variables was also reported for mechanical fixture correction; it was not run as an extra provider check.
