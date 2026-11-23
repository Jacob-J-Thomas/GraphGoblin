# CHANGES_REQUIRED

One blocker: a cancellation that reverts the run query while its fetch is paused or waiting to retry retires a valid receipt. That removes the retained-run fallback in the outage states it exists for. It fails closed, and the repair is about one line plus tests.

I found no path that qualifies a body the tracked GET did not supply. `useRun`'s ordinary result, error and header-receipt behaviour reads as unchanged. Nothing was executed; every conclusion is from reading the source and the supplied query-core excerpt.

## Reviewed candidate

- **Head:** `30820901e97e2ba3af0e9796b39f14b5d421b99d`
- **Tree:** `eab694eaaf05d3698d359f4983872d7c4c08fba1`
- **Parent:** `0f6c325becf3e3e0562ae69dfae2c42bcf1d7129`

These are as supplied. The three files on disk match the supplied patch text line for line (`queries.ts` 151–170, the 256-line helper, the 387-line test). I could not hash them or read git state, so the head, tree and SHA-256 values are not independently verified.

## Blocker

**B1. A revert with no live GET retires the receipt for an unchanged revision** (`inspector-read-provenance.ts:119–125`)

`sameRevision` requires `entry.attempt`, which exists only while the query function is running. TanStack also reverts in two states with no live attempt:

- **Paused before start:** the query function has not been called for this fetch.
- **Retry delay after a transport failure:** line 209 has already ended the attempt.

In both, `setState({...revertState, fetchStatus: 'idle'})` (query.ts 730–736) restores the same body object and `dataUpdateCount`. `sameRevision` is falsy, and line 125 sets `committed` to 0.

Witness through the public API, extending the author's pause test (test lines 220–231). Outcomes are by reading, not execution:

```ts
const source = owner(); const cache = source.source.queryClient; cache.mount();
await read(source, run);
const previous = getInspectorRead(source, run).committed;   // > 0
const body = cache.getQueryData(run);
onlineManager.setOnline(false);
const paused = read(source, run);                            // { committed: previous, pending: 0 }, loss recorded
await cache.cancelQueries({ queryKey: run, exact: true });   // revert to the same revision
await paused;
cache.getQueryData(run) === body;                            // true: same object, same dataUpdateCount
getInspectorRead(source, run).committed;                     // 0; the contract expects `previous`
```

Reachable in the app:

- **Browser offline, run open.** The stream drop triggers the run reread (`useRunEvents.ts:183–186`), which pauses (query.ts 918) and records a loss. Leaving the run, or switching to another run, removes the last observer, and query.ts 531–538 cancels with revert. On return during the same outage, `committed` is 0.
- **API unreachable, browser online, default `retry: 1`** (`bootstrap.tsx:19`). After the first transport failure, leaving during the retry delay does the same. Runs polled at 1 Hz (`queries.ts:171–177`) spend much of an outage in that window.

Impact:

- The page cannot reconstruct the receipt, so the fallback is unavailable for that run until a post-outage GET.
- The same cancellation with a GET in flight keeps the receipt (test 360–386), so the outcome depends on whether the cancel lands before or after TanStack calls the query function.
- No unproven body is ever shown as observed.

Scope caveat: within one continuous production visit I found no revert of the run key. The controls, live refresh and stream paths I read only invalidate or refetch. B1 bites on leave-and-return and on A to B to A.

Decision for root: if revisits are outside #416's minimum, B1 becomes a suggestion and my verdict would be ACCEPT. I treated them as in scope because the contract binds the receipt to the physical cache entry rather than the visit.

Minimal repair: drop the `entry.attempt &&` conjunct at line 120. Identical body object, equal `dataUpdateCount` and `fetchStatus: 'idle'` already prove the same qualified revision, and this branch never raises `committed`. Add regression tests for:

- pause then cancel;
- transport failure, then cancel during the retry delay;
- real `useRun` unmount and remount while offline.

## The same-revision `Query.setState` limitation

I assess it as acceptable: hypothetical forgery of internal cache state, not a reachable defect.

- **The claim stays true.** The preserved receipt still names the GET that supplied that exact object at that revision count.
- **Nothing is advanced.** `committed` does not move, so it cannot satisfy a later loss boundary or release the latch.
- **No caller exists in what I read.** None of the application files calls a physical `Query.setState`, and `apps/web/package.json` lists no persistence, broadcast or devtools package.
- **A mismatch retires.** A reset, or any state with a different object or count, sets `committed` to 0.

The B1 repair widens this from "while a GET is held" to "at any time". I consider that still sound for the reasons above, but root should accept it explicitly. If not, track fetch-in-progress per entry and accept the restoration only then.

## Checked, no finding

| Area | Reading |
| --- | --- |
| GET attempt to commit | Only lines 105–108 raise `committed`. They require a nonmanual success whose `query.promise` is the attempt's own, eligibility set, signal unaborted, generation accepted and a new `dataUpdateCount`. |
| Equal-body commits | The count increments even when structural sharing returns the old object (query.ts 852). `committed` advances and line 115 notifies React even when TanStack's result is unchanged. |
| Manual, seed, uninstrumented | A manual success retires even for the identical object (94–97). A seed has no entry. An uninstrumented fetch has no attempt and commits at 0. A later revert cannot restore a retired receipt. |
| Cancellation and supersession | Abort ends the attempt (178–182). A late answer fails `current()` (188–194). B1 is the exception. |
| Refusal versus transport | A transport error records loss and keeps `committed`. Anything else retires at once (207–215), and no later transport error restores it. |
| Scope | The receipt is bound to registry identity, that registry's cache, the physical query and the credential generation. A request sent after a generation change fails `accepted()` at eligibility and at commit. |
| Notifications | Snapshots are immutable and `empty` is a constant. Every path that changes the answer notifies the per-cache set or the key store. I found no listener call during render. |
| Retained memory | Body, registry and fetch promise are weak references. There is one cache subscription per `QueryCache` for its lifetime. The abort listener is removed on every end path I traced. |
| `useRun` and header lifecycle | The inner function is the old one apart from reading `signal` from the context. The lease is still taken synchronously, the receipt precedes the commit, and the value and error pass through unchanged. |

## Suggestions (non-blocking)

- **S1. The loss boundary marks the start of the latched outage, not its latest failure** (lines 65–70; the comment at line 18 says "most recent").
  - Witness by reading: the run fails (L1); an observation GET starts and commits during momentary reachability; the run fails again and the boundary stays L1 (test 179–182); the run recovers.
  - `observation.committed > run.loss` is then true although the observation predates the last run transport failure.
  - For "Start fresh session", the failure-identity match and the server check bound the harm, but the control could still issue a POST the server refuses.
  - Either advance the boundary on every transport failure (this changes the expectation at test line 182) or document the meaning for the page author.
- **S2. Eligibility against real API bodies is unproven.**
  - `RunSnapshotSchema` is strict, so any field the real GET returns outside it makes every read ineligible and the fallback silently never appears. Only the fake transport has been used.
  - The parse runs on the main thread for every run GET, including 1 Hz polling; its cost on a large `result` is unmeasured.
  - Check both against a real listener in later QA.
- **S3. Further tests.** Add a transport failure followed by a successful retry under `createQueryClient()` defaults, and a key switch in `useInspectorRead`.
- **S4. Dependence on query-core internals.** The helper relies on `Query.promise` being the retryer's promise, on observers being notified before cache subscribers, and on revert going through `setState`. The dependency range is `^5.104.0`, so keep this test file in the required gate for any query-core bump.
- **S5. Any paused state is treated as loss** (lines 126–127). From memory of the retryer, which is not in the excerpt, a retry also pauses when the tab is hidden. An HTTP failure followed by a hidden tab would then record a loss with no transport outage. It is conservative, but worth verifying.

## Author tests and independent QA

- **Author tests (read, not run).**
  - The 21 cases use the real `useRun` for equal-body and the refusal matrix, and `fetchQuery` schedules for ordering. Their assertions match the code as I read it.
  - The 59/59 result and the coverage figures are retrospective author statements with no raw log.
- **Independent QA (report only).**
  - Its raw receipts are outside my allowlist.
  - As described, its schedules cancel only a GET in flight. Neither suite contains pause-then-cancel or retry-delay-then-cancel, which is why B1 passed both.
- **Header and page behaviour on this head.**
  - QA did not rerun the 38 reconnect and header cases, so header preservation rests on the author's unlogged run plus my reading.
  - Nobody reports running the page-level suites, such as `RunInspectorPage.corrective.test.tsx`.

## Not run and limitations

- I ran no tests, typecheck, lint, build or browser, and no git or hash commands.
- Some query-core behaviour is from memory, not the excerpt: `cancelQueries` defaulting to revert, cancelling a paused or pending retryer, where `#abortSignalConsumed` is reset, and the default retry delay. The author's test at lines 374–375 corroborates the first.
- If `#abortSignalConsumed` is reset earlier than I recall, the unmount path for a fetch paused before start would not revert. The `cancelQueries` witness and the retry-delay path do not depend on that.
- `packages/api-client/src/client.ts` is outside the allowlist. I could not confirm how a body-read failure after headers is classified; if it is not status 0, it retires the receipt as a refusal.
- I reviewed no UI, documentation or changelog work.