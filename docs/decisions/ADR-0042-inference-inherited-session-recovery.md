# ADR-0042 - Inherited session IDs do not establish authored-task acceptance

Date: 2026-10-20. Status: Accepted. Records the orchestrator's D-022 decision in the #244 Round 2 brief.

## Context

Node A can finish in a conversation that node B selects through previous or named policy.
If B's authored turn fails without acceptance evidence, or the process dies after its durable
intent but before any adapter event, that inherited ID still belongs to A's work. Continuing it
can complete A's task and incorrectly record that output as B's result. Initialization alone
does not prove that B's prompt was consumed. Absence of acceptance also cannot prove refusal.

## Decision

An authored or retried authored turn whose only session evidence is its inherited
`resumeSessionId`, with no durable acceptance marker, has no usable session for uncertain
recovery. It fails non-resumably both on explicit failure and at visit-start recovery. It
never blindly resubmits B's prompt or continues A's work. Proven pre-send refusals can still
retry the saved authored task under the original policy when the cause is resumable.

Accepted turns, turns with a different newly established session, and repairs or continuations
on the visit's own session retain continuation recovery. This does not add a fresh-session
choice (#265) or an own-session policy (#33). Replay from the node is available as a deliberate
new attempt; named-session lookup remains in force, so changing that policy needs a corrected
definition and a new run.

## Consequences

The failure retains the inherited ID as provenance, while eligibility uses the task's actual
session evidence. Startup and explicit Resume apply the same rule. A crash in the intent/send
window can require owner action even when nothing was actually sent; this conservative stop
prevents unrelated inherited work from being accepted as the new task's output.
