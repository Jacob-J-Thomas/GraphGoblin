# ADR-0037 - Acknowledge saved webhook intake before dispatch

Date: 2026-10-15. Status: **Accepted; T4 implemented; independent and owner product review pending**.

## Context

The owner-approved #168 plan requires prompt acknowledgement after durable intake. ADR-0024
coupled public responses to dispatch and exposed duplicate dispositions as retry errors. Its
GitHub presets also placed checks in the trigger. The format-4 programme moves those checks into
editable downstream decisions, output restoration and quiet terminal exits (T2).

## Decision

Supersede ADR-0024's public duplicate/dispatch response rules and trigger-filter preset design;
retain its historical text. Public hooks acknowledge saved or confirmed consumed input with
`202 {accepted:true}`, without payloads, run IDs, signature material or disposition details.
Private Events metadata carries pending/admitted/failed/filtered/deduplicated state and run links.
Signing readiness and unconfirmed save failures may return 503. Saved pending or failed admission
does not justify a public 503 or 409.

For receipt intake, prepare one frozen admission under the deletion lock. Claim atomically saves
inbound and receipt, complete intent and pending pin/key reservations. Return after that claim;
dispatch separately commits run, thread, pins, first queued event, admitted receipt and inbound
link, then publishes notifications. Recover using that exact intent and run ID. Resolve uncertain
claim acknowledgements by reading back the allocated receipt identity. Retry metadata failure
leaves the durable claim recoverable. Keep the 15-second, five-receipt sweep and five-minute
backoff cap. Keep ordinary run recovery ahead of webhook dispatch at startup.

Export adapter-neutral conformance scenarios and assertions from engine/testing, without importing
SQLite or Vitest. A fake factory stages writes before installing state; a SQLite test factory
injects SQL faults at the same six writes. Run the same assertions for ordinary create, poll item
admission and webhook claim/create; supplement them with actual SQLite close/reopen recovery.

Both HMAC recipes authenticate raw bytes before decoding, extraction or expressions. None
establishes no sender identity and uses the same bounded admission path. JSON requires fatal
UTF-8 and nonempty valid JSON; Text permits empty UTF-8 strings; Bytes yields base64 JSON. Count raw authentication headers case-insensitively before selecting a value. Retain
existing signature prefix/case acceptance, constant-time comparison, timestamp bounds and limits.
Literal JSON `null` remains valid.

## Uniform admission and Allow

All three authentication recipes use the same claim, fixed acknowledgement and asynchronous create
path. Timestamp freshness is purely authentication. Identical unkeyed raw bodies may produce
distinct receipts and runs. The content hash remains audit evidence and its index is non-unique;
there is no raw-content suppression or policy selector. A present authored key always enters the
existing claim lookup, without `dedupeByKey`. Same-ID recovery remains distinct from an external
repeat. This supersedes ADR-0024's content consumption and timestamp-window deduplication rules.

SQL `0013_trigger_configuration` preserves endpoint identities and tokens while replacing signing
columns with `auth_type`, `signature_message`, `signature_header`, `secret_ref` and `window_seconds`.
CHECKs enforce all three target recipes, including null signing fields for None and an integer
1-86,400 timestamp window. Body/extraction/key configuration belongs in the pinned definition.
Format 4 is unreleased and readiness compares structure: its baseline is now 0013, refusing old
stores before automatic migration/recovery. No installed-store conversion is delivered here.

## General configuration and conversion

The live webhook contract is one strict object with defaulted nested authentication (None),
body (JSON) and eventType (constant webhook), plus optional dedupeKey/filter. There are no flat
signature/window readers. Header names are lowercase RFC tokens; EventNames are nonblank,
control-free and at most 128 characters. Header and JSON-pointer extraction have fallbacks;
ambiguous headers return EVENT_TYPE_AMBIGUOUS (400), invalid scalars EVENT_TYPE_INVALID (422).
Pointers require JSON, valid RFC 6901 escapes, at most 1,024 characters/32 segments and own
properties/array indices. Extracted invocation.trigger.eventType survives queued intent/recovery
without publishing an Event. Payload checks belong downstream; filter remains until T6.

SQL endpoint authentication must match its exact pinned definition and owner/version provenance.
Safe endpoint/Events summaries expose recipe, secret names and pinned body/extraction/key config;
disabled orphan history is explicitly unavailable. The editor provides native recipe/source
pickers and a body-mode control with validation, focus and undo. GitHub presets set body HMAC,
JSON, x-github-event extraction with webhook fallback and x-github-delivery as an explicit key.
Their editable downstream checks retain signed-body authority.

Frozen V3 conversion maps timestamp/body recipes to nested authentication, preserves key/filter
source and supplies JSON/constant metadata. One hash-bound webhook-json-decoding item per trigger
requires review of strict UTF-8/nonempty JSON, including the old timestamp empty-body behavior.
Every proposal passes the current schema and graph validation. This is a definition-converter
rule, not an installed-store migration or approval to apply data changes.

T5 tightens explicit-key permanence, validation and historical/cross-kind lookup. T6 removes
filter through reviewed graph conversion. Independent review and owner product review remain
required before integration.
