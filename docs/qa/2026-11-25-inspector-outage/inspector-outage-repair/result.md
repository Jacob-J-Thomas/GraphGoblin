I've implemented #575 within the assigned paths. **I ran nothing: no tests, typecheck, lint, prettier check, coverage or Playwright.** No shell was available, so all of it is still for you and QA to run.

## Changed paths

- `apps/web/src/runs/inspector-read-provenance.ts`
- `apps/web/src/runs/useRunEvents.ts`
- `apps/web/src/runs/inspector-read-provenance.test.ts`
- `apps/web/src/runs/useRunEvents.test.tsx`
- `apps/web/src/runs/RunInspectorPage.offline.test.tsx`
- `apps/web/e2e/inspector-availability.spec.ts` (the original real-listener test is unchanged; `runStatus` gained an optional `base` argument)
- `CHANGELOG.md` (one bugfix note at the top of Unreleased)

`RunInspectorPage.tsx` is untouched. Its ordered loss boundary, synchronous `gate.open()` check and post-loss reread effect now see the stream loss without changes.

## Design

- **New function `markInspectorTransportLoss(owner, queryKey)`.** It records the stream loss in the same per-query state that `getInspectorRead` and `gate.open()` read, synchronously, with no React state involved.
  - It never sets a query error and never marks cached data as read. Committed evidence stays, and a read already in flight keeps its pending identity.
  - It takes a new position from the existing counter, so a read started before the loss can't unlock even if it answers afterwards.
  - Within one unrecovered outage the boundary is kept. The exception: if a read started after that boundary is still unanswered, the boundary moves past it, because that read may have been answered before this second loss.
  - It records nothing without an owner, under a rejected key, or when the query doesn't exist (it never creates a query).
  - Another owner or an older credential generation is replaced by a fresh entry that holds the loss but no evidence. This is the same rule `trackInspectorRead` already uses. A cached row with no qualified read is therefore withheld, not shown as current.
- **Small refactor.** Entry creation moved into a private `own()` helper that `trackInspectorRead` now also uses; its behaviour is the same.
- **`useRunEvents`.** On the first transport failure of a reported stream outage, it records the loss before `markApiUnreachable()` and before its existing joined refetch. The owner follows the same rule `useRun` uses (registry client must equal the app client).
  - Retired streams, HTTP or protocol errors, slow-consumer and replay errors, clean EOF and frame errors (attempt 0) are filtered by the existing guards, so they record nothing.
  - Repeated refused retries are already suppressed by `reportedOutage`, so you get one boundary and one reread per outage. A failure after the stream advances its cursor, or after it has been open for at least 15 seconds, still counts as a new outage.
- **Recovery path.** A pre-loss read that answers successfully settles into "last observed", and the existing effect then issues one post-loss read. If the API is down, that read fails and the shared probe takes over. Global health alone never unlocks the view.

## Test intent

- **Provenance unit tests:**
  - A held pre-loss read answers after the loss: the evidence is kept, the request is untouched, and the run is not current.
  - Repeated losses keep the boundary; a loss after recovery creates a new one.
  - A loss during an unanswered recovery read advances the boundary.
  - The boundary is shared with transport failures of the reads themselves and survives cancellation.
  - Negative cases: no query, no owner, rejected key, replaced owner (no borrowing evidence back), new generation, removed query.
- **useRunEvents unit tests:**
  - The loss is visible inside the `onError` call, before React re-renders, and before `refetchQueries` is called.
  - Refused retries change nothing; the joined pre-loss read stays insufficient; cursor progress re-arms a distinct outage.
  - Nothing is recorded for HTTP, slow-consumer, clean-EOF or attempt-0 failures, for a stream retired by a credential change, or for a registry belonging to another API client.
- **Integration test** (whole app, FakeApi, real SSE helper):
  - Sequence: an input answer is queued; a run read is held in flight; the stream drops and reconnects are refused.
  - Writes are still answered, so any leak would show up. A store subscriber releases the queued answer at the moment the loss is reported.
  - Expected after the loss: "last observed" warning shown, the held read joined rather than replaced, the answer reported **Not sent** with no POST, all write controls disabled, the draft kept, and implicit form submission sends nothing.
  - Expected after release: the pre-loss success is not enough, exactly one refused reread follows, and the run stays last observed.
  - Expected after recovery: a post-loss read unlocks, and one POST carries the kept draft.
- **Browser test** (isolated `/apps` instance, run-route barrier):
  - The next run GET is answered by the live listener, then held. It is started by dispatching `visibilitychange` on `window`, which triggers TanStack's focus refetch.
  - Then: listener off, Timeline shows `connecting…`, the warning must appear while the read is still held, controls disabled, no writes, read joined.
  - Then: release, wait for the refused reread, still stale, listener on, recovery within the existing 45 s budget, one POST, run succeeds.
  - Retries stay at 0 and the existing timeouts are reused; cleanup is in `finally`.

**Expected baseline failure:** the base has no `markInspectorTransportLoss`, so the two unit-test files fail on import there. The real baseline failure is in the integration and browser tests: after `connecting…`, the "last observed" warning never appears. In the integration test the queued answer would also be sent.

## Limitations

- The integration test relies on the SSE helper's real 500 ms backoff after a clean close. FakeApi has no way to drop a stream with a transport error, and its fixture is outside my paths.
- The browser test depends on two things I couldn't check by running it:
  - `page.route` must see API requests while service workers are allowed. The Timeline tests in the same file and `events-refresh.spec.ts` already rely on this.
  - Recovery comes from the shared probe's 2/4/8/16 s backoff.
- **Decision for you:** I kept the existing `reportedOutage` rule. If the stream reconnects and drops again within 15 seconds with no new events, that counts as the same outage, so no new boundary is recorded and the write gate can be open during that second drop. Recording a loss on every drop would cost one run read per flap instead.

## Docs

`docs/09-frontend-and-pwa.md:190-195` already describes this behaviour exactly as implemented, so no edit is required. I can't tell whether that text was in the base or added in parallel. One optional clarification, outside my paths: append after line 195 _"A stream loss counts once per stream outage; after the stream delivers a new event or stays open for a heartbeat interval, a later transport failure is a distinct loss."_
