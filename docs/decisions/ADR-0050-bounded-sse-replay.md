# ADR-0050: Bound SSE replay and slow-consumer buffering

Date: 2026-10-23. Status: Accepted implementation decision for #186 round 1.

Revised 2026-10-24 after review: durable catch-up replaces overflow/gap failures.
Round 3 bounds terminal confirmation with indexed lifecycle-tail reads.
Round 4 confirms durable suffix delivery and adds authoritative stream completion.

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
  confirmation. A terminal lifecycle plus an empty confirmed tail emits id-less
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

History browsing follows in #186 round 2: per-run history retention, opaque-cursor
browsing and Timeline windowing remain open. This ADR does not close the whole bolt.
