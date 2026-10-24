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

## Bounded current-thread reads (round 2)

Current-thread reads first request only the checkpoint boundary and its tail using
`events.read(runId, checkpoint.seq - 1)` and verify that the first returned sequence is the
checkpoint's. Bounded replay state follows from the engine's single execution token and write
order: a `node.started` or `run.waiting` names the open visit; a matching `node.finished` closes
it, and an exit's `run.finished` follows that completion in the same append. These boundaries
therefore prove strict replay state without their prefix. Other boundary kinds, a missing
boundary, or an unsequenced snapshot fall back to the full admitted seed/history. This fallback
covers recovery snapshots at failed/cancelled or later progress/delivery events whose open visit
is not established by that event alone. Execution's `loadThread` keeps its existing full history.
The proven state is an in-memory reconciliation input, not a new stored field or migration.

A controlled Node 22.14.0 loopback-HTTP measurement on 2026-10-24 used physical SQLite with
10,008 events (an admitted minimal run followed by synthetic started/completed node pairs).
Each case had one warm-up and five measured reads, comparing the complete returned thread with
full replay. The lagging checkpoint omitted 200 events. The machine was loaded; these elapsed
times describe this fixture, not an SLA or a claim about the different #190 workload.

| Checkpoint         | Rows before | Rows after | Median before (ms) | Median after (ms) |
| ------------------ | ----------: | ---------: | -----------------: | ----------------: |
| current            |       10008 |          1 |            311.421 |            25.814 |
| lagging-200-events |       10008 |        201 |            222.919 |            21.827 |

The structural result is one decoded boundary row for a current checkpoint and boundary plus
200 tail rows for the lagging case, rather than a history-sized read. The raw samples and
counted port reads are in `docs/qa/2026-10-23-wp-g1-116/measure-before.json` and
`docs/qa/2026-10-23-wp-g1-116/measure-after.json`; the repeatable script is
`apps/api/scripts/thread-read-measure.ts`.

## Consequences

No schema or data migration is required. Unsequenced snapshots cannot accelerate reconstruction.
The actual replay seed remains authoritative (#245). Historical event selection and raw values
remain available for #255 without changing patch-diff presentation in this bolt. Execution
outcome remains separate from delivery finalization. Public reads cost the proven checkpoint boundary plus its tail, with full-history fallback
when its state cannot be proven. Bounded streaming optimization remains owned by #186.
