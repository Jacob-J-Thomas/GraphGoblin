# ADR-0043 - Bounded durable webhook return delivery

Date: 2026-10-20. Status: **Implemented proposal; independent review pending (#246)**.

## Decision

Execution and webhook delivery have independent outcomes. Queue each distinct webhook in the
same append as `run.finished`. `delivery.queued`, `delivery.attempted`,
`delivery.attempt_finished` and `delivery.finished` carry complete delivery snapshots.
`RunRecord.deliveries` projects the latest snapshot for each delivery identity from this journal;
there is no separately persisted status that can lag the final event. Other return sinks retain
`return.delivered` / `return.failed`.
Those receipt event schemas now exclude webhooks; old webhook receipts require the one-off
migration rather than a tolerant runtime reader.

Before sending, durably consume one attempt and record its recovery deadline. Send the same
opaque ULID in `Idempotency-Key` on every attempt; each attempt has its own signing timestamp.
This is a receiver deduplication opportunity, not an exactly-once guarantee. An interrupted
attempt becomes unknown, consumes its original slot and resumes with the remaining budget.
After the last interrupted attempt, write a failed final outcome without sending again.
Final outcomes are never resent. Event persistence errors leave finalization pending for restart.

Requests run outside execution slots. Parents may observe the child's execution outcome while
its outbound delivery is pending. Finalization waits for every webhook outcome; orderly idle
waiting drains delivery work too. Recovery starts pending delivery workers without delaying
API startup for network acknowledgement or backoff.

## Proposed engineering parameters

These numbers implement the owner-approved bounded-retry policy; they are not owner-approved
parameters. Five attempts maximum, each with a 10-second request-and-acknowledgement deadline.
After failures 1-4, wait 2, 5, 10 and 20 seconds respectively. Nominal uninterrupted bound:
87 seconds plus local scheduling/storage overhead. Fixed delays make the single-process local
schedule reproducible; jitter is unnecessary at this scale. Downtime can extend elapsed time,
but never resets an attempt or its recorded retry deadline.

Retry connection refusal, request/acknowledgement timeout, HTTP 408/429/5xx and unknown transport
outcomes. Stop after one attempt for malformed/unsupported HTTP destinations, credentials in a
destination URL, 3xx (redirects are not followed), and other 4xx. A complete 2xx acknowledges
delivery. Drain its body without retaining bytes, within the same timeout and a 64 KiB bound;
truncation, lost EOF or overflow leaves acknowledgement unknown. Never report timeout or a
process interruption as proof of non-delivery. `effectMayHaveHappened` retains prior uncertainty
even if a later attempt succeeds. No response bodies or transport exception text enter errors.

## Storage and clients

Migration `0015_webhook_delivery_journal` rewrites completed historical webhook return events
once into final journal snapshots, with one recorded attempt and no new retry budget. Old
failures have unknown acknowledgement; no missing attempt-start history is fabricated.
Non-webhook events and damaged JSON remain unchanged. There are no runtime legacy readers.
Old unfinalized returns without an acknowledgement receive a new identity and conservatively
consume one unknown attempt, retaining four retries. Their pre-upgrade request had no identity;
the new key cannot retroactively deduplicate it. The migration imports an unknown outcome,
not fabricated attempt-start evidence. Conversion follows the last durable lifecycle event
even if the row still says running; a completion superseded by resume/start is not rescheduled.
No new columns or tables are required. Format remains 4.

REST detail/list snapshots, generated api-client types, MCP `get_run` / `wait_for_run` and the
inspector expose `deliveries`. `wait_for_run.finished` and SSE terminal closure still refer to
execution. Poll the snapshot or read later JSON event pages for delivery; the inspector polls
once per second while a delivery is pending. Targeted Event admission (#343), non-webhook
effect retry and missing configured signing secrets (#345) remain separate scopes.
