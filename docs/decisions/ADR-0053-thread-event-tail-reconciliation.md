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

## Bounded current-thread reads (round 3 correction)

Each checkpoint writer records the thread, its sequence and the domain `ReplayState`
(`{ openNodeId?: string; strict: boolean }`) together. Executor parking records that visit open;
its own matching completion records no open visit. Recovery computes `replayStateAt(events, seq)`
from the full durable history. A `node.finished` boundary alone cannot prove a closed visit:
a delayed duplicate for A can leave B open. Readers never infer state from event types.

When stored state is present, current-thread reads request only the checkpoint boundary and its
tail using `events.read(runId, checkpoint.seq - 1)` and require the first returned sequence to be
the checkpoint's. Domain `reconcileThread` carries the recorded state through the tail. Missing
boundaries, unsequenced snapshots and snapshots without stored state use the full admitted
seed/history. Execution's `loadThread` retains its full history for its other recovery needs.
No read writes or repairs a checkpoint.

SQL migration `0018_thread_checkpoint_replay_state` adds nullable JSON text
`runs.thread_snapshot_replay_state`. Existing snapshots retain NULL and use full-prefix replay
until a writer saves the next checkpoint; no state is guessed or backfilled. Snapshot, sequence
and state are replaced in one repository update. The required `RunRepository.saveThread` port
arguments are `(runId, thread, seq, replayState)`. A stored state that is not exactly
`{ strict: boolean, openNodeId?: string }` is damaged history: reading the checkpoint raises
`UnreadableRunHistoryError`, as a damaged snapshot does, rather than trusting or ignoring it.

A fresh round-3 Node 22.14.0 loopback-HTTP measurement on 2026-10-24 used physical SQLite
with 10,008 events (an admitted minimal run followed by synthetic started/completed node pairs).
Each case had one warm-up and five measured reads, comparing the complete returned thread with
full replay. The lagging checkpoint omitted 200 events. The machine was loaded, including other
validation work; these elapsed samples describe this fixture, not an SLA or a speedup caused by
persisting state.

| Checkpoint         | Decoded rows per read | Round-3 median (ms) | Observed range (ms) |
| ------------------ | --------------------: | ------------------: | ------------------: |
| current            |                     1 |              11.357 |        5.206-86.185 |
| lagging-200-events |                   201 |              11.291 |        9.350-26.730 |

The structural result remains one decoded boundary row for a current checkpoint and boundary
plus 200 tail rows for the lagging case. The earlier round-2 full-history measurements decoded
10,008 rows per read (medians 311.421/222.919 ms); its bounded implementation decoded 1/201 rows
(medians 25.814/21.827 ms), but its event-type proof failed the delayed-duplicate case. The
persisted-state correction restores replay equivalence while keeping that bound. Timing samples
from different loaded runs are observations, not a controlled comparison of the state fix.

Fresh samples and counted port reads: `docs/qa/2026-10-23-wp-g1-116/round-3-measure.json`.
Historical round-2 samples remain in `docs/qa/2026-10-23-wp-g1-116/measure-before.json` and
`docs/qa/2026-10-23-wp-g1-116/measure-after.json`. The repeatable script is
`apps/api/scripts/thread-read-measure.ts`.

## Consequences

Migration 0018 adds the writer-recorded state without rewriting existing snapshots. Unsequenced
or unproven snapshots cannot accelerate current-thread reads.
The actual replay seed remains authoritative (#245). Historical event selection and raw values
remain available for #255 without changing patch-diff presentation in this bolt. Execution
outcome remains separate from delivery finalization. Public reads cost the verified checkpoint boundary plus its tail when writer-recorded state is
present, with full-history fallback when that proof is absent. Bounded streaming optimization remains owned by #186.
