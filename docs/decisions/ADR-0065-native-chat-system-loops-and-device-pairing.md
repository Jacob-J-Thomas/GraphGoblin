# ADR-0065 - Native Chat through protected system loops and paired device audiences

Date: 2026-11-07. Status: Accepted for owner-dispatched native Chat work (#443).

## Context

GraphGoblin needs a chat surface in its management application and an independently installable
Goblin client. Replies must be actual workflow outcomes, while device credentials must grant no
management authority. A retry or reconnect must not accidentally repeat a command. The workflow
must remain editable using existing nodes rather than embedding a provider-specific chat engine.

## Decision

Both frontends use one `/chat` API that admits and observes ordinary native engine runs. Owner
Chat is the first management screen at `/app/chat`; Goblin is a separate Vite entry, manifest and
service-worker scope at `/goblin/`. Shared chat components live in the web package. Goblin imports
no management shell, owner-key panel or general management client state. It connects to the origin
that serves it; selecting another gateway navigates there before pairing. A reverse proxy may
serve the shell and `/chat` on one origin. There is no cross-origin credential forwarding.

Server-owned bindings classify one gateway loop per owner and one loop per device as system chat
loops. Classification is separate from the portable definition and never depends on a name.
The gateway seed is a real Trigger → Inference → Exit graph with a fresh harness session,
temporary workspace, existing default resolution and current harness policy. Codex inherits
configured plugin tools/services under [ADR-0067](ADR-0067-codex-inherits-configured-plugins.md);
the published workflow's authority can include those services while device HTTP credentials stay
audience-scoped. Claude/Ollama restrictions are unchanged; Ollama remains fresh and tool-free.
The seed makes no model call
while seeding. A device enrollment atomically clones the gateway's current published definition,
publishes the clone and binds it to that device. Later gateway publications do not update existing
device loops. A missing/corrupt existing binding fails visibly instead of replacing owner edits.

### Editable workflow, guarded boundary

The interior graph uses normal prompts, harnesses, model/effort defaults, scripts, decisions and
awaited subloops. The system boundary requires exactly one manual `chat-input` trigger exposed to
UI/API, a canonical chat input schema and `chatResponse` variable schema, and success exits that
return exactly `vars.chatResponse` to exactly the caller. Draft saves refuse changes to the locked
trigger identity/type/exposure/canonical schema and response-variable schema. Other incomplete
boundary wiring stays saveable with issues and blocks publication/admission. Full boundary checks
apply to validation/publication and the exact pinned root at chat admission. System
loop deletion is refused inside the repository transaction as well as the route; revocation is a
separate lifecycle action. Export/import or ordinary
cloning carries no privileged binding.
Publication transactionally checks the full current boundary and exact expected draft definition,
so a concurrent draft edit cannot substitute a different graph after readiness validation.

The server supplies the protocol, conversation/request identities, turn number, input and bounded
history. Clients cannot select an owner, device, loop, version, caller, history, filesystem path
or return destination. History contains only valid successful user/assistant pairs, taking the
most recent twelve pairs and dropping oldest whole pairs until at most 64,000 characters remain.
Text and transcripts are 1–16,000 nonblank characters; replies are 1–32,000.

Only a successful native run with an exact validated
`{protocol: 'graphgoblin.chat.v1', reply}` result produces an assistant message. The projection
validates again on reads, including after restart. Invalid results are errors, not permissively
interpreted strings or reply aliases. Waiting/paused turns remain observable and cancellable;
owners use the ordinary run inspector for further intervention. Devices receive no native
pause/resume/replay/input/signal surface and no raw run-event stream.

### Atomic turn admission and read-only recovery

Chat extends the native admission transaction with a conversation-turn attachment. There is no
second run queue or chat execution state machine. The same transaction creates the run and turn,
checks exact ownership/audience/binding, rechecks device revocation, enforces one nonterminal turn
per conversation and advances its counter. Every accepted turn is linked to an extant native run.

A request UUID plus canonical input hash is unique within its conversation. The same request
returns the same run without enqueuing it again; a changed body conflicts. Duplicate lookup first
verifies exact owner/audience, then precedes current capability checks. Shared native deletion
atomically removes the turn's own content and retains an idempotency tombstone, so the old key
returns 410 `CHAT_HISTORY_DELETED` instead of executing again. That response describes a deleted
turn, not a deleted conversation: turn lists omit it, counter gaps are valid, and undeleted turns
remain available. This applies to history cleanup and loop/orphan deletion too. Later immutable native histories may already contain earlier messages;
deletion does not retroactively erase those copies.

Generic system-loop starts, draft tests and Subloops accept only canonical text input, even for
an audio-enabled loop. An attached admission transaction verifies protocol/conversation/request/
counter/input hash and the full server-resolved audio reference against its row and ID-derived
path. A narrow verified native replay can retain a source's immutable audio payload after checking
same owner/loop, deep payload equality and surviving audio metadata; caller-supplied replay fields
cannot grant this authority. Such owner replay forks do not create chat-turn identities.

One nonterminal linked turn blocks new chat admission. Authorized owners retain ordinary native
Resume recovery, which can change earlier outcomes; transcript order follows durable turn counters
rather than completion time. There is no automatic replay of an old response.

If an attached admission commits but loses its acknowledgement before manager enqueue, the native
admission boundary performs one bounded proof of the exact prepared run and complete matching
chat/thread/queued state, pinned snapshot and consumed-audio link when present. A complete fresh
admission returns normally for its first enqueue.
An actual duplicate still returns its existing identity without enqueueing again. The API's
recovery remains a read-only identity lookup; it does not create or schedule a replacement run.

The browser persists the request identity/input before sending. Uncertain acknowledgement, reload
and reconnect trigger GET lookups only. An explicit user retry retains that identity. Startup
recovers the same admitted native run under its existing effect/recovery rules; it never creates
a fresh run from a pending chat intent. Offline drafts remain unsent. Service workers precache
shell assets only, never store chat/management responses or credentials and never queue or replay
mutations. No Background Sync is introduced.
The active timer performs only canonical request GETs: prioritize the held pending identity,
deduplicate other active identities and rotate fairly, with at most eight lookups per tick and
four concurrent requests. Keep one-second polling/backoff; full session/index/history reads are
coalesced lifecycle/focus/explicit refreshes or one terminal/typed-retirement transition. Unknown
410 pauses only its identity's automatic lookup and preserves the recovery gate, without changing
the singular durable pending identity or issuing a POST.

### Device enrollment and revocation

Pairing creation requires a wildcard owner key or trusted local owner, required-key mode
(`GG_REQUIRE_API_KEY=true`) and configured `GG_PUBLIC_URL`. Enrollment links use that canonical
URL, never arbitrary request/forwarded host headers. Non-loopback URLs require HTTPS. Pairing does
not silently reconfigure authentication, listening addresses or proxy trust.

An owner-generated 32-byte enrollment code lasts ten minutes and is single-use. The link uses a
fragment, removed by the client immediately after capture. Page load never submits the claim.
Noninstalled tabs offer install-first instructions, Copy code and explicit **Pair this browser**;
an installed app takes code entry and explicit Pair. Credentials belong to the app/browser context
that pairs, without a promise of browser-to-Home-Screen transfer. The browser generates a `ggd_` token
from 32 cryptorandom bytes and durably saves it with its claim UUID before making the public exact
claim request. The server stores SHA-256 hashes of codes and tokens. The acknowledgement contains
no plaintext credential. Retrying the same code/claim/token returns the same device and loop;
competing claims cannot create orphans or revive revoked claims. A matching retry with a changed
label returns the original label; rename separately. Missing secure public URL refuses enrollment
creation even when a manual code would be used.

Device identity is a separate principal and token table, with an exact route allowlist plus
audience membership on every conversation, turn and upload operation. A recognized device token
is forbidden on management routes even in trusted local mode; malformed, unknown or revoked
bearers never fall back to unauthenticated owner access. Devices require tokens independently of
owner trusted-mode settings. The one public mutation is the rate-limited exact pairing claim.
Private responses are `Cache-Control: no-store` and every poll reauthenticates.
Persist `lastSeenAt` at most once per device per sixty seconds; every request still rechecks
authentication/revocation.

Revocation transactionally blocks subsequent requests and admission while retaining loop, history
and audit identity. It does not undo effects or cancel an already accepted run. Owners may cancel
separately. Device sign-out deletes only that browser's credential and unsent data. Owner and
device browser credentials use distinct keys; this is operational separation, not a sandbox
against same-origin script compromise.

### Audio normalizes through the workflow

Audio is unavailable until the published system loop uses the canonical text-plus-audio schema
and the chain `chat-input.out → chat-normalize.out → chat-normalize-check`. The ordinary Script or
awaited Subloop normalizer handles text pass-through and returns `{text}`. The protected local
expression decision validates the original recorded value, continues through `valid` into the
authored workflow and sends `invalid` to `chat-normalize-invalid`, a failure/no-return exit with no
destinations. The input/normalizer/check cannot be revisited or bypassed; the failure exit has
only the invalid incoming edge. Script text is recorded at
`thread.outputs['chat-normalize'].value.text`; Subloop text is at
`thread.outputs['chat-normalize'].value.result.text` in a succeeded native envelope. The pinned
node kind chooses the extractor. The exact canonical expression requires an object with exactly
one key `text`, a nonblank string and at most 16,000 UTF-16 code units, with surrogate pairs counted
to match Zod/browser bounds. No coercion/repair changes transcript content. There is no new subloop
wait flag or output envelope.

All root paths pass normalization and its local check before a model/action. The domain's
enable/disable helpers install/remove the canonical chain as one edit, refusing ambiguous
enable continuations or reserved-id collisions; they update only an exact seed prompt, never
arbitrary owner prompts. Disabling accepts a partial chain and either its single known valid
continuation or an explicit ordinary-node `continuationNodeId`; no normalizer/invalid-route/canvas
order is used to guess one. It removes reserved voice nodes, their incident edges and existing
trigger-outgoing edges, restores one trigger continuation and preserves all other ordinary graph content. Other boundary
wiring remains editable in drafts but blocks publication/admission.
The final projection independently requires a valid
recorded normalizer result for audio; `CHAT_AUDIO_NORMALIZATION_INVALID` suppresses the response
and future history even if the raw run succeeded. **Configured by loop** is a static graph claim,
not a health test of an external command. No transcription, speech-recognition fallback or speech
synthesis provider is built into core.

The owner editor's **Set up voice messages** dialog stages Script/Subloop fields locally with no
guessed program or transcriber preset. **Add voice steps** applies a validated fresh preview as
one undo/autosave edit and opens the real normalizer. A stale editor generation or unfinished
field state refuses replacement. Cancel changes nothing. **Edit normalizer** uses the ordinary
node editor. **Turn off voice messages** has an inline removal summary and Undo; only a missing/
ambiguous continuation needs a chooser. Setup/disable never execute or publish; live Chat uses
the current published graph. Protected checks remain read-only, and custom prompts are described
neutrally as unchanged rather than presumed to read a particular input. Script exit-code handling
stays native: successful output or explicit mapped `out` reaches the check; unhandled codes fail.

The browser supports microphone capture and file input, stops tracks on cancellation and caps
recording at 120 seconds. The API accepts only bounded recognized MIME types, at most 10 MiB,
with transactional audience quotas. An ID-derived private file under `<dataDir>/chat-audio/`
preserves bytes and has server-owned metadata. Clients never submit or receive its path; no
download/static upload route is added. Unused uploads expire after one hour. Consumed files are
retained for native run recovery and cleaned up only when no surviving initial-thread/snapshot
reference remains, including replay chains, rather than an arbitrary TTL. Full-size reservations
before upload bound retained used/unused/in-flight audio to 64 MiB per audience and 256 MiB per
gateway. `CHAT_AUDIO_QUOTA` returns 429; referenced inputs are never deleted to free quota.
The three-unused/one-in-flight audience limits and eight-in-flight gateway limit use that same
429 quota response. Private `chat-audio/` is store-owned reset data, removed only as a physical
directory under the existing reset ownership/link safeguards; complete backups include it.

## Consequences and limits

The same engine admission, immutable pins, output validation, recovery and cancellation support
ordinary loops and Chat. Schema tables arrive through ordinary Drizzle migrations; portable
definition format is unchanged and no stored content rewrite/reset is needed for this addition.
Pairing, system guards and atomic admission ship as one boundary.

Owners author trusted workflows: a device's authority is the authority of its bound published
loop. Core does not sandbox arbitrary Script side effects, automatically update device loops,
discover hardware, connect a smart-home provider, transcribe speech or deliver commands offline.
Pairing and send/upload rate limits supplement token entropy and membership checks; they do not
replace them. The gateway retains `trustProxy: false`; behind a reverse proxy, per-source pairing
limits may collapse onto the proxy's address, with the global cap still enforced. Forwarded headers
do not become trusted just to improve limit separation.

Install-first pairing accounts for the separate browser/Home Screen storage described by Apple in
[What's new in web apps](https://developer.apple.com/videos/play/wwdc2023/10120/?time=683).

See [Frontend and PWA](../09-frontend-and-pwa.md#native-chat-and-the-goblin-pwa-443),
[Harness integration](../06-harness-integration.md#native-chat-workflow-integration-443) and
[Offline and upgrade](../guide/08-offline-upgrade.md).
