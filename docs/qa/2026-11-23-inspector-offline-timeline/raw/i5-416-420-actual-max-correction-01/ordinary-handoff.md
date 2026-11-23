I've made the five corrections, all within the expected five files. Nothing else was touched, including the three protected provenance core files, the shared fixtures, E2Es, history/event-store/header/reachability code, dependency files, CHANGELOG and docs. No tests, typecheck, lint or Prettier were run, so none of these fixes is verified yet.

## Corrections

**1. Offline reconnect test (`RunInspectorPage.offline.test.tsx`, fixture fix).** The root hypothesis holds. With the test's timing, the first stream batch (events 1–2) is flushed after 100 ms and its live refresh starts after the test has already begun holding its read. That refresh either joins the held read and reads the run again after release, or runs after the recovery read. Either way it adds a second GET that is unrelated to the outage.

Before holding the read, the test now waits for three things, with no sleeps:
- the Timeline heading shows `Timeline (2 events, …`, meaning the batch was flushed;
- the run has been fetched exactly twice (the first load plus the refresh's one read);
- the run query is idle.

From the source, nothing else fetches the run in this test: one `useRun` observer, no refetch interval while running, no window focus, and refetch-on-reconnect joins the held read. So the count of 2 should be deterministic. All original assertions are unchanged: offline/reconnecting stay locked, `runGets() - before` is exactly 1 (checked again after 50 ms), zero POSTs, and the view stays stale until a read that started after the loss commits.

I found no duplicate recovery in production code. If a live batch happens to arrive during recovery, the extra refresh read is the normal, bounded live-refresh behaviour, so I didn't change it.

**2–4. Queued-mutation tests (`SessionRecoveryControls.test.tsx`, `WaitPanel.test.tsx`, fixture fix).** I replaced the late `queryClient.setDefaultOptions({ mutations: { onMutate } })` with `view.queryClient.getMutationCache().config.onMutate = () => { queued = true; return held; }`. The mutation reads that callback when it runs and waits for it before calling the API, so no rerender is needed. The test bodies are now wrapped in `try { … } finally { release(); }`. All assertions are kept: queued becomes true, NOT_SENT for gate expiry, the "failure shown has changed" message, zero POSTs, and the WaitPanel draft value is still `'answer'`. No production send-guard change.

**5. Timeline keyboard focus (`Timeline.tsx`, production fix).** The diagnosis was correct. When the target row is already in the window, the anchor doesn't change, nothing re-renders, and the effect that moves focus never runs.
- `move()` now sets the focus request first, then `setActive(row.seq)`, then `onPause` and `setAnchor`. Making the target the active row guarantees a re-render, so focus still moves after any window shift and scroll-into-view is unchanged.
- In `onKeyDown`, a key that names the row already focused (Home on the first row, End on the last, PageUp on the first) still calls `preventDefault` but no longer calls `move()`. Otherwise it would leave a pending focus request, and a later re-render (such as typing in the sequence field) would pull focus back to the row. This is the same root cause; it existed before my change, and the `setActive` fix alone wouldn't cover it.

Anchoring, the 80-row window, paging, selection, the single Tab stop and retention behave as before. The 512-row tests and the bounded-history E2E only move between different rows, so they're unaffected.

**New regression test (`Timeline.test.tsx`).** One test on the 3-row paused list, with no parent re-render: ArrowUp, then Home, then Home again on the first row. It checks focus and the Tab stop after each move. It then types into the sequence field and checks that focus and the value stay there and the Tab stop doesn't move. It doesn't repeat the existing #420 test (Home, ArrowDown and End).

## Unresolved / risks
- **Typing assumption:** I couldn't read `node_modules`, so I'm relying on your diagnosis that in TanStack 5.104 `MutationCache.config` is a public mutable property whose `onMutate` is awaited before `mutationFn`. If typecheck rejects the assignment, the fallback is the rerender approach the passing tests already use.
- **Run count:** the fixed count of 2 assumes the first stream batch arrives as one flush. The fake API sends both events at once, so it should.
- I have no evidence of a remaining failure; it all depends on your test run.