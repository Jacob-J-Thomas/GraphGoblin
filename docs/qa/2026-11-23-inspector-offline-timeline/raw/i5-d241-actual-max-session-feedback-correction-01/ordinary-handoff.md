I've moved ownership of the Start fresh session action out of the run section into a hook that the inspector page always mounts. None of the tests, typecheck, lint or build have been run; everything below comes from reading source. Only the six permitted paths changed, and `queries.ts`, `inspector-read-provenance.ts` and its test are untouched.

## Changed paths
- `apps/web/src/runs/inspector/SessionRecoveryControls.tsx`
- `apps/web/src/runs/RunInspectorPage.tsx`
- `apps/web/src/runs/inspector/SessionRecoveryControls.test.tsx`
- `apps/web/src/runs/RunInspectorPage.offline.test.tsx`
- `docs/09-frontend-and-pwa.md`
- `CHANGELOG.md`

## Implementation
- **New hook, `useSessionRecovery({ owner, run, events, availability })`:** it now owns `useMutation` and the shown-failure identity. The dispatch checks are unchanged: `assertOpen(gate)` first, then the run/node/visit/failure-sequence comparison, then `runs.recoverSession`, with run/thread invalidation on success. It returns `answerable`, `pending`, `refusal`, `blocked` and `choose()`.
- **Pending and refusal are scoped to the visit:** they show only when the current choice's `owner` is the visit that made it (`action.variables?.owner === owner`). Another run, or a later visit to the same run, sees neither. `choose()` also refuses while a choice is pending.
- **`SessionRecoveryControls`** is now presentation only, taking `{ run, events, recovery }`. There is no fallback to the old contract.
- **`RunInspectorPage`:**
  - I named the existing section guard `presented` (line 262) without changing it, and the section uses it at line 476.
  - The hook is called unconditionally after the gate effects (lines 362–367), with `owner: visit`, `run: presented ? run : undefined` and `availability: sessionGate`.
  - The section passes `recovery={sessionRecovery}` (line 549) and stays hidden while it is withheld.

## Design critique
- **The real-scenario fix holds.** Only the presentation remounts, so the old pending choice keeps the replacement button disabled. When it settles, its actual **Not sent** shows in the re-shown section.
- **Choices already sent are no longer lost.** If a POST went out before the section was withheld, its real outcome is now reported in the re-shown section; the old design dropped it.
- **A stale-identity problem is gone.** In the old design, a remounted section left the old mutation comparing against the unmounted component's last identity. The hook keeps the identity current, and it is empty while the section is withheld, so a choice that somehow got through an open gate there would be refused as "failure changed".
- **The ownership token is the page's existing `visit`** (a `useMemo` keyed on `runId`), the same identity the gates already depend on.
- **A → B → A trade-off:** coming back to A hides the first visit's pending choice and its outcome, so the button is enabled again. That can't send twice, because the old gate is spent, but that old outcome is never shown. This matches the old keyed-section behaviour.
- **A choice that never settles** keeps the control disabled for that visit until the user navigates away. That is the requested behaviour.

## Regression intent
- **Historical-loss case** (offline suite, placed after the browser-reconnect test so the earlier fresh-worker cases still have no outage boundary):
  1. The test takes the browser offline and back online itself and waits for genuine recovery, so it doesn't depend on test order.
  2. It queues a choice, then fails only the observation read with a `TypeError`.
  3. The mounted ApiKeyPanel receives a storage event for `gg_second_key`. The test then checks that the original header and button are gone and the "not been confirmed" message shows.
  4. It waits for the run and observation GETs under the second key and checks that the replacement header and button are new elements.
  5. The replacement button must be disabled only because the choice is pending (the evidence-blocked text is gone).
  6. After release, **Not sent** must show and persist, with zero POSTs.
  7. A new explicit choice sends exactly one POST with `{ nodeId: 'worker', failureSeq: 3 }`, and the report clears.
- **Route/identity case:** queue a choice on run A, open B through A's "parent run" link, and check that B's button is enabled with no "Not sent" text. Then queue B and release both. The mutation outcomes must be `[NOT_SENT, 'success']`, nothing "Not sent" is shown on B, there are zero POSTs for A and one for B.
- **Unit tests:** every existing case now runs through a small `Inspector` harness, with all assertions unchanged. I added one case where the section is withheld and shown again (stays pending, then **Not sent**, then one new POST). I added another where the owner and run switch (no pending state or refusal carried over; the old choice is refused as "failure changed"; the new run sends once with seq 9).

## Source-only risks
- **Immediate DOM check:** the historical-loss test asserts the section is gone straight after a synchronous `act()`, relying on `act` flushing the store update before it returns.
- **Mutation order:** the route test assumes `getAll()` returns mutations in insertion order and that no other mutations exist on the page.
- **Type narrowing:** using `run.id` inside `presented ? …` relies on TypeScript narrowing through a named condition (supported since 4.4; the repo uses 6). If typecheck disagrees, the fix is trivial.
- **Offline text:** I wait on the "Last observed" title rather than "This browser is offline.", because that text also appears in the session control's help text.

## Unresolved (parked, not claimed fixed)
- **#562:** with no outage history, replacing the key while healthy doesn't replace the session gate, so credential consent is still open.
- **#561:** body-error classification is untouched.
- **#563:** the broader reflow is untouched.
- **No cross-credential or two-tab claim:** the docs and CHANGELOG describe only that the action survives temporary withholding while qualification and the gate stay as they were. They claim nothing about safety across credentials in general or about two real browser tabs.