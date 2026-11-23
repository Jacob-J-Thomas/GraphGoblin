I've implemented #416 and #420 across all 15 allowed paths and left the three protected core files untouched. Nothing has been run: no tests, typecheck, lint, Prettier, build or browser. Everything below comes from reading the code, so none of it is passing evidence.

**Base:** I worked against 458f6cb06eded5cfeb2cf243093b60521a46f676 as you supplied it. I had no Git or hashing tools, so I couldn't confirm the base or the core file hashes myself.

## #416: what the inspector now does

- **Keeping the run on screen:** when a run read fails to reach the API, pauses, or the browser goes offline, the run section stays visible under "**Last observed, may be out of date**". The notice says whether the browser is offline, the API can't be reached, or the run is being read again.
  - It shows the run's status, failure, result, wait form and delivery or finalization state.
  - Nodes show their recorded IDs. The version-derived summaries and the execution context section are hidden during an outage.
  - Observation-derived parts are shown only from a qualified observation read.
- **What qualifies:** the run read uses the core's receipt (`committed > 0`). The observation read now goes through `trackInspectorRead` with an eligibility check: each field must be the expected event type and name this run.
  - A cold or unproved row still shows the ordinary offline state.
  - A definitive refusal shows its normal error, and a later transport error can't bring the run back.
- **Unlocking:** the run counts as current again only when `committed > max(browser loss, run loss, newest boundary this view has seen)`. The code and the docs both say this.
  - A browser disconnect is recorded with `markInspectorReadLoss()` at the moment it happens.
  - Coming back online, a health probe, the event stream reopening, or a read that started before the loss do not unlock anything.
  - The page adds at most one extra deduplicated reread per outage: of the run, or of the observation only when "Start fresh session" needs it. It joins any read already in flight.
- **Writes:** every control (pause, cancel, resume, replay, script recovery, fresh session, input/signal, delete-ready preview and confirm) takes a write gate. The page issues a new gate whenever the visit, run or outage boundary changes.
  - The gate is checked before a review opens, before a mutation is queued, and immediately before each POST. Every check sits inside the control, so keyboard submission is covered.
  - Mutation variables freeze the run, wait, consent, failure or selection identity.
  - Open reviews close, late previews are discarded, and a command queued across a loss, reconnect or A→B→A visit reports **Not sent**.
  - Cancel, reading and the draft of the same wait keep working. A write already sent keeps its real outcome; a delete-ready confirmation whose review expired mid-flight says it may or may not have been saved.
- **Start fresh session:** after an outage it also needs a post-loss observation whose failure event matches the current run, node and visit. It sends that failure event's own sequence, even when later audit events exist.
- **Unchanged:** the Runs list (it passes no gate), the Timeline, the thread, and query keys and cache shapes.

## #420: Timeline

- The fixed 30px track is replaced by a column sized to the widest sequence number in the visible rows. Rows wrap (number and type first, description below) on narrow screens or with enlarged text.
- I also made three small changes in `Timeline.tsx`. The event type's font size is now in rem so it follows text enlargement. The title count and window summary can wrap, and the "Go to event" form row can wrap. Without these, a 16-digit number could widen the card at 320px.
- Selection, keyboard, paging, Follow live, the 80-row window, the 512-event and byte budgets, and the live cursor logic are not touched.

## Tests to execute

- **`RunInspectorPage.offline.test.tsx`** (new):
  - retained waiting run with draft and zero POSTs, including keyboard submit
  - failed and succeeded runs retained without claiming finalization
  - cold load and unread seed stay unavailable
  - 500 refusal followed by a transport error doesn't bring the run back
  - browser reconnect plus a held pre-loss read stays locked, then exactly one more run GET unlocks it
  - replay and script reviews expire on loss
  - queued Pause after "lost" and "lost and read again" sends nothing
  - fresh session waits on a held observation, makes exactly one observation fetch, and sends `failureSeq: 3`
  - A→B→A
- **Component tests** added to the WaitPanel, SessionRecoveryControls, HistoryEligibility and Timeline test files. The Timeline ones cover 10593, 123456 and 2^53−1, the window-derived width, and keyboard and selection.
- **`e2e/inspector-availability.spec.ts`** (new):
  - Listener stopped with the browser still online: zero POSTs to `/runs`, recovery, then exactly one input POST.
  - Timeline at 1440px, 320px and 320px with 200% root text. It checks real text ranges, no overlap or clipping, no overflow inside the list, the card's narrowest width against the viewport, and keyboard movement.
- `docs/09-frontend-and-pwa.md` and `CHANGELOG.md` describe the behaviour above.

## Limits and risks

- **Execution context:** I couldn't read `ExecutionEvidence.tsx`, so during an outage that section is hidden rather than shown with unverified labels.
- **Assumptions I couldn't check by reading:**
  - The exact observation-read count assumes the stream's run follower doesn't trigger extra observation reads. Those files weren't in my read list.
  - The e2e SSE frames copy `FakeApi`'s format. I couldn't check how the event store handles sequences with large gaps.
  - The jsdom test reads the CSS variable with `style.getPropertyValue`, which assumes jsdom keeps custom properties.
  - `Card` and `Alert` internals were not readable.
  - I hand-matched Prettier and Tailwind class order; format may need a fix-up.
- **Enlarged text in the e2e:** it means a 200% root font size. At that size other sections, such as the run ID heading, may still widen the page. So the page-edge check only applies at normal text size, and the Timeline is checked against its own card.
- **Not covered:** there is no page-level test that a credential change can't clear the latch; the code keeps the boundary to cover that.
- **Behaviour change outside outages:** fresh-session matching (same run, node and visit) now applies in healthy mode too.
- **Browser-loss listener:** it is installed once per app session and stays for the app's lifetime.
- **Core defects:** none found; nothing needed stopping.

Root still owns everything after this: the checks, independent review and QA, browser and listener evidence, CI, the final audit, and the signed merge. This is not an acceptance claim.