# ADR-0055 - Explicit recovery from a missing provider conversation

Date: 2026-10-24. Status: Accepted (2026-10-25): #265 merged as PR #401 after independent review and QA.

## Context

Controlled public RunManager scenarios on `d32aa382` already stop missing inherited
and own conversations and refuse plain Resume. Their generic failure omits the
handle and selection origin, while the promised fresh-session choice has no API.
Codex additionally announces resumed mode before the CLI confirms the handle.
Fresh mode and an authored own-session reset boundary already start fresh correctly.
These findings are controlled-port/SDK evidence, not live-provider verification.

## Decision

A missing conversation remains `HARNESS_SESSION_MISSING`, non-resumable by plain
Resume. Typed `failure.missingSession` records its harness, handle when known,
selection origin, logical visit and exact model/effort. Missing completed own-session
rows name the absence of a recorded handle. No fallback or model substitution occurs.

`POST /runs/{id}/recover-session` requires the failing inference `nodeId` and the
observed `run.failed` sequence `failureSeq`. Ownership and `runs:write` apply. Under
the existing per-run lock, validate that same failure and visit, clear finalization,
then append one `run.resumed` with `freshSession` before changing status or queuing.
The event records the actor, timestamp, node, prior session/origin, original model
and effort, `priorContextCarried: false`, and the visit's original authored prompt
when recorded. Concurrent, repeated and stale requests reject with 409.

The next attempt starts a new conversation for this visit, using that exact authored
task (or the configured template if no task had yet been recorded), selected loop
inputs, context files and original model/effort. It restarts the node's task, including
validation/repair, rather than asking a blank conversation to continue or repair
lost work. Earlier provider actions are not undone. The node's pinned session policy,
shared thread, reset count and working-directory policy are unchanged. Later visits
select sessions normally. Unknown delivery keeps ADR-0045/#244's conservative rules;
this action authorizes recovery only from a positively identified missing session.

The choice and resume intent are the same durable event. Startup completes an
interrupted status write using existing resume recovery. A subsequent interrupted
provider turn still follows its own submission provenance: the choice does not grant
unlimited fresh retries. Declining is simply leaving the failed run untouched.

Codex emits a resumed session only after a matching native `thread.started` and a
successful turn; a different returned ID fails explicitly and is never advertised
as reuse. The engine also waits for turn success before persisting resumed mode for
either harness. Claude's existing native initialization validation and
missing-session refusal remain in force.

## Storage and upgrade

No SQL schema or migration is needed: failures and events are already JSON records.
The strict contracts gain optional typed missing-session metadata and the optional
fresh-session payload on `run.resumed`. Upgrade gateway, web and generated clients
together before writing these records; older binaries cannot consume the new fields.
Existing failures without this provenance are not retroactively rewritten or granted
recovery eligibility. Start a deliberate new run/replay for those records. No owner
store is modified by implementation or verification.

## Evidence limits

Public port, API, component, real-process restart and built-browser tests establish
the engine/application behavior. Real unknown-session CLI behavior remains a separate
D-005 orchestrator check, including any provider-version-specific silent fallback.
No fake result establishes native retention, recall or accepted-work rollback.

For a missing session inside a child, recover the actual inference child first,
then explicitly Resume the containing failed run. That Resume requires a durable
later resume of the same owned child and a child with no runtime failure; before
the child's choice it remains ineligible. This also composes through nested parents.

A controlled Codex SDK fixture also reproduced native initialization followed by a
missing-session refusal: the intermediate implementation still emitted resumed mode
(expected [], received sessionId=removed-handle/mode=resumed). Resumed announcements
are now withheld until turn success; the engine applies the same durable-record guard
for both harnesses, without treating init as prompt acceptance.
