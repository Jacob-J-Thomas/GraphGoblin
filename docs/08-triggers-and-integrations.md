# 08 - Triggers and integrations

## Trigger envelope (Decided)

Every trigger source produces the same envelope, embedded in the invocation and therefore in the thread.

```ts
type TriggerEnvelope = {
  nodeId: string;
  kind: 'manual' | 'cron' | 'webhook' | 'event' | 'poll';
  payload: unknown;
  receivedAt: string;
  dedupeKey?: string;
};
```

Nothing in the core knows about GitHub, CI systems, or error trackers. Provider-specific behaviour, when it arrives post-1.0, is a preset that fills in signature settings, filters, and dedupe keys for a generic webhook.

## Manual (Decided)

Three surfaces, one path: the UI button, `POST /loops/{id}/runs`, and the `start_run` MCP tool all create an invocation with the trigger node's input validated against its `inputSchema`. The `exposeTo` setting on the node controls which surfaces show it.

## Cron (Decided)

- One `schedules` row per cron trigger node per published version. Publishing a new version replaces the rows; runs in flight are unaffected.
- croner evaluates expressions with the configured timezone. The next fire time is persisted.
- At boot, the scheduler compares persisted next-fire times with the clock and applies each trigger's `missedFirePolicy`: `skip` moves on, `run-once` fires one catch-up run, `run-each` fires one run per missed slot up to a sanity cap.
- Overlapping fires start parallel runs, per the concurrency decision.

## Webhook (Decided)

- Each webhook trigger node on a published version gets an endpoint token, a random 32-byte value in the path, and a secret stored in the secret store.
- Requests must carry an HMAC-SHA256 signature over the raw body in the configured header, plus a timestamp within `replayWindowSeconds`. Signatures are compared in constant time. Seen `(endpoint, dedupeKey)` pairs are rejected within the window.
- Bodies above 1 MB are rejected. Endpoints are rate limited.
- The optional `filter` expression decides whether the event fires a run; filtered-out events are still recorded in `inbound_events` for inspection.
- The receiver acknowledges with 202 before the run starts.

## Inbound event bus (Decided)

`POST /events` accepts `{ type, payload, dedupeKey? }` from any authenticated client. Event trigger nodes fire on matching `type` and `filter`. Exit nodes can publish to the same bus through the `event` return channel, which is how loops compose without a parent loop: a triage loop can emit `issue.ready` and an implementation loop can trigger on it.

## Polling trigger (Draft, 1.0 stretch)

A `poll` trigger runs a probe on an interval and fires when `fireWhen` evaluates true for a new `dedupeKey`. It shares the `Probe` model with the heartbeat node: an HTTP request with templated URL and headers, or a script. This is the trigger to recommend when a laptop should not accept inbound connections at all.

## Exposing a laptop to webhooks (Decided posture)

The most secure default for a single-user laptop is to accept nothing inbound and use polling or manual triggers. When inbound webhooks are needed during development:

- Use a tunnel that terminates TLS and authenticates the tunnel itself, such as a Cloudflare Tunnel or an ngrok endpoint with its own auth, pointed only at `/hooks/*`.
- Keep signature verification and replay protection on. The tunnel is not a substitute.
- Never expose the whole API through the tunnel. Bind the API to localhost and route only the hooks prefix.
- For real distribution, the hosted version terminates TLS itself and sits behind the auth provider; webhook endpoints remain signature-gated and unauthenticated by design.

## Concurrency (Decided)

Every firing starts a run. A per-loop policy, `parallel`, `queue`, `skip`, or `replace`, is post-1.0 and will live in loop settings.
