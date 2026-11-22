**CHANGES_REQUIRED.** Most of the seven-path GPT support delta is sound, but it can't be approved at this head as written. The blocker is that the docs and CHANGELOG claim a 401 from an older request can never reject the recovered key. Owner Chat's own requests still can, which is the final audit's P2. There is also one weak negative control.

**Reviewed source and range**
- Checkout `8632538fea2c95c3a528ef91ddbaefebf3d3bfba`, tree `0ac0f5afd77d3a418784082398d94c00e7c07375`, parent `3168250645fe37bced7ace6a664c82fd137b1196`.
- The exact seven-path diff from the brief. Changed ranges as they stand now:
  - `CHANGELOG.md:19-25`
  - `docs/09-frontend-and-pwa.md:70-72, 82-85, 95-104`
  - `ApiKeyPanel.test.tsx:1-216` (new file)
  - `api-key-fetch.test.ts:58-133`
  - `api-key.test.tsx:49-69`
  - `queries.reconnect.test.tsx:347-426`
  - `RunInspectorPage.corrective.test.tsx:1-15, 186, 315-359`
- Supporting context I read: `api-key.ts`, `ApiKeyPanel.tsx`, `useOwnerChatClient.ts`, `queries.ts`, `run-header-status.ts`, `run-header-store.tsx`, `useRunHeaderStatus.ts`, `bootstrap.tsx`, and `RunInspectorPage.tsx:140-259`.
- Model and effort: Claude Opus 5.5 / xhigh, as admitted by root. Read-only; I made no edits and ran nothing.

**Dispositions**
- **S1 / R2-1 – ACCEPT.**
  - The new rendered test seeds a matching `succeeded #3` row before the providers exist, so the header has no record of reading it. It holds the current GET and requires "Status from event #3…" with neither "Last node in run record: cached-node" nor any "at …" text.
  - The old selector would have shown "Updating status…", so the test catches the original fault.
  - After release, a current read supplies the qualified "verified-node".
  - The cold-cursor, unseen-later-events and resume controls stay with the existing unit tests.
- **S2 / R2-2 – ACCEPT.**
  - The cold case now requires a read error and nothing installed in the cache.
  - The warm case first takes a genuine `waiting #3` read, then sends another run's body with the same status and sequence. The run's earlier read record alone wouldn't catch this, because a repeated identical position leaves it unchanged. The test catches it by requiring the original cached row to stay in place, `isError` to be true, and `currentNodeId: 'real-wait'`.
  - A later correct response for the same run recovers and records the new position at sequence 4.
- **S3 – ACCEPT.** The exact-label check stays, and the new assertion that no "at …" text appears (line 186) proves the event-derived state hides the old position.
- **R2-3 recovery – ACCEPT, except the no-op control (finding 3).**
  - The quiet case and the four warm/empty × old-200/401 cases are real: actual HTTP 401, visible form, same-key submit, and no test-triggered refresh after submit.
  - Together they show the old read is aborted, exactly one fresh read runs under the current credential generation, and a late old 200 or 401 changes nothing.
  - The wrapper cases cover cancellation alone, a genuine current 401, and an old anonymous 401. The cross-tab generation case is correct.
- **S4 – CHANGES_REQUIRED** (finding 1). The event-qualified tail, wrong-ID refusal and cancel-then-refresh wording all match the code.

**Findings**
1. **Universal delayed-401 claim, already named by the final audit (not a new finding).**
   - Evidence:
     - `docs/09-frontend-and-pwa.md:99-102` says a delayed 401 "is applied only when both the sent credential identity and generation still match".
     - `CHANGELOG.md:24-25` says an older generation's 401 "cannot reject the recovered generation".
     - At this head that holds only for the management client (`api-key.ts:75-93`). `useOwnerChatClient.ts:14` compares key text only, so an old Devices 401 retires same-key recovery.
   - Impact: the published behaviour claim is false. S4 says not to make this claim while the owner Chat case exists.
   - Fix, either way:
     - If the planned owner-hook repair lands in this PR, check the wording again afterwards and name both request paths explicitly.
     - Otherwise, limit the claim to management API requests and record the Devices limitation as a scope decision.
2. **No owner Chat test (a consequence of the audit P2, not a new finding).** None of the seven paths covers the following, so these tests cannot detect P2:
   - an owner Chat request sent before rejection and recovery whose 401 arrives afterwards;
   - a current 401 on the same memoized Chat client after recovery.

   The repair author owns this coverage. Neither case is approved here.
3. **The unchanged-accepted-key control is weak (new, low severity).**
   - Evidence: `ApiKeyPanel.test.tsx:198-206` waits one microtask (`await Promise.resolve()`) before checking that no new read happened.
     - The panel's refresh runs through a multi-step async chain: `cancelQueries()` → `.then` → `invalidateQueries` → API client → fetch (`ApiKeyPanel.tsx:40-43`).
     - The generation check only exercises `accept()` in `api-key.ts`, not the panel's guard.
   - Impact: if the `!previous.rejected` guard regressed, the test would plausibly still pass. The generation would be unchanged and the stray read could land after the assertion. The handoff says the microtask "completes notification work before checking unchanged reads". Notification is already synchronous, so that wait does not prove a refresh would have been seen.
   - Fix: wait for at least a macrotask and for no queries to be fetching, then check the read and stream counts. Ideally, show that the same wait does catch the single read after a real same-key recovery.

The cold-hint title (no change wanted, to keep trace names stable), the 200/404/500 controls and the two comment-only changes in the E2E spec keep their earlier ACCEPT.

**Limits**
- Nothing was executed. The handoff reports 95/95 focused tests passing, plus the original lint failure that was then fixed; I relied on that.
- The test fixtures (`fake-api`, `render`) aren't in the admitted paths. I inferred how the fake API matches routes, when it records calls, and how it enforces the required key.
- Finding 3 rests on reasoning about React `act` and TanStack Query microtask depth, not on a mutation run.
- The R2-1 test uses a QueryClient with zero stale time (the app default is 2s) so the held GET happens. That is acceptable for this test.
- I did not inspect `DevicesPage.tsx` or the Chat client beyond the audit's attribution.

This review doesn't approve the UI implementation, the P2 production defect, or a merge. Root owns the decision.