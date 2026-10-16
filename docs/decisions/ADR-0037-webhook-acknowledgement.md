# ADR-0037 - Acknowledge saved webhook intake before dispatch

Date: 2026-10-15. Status: **Accepted scope; signed admission, Allow and SQL 0013 implemented; general configuration and product review pending**.

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

Both existing signature recipes authenticate raw bytes before fatal UTF-8 and nonempty JSON
parsing. Count raw authentication headers case-insensitively before selecting a value. Retain
existing signature prefix/case acceptance, constant-time comparison, timestamp bounds and limits.
Literal JSON `null` remains valid.

## Uniform admission and Allow

Both existing signing recipes use the same claim, fixed acknowledgement and asynchronous create
path. Timestamp freshness is purely authentication. Identical unkeyed raw bodies may produce
distinct receipts and runs. The content hash remains audit evidence and its index is non-unique;
there is no raw-content suppression or policy selector. A present authored key always enters the
existing claim lookup, without `dedupeByKey`. Same-ID recovery remains distinct from an external
repeat. This supersedes ADR-0024's content consumption and timestamp-window deduplication rules.

SQL `0013_trigger_configuration` preserves endpoint identities and tokens while replacing signing
columns with `auth_type`, `signature_message`, `signature_header`, `secret_ref` and `window_seconds`.
CHECKs enforce all three target recipes, including null signing fields for None and an integer
1?86,400 timestamp window. Body/extraction/key configuration belongs in the pinned definition.
Format 4 is unreleased and readiness compares structure: its baseline is now 0013, refusing old
stores before automatic migration/recovery. No installed-store conversion is delivered here.

## Checkpoint and remaining work

The size-bounded checkpoint implements unified signed admission, uniform Allow and SQL 0013.
The live contract still has the two existing flat signing shapes; only that contract is read.
The SQL adapter writes/reads their signing fields using the new columns. Unsigned rows cannot
be authored or admitted yet. The strict nested authentication/body/event-type contract, unsigned
intake, text/bytes decoding, extraction/metadata, safe summaries, general editor controls and
updated GitHub extraction presets remain T4 work. No completed general configuration is claimed.

T5 tightens explicit-key permanence, validation and historical/cross-kind lookup. T6 removes
`filter` and adds conversion rules. Independent review and owner product review remain required
before integration.
