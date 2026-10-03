# ADR-0006 - No error ports; resiliency lives in the engine

Date: 2026-10-02. Status: Accepted.

## Context

The architect proposed an `error` output port on every node. The owner rejected it: failure handling is the platform's responsibility, not something every loop author wires. Inference-level retries belong to the harness. The remaining failures are either unavoidable conditions to fix and resume, or bugs to fix.

## Decision

Nodes have no error ports. The engine implements a four-class resiliency model: transient infrastructure failures are retried internally; harness-internal failures are left to the harness; unavoidable failures end the run as `failed` with a typed reason and are resumable from the failed node; anything else is a bug surfaced prominently. Nodes with legitimately different outcomes use labelled routes, for example script exit-code routes or decision routes.

## Consequences

- Loops stay simple and readable.
- The engine carries more responsibility and more tests.
- Explicit error or debug nodes remain a post-1.0 option, to be added only if run inspection and replay-at-node prove insufficient for debugging.
