# Research - Workflow runtime alternatives

Captured 2026-10-02 to support ADR-0002.

## LangGraph.js

- Licence: MIT for `@langchain/langgraph`, `@langchain/langgraph-checkpoint`, and the SQLite and Postgres checkpointers. LangGraph Platform, Studio, and the hosted deployment are commercial.
- Model: a state graph with typed channels and reducers, nodes, conditional edges, cycles, a recursion limit, subgraphs, checkpointing per super-step, interrupts for human input, and streaming modes for values, updates, custom events, and debug.
- Fit: maps well to nodes, routes, cycles, and subloops. Mismatches: parking a node for days is modelled as an interrupt that re-executes the node from the top on resume; the channel and reducer model is more than the nine-kind vocabulary needs; run management, event logs, and streaming to clients are Platform features; the dependency chain through `@langchain/core` is heavy.
- Verdict: the recorded alternative. Switch to it if M2 overruns.

## DBOS Transact

- Licence: MIT. Durable execution library for TypeScript and Python with Postgres as the system of record; a SQLite option exists in some bindings.
- Fit: strong for cross-process durability and exactly-once steps. Better suited to a post-1.0 remote runner than to the single-process 1.0 engine.

## Temporal

- Licence: MIT for server and SDKs.
- Fit: the heavyweight answer to durable workflows. Requires running the Temporal server. Overkill for a laptop tool; a candidate for a hosted runner fleet later.

## Hatchet

- Licence: MIT. Task queue and workflow engine with a Postgres backend.
- Fit: similar position to Temporal with a lighter footprint. Post-1.0 candidate only.

## Restate and Inngest

- Restate server is BSL. Inngest's server has historically used a non-OSI licence while its SDKs are Apache-2.0. Both excluded by the licence policy unless re-verified.

## Decision

Own the executor behind a `WorkflowRuntime` port. See ADR-0002.
