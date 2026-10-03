# ADR-0013 - Context thread shape

Date: 2026-10-02. Status: **Draft** - implemented in `packages/contracts` to unblock M1, pending the co-design session with the product owner. Revise freely; the engine treats the thread as opaque JSON changed only through patches, so shape changes are contained.

## Context

The context thread is the run's shared state and the product's central contract. Five questions were open (docs/13). The architect resolved each with the proposed default so implementation could start.

## Decision

```ts
type ContextThread = {
  schemaVersion: 1;
  run: { id; loopId; versionId; parentRunId?; iteration }; // engine-owned
  invocation: Invocation; // engine-owned, immutable
  messages: Message[]; // the spine
  vars: Record<string, JsonValue>; // declared per loop
  artifacts: Artifact[]; // references only, never contents
  outputs: Record<nodeId, NodeOutput>; // latest output per node
  lastOutput?: NodeOutput; // most recent output overall
  counters: { nodeVisits; usage }; // engine-owned
};
```

1. **Messages are the spine.** Harness transcripts are stored as artifacts; only final text, and optionally short tagged notes, enter `messages`.
2. **Transcripts never enter messages wholesale.** The inferencing node's `toMessages` setting chooses `final`, `final-and-notes`, or `none`. Notes carry the tag `harness-note` so truncation and drop operations can target them.
3. **Both `lastOutput` and `outputs`.** `outputs` is keyed by node id and holds the latest output of each node; `lastOutput` is the most recent overall. Decision nodes and templates can address either.
4. **Token estimates** use a four-characters-per-token heuristic in `domain`, replaceable without contract changes.
5. **Templates and expressions see everything** in the thread plus shortcuts `trigger`, `lastMessage`, and `lastAssistantMessage`. Artifact contents are never in the thread, so nothing needs hiding.

Mutable regions are `/vars`, `/messages`, `/artifacts`, `/outputs`, and `/lastOutput`. Mutation operations that target anything else are rejected. The engine alone writes `/run`, `/invocation`, and `/counters`.

Messages carry `id`, `role` (`system`, `user`, `assistant`, `tool`, `note`), `content`, the `nodeId` that created them, a timestamp, and optional `tags`.

## Consequences

- Every node reads a plain JSON document and returns an RFC 6902 patch. Replay, diffing, and re-run-at-node follow from that.
- Adding a field later is a `schemaVersion` bump plus a migration of stored threads; the event log stores patches, so historical runs replay against the version they were created with.
- The `note` role is GraphGoblin's own; adapters never send notes to a harness as conversation turns.

## To confirm in the co-design session

- Whether `messages` should be capped by default and at what size.
- Whether `outputs` should keep a short history per node rather than the latest only.
- Naming: `vars` versus `variables`, `lastOutput` versus `output`.
