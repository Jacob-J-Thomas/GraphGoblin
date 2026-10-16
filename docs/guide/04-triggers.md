# Configure triggers

## Choose a trigger type

Add the single **Trigger** node and open its editor. **Trigger type** comes first:
**Manual**, **Cron**, **Poll**, **Event** or **Webhook**. Each choice describes when
it starts a run and shows its own fields. Manual offers an input schema and start
surfaces; Cron offers its schedule, timezone, missed-fire policy and enabled flag;
Poll offers the interval, probe, firing condition, dedupe, optional Items and enabled
flag. Webhook offers **Authentication recipe** (None, Body HMAC, Timestamp and body HMAC),
**Body mode** (json, text, bytes) and **Event type source** (Constant, Header, JSON pointer).
Only the selected recipe fields appear. None establishes no authenticated sender identity.
Event/Webhook reject `filter`; payload checks belong in downstream decisions, classifiers or scripts. The editor includes a reminder. Route unwanted input to a terminal Success exit with no returns or destinations.

**Start from a preset** is optional and sits after the trigger fields. Choose a
GitHub recipe, fill in its setup and choose **Preview GitHub preset**. The preview
shows the current and replacement configurations and names any unfinished input
that will be replaced. **Cancel preview** changes nothing and returns focus to
Preview. **Apply GitHub preset** replaces the trigger configuration in one undo
step and returns focus to Trigger type. Webhook recipes also add an editable check,
restore and quiet exit, rewiring the former connection through restore. The preview
lists every node and edge change. All generated fields and nodes remain editable.
Undo restores the whole graph and unfinished input; redo reapplies it. Reapplying
explicitly reviews replacement of an existing check/restore/exit fragment, including
your edits. For webhook recipes, shared or ambiguously rewired nodes are retained
and the preview says it is inserting another fragment. Changing the graph, held input, load or undo history
invalidates an open preview. Apply validates graph rules and limits; repair any
unconnected or multiply connected output before applying. The stored discriminator is `type`.

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

The response contains `schedules`, `webhooks`, and `polls`. A missing or mismatched pinned webhook configuration is shown as `configurationAvailable: false` in this listing and Events; the row does not break the page. Intake for an enabled mismatched endpoint still refuses with 503 `HOOK_NOT_READY`, and the server logs a safe warning. Older schedule and endpoint rows remain with `enabled` false; select the enabled rows. Deleting a loop removes its schedules, webhook endpoints, receipts and run history, and disarms its polls. The API refuses deletion with 409 `LOOP_IN_USE` while runs are queued, running, waiting or paused, or an active caller or pending webhook admission still needs the loop. Cancel the run or resolve the pending admission first. A refusal leaves triggers unchanged.

## Start manually

Choose **Manual** in **Trigger type**, optionally set `inputSchema`, and declare `exposeTo`. Start it from **Runs → New run** (the editor's **Open in Runs** link goes there), the API start request, or MCP's `start_run` as shown in [Run and observe](03-run-and-observe.md). Treat exposure declarations as advisory in this build; see the [editor limitation](02-build-a-loop.md#choose-nodes).

## Schedule with cron

Choose **Cron** in **Trigger type**, then choose a schedule in **Repeat**:
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
  "type": "cron",
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

## Receive an ordinary POST

A new Webhook defaults to None authentication, JSON body and constant `webhook` event metadata.
None requires no secret and establishes no sender identity. Text supports XML/form-like content as
a UTF-8 string, including empty input; Bytes produces `{encoding:"base64",data}`. The raw limit is
1 MiB for every mode. Interpret text or bytes downstream.

Choose Header extraction with a lowercase header name and fallback, or JSON pointer extraction
with a fallback. Pointers require JSON mode, allow the empty root pointer, RFC 6901 escapes,
1,024 characters and 32 segments, and traverse own properties/array indices only. Missing, blank
or nonscalar values use fallback. Ambiguous headers return 400 `EVENT_TYPE_AMBIGUOUS`;
control/overlong scalar metadata returns 422 `EVENT_TYPE_INVALID`. Event names and fallbacks must
be nonblank, control-free and at most 128 characters. This metadata is recorded on the invocation;
it does not publish to the Event bus.

Authentication, body and extraction changes use the normal editor focus, validation and undo.
JSON remains strict, nonempty UTF-8 JSON; literal `null` is valid. The flat signing fields are no
longer accepted. Existing stores/exports need the reviewed format-4 cutover.

## Receive a timestamp-signed webhook

Create a secret in [Settings](06-settings-and-secrets.md#store-secrets), then reference its name in the trigger:

```json
{
  "type": "webhook",
  "authentication": {
    "type": "hmac-sha256",
    "message": "timestamp-body",
    "header": "x-graphgoblin-signature",
    "secretRef": "incoming-hook",
    "windowSeconds": 300
  },
  "body": { "type": "json" },
  "eventType": { "source": "constant", "value": "webhook" },
  "dedupeKey": "deliveryId"
}
```

Publish, then fetch the trigger listing. Copy the enabled webhook's `path`; its receiver has this shape:

```http
POST /hooks/{token}
```

The token stays stable across versions for the same trigger node ID. Replace or rename that node and publish to obtain a new token. The signing secret is resolved by name on each delivery.

The signature is HMAC-SHA256, keyed with the secret, over the exact UTF-8 bytes of the timestamp, a dot, and the body. It goes in the header named by `authentication.header` (default `x-graphgoblin-signature`). The timestamp always goes in `x-graphgoblin-timestamp`.

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

Keep whitespace and newlines identical between signing and sending. Send the timestamp as ISO 8601 or Unix seconds. The server rejects timestamps more than `authentication.windowSeconds` away from its clock in either direction; the default is 300 seconds. Send the digest as lowercase hex with the `sha256=` prefix.

`dedupeKey` is JSONata over the parsed body, with lower-case request headers available through `$headers`. The configured signing header is excluded case-insensitively from the expression; ordinary delivery and timestamp metadata remains available. The example deduplicates authored delivery IDs across signing recipes and versions. Without a dedupe expression, identical raw bodies can start separate runs; raw hashes are audit evidence only. Timestamp freshness authenticates the delivery and does not expire its authored key. Saved and duplicate requests return HTTP 202 `{accepted:true}`. Inspect **Events** for the payload, delivery state and started-run links (old `filtered` rows remain historical). The run's trigger payload is the parsed body, so templates read it as `trigger.payload`. A duplicate returns the same 202 without another run. Empty, whitespace-only, malformed JSON or invalid UTF-8 bodies return 400 `BODY_INVALID` (literal `null` is valid), and a dedupe expression that fails returns 422 `EXPRESSION_FAILED`.

A configured key expression must return a nonempty key: null, undefined and empty string return 422 `KEY_INVALID`, before saving input. Strings stay literal, including whitespace; other values use JSON serialization. Keys longer than 512 characters are refused and never truncated, for all authentication recipes. With no `dedupeKey` expression, no automatic business identity is generated. Fix invalid expressions and resend; no claim was consumed by that refusal. Event and Poll key rules are unchanged.

Explicit webhook keys are permanent in owner/loop/trigger-node scope across versions. Preserved receipt and inbound claims, saved reservations and committed run-envelope keys all count, including keys from earlier trigger kinds and old inbound-only claims with endpoint provenance. Restart, republishing, filter changes or an expired timestamp window do not reopen a key. Timestamp freshness only authenticates the new request. Concurrent repeats and retries after a lost acknowledgement start at most one run for the key.

Bodies are limited to 1 MiB; larger bodies return 413. The in-memory rate limit defaults to 60 deliveries per endpoint per minute, controlled by `GG_HOOK_RATE_LIMIT`; it resets on restart and is checked before the signature. See [Troubleshooting](07-troubleshooting.md) for timestamp and signature failures.

## GitHub body signatures

For a GitHub webhook, use body signing instead of the timestamp protocol above:

```json
{
  "type": "webhook",
  "authentication": {
    "type": "hmac-sha256",
    "message": "body",
    "header": "x-hub-signature-256",
    "secretRef": "github-repo-hook"
  },
  "body": { "type": "json" },
  "eventType": { "source": "header", "name": "x-github-event", "fallback": "webhook" },
  "dedupeKey": "$headers.\"x-github-delivery\""
}
```

The webhook presets add this editable graph:

```text
trigger --> event-check --pass (Continue)--> restore-output --> former successor
                     --ignore (Ignore)--> quiet-exit (Success, no returns)
```

For the issue-label example, `event-check` is an Expression decision with routes
`[{"id":"pass","label":"Continue"},{"id":"ignore","label":"Ignore"}]` and JSONata:

```jsonata
invocation.trigger.payload.(repository.full_name = "OWNER/REPO" and action = "labeled" and $exists(issue) and $not($exists(issue.pull_request)) and label.name = "ready") ? "pass" : "ignore"
```

Labels and branches are encoded as JSON strings, including quotes, backslashes,
newlines and Unicode. The presets extract `x-github-event` metadata with fallback `webhook`. The default authority
checks remain body-only; event headers are hints, available as `invocation.trigger.eventType`. `restore-output` is an ordinary Mutate node with:

```json
{
  "operations": [
    {
      "op": "set",
      "path": "/lastOutput",
      "value": { "kind": "expression", "jsonata": "$lookup(outputs, \"start\")" }
    }
  ]
}
```

Use your actual trigger ID in the safely quoted lookup. It restores the whole
output (`nodeId`, `value`, `at` and optional `schemaRef`), because a decision replaces
`lastOutput`. The Ignore branch ends at an ordinary terminal Exit configured as
`{"outcome":"success","returns":"none","destinations":[]}`, with no outgoing edge.
Edit any generated node directly to change behavior. The poll recipe removes a recognized earlier webhook fragment and reconnects
its former successor directly to the trigger. Unrecognized, shared or ambiguous
checks stay in place; the preview warns that they may ignore poll results.
Removal and reconnection are part of the same undo step.

Create the secret in Settings, publish the loop, and use its enabled `/hooks/<token>` URL as the GitHub payload URL. Configure JSON content and the same secret in GitHub. Subscribe to **Issues** for the example above; use **Pull requests** for PR checks. Expose only the hooks path through HTTPS, preserving the original body bytes. GitHub signs the payload in `X-Hub-Signature-256`; see its [signature verification reference](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) and [event payload reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

Replace the repository and label values deliberately. Body signing has no `windowSeconds` field. Each logical endpoint should have its own signing secret. The delivery ID and event headers are unsigned hints: check repository, object shape and action in the signed body. The editable decision uses these signed-body checks:

| Intent                       | Signed-body checks after the repository check                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Issue receives a ready label | `action = "labeled" and $exists(issue) and $not($exists(issue.pull_request)) and label.name = "ready"`                                 |
| PR opened or marked ready    | `action in ["opened", "ready_for_review"] and $exists(pull_request) and pull_request.draft = false and pull_request.base.ref = "main"` |
| PR merged into a branch      | `action = "closed" and $exists(pull_request) and pull_request.merged = true and pull_request.base.ref = "main"`                        |

An authored business key also prevents distinct payload bodies from starting separate runs for the same identity. It is scoped to this owner, loop and trigger node across versions, without expiry. Previous body receipts (including filtered or pending deliveries) and admitted runs consume the key; an older timestamp-signed run can therefore suppress a later body-signed delivery with the same key. A distinct body with a consumed key returns 202 `{accepted:true}` and is recorded as `deduplicated` with no run. Repeating that exact body returns the same acknowledgement. Timestamp-signed receivers use the same receipt/key admission path.

With these presets, a ping or unmatched payload starts a visible run that ends quietly with Success and no return. The explicit delivery key remains consumed before the downstream decision. Republishing a corrected check does not reopen that key. The raw body does not suppress another delivery: a distinct authored key can start another run for identical bytes, and unkeyed deliveries always follow Allow.

Events shows delivery state and retry attempts. For either signing recipe, the 202 follows a saved claim without waiting for run creation. A transient admission failure retains one allocated run; the background sweep retries it without needing GitHub to redeliver. Pending admissions pin the loop and its referenced subloops. Permanent failures remain visible with a safe failure code. A repeated completed receipt returns 202 `{accepted:true}`. An unconfirmed save or unavailable signing secret returns 503.

## Receive events and connect loops

Configure an event trigger to match a type and optionally deduplicate its payload; add a downstream decision for payload checks:

```json
{
  "type": "event",
  "eventType": "issue-ready",
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

To emit from another loop, add an `event` return channel to its exit. Exit-generated payloads wrap the mapped value under `result`, alongside `runId`, `loopId`, and `outcome`; use those fields in the receiving trigger's dedupe expression and downstream decision checks.

The self-trigger guard skips any loop already in the emitting run's chain, including parent subloops and earlier event callers. The chain stops at eight runs. The event remains recorded and skipped triggers produce warnings. An API-submitted event starts a fresh chain.

Open **Events** for each stored event's received time, type, source, dedupe key, payload, and **Started runs**, which links to every run the event started (or says none). The API listing returns the same `source` and `runIds`:

```http
GET /events?type=issue-ready&limit=100
```

## Poll without inbound access

Use a poll trigger when a laptop should not accept inbound connections:

```json
{
  "type": "poll",
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
  "type": "poll",
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

Cloudflare Tunnel and ngrok are examples from the design docs. Configure their proxy or gateway rules to reject every other path; a whole-origin tunnel also exposes the API and UI. Configure HMAC authentication and timestamp freshness when the sender supports them. Prefer manual or poll triggers when inbound access is unnecessary. Follow [Triggers and integrations](../08-triggers-and-integrations.md) and [Security and distribution](../11-security-and-distribution.md) for the tunnel posture.

Continue with [MCP and the Codex plugin](05-mcp-and-codex-plugin.md).

Stored filters require review during the format-4 cutover. Approve the exact version-bound generated check/restore/quiet-exit graph, supply a valid replacement fragment, or explicitly remove the filter with a reason. Formerly ignored input creates quiet runs, errors happen after acknowledgement, keys may already be consumed, and checks add visits. Filters needing headers, clock, randomness or unavailable context require replacement or explicit removal.
