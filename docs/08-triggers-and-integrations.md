# 08 - Triggers and integrations

Stored trigger configs use `type`: `manual`, `cron`, `webhook`, `event`, or `poll`.
Webhooks use one strict `type: 'webhook'` object with nested authentication, body and event-type configuration. Config parsers reject
`subtype`; current stores and exports using it remain refused until the integrated
format-4 cutover converts them. The pure V3-to-V4 definition converter automatically
renames this discriminator. Webhook decoding and stored filters have explicit review items; the installed-store and
offline-tool cutover is still separate work.
The invocation envelope continues to record the source as `trigger.kind`.

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

Nothing in the core knows about GitHub, CI systems, or error trackers. Provider-specific behavior is expressed through presets that fill in signature settings and dedupe keys for a generic webhook and add editable downstream checks.

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

## General webhook configuration (#168 T4)

A Webhook accepts an ordinary POST at `/hooks/<token>`. Tokens remain stable across versions for the same trigger node. The pinned definition owns `body`, `eventType`, `dedupeKey`. The endpoint row owns its safe authentication recipe; intake requires exact agreement with that pinned definition and owner/loop/version provenance before resolving a secret.

```ts
{
  type: 'webhook',
  authentication: { type: 'none' }, // default
  body: { type: 'json' },          // default
  eventType: { source: 'constant', value: 'webhook' }, // default
  dedupeKey?: Expression,
}
```

All objects are strict; flat `signature` and `replayWindowSeconds` fields are rejected. None establishes no sender identity. The same endpoint lookup, 60/minute default limiter, 1 MiB raw bound (including chunked bodies), decoding, extraction and atomic admission apply to every recipe.

| Authentication                                                                     | Fields and signing message                                                                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `{type:'none'}`                                                                    | No signing fields or secret lookup; no authenticated sender identity.                                                                  |
| `{type:'hmac-sha256', message:'body', header, secretRef}`                          | HMAC-SHA256 over exact raw bytes. Header defaults to `x-hub-signature-256`; no timestamp window.                                       |
| `{type:'hmac-sha256', message:'timestamp-body', header, secretRef, windowSeconds}` | Sign UTF-8 timestamp, a dot and raw bytes. Header defaults to `x-graphgoblin-signature`; integer window 1-86,400 seconds, default 300. |

HMAC values retain the `sha256=<hex>` format and constant-time comparison. The fixed timestamp header is `x-graphgoblin-timestamp`, accepting ISO or Unix seconds, within the configured window in either direction. Authenticate raw bytes before decoding, extraction or expressions. Duplicate raw authentication headers are counted case-insensitively and rejected. Header names are lowercase RFC token characters, length 1-128. Only secret names leave the owner's secret store.

### Body and event metadata

- JSON uses fatal UTF-8 and nonempty valid JSON. Empty/whitespace JSON returns 400 `BODY_INVALID`; literal `null` is valid.
- Text yields a JSON string, including empty string. Invalid UTF-8 returns 400 `BODY_INVALID`.
- Bytes yields `{encoding:'base64', data}` without text decoding. Every mode retains the 1 MiB raw bound.

`eventType` is one of `{source:'constant', value}`, `{source:'header', name, fallback}` or `{source:'json-pointer', pointer, fallback}`. Value and fallback are EventNames: nonblank, control-free strings of length 1-128; fallback defaults to `webhook`. Missing, blank or nonscalar selected values use fallback. Ambiguous headers return 400 `EVENT_TYPE_AMBIGUOUS`; control characters or overlong scalars return 422 `EVENT_TYPE_INVALID`, including scalars that would otherwise be blank.

Pointers allow 1,024 characters and 32 segments with valid RFC 6901 `~0`/`~1` escapes. They require JSON body mode, follow own properties and array indices only, and may select a scalar root with the empty pointer. A new webhook run records extracted `invocation.trigger.eventType` through StartRunInput, the initial thread and sequence-1 queued event. Trigger output remains the decoded payload. This metadata neither publishes an Event nor establishes repository/sender authority.

### Acknowledgement, repeats and recovery

Every saved delivery returns exactly `202 {accepted:true}` without payloads, run/event IDs or dispositions. Private Events exposes pending/admitted/failed/filtered/deduplicated state, attempts, retry time, safe failure code and run links. Unsaved/unconfirmed admission or signing/configuration readiness may return 503; a saved pending or failed admission cannot change the public acknowledgement. Other errors remain 400 decoding/ambiguous extraction, 401 authentication, 404 unknown/disabled hook, 413 body bound, 422 extraction/expression failure or `WEBHOOK_PAYLOAD_TOO_DEEP` (payload nesting above 994) and 429 with Retry-After. A target loop whose stored definition still has an exit publishing an Event (ADR-0044) refuses the delivery deterministically with 409 `LOOP_UPGRADE_REQUIRED` and saves nothing; the sender gets no loop details, and the API log names the loop, version and destination paths (cron and poll triggers log the same diagnostic; targeted Event intake returns `LOOP_UPGRADE_REQUIRED` to its authenticated caller).

**Allow** is uniform, with no policy switch: identical unkeyed bytes may create distinct receipts and runs. Raw SHA-256 is audit evidence only; it suppresses nothing. An external repeat is a new delivery; recovery reuses the same saved intent and run ID. An authored nonempty key uses the existing owner/loop/trigger claim lookup across both HMAC recipes and None. A duplicate key is saved as `deduplicated` without an executable intent. Payload checks run downstream after admission; current configs reject `filter`. The `filtered` receipt state is historical only.

Claim atomically saves inbound plus receipt, complete frozen intent, pending pins and key reservation under the deletion lock. Dispatch commits run/thread, pins, first queued event, receipt state and inbound link, then notifies. Recovery verifies immutable facts, uses the attempts re-read under the lock for backoff, and retains the nonoverlapping 15-second sweep, five due identities and five-minute backoff cap. The shared D29 runner tests fake/SQLite transactions; SQLite close/reopen supplements parity.

Endpoint summaries expose `authentication`, pinned `body`, `eventType`, optional `dedupeKey` and `configurationAvailable`. Orphan or mismatched summaries mark configuration unavailable; an enabled mismatch logs a safe warning without breaking either listing. Intake still refuses that endpoint with `HOOK_NOT_READY`. Events descriptions cache endpoint, version and loop reads within each request, including repeated missing endpoints; they never cache configuration across requests. Events exposes the same safe pinned configuration under `webhook`; the UI makes it inspectable per delivery. Neither summary exposes the internal admission intent or signing values.

### Permanent explicit keys (#168 T5)

An absent `dedupeKey` creates no business identity or automatic key, including no signature-hash key. A configured expression sees the decoded payload and the current bounded `$headers` binding, excluding the configured signature header case-insensitively. Expression failures remain 422 `EXPRESSION_FAILED`.

For every authentication recipe, a null, undefined, empty-string, NUL-containing or ill-formed Unicode (lone surrogate) expression result returns 422 `KEY_INVALID` before claim; storage would otherwise turn a lone surrogate into U+FFFD and merge it with a different key. Other results use the current string-or-JSON form: strings stay exact and other values use JSON serialization. Reject above 512 characters; never truncate. Whitespace-only strings are literal keys, so `" "` and `"  "` differ. Invalid keys save no receipt or inbound row and start no run. Event keys follow the separate Inbound Events rules below; Poll keys follow the polling section.

Explicit keys remain consumed permanently in owner/loop/trigger-node scope across versions and authentication recipes. Atomic claim checks preserved receipt/inbound keys, saved intent reservations and committed run-envelope keys from every trigger kind. Inbound-only historical claims use their preserved endpoint's owner/loop/node provenance, including disabled old versions. Receipt states, elapsed time, endpoint freshness windows and republishing cannot reopen a webhook key; there is no expiry refresh or signature-hash ledger. A concurrent repeat receives a new `deduplicated` receipt without a new executable intent. Lost-acknowledgement recovery reuses the saved identity; an external repeat with the key is acknowledged without another run. A stopped-store restart preserves the claims. Deleting the loop deletes that scope and its history.

### Storage and conversion

SQL `0013_trigger_configuration` stores `auth_type`, `signature_message`, `signature_header`, `secret_ref` and `window_seconds`, preserving endpoint identities/tokens and both indexes. The copy canonicalizes valid mixed-case signing headers to lowercase; startup also validates stored headers as lowercase RFC tokens and refuses invalid names before writes. CHECKs enforce null signing fields for None, header/secret plus null window for body HMAC, and an integer 1-86,400 timestamp window. Body/extraction/key settings stay in the pinned definition. The content-hash receipt index is non-unique. Unreleased format 4 requires the 0013 structure; older stores are refused before automatic migration/recovery.

The frozen V3-to-V4 definition converter maps both old signing recipes to nested authentication, lowercases header names, supplies JSON and constant `webhook` metadata, and preserves key source. Each webhook has a hash-bound `webhook-json-decoding` review item for strict UTF-8/nonempty JSON, including the former timestamp empty-body behavior. Filters use the separate reviewed graph conversion below. Every proposal passes the current schema and graph validation. Definition approval does not perform the integrated installed-store cutover. See [ADR-0037](decisions/ADR-0037-webhook-acknowledgement.md).

### Editable GitHub webhook recipes (#168 T2)

The three webhook presets no longer generate trigger `filter`. They keep body HMAC on
`x-hub-signature-256`, the chosen secret and `$headers."x-github-delivery"` dedupe.
They insert ordinary editable nodes: trigger --> expression decision (`event-check`),
Continue (`pass`) --> mutate (`restore-output`) --> former successor, and Ignore
(`ignore`) --> terminal Success exit with `returns: "none"`, `destinations: []` and no
continuation. Non-matching deliveries therefore create visible quiet successful
runs. These payload checks run downstream of the shared webhook intake and admission path.

Checks read `invocation.trigger.payload` and return route IDs. They preserve the
repository/action/object/label/draft/merged/base checks and JSON-quote user strings.
Presets extract `x-github-event` with fallback `webhook`; their authority checks use the
signed body. The mutate uses `set /lastOutput` with an expression
`$lookup(outputs, "<triggerId>")`, copying the full `nodeId/value/at/schemaRef`
record. It does not replace that record with a mutate output.

Preview lists config fields, added/replaced nodes and added/removed/rewired edges.
Apply checks the current schemas and graph rules, including limits, and records one
undo step with held input. Existing check/restore/exit topology is explicitly
reviewed for replacement, including owner edits; ambiguous/shared topology is
retained and a new fragment is inserted for webhook recipes. The poll recipe
removes a recognized earlier webhook fragment and reconnects its former successor
directly to the trigger; otherwise, a retained downstream check is disclosed with
a warning that it may ignore poll results.

### Reviewed stored filters (#168 T6)

Current Webhook/Event contracts reject `filter`, with no dual reader. Decisions, classifiers and scripts own payload policy. Every frozen filtered version needs a stored version ID and a hash-bound `trigger-filter` resolution: approve the generated graph, replace it with `{nodes, edges}`, or remove with an explicit reason accepting broader behaviour. Header, clock, randomness, dynamic-source, absolute-root (`$$`) and unavailable-context dependencies have no generated proposal and need replacement or explicit removal. Approvals never transfer to another stored version, even with identical definitions.

Filters that read context (`@$x`) or position (`#$i`) bindings conservatively require a reviewed replacement or explicit removal, even when they use those bindings deterministically over the payload. The converter does not prove those binding scopes.

The pure V3-to-V4 converter generates trigger -> expression decision; `pass` -> restore -> former successor and `ignore` -> a new quiet Success exit (`returns: "none"`, no destinations). The decision `$eval`s the JSON-escaped original source once against `invocation.trigger.payload` in a separate block frame, preventing source bindings from replacing the coercion helpers. It then implements `evaluatePredicate` coercion: missing/null false, nonempty arrays/objects true, other values JavaScript Boolean. It does not use JSONata `$boolean`. Sequences collapse according to JSONata evaluation; NaN is classified as object by `$type` and its empty keys yield false. Arithmetic can also produce positive/negative infinity, on which `$type` throws: the completed wrapper first compares `$v` with `1/0` and `-1/0`, assigning type `number` for those values before applying the plan's coercion branches. Lambdas, built-ins and regex functions pass. Guarded eval, unsafe-regex, depth/deadline and Expression bounds remain enforced.

Restore sets `/lastOutput` from `$lookup(outputs, "<triggerId>")`. Trigger and successor-edge IDs stay; the old edge starts at restore, retains its destination and loses any invalid manual route, which the review reports. Generated Slug IDs are deterministic and collision-free. Ambiguous/multiple/missing successors, exhausted IDs and graphs above 500 nodes or 2,000 edges refuse conversion. Effectful exits are never reused. Replacements own new nodes and edges, preserve the original successor edge/destination, and pass current schema, syntax and graph validation.

Review explicitly accepts formerly ignored input creating quiet runs, expression errors occurring after acknowledgement inside an admitted run, keys consumed before the check, and extra visits against the safety cap. This definition rule does not apply SQL, convert device drafts or authorize installation; the shared cutover still composes those operations and binds stored-version review identities.

## Inbound Events (Decided; targeted durable admission, ADR-0048)

`POST /events` accepts `{ loopId, triggerNodeId?, type, payload?, dedupeKey? }` from a client with `events:write`. `loopId` is a stable loop ULID owned by that caller. Only the current published version is eligible for a new delivery. The selected entry must be an `event` trigger whose `eventType` equals `type`. Omit `triggerNodeId` only when exactly one entry matches; no request broadcasts. Runs retain `caller: { kind: 'system', id: 'event:<eventId>' }` and `source: 'event'`.

Missing or malformed fields return 400 `VALIDATION_FAILED`; unknown or foreign loops return 404 `LOOP_NOT_FOUND` without disclosing ownership. Unpublished loops return 409 `VERSION_NOT_PUBLISHED`. A mismatched entry returns 422 `EVENT_TRIGGER_NOT_FOUND`; multiple matches return 422 `EVENT_TRIGGER_AMBIGUOUS`. A failing authored dedupe expression returns 422 `EVENT_KEY_EXPRESSION_FAILED` before saving. Stored retired Event exits retain 409 `LOOP_UPGRADE_REQUIRED`. A keyed retry with unreadable stored delivery data returns 500 `STORED_EVENT_INVALID`, without rewriting history.

Targeted Event request keys must contain 1 to 512 characters of well-formed Unicode without U+0000 (NUL) (400 `VALIDATION_FAILED` naming `/dedupeKey` otherwise); an authored key containing NUL or invalid Unicode is refused with 422 `EVENT_KEY_INVALID`. This prevents SQLite text normalization or NUL truncation from changing an accepted identity.

A transaction saves the inbound delivery, exact loop/version/trigger, complete frozen run intent (including referenced subloop pins), allocated run identity and receipt identity **before 202**. The response includes `admissionId`, `target`, `delivery`, `runIds` and `duplicate`. A new executable delivery initially reports `pending` with no started-run links. Execution is asynchronous; independent requests enter the ordinary `GG_MAX_CONCURRENT_RUNS` scheduler without waiting for another run to finish. Atomic run admission commits the run/thread, first queued event, receipt state and inbound run link together. Only after that commit does `runIds` name a started run. A later publish cannot change the accepted version or pinned subloops.

An explicit request key identifies one delivery in owner/loop/trigger/type scope across versions. Retries return the **original Event and admission identity**, including its current pending, admitted, deduplicated or failed state. An omitted trigger ID on a retry can resolve that saved destination even after republishing; if two saved entries match the key, supply `triggerNodeId`. The same key for another loop or trigger is independent. Request keys remain exact (whitespace is literal; an empty request key is refused before anything is stored). Unkeyed repeats are independent deliveries; there is no body-hash suppression. Historical broadcast rows do not acquire a destination or reserve a new targeted request key.

The existing node `dedupeKey` expression remains a separate payload-key rule: its nonempty string-or-JSON result (limited to 512 characters by the existing rule) reserves the selected trigger across pending/admitted receipts and committed run envelopes. Failed receipts release this payload key: a new request key can attempt new work with the same payload key. A newly received request suppressed by that rule is saved as `deduplicated` with no executable intent. Repeating its request key returns that saved delivery. All accepted request keys, including failed receipts, stay consumed until explicit loop deletion; restarting or publishing does not reopen them. This is admission reliability, **not exactly-once external side effects**.

Boot and the existing nonoverlapping 15-second admission sweep recover up to five due Event identities per sweep, separately from the five webhook identities. Retry delays are 5, 10, 20, 40, 80, 160 and 300 seconds; the eighth failed admission ends as `EVENT_ADMISSION_EXHAUSTED`. Timer polling may delay an eligible retry. Identity conflicts (`EVENT_INTENT_CONFLICT`) and removed targets (`EVENT_TARGET_REMOVED`) fail immediately. These are engineering bounds to avoid endless failed admission attempts, not owner-approved settings. A failed retry-metadata write leaves the original pending intent recoverable at restart. Each Event receipt dispatch catches and logs its own failure, so a retry-metadata write fault cannot starve later due Events in the same sweep. Each sweep half also logs its own failure and continues independently, so an Event-ledger failure cannot block webhook recovery or startup, and vice versa. Unsaved/unconfirmed receipts return 503 `EVENT_ADMISSION_FAILED`; senders should retry using the same explicit key.

Payloads use iterative JSON validation and the shared poll nesting budget, reserving two extra container levels for `intent.queued.initialThread`: maximum payload container depth 994, counting the payload root as zero. Deeper Events return 422 `EVENT_PAYLOAD_TOO_DEEP`, and deeper URL webhooks return 422 `WEBHOOK_PAYLOAD_TOO_DEEP`, before any receipt. Both log a bounded diagnostic without payload data and never enter recovery. Other webhook URL, authentication, Allow, permanent key and fixed acknowledgement contracts remain unchanged.

`GET /events` and the Events page expose pending/admitted/failed/deduplicated delivery states, attempts, retry time and safe failure codes. Migration `0020_targeted_event_admission` adds a separate `event_receipts` ledger; it does not reinterpret or rewrite historical inbound/webhook rows. Old Events continue to show their original run links and "not tracked" admission state, with no fabricated target. Invalid stored history remains untouched.

Events come only from outside the engine. Exit-to-Event chaining remains retired (ADR-0044); use an awaited Subloop for loop composition.

## Polling trigger (Shipped in M6 as the stretch)

A `poll` trigger runs a probe every `intervalSeconds` and starts a run when `fireWhen` holds and, if the node has a `dedupeKey`, the key is new for that trigger node. It shares the `Probe` model with the heartbeat node: an HTTP request with templated URL, headers, and body, or a script run in the data directory. Expressions and templates see `{ now, probe }`, where `probe` is `{ status, headers, body, json }` or `{ exitCode, stdout, stderr, json, timedOut }`; the run's payload is the probe result. `signal-count` and `none` probes produce `null`. Poll targets are armed in memory with the version (the first probe is one interval after arming or boot); seen dedupe keys live in the runs they started. Runs carry `triggerKind: 'poll'` and `source: 'poll'`. This is the trigger to recommend when a laptop should not accept inbound connections at all.

All HTTP probes, including heartbeat and single-result polls, accept at most
65,536 body bytes. The engineering parameter `PROBE_MAX_BODY_BYTES` is defined
in `packages/engine/src/ports.ts`, matching strict poll-script stdout's 64 KiB
budget. `HttpProbes` counts bytes from fetch's decompressed response stream into a
fixed-size buffer before UTF-8 decoding or JSON parsing. Exact-cap bodies are
accepted without truncation; the first chunk crossing the cap cancels the reader
and throws `ProbeBodyOverflowError` with safe code `HTTP_PROBE_BODY_OVERFLOW`.
No partial body reaches expressions or dispatch. Poll warnings preserve that code.
An advertised `Content-Length` above the cap is rejected before any body read only
for identity-encoded responses with a body. Encoded wire lengths do not describe
the decompressed size; chunked/no-length and compressed responses undergo streamed
byte counting. HEAD and body-less responses (including 204 and 304) return an empty
body and accept representation-length metadata above the cap. Accepted UTF-8
survives split chunks; caller abort or timeout cancels the
reader and releases its lock and connection. Partition larger queries by repository,
label or time range; the cap is a code-level parameter, not a new trigger setting.

Single-result HTTP polls and heartbeats previously sliced the displayed body while
parsing the entire JSON. They now fail above the cap. API warnings named
`poll trigger failed` identify affected poll targets with `HTTP_PROBE_BODY_OVERFLOW`;
heartbeat runs fail with that same typed code. Narrow the remote query or use a
single-result script probe, retaining its 10 MiB capture and full JSON parsing.
Items-mode scripts keep their stricter 64 KiB budget.

### Bounded items mode

A poll may add `items: {select, dedupeKey, maxRunsPerPoll}`. `select` evaluates over `{now,probe}` and returns at most 200 curated items. The per-item key evaluates over `{now,probe,item,index}` and must be a unique nonblank string of at most 512 characters. Every candidate and key is validated before one indexed dedupe lookup or any admission. Single-result `dedupeKey` and items mode cannot be combined.

`maxRunsPerPoll` is an integer from 1 to 25, default 5. Each run receives the selected item itself as its trigger payload, not the whole probe envelope. Seen keys do not consume that cap and are skipped silently even if their current payload exceeds the depth bound. Unseen items are admitted sequentially. An unseen candidate exceeding `POLL_ITEM_MAX_NESTING_DEPTH` is refused individually before storage, without consuming its key or the cap, and later eligible items can be admitted in the same poll. The fixed diagnostic `POLL_ITEM_REJECTED` carries only `itemIndex` and reason `NESTING_DEPTH_EXCEEDED` alongside the trigger identity. At most 200 such diagnostics can be emitted per poll. JSON validation and depth counting are iterative. The bound is **996 nested containers below the candidate root**: SQLite JSON1 accepts 1,000 container levels, and the indexed `initial_thread` envelope occupies four through `root.invocation.trigger.payload` (including the candidate's root). An object whose property contains 996 nested arrays fits; 997 does not. Invalid JSON values and invalid/duplicate keys still refuse the whole batch before admission. An unclassified or storage admission failure still stops the tail, logs `POLL_ADMISSION_FAILED` with the failing index, and leaves that item and later items for a future poll. A refused depth key may be retried when its structure is repaired.

Runs retain their dedupe keys, so restart does not forget successfully admitted items. A single serialized sweep prevents overlapping probes from consuming the cap twice. Each items-mode admission also checks run keys and pending allocated webhook intents atomically for the same owner/loop/trigger node. This closes the race when a node is republished from webhook to poll while an old delivery awaits recovery. A skipped key does not consume the cap or reuse the earlier run. A pending reservation ends only after admission or permanent failure; an admitted run key remains durable.

Items mode alone rejects non-successful, timed-out or malformed-JSON probes. Script stdout is captured at the strict `PROBE_MAX_BODY_BYTES` bound of 65,536 bytes. The consumer checks both the overflow flag and the raw stdout byte count; either overflow refuses the whole candidate batch before dispatch with `POLL_STDOUT_OVERFLOW`. Legacy single-result scripts retain their existing truncation and text/exit-code behavior. Partition larger queries by repository, label or time range. Polling observes current state and cannot reconstruct every transition between polls.

HTTP probe results omit authorization, cookie, set-cookie and API-key response headers. Safe error codes replace raw transport/process diagnostics; application payload fields are not blanket-redacted.

## Exposing a laptop to webhooks (Decided posture)

The most secure default for a single-user laptop is to accept nothing inbound and use polling or manual triggers. When inbound webhooks are needed during development:

- Use a tunnel that terminates TLS and authenticates the tunnel itself, such as a Cloudflare Tunnel or an ngrok endpoint with its own auth, pointed only at `/hooks/*`.
- Choose the required signing recipe and timestamp freshness check deliberately. The tunnel is not a substitute.
- Never expose the whole API through the tunnel. Bind the API to localhost and route only the hooks prefix.
- For real distribution, the hosted version terminates TLS itself and sits behind the auth provider; webhook endpoints remain signature-gated and unauthenticated by design.

## Outbound webhook returns

An exit webhook destination sends a JSON POST containing `runId`, `loopId`, `outcome` and
`result`. `Idempotency-Key` carries one durable delivery identity across all attempts. Receivers
must implement their own deduplication if duplicate effects are unacceptable; GraphGoblin
does not assume they do. Signing still covers each attempt's timestamp and body.

Five attempts have 10-second acknowledgement deadlines, separated by 2/5/10/20 seconds.
Connection refusal, timeout, HTTP 408/429/5xx and unknown acknowledgement are eligible;
other 4xx, redirects and invalid destinations stop once. Redirects are never followed.
An out-of-range or invalid HTTP status is retryable `transport` / unknown, without a typed
`httpStatus`. `acknowledgementUncertain` retains prior unknown attempts independently of the
latest error and response. The inspector keeps its possible-duplicate warning after eventual
success following an unknown acknowledgement; rejection-only retries do not produce it.
The complete 2xx acknowledgement is bounded to 64 KiB. Timeouts and truncated/lost responses
mean the effect may have happened. `run.deliveries` and durable `delivery.*` events expose
pending, delivered or failed after N attempts and the last typed error, separately from
execution. Restart retains identity and consumed attempts. See
[ADR-0043](decisions/ADR-0043-bounded-webhook-return-delivery.md). These engineering values are
reviewed implementation parameters. On orderly stop, an in-flight request finishes within
its existing 10-second deadline, no new attempt starts, and pending delivery resumes on the
next start with the same budget. Loop deletion stops that loop's pending deliveries.
This outbound journal does not implement targeted Event intake.

## Concurrency (Decided)

Every firing starts a run. A per-loop policy, `parallel`, `queue`, `skip`, or `replace`, is post-1.0 and will live in loop settings.

## Template starting points and packaging (#165)

The four shipped templates are manual starting graphs copied with `POST /templates/:id/draft`. Copying creates an independent ordinary loop and draft without publication, runs, children or bindings. The catalogue validates only the declared draft export and its graph. It does not discover GitHub work or consult models, credentials, prerequisites or template storage. Later edits may add ordinary triggers and effects explicitly.

The API build and distributed image contain no private template support entry modules. There is no configured implementation, review or QA service, reporter, authority dispatch or support-command wrapper. The draft gate checks all shipped starting points and deliberately invalid graph refusal. CI loads the installed catalogue in a container without network access or writable storage, checks independent copies, and verifies that the deleted support modules are absent. Configured JSON assets remain temporarily for step 10; no loader executes them.

The generic GitHub poll-items recipe in the trigger guide remains available to ordinary loops. It uses the owner's explicit CLI credentials, bounded probes, durable deduplication and ordinary admission, without configured-instance discovery or attempt authority.
