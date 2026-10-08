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
are complete. An incomplete schedule blocks publishing and stays when the dialog is
reopened, until the required day and time (or interval) are chosen or the input is
discarded. Switching presets keeps the last valid time and day choices.
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

## Receive a timestamp-signed webhook

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

`dedupeKey` and `filter` are JSONata over the parsed body, with lower-case request headers available through `$headers`. The configured signing header is excluded case-insensitively from both expressions; ordinary delivery and timestamp metadata remains available. The example rejects repeated delivery IDs within the replay window. Without a dedupe expression, a hash of the signature identifies the delivery, so a byte-for-byte replay is rejected without storing the signature itself. Accepted requests return HTTP 202 with an event and `runId`; filtered requests return 202 with `filtered` true and no run. The run's trigger payload is the parsed body, so templates read it as `trigger.payload`. Duplicate deliveries return 409 `REPLAYED`. A body that is not JSON returns 400 `BODY_INVALID`, and a filter or dedupe expression that fails returns 422 `EXPRESSION_FAILED`.

Bodies are limited to 1 MiB; larger bodies return 413. The in-memory rate limit defaults to 60 deliveries per endpoint per minute, controlled by `GG_HOOK_RATE_LIMIT`; it resets on restart and is checked before the signature. See [Troubleshooting](07-troubleshooting.md) for timestamp and signature failures.

## GitHub body signatures

For a GitHub webhook, use body signing instead of the timestamp protocol above:

```json
{
  "subtype": "webhook",
  "signature": {
    "scheme": "hmac-sha256-body",
    "header": "x-hub-signature-256",
    "secretRef": "github-repo-hook"
  },
  "dedupeKey": "$headers.\"x-github-delivery\"",
  "filter": "repository.full_name = \"OWNER/REPO\" and action = \"labeled\" and $exists(issue) and $not($exists(issue.pull_request)) and label.name = \"ready\""
}
```

Create the secret in Settings, publish the loop, and use its enabled `/hooks/<token>` URL as the GitHub payload URL. Configure JSON content and the same secret in GitHub. Subscribe to **Issues** for the example above; use **Pull requests** for PR filters. Expose only the hooks path through HTTPS, preserving the original body bytes. GitHub signs the payload in `X-Hub-Signature-256`; see its [signature verification reference](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) and [event payload reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

Replace the repository and label values deliberately. Body signing has no `replayWindowSeconds` field. Each logical endpoint should have its own signing secret. The delivery ID and event headers are unsigned hints: check repository, object shape and action in the signed body. Useful filter variants are:

| Intent                       | Signed-body checks after the repository check                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Issue receives a ready label | `action = "labeled" and $exists(issue) and $not($exists(issue.pull_request)) and label.name = "ready"`                                 |
| PR opened or marked ready    | `action in ["opened", "ready_for_review"] and $exists(pull_request) and pull_request.draft = false and pull_request.base.ref = "main"` |
| PR merged into a branch      | `action = "closed" and $exists(pull_request) and pull_request.merged = true and pull_request.base.ref = "main"`                        |

An authored business key also prevents distinct payload bodies from starting separate runs for the same identity. It is scoped to this owner, loop and trigger node across versions, without expiry. Previous body receipts (including filtered or pending deliveries) and admitted runs consume the key; an older timestamp-signed run can therefore suppress a later body-signed delivery with the same key. A distinct body with a consumed key returns 409 `DUPLICATE_KEY` and is recorded as `deduplicated` with no run. Repeating that exact body returns `REPLAYED`. Timestamp-signed receivers retain their own window semantics.

A ping or unmatched payload returns 202 with `filtered: true`; no run starts. **Filtered content is permanently consumed.** Republishing a corrected filter does not reopen the same body. Exact raw-content replay is blocked across versions even if the delivery ID, signature casing, secret or business dedupe expression changes. This policy makes captured deliveries unusable as repeated run triggers; it is stricter than timestamp signing.

Events shows delivery state and retry attempts. A transient admission failure returns 503 and retains one allocated run; the background sweep retries it without needing GitHub to redeliver. Pending admissions pin the loop and its referenced subloops. Permanent failures remain visible with a safe failure code. A repeated completed receipt returns 409 `REPLAYED`.

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

### Drain a GitHub backlog with items mode

Use an authenticated local `gh` installation and Node.js for read-only polling. GraphGoblin does not install `gh` or store its login. This example lists open issues carrying `ready`, excludes pull requests, and emits only the fields needed by the loop. [GitHub CLI pagination](https://cli.github.com/manual/gh_api) applies the query to each page. The bounded Node wrapper collects those compact JSON lines into one array; it avoids the unsupported combination of `--slurp` and `--jq`, limits the child to 55 seconds and 65,536 output bytes, and reports only a fixed failure message.

```json
{
  "subtype": "poll",
  "intervalSeconds": 60,
  "probe": {
    "kind": "script",
    "command": "node",
    "args": [
      "-e",
      "const {spawnSync}=require('node:child_process');const fail=()=>{process.stderr.write('GitHub poll failed or exceeded limits');process.exit(1)};const result=spawnSync('gh',['api','--method','GET','--paginate','repos/OWNER/REPO/issues?state=open&labels=ready&per_page=100','--jq','.[] | select(.pull_request == null) | {number,title,updated_at,url:.html_url} | @json'],{encoding:'utf8',maxBuffer:65536,timeout:55000,windowsHide:true,shell:false});if(result.error||result.status!==0)fail();try{const lines=result.stdout.split(/\\r?\\n/).filter(line=>line.trim()!=='');if(lines.length>200)fail();const items=lines.map(line=>JSON.parse(line,(_,value)=>{if(typeof value==='number'&&!Number.isFinite(value))throw new Error();return value}));const output=JSON.stringify(items);if(Buffer.byteLength(output,'utf8')>65536)fail();process.stdout.write(output)}catch{fail()}"
    ],
    "timeoutSeconds": 60
  },
  "fireWhen": "true",
  "items": {
    "select": "probe.json",
    "dedupeKey": "\"OWNER/REPO:issue:\" & $string(item.number)",
    "maxRunsPerPoll": 5
  },
  "enabled": true
}
```

Replace both `OWNER/REPO` values. The key above admits an issue once for this trigger; include an explicit revision field in the key only if changes should start another run. Each run receives its selected item as `trigger.payload`; the whole probe envelope is not passed as that payload. Successfully admitted keys survive restart. Items-mode admission also respects a pending webhook run reserved for the same logical trigger node and key, so republishing that node as a poll cannot race the earlier delivery into a duplicate. Already-seen candidates do not consume the five-run cap, so subsequent polls drain the rest. The first admission failure stops that poll's dispatch, leaving its remaining candidates for later.

Every item key must be unique, nonblank and at most 512 characters; all keys are checked before any candidate starts. A batch may contain at most 200 candidates and admit 1–25 unseen items per poll. Items-mode script stdout has a strict 65,536-byte bound; overflow, a failed/timed-out command or invalid JSON refuses the entire candidate batch. Do not truncate the result silently. Partition larger queues by repository, label or a chosen time range.

Polling captures current state. It can miss a label added and removed between polls, and it does not reproduce the sequence of webhook events. Choose webhooks when those transitions matter. Existing polls without `items` retain their text/exit-code behavior and single-result dedupe.

## Expose only webhook receivers

Keep the API bound to localhost. If inbound webhooks are necessary, use a TLS tunnel with its own authentication and restrict forwarding to this prefix:

```text
/hooks/*
```

Cloudflare Tunnel and ngrok are examples from the design docs. Configure their proxy or gateway rules to reject every other path; a whole-origin tunnel also exposes the API and UI. Keep HMAC verification and replay protection enabled. Prefer manual or poll triggers when inbound access is unnecessary. Follow [Triggers and integrations](../08-triggers-and-integrations.md) and [Security and distribution](../11-security-and-distribution.md) for the tunnel posture.

Continue with [MCP and the Codex plugin](05-mcp-and-codex-plugin.md).
