# ADR-0050: Bound SSE replay and slow-consumer buffering

Date: 2026-10-23. Status: Accepted implementation decision for #186 round 1.

Revised 2026-10-24 after review: durable catch-up replaces overflow/gap failures.
Round 3 bounds terminal confirmation with indexed lifecycle-tail reads.
Round 4 confirms durable suffix delivery and adds authoritative stream completion.
Amended 2026-10-26 after acceptance (D1): following a run live reads only bounded read models, coalesced.

## Context

The current baseline materializes 41,008 events before the first event reaches the
reader, ignores `write` backpressure, and holds live appends without a bound during
replay. The [before measurements](../qa/2026-10-22-wp-e1-186-before.md) reproduce this.
The durable event store already supports exclusive sequence reads with a limit.
Stored history and the loop's intended context must remain complete.

## Decision

- Read 128 events per page, write the page before reading the next, then yield with
  `setImmediate`. The measured average frame is about 470 bytes; roughly 60 KiB per
  ordinary page balances short reads against query overhead. One named constant owns
  page size. Count paging cannot bound the intrinsic size of arbitrary stored values.
- Confirm a consumed terminal cursor with the newest lifecycle marker, before headers for an
  empty first page and after catch-up otherwise. The engine persists the terminal event before
  its status, including recovery that completes a lost status write. That event is **not always
  the last row**: finalization and recovered return deliveries append audit events afterward.
  A resumable failure also ceases to be current once `run.resumed` is durable; `run.started`
  invalidates an earlier outcome too, matching the engine's `terminalEvent` rule.
  SQLite therefore uses one statement with five indexed `MAX(seq)` seeks (the three terminal
  types plus started/resumed), followed by one primary-key row read. The existing
  `run_events_delivery_idx (run_id, type, seq)` supports these seeks; no migration is needed.
  Confirm only a terminal marker at or before the written cursor. This work does not grow
  with history length or post-terminal audit volume and does not assume a fixed tail window.
  If no current terminal marker exists, preserve the 2-second defensive grace close and live
  subscription. Missing bounded metadata at a consumed cursor in a standalone composition also uses grace.
- Never close on an individual terminal event: it can be superseded by a later started/resumed
  marker, and delivery audits can follow the current outcome. Deliver every replay page and
  held notification first. With the writer still locked, look up the current lifecycle, then
  make another bounded cursor read. More rows/notifications re-enter catch-up before another
  confirmation. As amended by ADR-0057 (#185), require the existing durable finalization acknowledgement
  after terminal lifecycle confirmation; pending delivery remains live and its marker is rechecked
  by one 250 ms timer. A terminal lifecycle, finalization acknowledgement and an empty confirmed tail emit id-less
  `event: stream.complete` with `data: {"after":<written cursor>}`, then closes. Completion
  acknowledges the tail-read snapshot, not the immutability of future history. Later appends
  require a new subscription. Port-only compositions can track the newest lifecycle marker
  delivered during replay; a consumed cursor still requires the bounded metadata lookup.
  An empty terminal-cursor reply now uses three bounded empty reads and two lifecycle lookups;
  one additional tail read closes the lookup/append race without history-size-dependent work.
  Missing/currently resumed metadata keeps grace, which closes without a completion control.
- Subscribe before reading, but retain no live copies during replay/catch-up:
  notifications follow commit, so subsequent pages return those events. After a short
  page, enable live notifications first, then read again from the cursor. Keep paging
  while pages are full; a short confirmation page hands off to the sorted live queue.
  Events committed before the switch are read; later events are read or held, with
  overlap deduplicated by sequence. This closes the read/switch race.
- The live queue holds at most 256 events or 1,048,576 encoded UTF-8 bytes. Count
  protects tiny bursts; bytes protect larger events. On overflow, an oversized event,
  or a live sequence gap, clear the queue and re-enter paged catch-up from the written
  cursor on this connection. These signal notification pressure, not reader slowness.
  No durable history or context is discarded and no failure is sent. Contiguity is
  checked only for live notifications; replay follows authoritative repository order,
  including a durable sequence gap.
- Write UTF-8 frames in 16,384-byte chunks. Stop immediately on false and await
  `drain`. Cap ordinary pending writes at 262,144 bytes (a generous margin above
  Node's normal high-water mark). One large event is serialized at a time, without
  an event-size cutoff or altered payload. This avoids rejecting large history values.
- Skip heartbeat writes while the writer is busy. Fail after 5,000 ms without drain:
  enough for the measured one-second initial hold and 50 ms paced reader, finite for
  a stalled peer. This is a transport recovery policy, not a run execution limit.
- Only a writable-ceiling breach or drain timeout declares a slow consumer. Failure
  is id-less `event: stream.error` Problem Details with status 503 and code
  `SSE_SLOW_CONSUMER`. Allow the small control to queue behind accepted bytes; end
  the response and force socket destruction after 2,000 ms if it never drains. This
  bounds retained connection lifetime. A permanently unreadable transport cannot
  guarantee delivery of its own error; premature EOF/network failure is reported by
  the client, which resumes from its own last complete event. No server write cursor
  is treated as acknowledgement by the client.
- Place `id` after `data`. A failure appends invalid data to an unfinished frame and
  restores its id to the previous complete event, then separates the problem control.
  It does not insert an extra blank line at an existing line boundary: even complete
  JSON must not dispatch before its id. A wholly accepted frame stays intact. The
  parser reports partial data; the complete-event cursor remains the resume point. SSE field
  order is not a contract change; `after` and `Last-Event-ID` remain exclusive seqs.
  For contiguity checks, numeric header bounds use their nonnegative integer floor,
  preserving negative and fractional exclusive-bound behavior over stored integer seqs.
- Validate only each page. Before headers, read failures remain HTTP problems. After
  headers, unreadable stored history emits `STORED_EVENT_INVALID`; other read errors
  emit `SSE_REPLAY_FAILED`. Corrupt history is fatal until repaired; other read errors
  follow the existing 5xx retry/backoff, like a first-page HTTP failure. No payloads
  leak in their fixed detail.
- Reuse `GraphGoblinApiError` for typed controls. Report retryable failures before
  the existing backoff, preserve the last delivered cursor, and retain finite
  `maxAttempts`. Reject `done` for corrupt history or nonretryable controls. Cancel the underlying Fetch reader
  directly on abort, avoiding transform-stream cancellation stalls on quiet bodies.
- The client resolves `done` on a valid completion control whose `after` matches its delivered
  cursor, never on a historical terminal event or arbitrary EOF. Completion carries no id and
  cannot advance the cursor. EOF without it still retries from the last delivered event.
  Both initial HTTP Problem Details and in-stream errors use the same classification:
  `STORED_EVENT_INVALID` is fatal and typed; transient 5xx read failures retain backoff.
- Flush browser held batches at 256 events or an estimated 1 MiB of UTF-16 JSON,
  including timer throttling. A larger single event flushes immediately. Render the
  slow-consumer reason as the hook's error until a successful reopen. The client
  supplies the received JSON text's size as the second `onEvent` argument, avoiding
  an extra serialization in the hook; the event store keeps its existing accounting.

These numeric choices are engineering parameters, not owner-approved values. No
dependency, stored shape, migration or execution guardrail changes.

## Consequences and verification

Replay memory depends on one page and an individual event's intrinsic serialized
size, rather than the entire log. Temporary handoff and writable buffers are bounded.
The small failure control is the sole permitted addition beyond the normal write
ceiling. An oversized live frame re-enters paged replay without a stream failure.
Fast readers can follow active runs regardless of total appends during replay.
Exactly one active writer prevents heartbeat/live writes from bypassing
backpressure. Disconnect and failure release listeners, timers and held frames.

Tests use supported ports, real HTTP sockets and disposable SQLite storage. The
[after evidence](../qa/2026-10-22-wp-e1-186-after.md) repeats the baseline workload;
only workload-specific observations support performance claims. The public SSE
field order assertion in the existing edge test now validates terminal JSON data.

## Round 2: bounded browser history (2026-10-24)

The browser half retains one window per run, at most 512 rows and 1,048,576 estimated UTF-16 row-JSON bytes, persisted with its independent SSE acknowledgement, mode and opaque paging boundaries. Count protects tiny events; bytes protect payload-heavy runs. A 512-row window covers about 40 passes of the measured cyclic workload; 128-event history reads align with the server's bounded replay pages. Oversized events retain a small sequence/type/description marker (ordinary accessible names are preserved, with the existing 4,096-character preview budget for pathological summaries); one exact explicitly requested payload is transient, never cached. Storage failures are nonfatal. Device cache version 2 discards the old cache; server history and stored shape are unchanged.

History mode freezes the visible window while live acknowledgement continues. Older/newer pages join by sequence and trim the opposite side, invalidating any cursor no longer at the retained edge. Numeric seeks acquire fresh positions; subsequent paging passes run-bound opaque cursors unchanged. Returning live catches the acknowledged suffix before switching modes, bounded to eight additional pages per explicit action, with a visible retry reason if the history keeps outrunning that action.

Timeline row windowing mounts 80 rows without fixed-height assumptions or a new dependency. Row interaction pauses follow, preserving keyboard focus and selection. Arrow, Home/End, Page Up/Down, boundary Tab and persistent paging controls support browsing; Follow live resumes tail scrolling.

Whole-history projections move to server reads: run record for status/position/result/failure/delivery; indexed latest evidence for exit/gate/finish and attempt following; #116 current thread for live context; exact historical thread and previous boundary for selection/patches. Domain replay state is carried across server pages, including unfinished starts and delayed duplicate completions. Node progress explicitly describes the retained window; older progress and exact values remain browsable. Browser replay and its 32-thread cache are removed rather than being fed truncated history.

These are implementation parameters, not owner-approved budgets or execution caps. Round 2 implements the bolt's remaining browser scope; review, independent QA and integrated acceptance are separate delivery gates. Measurements and limits are recorded in [the round-2 evidence](../qa/2026-10-24-wp-e1-186-r2/README.md).

## Round 2 acceptance fix: bounded live following (2026-10-26)

### Context

Independent acceptance of round 2 found that an inspector following a long run live starved the
whole gateway (D1, High). On every 100 ms stream batch the inspector refreshed the run record,
`/observation` and the current thread, and while the latest event was a completion its default
selection also read `thread?at=N` and `thread?at=N-1`. `historicalThread` starts from the run's
single stored checkpoint only when it precedes the boundary, and the executor rewrites that
checkpoint after every node completion, so `at=N-1`, and any boundary already behind the newest
completion, replayed the history from the admitted seed: 163 ms at about 2,000 events, 752 ms at
10,000. On this fix's base build a cyclic run fell from 108.9 to 7.4 events/s while followed from
about 5,200 events and from 98.9 to 1.4 events/s from about 10,100, and an unrelated run on the
same gateway fell with it. No data or ordering was lost.

### Decision

- **The live path reads only bounded read models.** Following live reads the run record (one
  row), `/observation` (indexed latest reads and at most 20 fresh-session rows) and #116's current
  thread (the checkpoint boundary and the events after it). It never reads `thread?at`. The live
  view's thread panel is always the current thread, whatever the latest event is. A completion's
  exact before/after patch diff is read when the reader selects it, which pauses following: two
  reads per selection, each replaying the history before its boundary from the latest checkpoint
  at or before it, as docs/07 records for history mode.
- **Refreshes are coalesced.** The first change after a quiet interval refreshes at once; later
  changes within 500 ms, or while a refresh is in flight, merge into one trailing refresh. No
  change is lost, refreshes never overlap and a slow gateway slows them instead of queueing them.
  500 ms keeps status, evidence and the current thread visibly live and bounds a followed run to
  at most two refreshes a second. It is an engineering parameter, not an owner-approved budget.
- **A refresh reads only what its changes can affect.** The run record is read on every refresh.
  `/observation` is read only after a lifecycle, cancellation-request, exit or decision event. The
  current thread is read only after an event `replayThread` applies (domain `THREAD_EVENT_TYPES`:
  node start and completion, decision, iteration change), and only while it is shown; a change
  while a selected event's thread is shown is read once, when the current thread returns. A domain
  test checks that every other contract event type leaves a replayed thread unchanged, so a new
  thread-changing event type cannot be missed silently.

### Alternatives considered

- **Retained checkpoints near the tail.** A ring of recent completion checkpoints cannot promise
  coverage: a fast loop completes several nodes between a stream batch and its read, so a lagging
  reader still replays from the seed in exactly the workload that exposed D1. Uniform stride
  checkpoints would bound every boundary read, but their storage grows with history length times
  thread size (each stores the whole thread) and they add writes to the executor's completion
  path; capping their number brings back unbounded reads beyond the retained span. Live following
  does not need them; they remain a possible history-mode improvement.
- **Computing the live completion diff in the browser from streamed events.** A patch records only
  the new state, not the values it replaced. An exact diff needs an anchor thread with its boundary
  sequence and domain replay state from the server, which would publish internal replay state, and
  per-event patch application in the browser: the browser replay and thread cache round 2 removed
  to bound browser memory.
- **An API cache of recently read historical threads.** It cannot bound server memory while
  guaranteeing coverage for large threads, and a missed entry replays from the seed again.

### Consequences and verification

Following a run live no longer starves the gateway: in the aligned measurement the followed run
and its neighbour kept 111.3 and 107.9 events/s from about 5,000 and 10,000 events, against 124.9
and 119.8 unobserved on the same shared host, with no `thread?at` read. The read rate depends on
elapsed time rather than the run's event rate. The live view no longer shows a default-selected
completion's historical thread or patch diff; the reader selects the completion to see it. Reads
for a selected event are unchanged and remain proportional to the history before their boundary;
they are user-paced, two per selection. The current-thread read decodes the events after the
latest checkpoint, which belong to the visit in progress. It is issued only after thread-changing
batches, so a node streaming progress costs the run-record read alone. No API route, contract,
stored data or migration changes. The Timeline, retention, paging, slow-consumer recovery and
reconnect are unchanged.

Regression tests through public interfaces: web `live-follow.test.tsx` (read kinds and counts
while the page follows a fast cycle and a progress stream, and a selection's exact reads, against
the fake API), `live-refresh.test.ts` (coalescing with fake timers), domain `replay.test.ts`
(`THREAD_EVENT_TYPES` is complete) and Edge `e2e/live-follow.spec.ts` (no `thread?at` read and at
most one refresh per elapsed 500 ms while following a fast run on the built product). The bounds
are counts derived from elapsed time, never wall-clock thresholds. Before/after gateway rates and
read counts are recorded in [the acceptance-fix evidence](../qa/2026-10-26-acceptance-fix-186/README.md).

### Review round 1 (2026-10-26)

Review of the fix (PR #418) found that one live-path read still grew with history and that two
refresh orderings could leave the context stale or read it twice; behaviour QA added one display
defect of the fix and three accessibility defects of round 2's Timeline.

- **Bounded evidence lookups.** `/observation`'s latest gate scanned every decision newer than the
  last one carrying gate evidence, all of them in an ungated cyclic loop, which is valid (review
  measured 7.5, 27.4 and 302.5 ms at 99, 10,099 and 100,099 decisions). The fresh-session choices
  scanned resumes the same way. Migration 0021 adds two partial indexes on `run_events (run_id,
seq)`: one holding the decisions whose payload has gate evidence, one holding the resumes that
  record a fresh-session choice. Both also hold rows whose JSON is malformed, so a read of the
  newest one still reports the corruption instead of skipping it. Each read names its index and
  repeats its condition word for word, so SQLite seeks the index (one entry for the gate, at most
  20 for the choices) or fails loudly; it never falls back to a scan. A durable projection on the
  run row was the alternative: it needs engine or repository writes on every decision and a
  backfill, and loses the corruption report. An append now evaluates two type comparisons; only a
  decision or a resume also parses its payload for the index condition. Measured on the built
  product after the change: 5.8, 6.2 and 6.7 ms at 101, 10,101 and 100,101 ungated decisions.
- **Reads that cover the change.** A refresh reads each read model with a request that starts
  after the change. A request already in flight, such as the first load, may hold an older
  snapshot, and invalidating a query that has no data yet reuses that request; so the refresh lets
  it settle and then reads again. A failed read keeps its change pending for the next refresh a
  later change requests, without retrying on its own.
- **One refresh at a time, including the return to live.** Showing the current thread again after a
  selection reads it through the same coalesced refreshes, so it never runs beside a refresh that a
  live batch requested.
- **The thread on screen stays while a selection is read.** Round 2 kept the previous selection's
  result as the placeholder; once following live stopped reading selections, that was an older
  selection the reader had left. The inspector now keeps whichever thread was on screen just
  before, with its own label.
- **Timeline accessibility (round 2's own window).** The polite region that announced "Showing
  events X–Y" on every live append now says only "Following live." or "Following paused." with the
  window, so it changes when the reader acts; the visible range text is unchanged. One row is in
  the Tab order, so Tab and Shift+Tab leave the rows in one step (round 2's boundary Tab moved
  through every retained row instead). Paging controls stay focusable while they cannot act
  (`aria-disabled`), so Follow live keeps keyboard focus after it resumes following.

The migration is 0021, the next free number on `main`: this fix merges ahead of PR #412 and #256,
which renumber their migrations, restamp their journal times after it and rechain their snapshots
when they integrate. Regression tests, each of which
failed on the code before this round: infrastructure `evidence-index.test.ts` (query plans through
Drizzle's public query logger), web `live-follow.test.tsx` (overtaken first read, serialized
return, thread kept during a selection's read) and `Timeline.test.tsx` (announcements, Tab out,
focus kept), and the Edge `e2e/live-follow.spec.ts` accessibility test. `live-refresh.test.ts`
covers the scheduler's unread changes. Evidence: [review round 1](../qa/2026-10-26-acceptance-fix-186/README.md#review-round-1).
