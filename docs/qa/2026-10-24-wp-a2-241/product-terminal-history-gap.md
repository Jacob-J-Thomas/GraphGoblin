# Confirmed product defect: terminal inspector can omit persisted return-delivery evidence

This blocks #241's three-clean-full-run acceptance. Product implementation is deliberately untouched under the worker's scope restriction. The stricter regression assertion remains in `apps/web/e2e/inspector-large-values.spec.ts`.

## Observed evidence

In the real Edge run `focused-lifecycle` on HEAD `24d7be41da50944cae25e9093c0591f4a7fdf5c0`, application/test diff `631f7afb78507cd5b4bad4f7b557ccd7a1f810246f9305b3d2d5ec1ef788dac2`:

- `GET /runs/01M3Y7RKG0XYB0QB8C3VPGYTCE` at **2026-10-25T03:20:58.156Z** returned `status: succeeded`, `lastEventSeq: 21`.
- The browser's next run read at **03:20:58.647Z** returned `status: succeeded`, **`lastEventSeq: 22`**.
- The inspector nevertheless remained at **`Timeline (21 events, complete)`**, selected **event 21**, with no `return.delivered` row for the entire subsequent ten-second observable assertion window.
- The original full-suite failure showed the opposite ordering: event 22 (`return.delivered caller`) had reached the timeline before the test revisited its captured event 21. That initially looked like a test-only selection race. The stronger synchronization probe exposed a separate product failure: the persisted tail can be omitted permanently from the loaded inspector.

[Network response inventory](large-history-network-analysis.json) preserves timestamps, statuses, sequence counts and exact trace body-resource names. The source trace was **8,544,184 bytes**, SHA-256 `325dd4cb9837201c330ab0c699e1e291869b3a5ecd77f7b0d6ee4cba464ff8f3`; its size/hash is also indexed in the capture inventory and NOT-KEPT record. [Focused log](focused-lifecycle.log.txt), [metadata](focused-lifecycle.json), [capture inventory](focused-lifecycle-artifacts.json). These are native browser/API observations, not a fake-component test.

## Reproduction

Use Node 22 and the built app in this isolated worktree, with Edge, zero retries, one worker, provider-free harnesses and disposable storage. From `apps/web`, run:

```powershell
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:LIVE = '0'
$env:GG_E2E_MAIN_PORT = '6020'
$env:GG_E2E_CONTROL_PORT = '6021'
pnpm.cmd exec playwright test e2e/inspector-large-values.spec.ts --grep 'a run with a large history' --retries=0 --workers=1
```

The existing scenario creates a real API instance, publishes inference -> wait-for-input -> exit, scripts a 2,100,000-character harness result, reconstructs the waiting thread, then submits approval. It requires live post-terminal caller-delivery evidence before freezing the completed selection. The failure is `return.delivered` absent despite the API exposing a larger durable sequence. Scheduling affects reproduction; a passing rerun does not disprove the captured gap.

## Corroborating source

- `apps/api/src/sse.ts`: writing a terminal run event immediately ends the SSE stream.
- `apps/web/src/runs/follow-run-attempts.ts`: one finite catch-up captures `run.lastEventSeq`; after matching terminal success, observation stops. Rechecks are scheduled only for a status mismatch or a resumable failure.
- `packages/engine/src/run-manager.ts`: `finalizeTerminal` delivers returns after the terminal event, appending `return.delivered`, then marks finalization complete.
- `apps/web/src/runs/useRunEvents.ts`: after SSE completion it delegates to that finite terminal observer. A later metadata query can show sequence 22 without advancing the event log from 21.

The source explains the observed ordering, but the finding rests on the API response versus rendered-timeline discrepancy. No product code was changed. Orchestrator action: route this to the inspector/session-recovery owner, integrate the product fix, then rerun the complete Edge suite three consecutive times with this regression intact. Do not substitute retries, a reload, a skip or a weaker assertion.
