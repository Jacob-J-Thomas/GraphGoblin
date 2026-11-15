# ADR-0080 - Authored failures and private run diagnostics

Status: Accepted (#381, #414).

## Context

Deterministic mutation errors and a published Exit return that reached the evaluator depth guard
were recorded as resumable `INTERNAL_ERROR`. Resume retried the same pinned operation. Unexpected
exceptions exposed message and stack diagnostics in durable failures, which REST, MCP and the
inspector read. Inference recording faults and child failure propagation also copied those
diagnostics into newly written events.

## Decision

- A Context Mutation node reports a recognized error at its authored expression, predicate,
  template, mutation validation or patch boundary as nonresumable `MUTATION_ERROR`. The failure
  names the node. Its details carry zero-based `operationIndex`, `operationKind`, and a `cause`
  with a domain code and bounded message. The visible message uses the one-based operation number.
  A repair pause retains the original operation index. The accumulated node patch is applied only
  on success, after the existing manager boundary validates the final context thread.
- The authored Exit return evaluator reports `ExpressionError` as nonresumable
  `EXPRESSION_ERROR`. Return conversion and final thread validation retain their engine failure
  boundary. Model resolution, completion providers and inference transforms follow their existing
  failure policies.
- Before appending a terminal failure, the run manager selects the public projection after classifying
  durable script evidence. The failed row records the same failure. Unexpected internal message,
  name and stack diagnostics belong in server logs carrying run and available node identity.
  Source-authored safe summaries and structured recovery provenance remain public. The
  decision-provider path continues to use its fixed message, allowlisted fields and safe-only
  provider diagnostic log.
- Secondary inference recording entries retain their order and operation identifiers
  (`harness.submission`, `turn.intent.reconcile`, `harness.status`). The private log carries the
  exception with the run, node, turn and operation. Primary classification, accepted-turn
  evidence, retry decisions and event ordering use their existing rules.
- Newly emitted subloop failures copy a safe primary internal message and remove recognized
  secondary recording diagnostics from the canonical child failure chain. Child run and node IDs,
  script and recovery provenance, and unrelated authored or provider detail retain their roles.

## Consequences

Existing recovery policy reads `resumable` and `FAILURE_NOT_RESUMABLE` is the same refusal on
REST and MCP. The inspector can render the operation and cause with its ordinary failure display.
The stored format remains readable under [ADR-0062](ADR-0062-stored-data-corrected-by-hand-before-1.0.md).
Historical rows and events retain their existing content, including any earlier engine diagnostics.

Authored template and expression failures at these remaining boundaries still use their existing
`INTERNAL_ERROR` path: script arguments; heartbeat probe/deadline templates and `until` predicates;
subloop input and custom output mappings; and inference prompt, context and file templates plus
input/output transforms. When one of these failures is emitted as `INTERNAL_ERROR`, it keeps its
existing resumability, while a new public failure uses the safe message `An unexpected error
interrupted the run. See the server logs for this run.` The evaluator cause is recorded in server
logs correlated by run and node when available. Existing higher-priority cancellation, script-outcome
and inference submission classifications remain in effect. Historical rows and events are not
rewritten.
