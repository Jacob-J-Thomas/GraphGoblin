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

Nothing in the core knows about GitHub, CI systems, or error trackers. Provider-specific behavior is expressed through presets that fill in signature settings, filters, and dedupe keys for a generic webhook.

## Manual (Decided)

Three surfaces, one path: the UI button, `POST /loops/{id}/runs`, and the `start_run` MCP tool all create an invocation with the trigger node's input validated against its `inputSchema`. The `exposeTo` setting on the node controls which surfaces show it.

## Arming (Decided, shipped in M6)

The `TriggerService` in `apps/api/src/triggers/` owns everything between an external signal and `RunManager.startRun`.

- `POST /loops/{id}/publish` arms the new version: one `schedules` row per cron trigger node and one `webhook_endpoints` row per webhook trigger node. Rows of earlier versions of the loop are disabled, not deleted, so `GET /loops/{id}/triggers` shows the history. Runs in flight are unaffected (ADR-0008).
- Publishing is refused with 422 `LOOP_INVALID` (issue code `CRON_INVALID`) when a cron expression or timezone does not parse.
- Boot re-arms every loop's current version. Arming is idempotent per version: existing rows keep their next fire time, so a restart still sees what it missed, and a restored database without trigger rows gets them back.
- Deleting a loop disables its rows.
- `GET /loops/{id}/triggers` lists schedules, webhook endpoints (as `path: /hooks/<token>`, never the secret), and armed poll triggers.

## Cron (Decided, shipped in M6)

- The trigger editor offers six schedule presets, a searchable IANA timezone picker (default UTC), a summary, and the next five slots in both the trigger and viewer zones. Raw cron lives under the schedule's Advanced disclosure; custom expressions are preserved. The read-only `POST /triggers/cron/preview` calls `CronScheduler.nextFire` and requires `loops:read`; an invalid expression or zone returns 400 `CRON_INVALID` before publishing (see 07 and guide 04).
- croner (MIT) computes slots in the trigger's `timezone`, including daylight-saving changes. The next fire time is persisted in `schedules.next_fire_at`.
- `CronScheduler` in `packages/infrastructure/src/scheduler` polls for due schedules every `GG_TIMER_POLL_MS` (default 1 s). A schedule is advanced in the store before its listeners run, so a crash mid-fire loses at most that fire and never repeats it.
- At boot, before polling starts, each enabled schedule whose next fire time is already past applies its `missedFirePolicy`: `skip` moves to the next future slot without firing; `run-once` fires one catch-up run for the latest missed slot; `run-each` retains the latest missed slots, up to `RUN_EACH_CAP` (100) per schedule, and fires them oldest first. Past the cap the older slots are dropped with a warning naming the number dropped and the first retained slot; a minutely schedule down for a day would otherwise start 1,440 runs at once.
- A firing starts a run with `source: 'cron'`, `triggerKind: 'cron'`, payload `{ scheduledFor, catchUp }`, and dedupe key `cron:<scheduleId>:<scheduledFor>`.
- Overlapping fires start parallel runs, per the concurrency decision.

The `run-each` catch-up cap does not change `run-once` semantics. Even after an
outage longer than 100 slots, `run-once` uses the latest missed slot at or before
the recovery clock.

## Timestamp-signed webhook

- Each webhook trigger node gets an endpoint token: 32 random bytes, base64url, in the path `/hooks/<token>`. The token stays the same across published versions for the same trigger node id, so publishing does not break a sender's configuration; to rotate it, rename or replace the node. The signing secret is the owner's secret named by the node's `signature.secretRef`, resolved from the secret store on every delivery.
- `/hooks/` needs no API key because the HMAC signature is the credential. See [Public routes](07-api-and-streaming.md#public-routes-decided-by-implementation-2026-10-03) for the full list.
- Checks, in order, with the response for each failure:

  | Check                                                                                                                                                   | Failure                                              |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
  | Body at most 1 MB (enforced while reading, before anything else)                                                                                        | 413                                                  |
  | Token names an enabled endpoint                                                                                                                         | 404 `HOOK_NOT_FOUND`                                 |
  | Per-endpoint rate limit                                                                                                                                 | 429 `RATE_LIMITED` with `retry-after`                |
  | `x-graphgoblin-timestamp` present (ISO 8601 or Unix seconds) and within `replayWindowSeconds` of the server clock, in either direction                  | 401 `TIMESTAMP_MISSING` or `TIMESTAMP_OUT_OF_WINDOW` |
  | The secret exists                                                                                                                                       | 503 `HOOK_NOT_READY`                                 |
  | `sha256=<hex of HMAC-SHA256(secret, "<timestamp>.<raw body>")>` in the configured header (default `x-graphgoblin-signature`), compared in constant time | 401 `SIGNATURE_INVALID`                              |
  | Body is empty or JSON                                                                                                                                   | 400 `BODY_INVALID`                                   |
  | `dedupeKey` and `filter` expressions evaluate                                                                                                           | 422 `EXPRESSION_FAILED`                              |
  | `(endpoint, dedupeKey)` not seen within the replay window                                                                                               | 409 `REPLAYED`                                       |

- Expressions are JSONata over the parsed body, with request headers bound as `$headers` (lower-case names), excluding the configured signing header case-insensitively for both `dedupeKey` and `filter`. Without a `dedupeKey` expression the dedupe key is a SHA-256 hash of the signature digest (`sig-hash:`), which rejects a byte-for-byte replay inside the window without persisting the signature.
- Every accepted delivery is recorded in `inbound_events` (`type: 'webhook'`, `source: 'webhook:<endpointId>'`). When the `filter` rejects it the response is 202 with `filtered: true` and no run; otherwise the run starts with `source: 'webhook'`, `triggerKind: 'webhook'`, the parsed body as payload, and the dedupe key, and the response is 202 with the event and `runId`. The run is queued, not finished, when the response is sent.
- Rate limit: 60 deliveries per endpoint per minute by default (`GG_HOOK_RATE_LIMIT`), a fixed one-minute window counted in memory. It is a guard against a misbehaving sender, not a security boundary: counts reset on restart, a burst at a window edge can reach twice the limit, and the check runs before the signature so an attacker with the token can exhaust it.

Sending a delivery by hand:

```sh
TOKEN=...                      # from GET /loops/{id}/triggers -> webhooks[].path
SECRET=...                     # the value stored as the secret named by signature.secretRef
BODY='{"action":"opened","number":7}'
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)   # or Unix seconds: TS=$(date +%s)
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -sS -X POST "http://127.0.0.1:4747/hooks/$TOKEN" \
  -H 'content-type: application/json' \
  -H "x-graphgoblin-timestamp: $TS" \
  -H "x-graphgoblin-signature: $SIG" \
  --data-binary "$BODY"
```

Sign exactly the bytes you send (`--data-binary`, not `-d`, which strips newlines). GraphGoblin's own outbound webhook return channel signs the same way, so one GraphGoblin can trigger another.

## Body-signed webhook and durable admission (#29)

Select `signature.scheme: hmac-sha256-body` for GitHub-compatible signing. The default header is `x-hub-signature-256`. The digest is `sha256=<hex HMAC-SHA256(secret, exact raw body)>`; no timestamp header is required, and `replayWindowSeconds` is rejected for this branch. Signature validation precedes strict UTF-8 decoding and JSON parsing. The same 1 MiB body limit, enabled-endpoint check and rate limit apply.

A durable receipt consumes `(ownerId, loopId, triggerNodeId, SHA256(raw body))` across published versions, without expiry. The GitHub delivery header is only a business dedupe hint; changing it, the signature's hex case, the signing secret or a filter cannot bypass raw-content replay suppression. Filtered deliveries return 202 and permanently consume their content. A completed repeat returns 409 `REPLAYED`. Correct a filter for future deliveries; resending identical captured bytes will not re-evaluate it.

An authored nonempty `dedupeKey` also suppresses distinct bodies with the same business identity. In body mode, a key longer than 512 characters returns 422 `EXPRESSION_FAILED` before consuming a receipt; it is never truncated into a permanent collision. The claim transaction checks previous body receipts in every state and admitted runs, scoped to the same owner/loop/trigger across versions, without expiry. This includes an older timestamp-signed run with the same authored key. The new body is consumed as `deduplicated`, starts no run, and returns 409 `DUPLICATE_KEY`; repeating its exact bytes returns `REPLAYED`. The timestamp receiver still uses its existing replay window.

A matching delivery freezes a run ID, invocation, initial thread and subloop pins. Receipt claim and pending pins share the engine's deletion lock. Run admission commits that state together with the sequence-1 queued event and receipt link, and publishes notifications only after commit. A transient dispatch failure returns 503 while retaining the pending intent. Permanent identity or target failures are saved as failed with a safe code. Startup recovery and a non-overlapping 15-second sweep retry at most five due intents, with persisted backoff capped at five minutes. Recovery reuses only the allocated run ID after immutable identity checks. Pending pins prevent deletion; permanent failures remain visible rather than silently allocating another run.

`GET /events` can include `delivery: {state, attempts, nextAttemptAt?, failureCode?}`. This exposes disposition without raw signatures, secret headers or the internal frozen intent. Schemes are listed on armed endpoints, with a null replay window for body signing. See [ADR-0024](decisions/ADR-0024-github-trigger-admission.md) and the [GitHub setup guide](guide/04-triggers.md#github-body-signatures).

## Inbound event bus (Decided, shipped in M6)

- `POST /events` accepts `{ type, payload, dedupeKey? }` from any client with the `events:write` scope. The event is stored in `inbound_events` (`source: 'api'`) and fires every `event` trigger node of the owner's published loops whose `eventType` matches and whose `filter` passes. The response is the stored event with `runIds` and `duplicate`.
- Dedupe: an event whose `(type, dedupeKey)` was seen before fires nothing and returns `duplicate: true` with the earlier event's run ids. A trigger node's own `dedupeKey` expression additionally skips the event when that node has already started a run with the same key (looked up in the runs' stored trigger envelopes, so it survives restarts).
- Exit nodes publish to the same bus through the `event` return channel, which is how loops compose without a parent loop: a triage loop can emit `issue-ready` and an implementation loop can trigger on it. Those events are stored with `source: 'run:<runId>'`, and the runs they start record `caller: { kind: 'run', id: <emitting run> }`.
- `GET /events` lists stored events newest first (`limit`, `type`, `before`).

### Self-trigger guard

A loop that publishes the event it listens for, or two loops that trigger each other, would otherwise run forever. When an exit event arrives, the service walks the run chain back from the emitting run: to the run that started it through an event trigger (`caller.kind = 'run'`), or to its parent for a subloop, and so on. Then:

- an event never starts a loop that already appears in that chain, so a loop cannot re-trigger itself directly or through others;
- a chain may be at most `MAX_EVENT_CHAIN` (8) runs long, so a long line of distinct loops also stops.

Skipped triggers are logged as warnings; the event itself is still recorded. Events from `POST /events` start a new chain.

## Polling trigger (Shipped in M6 as the stretch)

A `poll` trigger runs a probe every `intervalSeconds` and starts a run when `fireWhen` holds and, if the node has a `dedupeKey`, the key is new for that trigger node. It shares the `Probe` model with the heartbeat node: an HTTP request with templated URL, headers, and body, or a script run in the data directory. Expressions and templates see `{ now, probe }`, where `probe` is `{ status, headers, body, json }` or `{ exitCode, stdout, stderr, json, timedOut }`; the run's payload is the probe result. `signal-count` and `none` probes produce `null`. Poll targets are armed in memory with the version (the first probe is one interval after arming or boot); seen dedupe keys live in the runs they started. Runs carry `triggerKind: 'poll'` and `source: 'poll'`. This is the trigger to recommend when a laptop should not accept inbound connections at all.

### Bounded items mode

A poll may add `items: {select, dedupeKey, maxRunsPerPoll}`. `select` evaluates over `{now,probe}` and returns at most 200 curated items. The per-item key evaluates over `{now,probe,item,index}` and must be a unique nonblank string of at most 512 characters. Every candidate and key is validated before one indexed dedupe lookup or any admission. Single-result `dedupeKey` and items mode cannot be combined.

`maxRunsPerPoll` is an integer from 1 to 25, default 5. Each run receives the selected item itself as its trigger payload, not the whole probe envelope. Seen keys do not consume that cap. Unseen items are admitted sequentially; after an admission failure, the failed item and later items remain for a future poll. Runs retain their dedupe keys, so restart does not forget successfully admitted items. A single serialized sweep prevents overlapping probes from consuming the cap twice. Each items-mode admission also checks run keys and pending allocated webhook intents atomically for the same owner/loop/trigger node. This closes the race when a node is republished from webhook to poll while an old delivery awaits recovery. A skipped key does not consume the cap or reuse the earlier run. A pending reservation ends only after admission or permanent failure; an admitted run key remains durable.

Items mode alone rejects non-successful, timed-out or malformed-JSON probes. Script stdout is captured at a strict 65,536-byte bound, and overflow refuses the whole candidate batch before dispatch. Legacy single-result scripts retain their existing truncation and text/exit-code behavior. Partition larger queries by repository, label or time range. Polling observes current state and cannot reconstruct every transition between polls.

HTTP probe results omit authorization, cookie, set-cookie and API-key response headers. Safe error codes replace raw transport/process diagnostics; application payload fields are not blanket-redacted.

## Exposing a laptop to webhooks (Decided posture)

The most secure default for a single-user laptop is to accept nothing inbound and use polling or manual triggers. When inbound webhooks are needed during development:

- Use a tunnel that terminates TLS and authenticates the tunnel itself, such as a Cloudflare Tunnel or an ngrok endpoint with its own auth, pointed only at `/hooks/*`.
- Keep signature verification and replay protection on. The tunnel is not a substitute.
- Never expose the whole API through the tunnel. Bind the API to localhost and route only the hooks prefix.
- For real distribution, the hosted version terminates TLS itself and sits behind the auth provider; webhook endpoints remain signature-gated and unauthenticated by design.

## Concurrency (Decided)

Every firing starts a run. A per-loop policy, `parallel`, `queue`, `skip`, or `replace`, is post-1.0 and will live in loop settings.

## Bundled implementation workflow (#30)

The [GitHub issue implementation template](guide/10-implementation-template.md) uses the generic poll-items trigger every 60 seconds and admits at most one eligible issue per poll. Its private support command discovers open issues carrying the configured trigger label. Before generic deduplication, the API derives a stable repository/issue/attempt key from authenticated template run history. Transactional admission independently recomputes that attempt and rejects stale or forged selections. Restarting, relabeling or creating another template instance does not reset a consumed attempt.

Publishing the parent enables polling; creating its draft does not. Support checks the issue, labels, repository identity and origin before effects, records a durable claim, then prepares local worktrees and labels the issue in progress. Direct work uses one fresh child; split tasks run sequentially in separate child worktrees and merge into the issue branch. The configured native gate must pass on an unchanged, clean commit before support can publish its exact PR intent. Successful completion leaves the PR open for review. Failed progressed attempts retain their state for manual reconciliation; only the documented pre-execution prerequisite failures can resume the same run.
