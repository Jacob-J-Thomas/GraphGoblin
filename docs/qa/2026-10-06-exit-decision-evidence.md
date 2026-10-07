# Exit and decision execution evidence

Implemented in `.claude/worktrees/codex-fix-exit-evidence` on branch `codex-fix-exit-evidence`. Changes are unstaged and uncommitted.

## Changes

- Contracts define strict `exit.evaluated` events and a required `decision.made.skipped` list. No new dependencies or compatibility parsing paths.
- The domain evaluator observes each criterion's verdict, confidence threshold, and safe error evidence without changing ordered first-match semantics. The engine records remaining criteria as skipped after a match or failure.
- Each exit execution records its iteration, ordered evidence, and completion, loop-back, named configured/hard limit, failure, or cancellation. Unavailable exit predicates still fail; provider exceptions still fail decisions.
- Codex judge reasoning is retained, bounded to 2,048 characters. Codex names the resolved model; Jev names the built-in classifier. Provider envelopes and provider error text are excluded; error and skip diagnostics use fixed messages and recognized codes.
- JSON event pages and SSE preserve identical evidence. OpenAPI components and the generated client were regenerated.
- The inspector shows the latest exit explanation near the top, plain-language timeline and node-progress summaries, and selected evaluation details with ordered criteria, thresholds, model/classifier, reasoning, and skipped strategies.
- Migration `0007` adds `skipped: []` to historical decisions missing that field. Existing recorded skip evidence is preserved. Old exit and skip reasons cannot be reconstructed. The browser uses a fresh event-cache key and reloads migrated events.
- The execution-engine document, API/streaming document, run guide, and Unreleased CHANGELOG/upgrade notes describe the changes. `pnpm.cmd docs:generate` ran; the generated reference Markdown remained unchanged because its renderer lists routes and node configs, not event component contents.

## Event shapes

The shared envelope remains `runId`, `seq`, and `ts`. This example omits that envelope:

```json
{
  "type": "exit.evaluated",
  "nodeId": "done",
  "iteration": 2,
  "maxIterations": 5,
  "criteria": [
    {
      "index": 0,
      "strategy": "jev",
      "status": "not-matched",
      "holds": false,
      "confidence": 0.93,
      "classifierModel": "jev"
    },
    {
      "index": 1,
      "strategy": "expression",
      "status": "matched",
      "holds": true
    }
  ],
  "result": {
    "kind": "completed",
    "reason": "criterion-matched",
    "criterionIndex": 1,
    "outcome": "success"
  }
}
```

Criterion indices are zero-based in the API and displayed starting at 1. Criteria name `expression`, `jev`, `codex`, `max-iterations`, `max-duration`, or `last-output-matches`. Status is `matched`, `not-matched`, `skipped` with `reason: { code, message }`, or `error` with `diagnostic: { code, message, status? }`. Evaluated answers retain `holds`, optional confidence/minConfidence, model/classifier, and bounded Codex reasoning.

Exit results:

| kind            | Evidence                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completed`     | Run outcome, reason `criterion-matched` with criterionIndex or `default-success`.                                                                 |
| `looped-back`   | Reason `no-criterion-matched` and targetNodeId.                                                                                                   |
| `limit-reached` | `max-iterations`, `max-duration`, or `iteration-ceiling`, its value, optional criterionIndex, and exhausted outcome. Duration values are seconds. |
| `failed`        | Fixed safe diagnostic for predicate/evaluation or return-mapping failure.                                                                         |
| `cancelled`     | Evaluation interruption by cancellation.                                                                                                          |

The per-node visit cap continues to produce `run.failed` with `MAX_ITERATIONS` before a blocked node starts. An exit evaluation describes its attempt; recovery may evaluate again if its `node.finished` was not durable.

A decision fallback example, again omitting the envelope:

```json
{
  "type": "decision.made",
  "nodeId": "choose",
  "strategy": "expression",
  "route": "yes",
  "skipped": [
    {
      "strategy": "jev",
      "code": "CLASSIFIER_MODEL_DISABLED",
      "message": "The selected classifier is disabled"
    }
  ]
}
```

Skip codes cover missing/disabled classifiers, unsupported Choice, missing/unreadable keys, unavailable providers, expressions not selecting a declared route, undeclared provider routes, invalid confidence, and low confidence. Skip entries retain execution order before the winner. Historical migrated empty lists represent evidence that was not recorded.

## Verification

| Gate                                                                                                                 | Final result                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck --concurrency=2`                                                                                 | PASS: 20 successful tasks.                                                                                          |
| `pnpm.cmd lint --concurrency=2`                                                                                      | PASS: 11 successful tasks.                                                                                          |
| `pnpm.cmd format:check`                                                                                              | PASS: all matched files use Prettier style.                                                                         |
| `pnpm.cmd check:layers`                                                                                              | PASS: Layer rules OK.                                                                                               |
| `pnpm.cmd check:docs`                                                                                                | PASS: generated docs up to date.                                                                                    |
| `pnpm.cmd test:coverage --concurrency=1 --continue=always --env-mode=loose`                                          | Exit 1: 11 of 12 tasks pass; only infrastructure fails, with 156 passing and 3 failing tests.                       |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run --coverage --coverage.reportOnFailure --maxWorkers=2` | Exit 1: the same 3 existing process-termination tests fail; coverage report generated and every metric exceeds 90%. |
| `git diff --check`                                                                                                   | PASS.                                                                                                               |

The final full coverage run used process-local `VITEST_MAX_WORKERS=2` and Git trust for this exact worktree through `GIT_CONFIG_*`; no global Git configuration was changed. The tooling suite passes all 47 tests. The full web suite passes all 92 files and 1,019 tests; no per-file fallback was needed. Earlier concurrent runs exposed resource-related UI timeouts and old migration-count expectations; the final run resolves those.

All runtime package metrics exceed 90%; thresholds and exclusions are unchanged:

| Package                            | Statements | Branches | Functions |  Lines |
| ---------------------------------- | ---------: | -------: | --------: | -----: |
| contracts                          |     100.00 |   100.00 |    100.00 | 100.00 |
| domain                             |      98.76 |    96.96 |     96.15 |  99.22 |
| engine                             |      97.84 |    94.15 |     97.10 |  98.89 |
| infrastructure (report on failure) |      99.18 |    94.83 |     98.85 | 100.00 |
| adapter-codex                      |      98.70 |    98.00 |     97.43 |  99.64 |
| adapter-jev                        |      98.75 |    98.07 |    100.00 | 100.00 |
| api-client                         |     100.00 |    99.30 |    100.00 | 100.00 |
| api                                |      97.10 |    92.92 |     94.95 |  98.49 |
| web                                |      98.94 |    96.30 |     99.41 |  99.54 |
| mcp                                |      93.86 |    94.83 |     92.94 |  95.23 |
| plugin-codex                       |      95.52 |    95.45 |    100.00 |  95.23 |

Functional coverage includes mixed Jev/expression criteria identifying the actual match; Codex reasoning/model and truncation; true predicates below confidence thresholds; every loop-back and hard ceiling; configured iteration/duration limits; safe provider and expression errors; cancellation and return-mapping failures; ordered fallback skips; migration idempotence/preservation; JSON/live SSE/replayed SSE agreement; inspector rendering; and discarding the obsolete browser cache.

## Remaining blocker

The sandbox denies Windows `taskkill`. A controlled disposable-child reproduction returned `ERROR: Access denied` and taskkill exit code 1; the child then exited normally on its bounded timer. This reproduces the cause of the three existing failures, which were not modified:

- `packages/infrastructure/src/process/scripts.test.ts`: kills the process tree on timeout (15 s test timeout).
- `packages/infrastructure/src/process/scripts.test.ts`: kills the process when the signal aborts, including when already aborted (15 s).
- `packages/infrastructure/src/adversarial.test.ts`: QA-LIMIT-001, abort kills a real child and grandchild (30 s).

Run the coverage gate again in CI or a Windows environment permitting process-tree termination before treating that gate as green. No tests were skipped or weakened to bypass this restriction. Provider-live suites retain their existing opt-in skips; this work uses unit fakes.

## Changed files

- [CHANGELOG.md](../../CHANGELOG.md)
- [apps/api/src/openapi-registry.ts](../../apps/api/src/openapi-registry.ts)
- [apps/api/src/sse.test.ts](../../apps/api/src/sse.test.ts)
- [apps/api/src/version-migration.test.ts](../../apps/api/src/version-migration.test.ts)
- [apps/web/src/runs/RunInspectorPage.test.tsx](../../apps/web/src/runs/RunInspectorPage.test.tsx)
- [apps/web/src/runs/RunInspectorPage.tsx](../../apps/web/src/runs/RunInspectorPage.tsx)
- [apps/web/src/runs/event-store.ts](../../apps/web/src/runs/event-store.ts)
- [apps/web/src/runs/inspector/EvaluationDetails.test.tsx](../../apps/web/src/runs/inspector/EvaluationDetails.test.tsx)
- [apps/web/src/runs/inspector/EvaluationDetails.tsx](../../apps/web/src/runs/inspector/EvaluationDetails.tsx)
- [apps/web/src/runs/projections.test.ts](../../apps/web/src/runs/projections.test.ts)
- [apps/web/src/runs/projections.ts](../../apps/web/src/runs/projections.ts)
- [docs/05-execution-engine.md](../../docs/05-execution-engine.md)
- [docs/07-api-and-streaming.md](../../docs/07-api-and-streaming.md)
- [docs/guide/03-run-and-observe.md](../../docs/guide/03-run-and-observe.md)
- [docs/qa/2026-10-06-exit-decision-evidence.md](../../docs/qa/2026-10-06-exit-decision-evidence.md)
- [packages/adapter-codex/src/decider.test.ts](../../packages/adapter-codex/src/decider.test.ts)
- [packages/adapter-codex/src/decider.ts](../../packages/adapter-codex/src/decider.ts)
- [packages/api-client/openapi.json](../../packages/api-client/openapi.json)
- [packages/api-client/src/generated/schema.ts](../../packages/api-client/src/generated/schema.ts)
- [packages/contracts/src/classifiers.test.ts](../../packages/contracts/src/classifiers.test.ts)
- [packages/contracts/src/events.ts](../../packages/contracts/src/events.ts)
- [packages/contracts/src/exit-events.test.ts](../../packages/contracts/src/exit-events.test.ts)
- [packages/contracts/src/schemas.test.ts](../../packages/contracts/src/schemas.test.ts)
- [packages/domain/src/exit.test.ts](../../packages/domain/src/exit.test.ts)
- [packages/domain/src/exit.ts](../../packages/domain/src/exit.ts)
- [packages/engine/src/handlers/classifiers.test.ts](../../packages/engine/src/handlers/classifiers.test.ts)
- [packages/engine/src/handlers/decision.ts](../../packages/engine/src/handlers/decision.ts)
- [packages/engine/src/handlers/exit.test.ts](../../packages/engine/src/handlers/exit.test.ts)
- [packages/engine/src/handlers/exit.ts](../../packages/engine/src/handlers/exit.ts)
- [packages/engine/src/run-manager.test.ts](../../packages/engine/src/run-manager.test.ts)
- [packages/infrastructure/drizzle/0007_decision_skipped.sql](../../packages/infrastructure/drizzle/0007_decision_skipped.sql)
- [packages/infrastructure/drizzle/meta/_journal.json](../../packages/infrastructure/drizzle/meta/_journal.json)
- [packages/infrastructure/src/sqlite/catalog.test.ts](../../packages/infrastructure/src/sqlite/catalog.test.ts)
- [packages/infrastructure/src/sqlite/classifiers.test.ts](../../packages/infrastructure/src/sqlite/classifiers.test.ts)
- [packages/infrastructure/src/sqlite/decision-migration.test.ts](../../packages/infrastructure/src/sqlite/decision-migration.test.ts)
- [packages/infrastructure/src/sqlite/storage.test.ts](../../packages/infrastructure/src/sqlite/storage.test.ts)
- [packages/infrastructure/src/sqlite/version-migration.test.ts](../../packages/infrastructure/src/sqlite/version-migration.test.ts)
