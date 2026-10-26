# ADR-0059 - Preserve uncertain script outcomes until explicit recovery

Date: 2026-10-25. Status: Accepted scope, integration of #321.

## Context

A process may produce an external effect before its completion is durable. Recovery cannot infer that the effect did not happen from missing bookkeeping. The #321 branch had no dedicated ADR; this records its integrated behavior.

## Decision

Record `script.dispatched` with logical visit and dispatch identities before calling the runner. Keep proven pre-start refusals distinct from completed processes and uncertain outcomes. An unfinished dispatch, interrupted historical visit without dispatch evidence, or persistence failure with unresolved disposition becomes `SCRIPT_OUTCOME_UNCERTAIN` with typed `failure.script` provenance. Restart and upgrade never blindly repeat it. Resume explicitly retries the same visit with a new dispatch identity; Replay explicitly forks a new run. The inspector explains the risk and requires a deliberate Resume or Replay action. Opening or cancelling recovery produces no effect.

Keep explicit stop, expired run deadlines and unconfirmed native termination non-resumable and preserve their script provenance and shutdown cleanup evidence. Atomic child admission and sequence-bound child completion follow ADR-0046. New completion facts share the parent's outcome append; mapping retries reuse an existing finish for that child terminal sequence.

The browser follows resumed attempts through paged history and authoritative `stream.complete`, using the same mechanism as other resumes. Cached terminal events never terminate a subscription by themselves. Default-discovered script recovery browser coverage owns an isolated built API and disposable store.

## Consequences

No exactly-once external-effect guarantee is claimed. Event JSON stores the added evidence without a SQL change; migration verification still checks the integrated head. Operators must use the CHANGELOG upgrade instructions for unfinished script visits. Native kill, persistence-fault, Resume, Replay, admission and browser tests verify these boundaries.
