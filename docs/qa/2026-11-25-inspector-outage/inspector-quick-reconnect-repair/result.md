I've made the fix in the three files I own, but I haven't run anything: no tests, typecheck, lint, prettier or browser gates. You'll need to run the focused suites and browser gates.

**`apps/web/src/runs/useRunEvents.ts`:** fixes F575-1.

- The hook now notes whether the connection actually opened, just before it clears `openedAt`.
- If the outage has already been reported and a connection that opened then drops by transport failure, it now calls `markInspectorTransportLoss` synchronously. The existing provenance logic then sets a new boundary if the run had recovered, or moves the boundary past a recovery read that hasn't answered yet.
- That later drop doesn't call `markApiUnreachable` or request a reread. The 15s/cursor-progress re-arm and the one-reread-per-outage limit are unchanged, and serving the new boundary is left to the inspector's existing post-loss effect.
- Retries that never opened record nothing and request nothing.
- The HTTP, protocol, clean-close, attempt-0 and `current()`/auth checks all run before the new code, and the slow-consumer/replay-failed path is untouched.

**`apps/web/src/runs/useRunEvents.test.tsx`:** I added one test under the #575 describe and left all existing tests unchanged. It runs:

1. First loss, then a run read that qualifies.
2. Recovery reopens the stream (`options(1).onOpen`), and a run read starts while it's open.
3. The stream drops immediately, with no events and under 15s.
4. It checks the new boundary is visible straight away, is newer than the pending read, and that the read count is still 1.
5. The read started before that drop answers afterwards and does not make the run current again.
6. A recovery read starts after the loss. Refused retries (`network('refused')` and `TypeError`, with no open) leave the boundary and read count unchanged. If code wrongly recorded a loss on every retry, the boundary would move past this pending read and the test would fail.
7. The recovery read then qualifies.

I also checked the existing rapid-drop and cursor re-arm tests. They don't create a run query, so the new call does nothing there and their read, reachability and subscribe counts should be unaffected.

**`CHANGELOG.md`:** replaced "Repeated stream failures keep one outage and one reread" with: refused stream reconnection attempts trigger no further rereads, while a stream that opens again and then drops records a new loss.

One gap remains because it follows from the semantics you specified. If a run read recovers the run and the next reconnection is refused before it ever opens, while the outage is still marked as reported, no new loss is recorded.
