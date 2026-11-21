# #486 independent behavior QA 02 · BLOCKERS

Status at 2026-11-21T16:47Z: **no product blocker found.** No valid product failure stopped any lane, and no dependent scenario was skipped because of a product defect.

All failed attempts were QA instrumentation or setup. The product was not changed, and each fix is new QA-owned bytes with retained attempts:

| Attempt | Failed rows | Cause (QA side) | Fix |
| --- | --- | --- | --- |
| d2-leaf/attempt-1 | 4 setup (B21c, EXT-C ×3) | classifier fixtures need a configured `jev-api-key` secret to publish (`LOOP_INVALID CLASSIFIER_SECRET_MISSING`, correct existing publication policy) | attempt-2 sets a dummy secret in the disposable store |
| d3-children/attempt-1 | 3 (B07a, CH-INF-1/2) | the 02 scripted harness emitted usage key `reasoningTokens` instead of `reasoningOutputTokens`; the product correctly refused the event (`EVENT_INVALID`) | harness fixed; attempt-2 71/71 |
| d4-inference/attempt-1 | 1 setup + 2 (FRESH-unsaved, RETRY-1/3) | decision `limit-reached` port unconnected (correct publish refusal); the fault re-arm never ran between SQLite appends | fixture + synchronous multi-shot fault; attempt-2 93/93 |

Non-blocking observations for root, all established behavior that new code did not change:

- B25: the signal-request 400 body still carries the literal and the filter source (`detail: "expression failed: QA486-LIT-B25"`, `errors.expression`). This is the preserved request-side contract (positive control).
- P01/P02 keep the bounded authored literal in the public failure and the private "node failed" log (preserved contract).
- B26x: `return.failed.error` carries raw `describeError` text, including the absolute path (preserved raw receipt contract).
- RETRY-1: the INTERNAL_ERROR failure carries `details: {cause: null, recording: [{operation: "turn.intent.reconcile"}]}`. This is the existing recording-details projection.
