# ADR-0002 - Own the loop executor; LangGraph.js is the recorded alternative

Date: 2026-10-02. Status: Accepted, with a review trigger.

## Context

The graph vocabulary is nine node kinds with specific semantics: iteration limits with explicit loop-back, parked nodes that stop and resume the run, child runs for subloops, return channels, and an engine-owned resiliency model. LangGraph is MIT licensed and offers checkpointing, interrupts, subgraphs, and streaming, but LangGraph Platform, which provides run management, is commercial.

## Decision

Build a small event-sourced interpreter in `packages/engine` behind a `WorkflowRuntime` port. The append-only event log is the persistence, the live stream, the audit trail, and the replay mechanism.

## Consequences

- Full control over park and resume semantics, cancellation, recovery, and error vocabulary.
- All of the executor is our code and counts toward the coverage target; it is deterministic and testable with fake ports.
- We do not inherit LangGraph's channel and reducer model, its super-step scheduling, or its interrupt-re-executes-the-node behaviour.
- Review trigger: if M2 cannot reach park, resume, cancel, and subloops with tests within its planned size, switch to LangGraph.js behind the same port.

## Alternatives considered

- LangGraph.js: mature, MIT, but a conceptual mismatch on parking and a heavy dependency chain; run management still had to be built.
- DBOS Transact, Temporal, Hatchet: MIT durable-execution frameworks, better suited to a later cross-process runner than to the 1.0 single-process engine.
