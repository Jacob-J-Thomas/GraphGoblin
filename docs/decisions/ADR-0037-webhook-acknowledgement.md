# ADR-0037 - Acknowledge saved webhook intake before dispatch

Date: 2026-10-15. Status: **Accepted scope; T4 admission checkpoint implemented; remaining T4 and product review pending**.

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

## Checkpoint and remaining work

This checkpoint implements asynchronous body-receipt dispatch, the fixed public response,
authentication order and adapter conformance. The old timestamp insert/start/link path remains
until the T4 continuation can change endpoint configuration and receipt storage together. The
current signing config, content/window dedupe algorithms and trigger `filter` remain. No migration,
format baseline change, unsigned intake, body-mode picker or event extraction is claimed here.

The continuation implements the strict nested authentication/body/event-type config, 0013 and its
readiness decision, all-recipe atomic intake, metadata, editor/presets and associated tests/docs.
Q5 is decided **Allow**, with no policy selector: T5 implements that algorithm and permanent
explicit keys. T6 removes `filter` and adds conversion rules. These are delivery seams, not
alternative stored policies or permission to change installed data.

Independent review and owner product review remain required before integration.
