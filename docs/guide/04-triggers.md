# Configure triggers

## Publish to arm automatic triggers

Edit a trigger's `config`, connect its `out` port, and publish. Cron, webhook, event, and poll triggers use published versions. Publishing replaces the armed version while existing runs keep theirs. Boot re-arms published loops. Every firing creates a new run; overlapping runs can execute in parallel.

Inspect armed triggers through the API:

```http
GET /loops/{id}/triggers
```

```bash
LOOP_ID='<loop-id>'
curl -sS "http://127.0.0.1:4747/loops/$LOOP_ID/triggers"
```

The response contains `schedules`, `webhooks`, and `polls`. Older schedule and endpoint rows remain with `enabled` false; select the enabled rows.

## Start manually

Choose `subtype` of `manual`, optionally set `inputSchema`, and declare `exposeTo`. Use **Run** in the editor, the API start request, or MCP's `start_run` as shown in [Run and observe](03-run-and-observe.md). Treat exposure declarations as advisory in this build; see the [editor limitation](02-build-a-loop.md#choose-nodes).

## Schedule with cron

Set a cron expression, timezone, missed-fire policy, and enabled flag:

```json
{
  "subtype": "cron",
  "expression": "0 2 * * *",
  "timezone": "America/Chicago",
  "missedFirePolicy": "run-once",
  "enabled": true
}
```

This starts a run daily at 02:00 in the selected timezone. UTC is the default; timezone-aware scheduling follows daylight-saving changes. Publishing rejects an invalid expression or timezone with HTTP 422, `LOOP_INVALID`, and a `CRON_INVALID` issue.

Choose how to recover missed slots after an outage:

| Policy | Recovery |
| --- | --- |
| `skip` | Default; move to the next future slot. |
| `run-once` | Start one catch-up run for the last slot in the bounded missed-slot scan. |
| `run-each` | Start catch-up runs for the first 100 missed slots, oldest first. |

The scan considers at most 101 missed slots. With `run-each`, later slots beyond the first 100 are dropped with a warning. Trigger payloads contain `scheduledFor` and `catchUp`. The schedule advances before firing, so a crash at that boundary can lose that firing. `GG_TIMER_POLL_MS` controls schedule polling and timer checks, default 1000 milliseconds.

> Coming in 1.0: Latest-missed-slot catch-up after long outages. The trigger plan describes `run-once` using the latest missed slot; the current bounded scan can instead select an earlier slot when more than 101 were missed. Plan for one catch-up run, without assuming it represents the newest slot.

## Receive a signed webhook

Create a secret in [Settings](06-settings-and-secrets.md#store-secrets), then reference its name in the trigger:

```json
{
  "subtype": "webhook",
  "signature": {
    "scheme": "hmac-sha256",
    "header": "x-graphgoblin-signature",
    "secretRef": "incoming-hook"
  },
  "replayWindowSeconds": 300,
  "dedupeKey": "deliveryId",
  "filter": "action = \"opened\""
}
```

Publish, then fetch the trigger listing. Copy the enabled webhook's `path`; its receiver has this shape:

```http
POST /hooks/{token}
```

The token stays stable across versions for the same trigger node ID. Replace or rename that node and publish to obtain a new token. The signing secret is resolved by name on each delivery.

In Bash, install curl and OpenSSL, then replace the token and secret placeholders. This signs the exact UTF-8 bytes of the timestamp, a dot, and the body:

```bash
TOKEN='<token-from-the-enabled-webhook-path>'
SECRET='<value-stored-as-incoming-hook>'
BODY='{"action":"opened","deliveryId":"demo-1"}'
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DIGEST=$(printf '%s.%s' "$TIMESTAMP" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
SIGNATURE="sha256=$DIGEST"
curl -sS -X POST "http://127.0.0.1:4747/hooks/$TOKEN" \
  -H 'Content-Type: application/json' \
  -H "x-graphgoblin-timestamp: $TIMESTAMP" \
  -H "x-graphgoblin-signature: $SIGNATURE" \
  --data-binary "$BODY"
```

Keep whitespace and newlines identical between signing and sending. Send the timestamp as ISO 8601 or Unix seconds. The server rejects timestamps more than `replayWindowSeconds` away from its clock in either direction; the default is 300 seconds. Send the digest as lowercase hex with the `sha256=` prefix.

`dedupeKey` and `filter` are JSONata over the parsed body, with lower-case request headers available through `$headers`. The example rejects repeated delivery IDs within the replay window. Without a dedupe expression, the signature identifies the delivery, so a byte-for-byte replay is rejected. Accepted requests return HTTP 202 with an event and `runId`; filtered requests return 202 with `filtered` true and no run. Duplicate deliveries return 409 `REPLAYED`.

Bodies are limited to 1 MiB. The in-memory rate limit defaults to 60 deliveries per endpoint per minute, controlled by `GG_HOOK_RATE_LIMIT`; it resets on restart and is checked before the signature. See [Troubleshooting](07-troubleshooting.md) for timestamp and signature failures.

## Receive events and connect loops

Configure an event trigger to match a type and optionally filter or deduplicate its payload:

```json
{
  "subtype": "event",
  "eventType": "issue-ready",
  "filter": "approved = true",
  "dedupeKey": "issueId"
}
```

Publish it. Save the following request body and send it with an API key carrying `events:write` when authentication is required:

```text
event.json
```

```json
{
  "type": "issue-ready",
  "payload": { "issueId": "example-7", "approved": true },
  "dedupeKey": "example-delivery-7"
}
```

```bash
curl -sS -X POST 'http://127.0.0.1:4747/events' \
  -H 'Content-Type: application/json' --data-binary @event.json
```

Matching published triggers start runs. The response includes `runIds` and `duplicate`. A repeated event type plus request dedupe key returns the earlier event without starting more runs; this dedupe persists without a replay-window expiry. A node's own dedupe expression separately suppresses keys already used by that trigger.

To emit from another loop, add an `event` return channel to its exit. Exit-generated payloads wrap the mapped value under `result`, alongside `runId`, `loopId`, and `outcome`; use those fields in the receiving trigger's filter and dedupe expressions.

The self-trigger guard skips any loop already in the emitting run's chain, including parent subloops and earlier event callers. The chain stops at eight runs. The event remains recorded and skipped triggers produce warnings. An API-submitted event starts a fresh chain.

Open **Events** for stored types, dedupe keys, and payloads. Fetch the API listing to inspect `source` and `runIds`:

```http
GET /events?type=issue-ready&limit=100
```

> Coming in 1.0: Triggered-run links on the Events screen. Today the screen shows received time, type, dedupe key, and payload; use the API's `runIds` to find the runs.

## Poll without inbound access

Use a poll trigger when a laptop should not accept inbound connections:

```json
{
  "subtype": "poll",
  "intervalSeconds": 60,
  "probe": {
    "kind": "http",
    "method": "GET",
    "url": "https://example.com/job-status",
    "timeoutSeconds": 30
  },
  "fireWhen": "probe.status = 200 and probe.json.ready = true",
  "dedupeKey": "probe.json.jobId",
  "enabled": true
}
```

Replace the probe URL with your service. `intervalSeconds` ranges from 5 to 86,400. Expressions see `now` and `probe`; HTTP results include status, headers, body, and parsed JSON, while script results include exit code, stdout, stderr, parsed JSON, and timeout state. The result becomes the trigger payload. Poll script probes run in the data directory. `signal-count` and `none` probes produce null in poll triggers.

Polling starts one interval after publish or boot and is armed in memory; it does not catch up missed polls. Trigger dedupe history is stored in the runs and survives restarts. Polling is implemented even though the older node catalog labels it a stretch feature.

## Expose only webhook receivers

Keep the API bound to localhost. If inbound webhooks are necessary, use a TLS tunnel with its own authentication and restrict forwarding to this prefix:

```text
/hooks/*
```

Cloudflare Tunnel and ngrok are examples from the design docs. Configure their proxy or gateway rules to reject every other path; a whole-origin tunnel also exposes the API and UI. Keep HMAC verification and replay protection enabled. Prefer manual or poll triggers when inbound access is unnecessary. Follow [Triggers and integrations](../08-triggers-and-integrations.md) and [Security and distribution](../11-security-and-distribution.md) for the tunnel posture.

Continue with [MCP and the Codex plugin](05-mcp-and-codex-plugin.md).
