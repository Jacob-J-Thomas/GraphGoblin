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

```powershell
$loopId = '<loop-id>'
$triggers = Invoke-RestMethod "http://127.0.0.1:4747/loops/$loopId/triggers"
$triggers.webhooks | Where-Object enabled | Select-Object triggerNodeId, path
```

The response contains `schedules`, `webhooks`, and `polls`. Older schedule and endpoint rows remain with `enabled` false; select the enabled rows. Deleting a loop disarms all of its triggers; the API refuses to delete a loop with active runs (409 `LOOP_IN_USE`).

## Start manually

Choose `subtype` of `manual`, optionally set `inputSchema`, and declare `exposeTo`. Start it from **Runs → New run** (the editor's **Open in Runs** link goes there), the API start request, or MCP's `start_run` as shown in [Run and observe](03-run-and-observe.md). Treat exposure declarations as advisory in this build; see the [editor limitation](02-build-a-loop.md#choose-nodes).

## Schedule with cron

Choose **cron** in the trigger's Subtype, then choose a schedule in **Repeat**:
every N minutes, every N hours, daily, weekdays, weekly on chosen days, or monthly
on day N. Set the time and days where offered. Minute steps restart each hour;
hour steps restart each day. Months without the selected monthly day are skipped.

The summary describes the schedule in its timezone. **Timezone** is a searchable
IANA picker; UTC stays the default, and **Use my time zone** fills your browser's
zone. **Next five runs** shows each slot in the trigger's zone and your local zone,
including its UTC offset around daylight-saving changes. The preview comes from
the same scheduler that fires published triggers, after a short typing debounce.
Invalid expressions and zones show an inline error before publishing. If the
preview API cannot be reached, the current expression stays visible with a clear
unavailable message.

Open the schedule's **Advanced → Cron expression** to enter the syntax the scheduler
accepts: five fields, six with seconds, seven with seconds and year, or nicknames
such as `@daily` and `@hourly`. Recognised expressions reopen in the builder; others show
**Custom expression** and keep exactly what you typed. Switching explicitly to a
preset replaces the expression with that preset, retaining applicable time and
day choices. Incomplete builder edits keep the last valid expression until they
are complete, and keep the last valid time and day choices when switching presets.
For example, clearing weekly 07:30 and switching to Daily restores 07:30.
A new cron trigger offers **Choose a schedule…** before any preview.
The timezone picker, missed-fire policy, and enabled flag remain visible alongside
the schedule. The saved config shape is unchanged:

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

| Policy     | Recovery                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| `skip`     | Default; move to the next future slot.                                      |
| `run-once` | Start one catch-up run for the latest missed slot at or before the restart. |
| `run-each` | Start catch-up runs for the latest 100 missed slots, oldest first.          |

Trigger payloads contain `scheduledFor` and `catchUp`. The schedule advances before firing, so a crash at that boundary can lose that firing. `GG_TIMER_POLL_MS` controls schedule polling and timer checks, default 1000 milliseconds.

After a long outage `run-once` still starts exactly one catch-up run, for the latest missed slot at or before the restart, however many slots were missed. `run-each` starts at most 100 catch-up runs per schedule: it keeps the latest 100 missed slots, runs them oldest first, drops the older missed slots with a warning in the log naming the number dropped and the first retained slot, and moves the schedule to its next future slot.

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

The signature is HMAC-SHA256, keyed with the secret, over the exact UTF-8 bytes of the timestamp, a dot, and the body. It goes in the header named by `signature.header` (default `x-graphgoblin-signature`). The timestamp always goes in `x-graphgoblin-timestamp`.

In Bash, install curl and OpenSSL, then replace the token and secret placeholders:

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

In PowerShell, this version signs a Unix-seconds timestamp and sends the same bytes it signed:

```powershell
$token = '<token-from-the-enabled-webhook-path>'
$secret = '<value-stored-as-incoming-hook>'
$body = '{"action":"opened","deliveryId":"demo-1"}'
$timestamp = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$hmac = New-Object System.Security.Cryptography.HMACSHA256 (,[Text.Encoding]::UTF8.GetBytes($secret))
$hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$timestamp.$body"))
$signature = 'sha256=' + (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4747/hooks/$token" `
  -ContentType 'application/json' `
  -Headers @{ 'x-graphgoblin-timestamp' = $timestamp; 'x-graphgoblin-signature' = $signature } `
  -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

For a quick check of your signing code, the secret `s3cret-value`, the timestamp `1791013464`, and the body above produce:

```text
sha256=1ed6e75a09e5efba80f692ea02ee05a85fb177ec7ed73cfe378758e7f8757c96
```

Keep whitespace and newlines identical between signing and sending. Send the timestamp as ISO 8601 or Unix seconds. The server rejects timestamps more than `replayWindowSeconds` away from its clock in either direction; the default is 300 seconds. Send the digest as lowercase hex with the `sha256=` prefix.

`dedupeKey` and `filter` are JSONata over the parsed body, with lower-case request headers available through `$headers`. The example rejects repeated delivery IDs within the replay window. Without a dedupe expression, the signature identifies the delivery, so a byte-for-byte replay is rejected. Accepted requests return HTTP 202 with an event and `runId`; filtered requests return 202 with `filtered` true and no run. The run's trigger payload is the parsed body, so templates read it as `trigger.payload`. Duplicate deliveries return 409 `REPLAYED`. A body that is not JSON returns 400 `BODY_INVALID`, and a filter or dedupe expression that fails returns 422 `EXPRESSION_FAILED`.

Bodies are limited to 1 MiB; larger bodies return 413. The in-memory rate limit defaults to 60 deliveries per endpoint per minute, controlled by `GG_HOOK_RATE_LIMIT`; it resets on restart and is checked before the signature. See [Troubleshooting](07-troubleshooting.md) for timestamp and signature failures.

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

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4747/events' `
  -ContentType 'application/json' -InFile event.json
```

Matching published triggers start runs. The response includes `runIds` and `duplicate`. A repeated event type plus request dedupe key returns the earlier event without starting more runs; this dedupe persists without a replay-window expiry. A node's own dedupe expression separately suppresses keys already used by that trigger.

To emit from another loop, add an `event` return channel to its exit. Exit-generated payloads wrap the mapped value under `result`, alongside `runId`, `loopId`, and `outcome`; use those fields in the receiving trigger's filter and dedupe expressions.

The self-trigger guard skips any loop already in the emitting run's chain, including parent subloops and earlier event callers. The chain stops at eight runs. The event remains recorded and skipped triggers produce warnings. An API-submitted event starts a fresh chain.

Open **Events** for each stored event's received time, type, source, dedupe key, payload, and **Started runs**, which links to every run the event started (or says none). The API listing returns the same `source` and `runIds`:

```http
GET /events?type=issue-ready&limit=100
```

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
