# ADR-0050: Bound SSE replay and slow-consumer buffering

Date: 2026-10-23. Status: Accepted implementation decision for #186 round 1.

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
- Subscribe before reading. Hold live encoded frames in a queue capped at 256 events
  or 1,048,576 UTF-8 bytes; sort handoff and deduplicate against the written sequence.
  Count protects tiny-event bursts; bytes protect larger events. The queue allows two
  ordinary pages of concurrent activity without retaining the whole log. Overflow
  ends this connection explicitly; no durable event or context is deleted.
- Write UTF-8 frames in 16,384-byte chunks. Stop immediately on false and await
  `drain`. Cap ordinary pending writes at 262,144 bytes (a generous margin above
  Node's normal high-water mark). One large event is serialized at a time, without
  an event-size cutoff or altered payload. This avoids rejecting large history values.
- Skip heartbeat writes while the writer is busy. Fail after 5,000 ms without drain:
  enough for the measured one-second initial hold and 50 ms paced reader, finite for
  a stalled peer. This is a transport recovery policy, not a run execution limit.
- Failure is id-less `event: stream.error` Problem Details with status 503 and code
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
  emit `SSE_REPLAY_FAILED`. These controls are fatal until repaired; automatic retry
  would repeatedly encounter the same page. No payloads leak in their fixed detail.
- Reuse `GraphGoblinApiError` for typed controls. Report slow-consumer failures before
  the existing retry/backoff, preserve the last delivered cursor, and retain finite
  `maxAttempts`. Reject `done` for other controls. Cancel the underlying Fetch reader
  directly on abort, avoiding transform-stream cancellation stalls on quiet bodies.
- Flush browser held batches at 256 events or an estimated 1 MiB of UTF-16 JSON,
  including timer throttling. A larger single event flushes immediately. Render the
  slow-consumer reason as the hook's error until a successful reopen.

These numeric choices are engineering parameters, not owner-approved values. No
dependency, stored shape, migration or execution guardrail changes.

## Consequences and verification

Replay memory depends on one page and an individual event's intrinsic serialized
size, rather than the entire log. Temporary handoff and writable buffers are bounded.
The small failure control is the sole permitted addition beyond the normal write
ceiling. One oversized live frame can exceed the held-byte budget and recover through
paged replay. Exactly one active writer prevents heartbeat/live writes from bypassing
backpressure. Disconnect and failure release listeners, timers and held frames.

Tests use supported ports, real HTTP sockets and disposable SQLite storage. The
[after evidence](../qa/2026-10-22-wp-e1-186-after.md) repeats the baseline workload;
only workload-specific observations support performance claims. The public SSE
field order assertion in the existing edge test now validates terminal JSON data.

History browsing follows in #186 round 2: per-run history retention, opaque-cursor
browsing and Timeline windowing remain open. This ADR does not close the whole bolt.
