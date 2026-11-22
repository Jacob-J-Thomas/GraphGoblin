**ACCEPT FIX**

I found no reproducible or structurally reachable defect that would let a #386 regression pass where the original test would have caught it. I compared the frozen `apps/web/e2e/inspector-truthfulness.spec.ts` against the brief's AFTER text and they match. I didn't run anything, so this is a reading of the code only.

**Why it's acceptable**
- **The original checks are kept.** The phase-1 header checks (lines 113–120) are unchanged in both variants and still run while refreshes are held. The held variant still sends one record at `terminal.seq - 1` and holds every later read (lines 89, 95).
- **The status must now come from the streamed event.** Before, the real observation request could return and supply the outcome, so a broken event path could still pass. Holding `/runs/:id/observation` for the whole test body (lines 65–78) closes that gap.
- **Capturing the row once is equivalent.** The row is read after the run has finished (lines 20–40), so the server state can't change. A fresh fetch on each read would return the same row, without the teardown risk.
- **The race handling holds up.** Requests are pushed in order (line 86). `slice(1)` is taken after the poll, so it includes every read so far. Reads that arrive later find `heldRun` already released. The `returnedReads >= heldReads` check is consistent because read #1 is counted in both.
- **Cleanup is sound.** It releases both holds, leaves the page, waits for `activeRoutes` to reach 0, then calls `unrouteAll({behavior:'wait'})`. The wait option already covers handlers that haven't started yet.

**Findings that don't block (root decides)**
1. **The post-release checks are weak, and the comment at lines 127–128 overstates them.** `response.finished()` and `response.json()` (lines 134–138) only confirm that the browser network layer received the test's own fulfilled body, so line 135 checks the fixture against itself. Two animation frames (lines 141–146) don't guarantee the app's fetch, React Query's notify step and React's commit have all happened. Lines 148–154 are retrying checks that pass as soon as the page still shows the old state, so they can't catch a flip to "running" that happens afterwards. The brief already says this isn't proven here and relies on a separate witness. I'd suggest rewording the comment to "browser responses completed" rather than "rendering".
2. **The stale variant now assumes a second read.** Line 121 requires a second `/runs/:id` read within the default expect timeout; the original only required one read. That ties the test to how the UI refetches. If it fails, it fails loudly rather than passing falsely.
3. **Overlapping readers can change which read gets record #1 (possible, not shown).** If the "attempt follower" and the run query fetch separately, whichever is intercepted first gets record #1. If the follower wins, the run query is held from the start. Phase 1 would then test "no record yet", and the stale variant's main scenario would only be covered by the weak phase 2. The original held variant already had this, but the delta extends it to the stale variant. Also, line 124 (`returnedReads === 1`) has a tiny window when read #2 is intercepted while read #1's fulfil is still in progress. Both would fail loudly.
4. **An aborted held read fails the test (line 133).** If the UI cancels a held refetch through an abort signal, `response()` returns null and the test throws. That's a fail-closed flake risk, not a false pass. I haven't seen it happen.
5. **Coverage is narrower.** The state "fresh real observation returned plus stale run record" is no longer asserted at any point. `returnedObservations === 0` (lines 123, 147) is true by construction. Whether that state belongs to #386 is your call.
6. **Minor points:**
   - `route.fulfill({json})` without `response` replaces the original status and headers with synthesized ones.
   - If the test fails, an exception from `goto('about:blank')` or the poll inside `finally` would hide the original error.
   - Releasing the observation hold before leaving the page sends real `continue()` calls into a navigation that cancels requests. I believe Chromium tolerates this, but I haven't checked against this Playwright version.

**Limits**
- I didn't execute anything, didn't look at the UI or its query wiring, and don't know the Playwright version.
- Findings 3 and 4 depend on UI fetch behaviour I can't see.
- This review doesn't show that React Query consumed the released responses. That rests on the separate witness.
- `claude-harness.spec.ts` matches the brief's description and its `succeeded` assertion is untouched. I didn't review it beyond that.