# ADR-0053: Reconcile observed threads from durable event tails

- Status: Accepted for implementation; independent review pending
- Date: 2026-10-23
- Issue: #116

## Context

Execution already verified checkpoint sequences and replayed later events. Public thread reads
returned any available snapshot immediately. Inspectors stopped at a cached terminal event,
even when the same run was later resumed. Persisted fault injection reproduced disagreement
through failure, resume and success.

## Decision

Domain owns pure `reconcileThread`: the admitted seed and durable event prefix are authoritative.
A snapshot is an optimization only when its sequence occurs in that prefix at or before the
requested boundary. Replay carries the open visit across a checkpoint so duplicate completions
are not applied twice; starts contribute visits but cannot invent patches. Engine execution,
public current-thread reads (REST and MCP) and inspector reconstruction use this owner.

Reads never persist reconciliation, advance execution, finalize a run or repair storage.
Concurrent reads describe the prefix each observed. This decision does not make separate REST
requests atomic or replace the run-record lifecycle projection.

SSE remains a terminal-bounded subscription. The inspector reconciles JSON pages beyond old
terminal events before following a new active tail. Each catch-up captures a finite run cursor;
500-event pages match the API default. Lifecycle events choose the tail state even when a page
overtakes the captured run record. A two-second check watches resumable failures and a terminal
event whose status has not yet reached the run record. A changed run record refreshes inspector
metadata even without another event; terminal observation stops once that record agrees, except
for resumable failures. This allows another client to resume them without keeping terminal SSE
connections open. The interval is an engineering refresh parameter, not an owner-approved latency
SLA. Cancellation and unmount discard late reads. Transport failures retry observation with
exponential delays from two to thirty seconds; other read failures remain visible without an
automatic retry.

## Consequences

No schema or data migration is required. Unsequenced snapshots cannot accelerate reconstruction.
The actual replay seed remains authoritative (#245). Historical event selection and raw values
remain available for #255 without changing patch-diff presentation in this bolt. Execution
outcome remains separate from delivery finalization. Public reads may cost a durable history
read; bounded streaming optimization remains owned by #186.
