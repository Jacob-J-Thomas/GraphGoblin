# ADR-0057: Observe execution outcome and durable finalization separately

Date: 2026-10-24. Status: Implementation decision for #185; independent review and owner acceptance pending.

## Evidence

At baseline 456fcd61, the public-interface reproduction in
[before.log.txt](../qa/2026-10-24-wp-d2-185/before.log.txt) observes a delayed retry,
permanent HTTP 400 failure and a real API-process restart with pending delivery.
REST already exposes truthful webhook snapshots, but SSE completes while they are
pending, both polling waits return finished, and the inspector timeline says complete.

## Decision

Expose the existing optional RunRecord.finalizedAt, backed by runs.finalized_at.
Keep status, outcome, result, finishedAt and run.finished about execution alone.
A run is fully finalized when its current lifecycle is terminal and the existing
finalization marker is present and the delivery snapshot has no pending webhook.
Pending journal evidence vetoes the marker: a snapshot read racing resume must never
hide a newer pending delivery behind an older acknowledgement. Delivery failure is a final outcome, never execution
failure or proof of a successful external effect. Webhook deliveries retain their
independent pending/delivered/failed snapshots and uncertainty evidence;
non-webhook returns retain return.delivered and return.failed.

No new stored state, migration, terminal event or stream control is introduced.
Directly reconstructing finality on every read would duplicate the finalizer's channel
selection (the pinned exit plus invocation defaults), receipt reconciliation, retired
Event handling, child cancellation and parent notification rules. The existing marker
already acknowledges those operations: non-webhook receipts and final webhook
journal snapshots must be durable before it is set. Recovery retries incomplete
bookkeeping, and a failed-run resume clears it before recording run.resumed.
Reuse this acknowledgement instead of introducing another fallible projection or
claiming finalization before terminal cleanup completes. Expose it as optional because
it does not exist during execution or pending finalization, not for old-client parsing.

Extend ADR-0050's confirmation: after a consumed terminal lifecycle, require that
acknowledgement, then confirm the durable tail under the existing single writer.
Lifecycle changes invalidate the confirmation, including notifications below an
ahead-of-tail cursor. Pending finalization stays live beyond the inconsistent-log
grace. Because the existing marker write has no journal event, schedule at most one
250 ms confirmation timer per pending connection; heartbeats and other writes do not ask again before it fires. Delivery events also wake the writer.
This engineering parameter bounds observation latency and quiet-store reads; it
does not alter request deadlines, retry policy or execution limits. Cancel it on close.
Standalone stream compositions must supply the same finalization callback;
its required type prevents execution-only completion by omission.

The client still settles only on stream.complete with its matching cursor; an already
consumed cursor needs no event redelivery. EOF alone retries, including during restart.
Polling waitForRun and MCP wait_for_run require terminal status and finalizedAt.
A deadline during pending delivery returns finished:false with the latest delivery
snapshots and execution status. A final failed delivery returns finished:true with the
failed snapshot. These flags mean observation completion, never execution success.

The inspector independently shows execution, finalization pending/complete, webhook
outcomes and acknowledgement uncertainty. Its stream remains live while delivery is
pending. Snapshot polling covers the marker write after the last event; stream
completion invalidates the run snapshot as well. Any new history discovered after a
completed stream reopens SSE, including a remote attempt that already ended between polls;
JSON history alone never substitutes for the next stream.complete.

## Consequences

API, client and MCP callers must upgrade together and distinguish finished/finalized
from status and delivery outcome. There is no data migration or store reset.
Existing recovery and retry identity/budget semantics remain authoritative.
Owner product acceptance is required before #185 closes.
