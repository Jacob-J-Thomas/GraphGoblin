# #168 technical plan: reconciled trigger configuration and admission

This second comment follows `plan-168-summary.md`. Citations use c379f80. Reconciliation uses unchanged peer inputs from #163, #164, #165 and #167. This is research only; no implementation or owner-instance access occurs.

HMAC means hash-based message authentication code; PR means pull request; QA means quality assurance; UI means user interface; CI means continuous integration. SQL is the database language, DDL its structure-changing statements, and ULID the repository's sortable identifier. JSON means JavaScript Object Notation; MCP means Model Context Protocol; UTC is Coordinated Universal Time.

## 1. Summary

Present five configuration types within one trigger, retain Cron, and replace subtype with type. Add general webhook decoding/extraction, optional existing HMAC and downstream checks. Preserve addresses, owner secrets, raw authentication, constant-time comparisons, bounds, consumption, IDs/pins/recovery, poll dedupe and catch-up.

D7 adds durable webhook/event intake with frozen recipients; D17 acknowledges saved intake; D29 tests both adapters with one contract suite. Keep both poll modes. Q5 remains open; Allow is recommended for new authoring, without releasing old claims. Estimate 14-20 worker days plus 2-3 for shared rehearsal, excluding feedback and other issues. Confidence is high on UI/protocols and medium on fan-out/conversion. Tests below are planned, not claimed passed.

## 2. Owner decisions and reconciliation

Apply the recorded choices: one trigger kind, Cron, generic senders, existing authentication only, downstream checks, quick acknowledgement and no poll operational expansion.

Q5 remains open. Recommend Allow: distinct valid identical bodies can start work, including an unkeyed external retry. Business keys and timestamp checks still apply; recovery reuses its saved ID. Consume instead permanently claims raw content across versions, even if downstream rejects it. Both choices preserve old body configurations and consumed keys. Releasing old claims needs separate review; run replay does not reset them.

Moving a filter changes admission behavior. Formerly ignored webhook deliveries now create quiet runs; expression errors fail after 202 instead of rejecting before claim; event node keys can be consumed before a downstream check. Approval must acknowledge those changes, and later approve each exact stored-filter resolution.

| Debt | Disposition and required change |
| --- | --- |
| D7 | Absorb fully. Timestamp, body-HMAC, unsigned webhooks, POST /events and exit/bus events use the same delivery claim and atomic target commit. Freeze all event recipients, their versions, keys and intents before acknowledging. Do not insert an inbound row and separately start or link runs. |
| D17 | Absorb fully. Valid durable intake returns 202, including duplicates and saved pending or failed admission. Return 503 only when no durable intake can be confirmed or a signing secret is unavailable. An event producer must also learn whether intake was durably saved. |
| D18 | Absorb fully. One primary trigger selector, nested signing choices, optional presets and no trigger filters. Convert stored predicates through reviewed graph entries in #164's manifest. |
| D19 | Partially absorb the clarity problem, but disagree with deleting one result mode. Whole-probe and per-item payloads are intentional current features, not compatibility branches. Preserve both with clear labels and mutual exclusion; credentials and configurable directories remain separate backlog proposals under the owner's scope. |
| D29 | Absorb fully. One shared contract suite, with the same cases and assertions, runs against in-memory and SQLite admission adapters. It covers receipts, transaction rollback, pending pins, dedupe and notifications. Adapter-specific persistence tests supplement it. |

The register is under review. These entries are source risks, not failures reproduced here. Sections 8 and 9 reconcile shared and parked work.

The owner has not decided #167. Recommend keeping loop-back for now with medium confidence. If continuation nodes are preferred, decide now to avoid another cutover. #168 needs a quiet terminal exit under either shape; its final factory and cutover await that decision.

## 3. Target contract

### Trigger definitions

Use one strict union on `config.type`. #164 owns format 4 and decision/exit schemas. Live APIs reject subtype, filters and old signing shapes; frozen schemas are offline only. For example, `{id:'start',kind:'trigger',config:{subtype:'manual'}}` becomes the same node with `config:{type:'manual'}`; node identity does not change.

Existing scalars remain: Expression is a nonempty string up to 100,000 characters; node IDs use the existing 64-character Slug rule; secret references are nonempty strings up to 128 characters. HeaderName uses RFC token characters, has 1-128 characters, and is canonical lowercase. Defaults appear explicitly in converted canonical output; use Zod `.prefault({})` where nested object fields have defaults.

| Type | Stored and exported fields |
| --- | --- |
| Manual | `type: 'manual'`, optional `inputSchema: JsonSchema`, and nonempty `exposeTo: ('ui' | 'api' | 'mcp')[]`, defaulting to all three. Keep current input validation. Fixing current exposeTo enforcement is outside this issue. |
| Cron | `type: 'cron'`, `expression: string` of 1-256 characters, `timezone: string` of 1-64 characters defaulting to UTC, `missedFirePolicy: 'skip' | 'run-once' | 'run-each'` defaulting to skip, and `enabled: boolean` defaulting to true. Keep current syntax, timezone and preview validation. |
| Event | `type: 'event'`, `eventType: Slug`, and optional `dedupeKey: Expression`. Keep exact subscription and bus/node dedupe. Remove filter. |
| Poll | `type: 'poll'`, `intervalSeconds: integer` from 5 to 86,400, `probe: Probe`, `fireWhen: Expression`, optional `dedupeKey: Expression`, optional `items: PollItems`, and `enabled: boolean` defaulting to true. Whole-probe dedupe and items remain mutually exclusive. |
| Webhook | `type: 'webhook'`, `authentication: WebhookAuthentication`, `body: WebhookBody`, `eventType: WebhookEventType`, `dedupe: WebhookDedupe`, and `repeatPolicy: 'allow' | 'consume-content'`. Defaults are None, JSON with empty-to-null, constant webhook event type, no business key, and the approved repeat default. |

No webhook filter, response template, top-level signature, replayWindowSeconds or dedupeKey remains. No new saved poll field is added.

### Webhook fields and validation

```ts
type WebhookAuthentication =
  | { type: 'none' }
  | { type: 'hmac-sha256'; message: 'body';
      header: HeaderName; secretRef: SecretName }
  | { type: 'hmac-sha256'; message: 'timestamp-body';
      header: HeaderName; secretRef: SecretName; windowSeconds: number };

type WebhookBody =
  | { type: 'json'; empty: 'null' | 'reject' }
  | { type: 'text' }
  | { type: 'bytes' };

type WebhookEventType =
  | { source: 'constant'; value: EventName }
  | { source: 'header'; name: HeaderName; fallback: EventName }
  | { source: 'json-pointer'; pointer: string; fallback: EventName };

type WebhookDedupe =
  | { type: 'none' }
  | { type: 'key'; expression: Expression;
      scope: 'trigger'; retention: 'forever' }
  | { type: 'key'; expression: Expression;
      scope: 'endpoint-version'; retention: 'window'; seconds: number };
```

All objects are strict. Timestamp window and key-window seconds are integers from 1 to 86,400; the timestamp default is 300. The paired dedupe scope/retention variants preserve existing permanent body-key and endpoint-window semantics without adding every possible retention combination.

EventName is a nonblank, control-free string of 1-128 characters with exact case; Event subscriptions remain Slugs. Ambiguous headers return 400 EVENT_TYPE_AMBIGUOUS. Missing, blank or nonscalar values use fallback; oversized/control values return 422 EVENT_TYPE_INVALID. JSON Pointers allow 1,024 characters, 32 segments, valid RFC 6901 escapes, own properties and array indices; a string root is valid. They require JSON mode. No wildcards, arbitrary JSONPath, expressions or signing credentials are extraction sources.

Retain SHA256, hexadecimal `sha256=`, current prefix/case acceptance and constant-time comparison. Body header defaults to x-hub-signature-256; timestamp signature defaults to x-graphgoblin-signature. The fixed x-graphgoblin-timestamp accepts current ISO/Unix seconds. Hash timestamp UTF-8, dot and raw bytes without decoding first. Document strict malformed UTF-8 rejection after verification. None has no signing fields or authenticated identity. No new protocol is added.

JSON decoding uses fatal UTF-8 and JsonValue validation; empty or whitespace-only input becomes null or rejects according to `empty`. Text returns a UTF-8 JSON string, including an empty string. Bytes returns `{encoding: 'base64', data: string}`. Enforce the existing 1 MiB raw-body bound while reading, including chunked input; base64 expansion remains bounded. There is no automatic content-type transformation, decompression, multipart or form parser. Scripts can interpret XML or form text.

Key expressions evaluate against the decoded payload with current in-memory `$headers` bindings excluding the configured signing header. Never persist full headers. Null, undefined or empty results mean no authored key; other results use the current string-or-JSON representation. New webhook and event node keys longer than 512 characters reject rather than truncate; conversion reports this change and preserves old stored truncated keys. Whitespace strings remain authored identities. Poll item keys keep their existing stricter nonblank rule. An HMAC delivery without an authored key may retain `sig-hash:<digest-hash>` as envelope provenance, but that does not activate permanent business-key dedupe under Allow.

### Poll contract

Keep the current strict Probe union. HTTP has method GET, POST or HEAD, default GET; templated URL, optional templated headers/body, and integer timeout of 1-300 seconds, default 30. Script has a nonempty command, templated args defaulting to an empty array, and integer timeout of 1-3,600 seconds, default 60. Signal-count has a Slug name; None has no fields. Script probes continue using the data directory and ambient local CLI credentials.

PollItems retains select and dedupeKey expressions plus maxRunsPerPoll from 1 to 25, default 5. Validate at most 200 candidates and all unique nonblank string keys of at most 512 characters before lookup or admission. Preserve single-result payloads and per-item payloads, the failure-tail rule and serialized sweeps. The editor explicitly labels these two supported result modes. No credentials, configurable cwd, pagination engine, backfill or cursor is introduced.

### Graph recipe and output

Use #164's expression decision contract exactly: `{kind: 'expression', jsonata, routes: [{id, label}, ...]}`. Its expression returns a declared string route ID, not a Boolean observation or Noul decision. This replaces the first draft's stale Boolean-decision factory assumption.

```json
{"kind":"expression","routes":[{"id":"pass","label":"Continue"},{"id":"ignore","label":"Ignore"}],"jsonata":"($p := invocation.trigger.payload; invocation.trigger.eventType = 'issues' and $p.repository.full_name = 'octo-team/service-repo' and $p.action = 'labeled' and $exists($p.issue) and $not($exists($p.issue.pull_request)) and $p.label.name = 'ready') ? 'pass' : 'ignore'"}
```

Generate strings with JSON escaping, not source interpolation. GitHub selects body-HMAC, JSON, x-github-event with webhook fallback, and x-github-delivery as a business-key expression. The unsigned headers are hints; repository, object, action and label checks use the signed body. PR recipes retain draft, merged and base-branch checks. Classifier decisions and scripts remain ordinary downstream alternatives.

```text
hook.out -> event-check --pass--> restore-output.out -> former successor
                       --ignore--> quiet terminal exit
```

Restore the exact original trigger NodeOutput, including nodeId, value, at and schemaRef, because a decision overwrites lastOutput. Use an ordinary mutate set at `/lastOutput`, with expression access to `outputs[triggerId]` generated safely for the ID. Mutate does not replace that with its own output. The ignore exit has no return channels or loop-back. If #167 keeps loop-back, use the ordinary unconditional success exit with no channels; if it chooses terminal-only exits, use its success-outcome equivalent. Additional decision outputs and visits remain visible.

### API and envelope

Keep trigger nodeId, kind, payload, receivedAt and optional dedupeKey. Add optional `eventType: EventName`; new webhooks always set it, but history does not invent missing header metadata. Pass it through StartRunInput, initial thread, sequence-1 queued event and frozen identity. The trigger handler still outputs payload. Webhook extraction does not publish another event onto the bus.

New webhook inbound rows use extracted type and source `webhook:<endpointId>`; old type webhook remains factual. Bus dedupe covers only event-origin rows, never webhook rows with a coincidentally equal type/key. POST /events keeps its input and event/duplicate response, but runIds may initially be empty while saved targets await admission. Authenticated Events shows recovery state and links as they commit.

Hooks return fixed `202 {accepted: true}` once valid intake is saved or known consumed. Do not expose payload, signature, event or run ID through the public acknowledgement. Retain 400 for malformed input, 401 for signature/window errors, 404 for unknown or disabled endpoints, 413 for the body limit, 422 for extraction/key errors, 429 with retry-after for the existing rate limit, and 503 when signing readiness or durable save fails. Pending admission never changes an already-saved delivery to 503 or a retry to 409.

Endpoint summaries retain identity, owner, loop/version/node, path, enabled and creation time. Replace flat signing fields with the safe recipe and include body, event extraction, dedupe and repeat configuration from the pinned version. Expose only secret names. `configurationAvailable: false` distinguishes disabled orphan endpoints whose definition is unavailable. MCP descriptions use type. Delivery metadata exposes safe state, attempts, nextAttemptAt and failureCode, plus a reason when provable; never frozen intents or credential material. For fan-out, add nonnegative counts by target state; attempts is their sum, and nextAttemptAt is the earliest pending time.

### One delivery admission contract (D7 and D29)

Generalize TriggerAdmissionPort, not a parallel event-specific implementation. `claimDelivery` accepts one validated inbound delivery, its consumption policy and a complete frozen target set. `commitTarget` takes a saved target ID and its exact RunAdmission. Keep create for ordinary starts and atomic createPollItem. Due selection, failure recording and pending-pin queries operate on the shared target records. No public caller supplies allocated run IDs.

A webhook has one possible target. An event snapshots all matching published owner-scoped Event triggers, preserving caller-chain exclusion and the chain limit of eight. Before intake commits, freeze each selected version, invocation, allocated run ID, initial thread, queued event and subloop pins. Record skipped or failed selections safely; an individual target preparation error must not silently disappear or prevent valid siblings from being saved. Recovery uses this set, never rescans newly published versions or newly created subscriptions.

Save inbound, receipt, targets and reservations together under the deletion lock, revalidating versions and keys inside the transaction. An intake never consumes its identity without its targets. Zero recipients means recorded input with no work. A failed transaction saves nothing.

Each target atomically commits its run, thread, pins, queued event, status and inbound link, then notifies. Siblings commit separately; recovery neither repeats admitted work nor loses pending work. Fan-out execution itself is not atomic.

An event request key consumes owner/event-type/key permanently within the event-bus namespace. A duplicate returns the original event and current links without new targets. Node-authored event keys retain owner/loop/node dedupe and now see pending reservations. Webhook policies keep their separate trigger or endpoint scope. A pending target's envelope key remains visible to poll-item checks, including after republishing the trigger kind; committed run keys remain visible. A duplicate audit record must not extend signature or key expiry.

The proposed SQL separates intake and target recovery:

| Record | Fields and constraints |
| --- | --- |
| `inbound_receipts` | Preserve old receipt ID where one exists. Fields are id, owner_id, inbound_id (unique), origin (`webhook` or `event`), event_type, received_at, status, targets_frozen, target_count and nullable targets_hash. Status is pending, admitted, failed, deduplicated, filtered or historical. New targets are always frozen with a hash; historical incomplete selections never become pending. |
| Webhook receipt scope | Nullable endpoint_id, loop_id, version_id and trigger_node_id are required for webhook origin and absent for event origin. Nullable content_hash is a 64-character lowercase SHA256 hash; consume_content is a Boolean and can be true only for webhook origin. |
| Receipt dedupe | Nullable business_key (at most 512 characters), business_scope (trigger, endpoint-version or event-bus), business_expires_at, signature_replay_hash and signature_replay_expires_at. Signature hash and expiry are paired for timestamp replay. `claims_business` and `claims_signature` distinguish consumption from audit facts. Forever keys have no expiry; window keys require it. |
| Receipt evidence | Nullable reason uses safe codes such as content-consumed, signature-replay, business-key or event-key. Optional duplicate reference has paired kind (receipt or run) and ID. No raw signatures or header collections are stored. |
| `trigger_admissions` | Fields are id, receipt_id, owner_id, loop_id, version_id, trigger_node_id, ordinal, status, phase, nullable run_id, nullable reservation_key, nullable intent, attempts, next_attempt_at and failure_code. Status is pending, admitted, failed, deduplicated, skipped or historical; phase is selection or admission. Attempts are nonnegative integers. |
| Target identity | The intent retains RunAdmission's run, initialThread, queued and pinnedLoopIds. Pending and admitted targets require an intent/run ID; admission-phase failure retains that intent. Selection failures and skipped/deduplicated targets have no executable intent. Historical targets may link a proven old run without reconstructing its intent. |

IDs use the existing ULID rules; times use Timestamp; owner and trigger IDs retain their current bounds. Target counts are exact nonnegative counts, not user-supplied limits. Unique receipt/ordinal and receipt/loop/node identities prevent repeated recipients; allocated run IDs are unique. The indexed target key query includes owner, loop, node and pending state. Pending pin checks inspect saved intents. Receipt aggregation is pending if any target is pending, failed if terminal targets include failure, otherwise admitted; filtered, deduplicated and historical facts remain explicit. Aggregate admission does not mean graph execution succeeded.

The receipt table replaces webhook_receipts without an alias. Add UNIQUE(owner_id, loop_id, trigger_node_id, content_hash) where consume_content is true; index signature replay by owner/endpoint/expiry and event claims uniquely by owner/type/key. Keep inbound, due and scope indexes. Audits never renew keys; webhook lookup retains receipt/run evidence. The port and converter validate relations; no broad foreign-key project is added.

The same saved-delivery boundary applies to exit/bus producers. `onBusEvent` must propagate failure before durable intake instead of logging and swallowing it. Once saved, pending work is success to the producer. Existing at-least-once return-channel behavior remains; this issue does not deduplicate separate unkeyed publications from a return retry.

## 4. Stored data and the single format-4 converter

### Agreement with #164's integration shape

Agree with `peer-inputs/plan-164.md:149`: freeze format-3 imports/replay first, retain earlier stages, and collect edits against original IDs/pointers. #168 contributes graphs, storage maps, notices and refusals; #164 composes them once with approved builders. Never run competing wrappers or overwrite another stage's edits.

Agree with the exact shared envelope:

```ts
{
  format: 'graphgoblin-upgrade-manifest', targetVersion: 4,
  sourceHash, converterHash, sqlHash, versions, failedRuns,
  retirements, historyResolutions, expectedResultHash,
  approval: { approvedBy, approvedAt, approvedPlanHash }
}
```

approvedPlanHash binds the canonical manifest excluding approval, including rules, SQL, source, dispositions and result. Changed inputs require a new preview/approval. There is no separate trigger manifest or stamp; plan approval does not approve data.

### #168 manifest entries

The following are proposed strict schemas inside #164's namespaces. The coordinator fixes the exact spelling once; these are contributions to the common schema, not additional top-level envelopes.

| Common namespace | #168 entry |
| --- | --- |
| `versions[versionId]` | Retain #164's definitionHash. Add `resolutions.triggers[nodeId]` with sourceConfigHash, action (`automatic` or `review-filter`), optional filter resolution, and targetConfigHash. Every retained trigger is hash-bound, including automatic mappings. |
| Filter resolution | Require filterHash, reason, and kind (`generated-graph`, `replacement-graph` or `remove`). Generated entries include decisionId, restoreId, exitId, newEdgeIds, originalSuccessorEdgeId and graphHash. Replacement includes the complete reviewed graph fragment and graphHash. Remove explicitly acknowledges broadened behavior and supplies no fragment. |
| Header-dependent resolution | A reviewed filter entry may also specify a bounded current eventType extraction config and an explicit route-ID expression. It must acknowledge the changed metadata/error behavior. No unrecorded headers are invented for history. |
| `historyResolutions.triggers.rows` | Bind table, rowId, sourceRowHash, pointer and originalValueHash, action, targetValueHash and reason. Tables are webhook_endpoints, webhook_receipts, inbound_events, runs and run_events. Actions distinguish endpoint mapping, receipt mapping, historical-intake classification and factual field preservation. Multiple rows can share a rule but each identity/hash remains bound. |
| `historyResolutions.triggers.claims` | Bind source identity/value hashes for permanent body keys, timestamp-window evidence, event-bus key claims and run keys; include target scope, expiry or permanent retention, and proof classification. Collision resolution needs exact member IDs and a reviewed canonical claim; it never merges or deletes factual inbound rows. |
| Shared `historyResolutions` | Any actual initial-thread, queued, snapshot or output transformation joins #164's run/event/pointer/original-value entries. #168 proposes no semantic trigger-history rewrite by default. |
| Shared `retirements` | #165 owns exact retired row/file closures and reasons. #168 only checks that its survivor set excludes approved retired identities and that mixed surviving recipients/pins do not cross that closure silently. |
| Shared `failedRuns` | #164 owns reviewed nonresumable dispositions. #168 reports affected filter-graph versions and reachable dependencies; it does not invent a second failed-run map. |

Reject unknown, unused, stale or conflicting entries. Row/pointer edits must declare composition; graph edits use original IDs. A shared exit/edge needs one joint resolution. Portable exports use these rules bound to file hashes.

### Definition mappings and filter resolutions

Manual, Cron and Poll rename subtype to type without changing other values, defaults, IDs, settings or positions. Event preserves its subscription/key and removes filter only through the resolution below. Unknown types, conflicting type/subtype, extra fields, bad expressions or unsupported source probes refuse instead of receiving guessed defaults.

Timestamp webhook maps hmac-sha256 to authentication timestamp-body, moves replayWindowSeconds to windowSeconds, keeps header/secret, selects JSON empty-to-null and constant webhook metadata, and uses Allow. An authored key becomes endpoint-version/window dedupe with the same seconds; no key becomes None. Body webhook maps hmac-sha256-body to authentication body, keeps header/secret, selects JSON empty-reject, constant webhook metadata and Consume. Its authored key becomes trigger/forever, otherwise None. Reject invalid headers/windows, a body branch carrying a window, unknown schemes and inconsistent stored endpoint recipes. Do not infer a protocol from a provider label.

Report the new refusal of overlong webhook/event keys and strict UTF-8 handling. Preserve all old stored keys exactly, including prior truncation. Stored configurations may later be edited normally; conversion itself does not release consumption.

For a pure payload predicate, generate a route expression that evaluates the exact escaped original source against invocation.trigger.payload and returns pass or ignore. Prove its result is Boolean before wrapping it in the route conditional. The existing predicate coercion treats nonempty objects or arrays as true (`packages/domain/src/expression.ts:199`); do not silently replace that with JSONata truthiness. Nonboolean results need an explicit reviewed Boolean rewrite. Apply the existing guarded $eval and regex checks to original and wrapper; refuse a wrapper exceeding the Expression limit. Header, clock, random, dynamic-eval or unavailable-context dependencies require authored resolution.

Every stored filter needs review even when a proposal can be generated. Preserve the trigger ID and old successor edge ID. Generate deterministic collision-free Slug IDs for decision, restore, terminal exit and new edges. Repoint the old edge from restore to its old successor; clear and report its invalidated manual route. Add trigger-to-decision, pass-to-restore and ignore-to-exit edges. Restore the exact trigger output before the successor. Reject ambiguous or multiple outgoing edges, disconnected graphs without a reviewed destination, exhausted ID space, or final limits exceeding 500 nodes or 2,000 edges.

Each exact version needs a resolution acknowledging changed runs, errors, keys and counters. Never reuse an effectful exit, delete a filter silently or add newer preset checks. A replacement supplies a valid graph/expression, not merely a reason.

### SQL numbering and construction

Agree with the central reservations: `0012_retire_template_instances` belongs to #165, `0013_trigger_configuration` belongs to #168, and `0014_format_four_cutover` belongs to #164 only when chosen exit metadata requires DDL. Our 0013 includes event intake/target storage as required by D7. Omit unused slots and empty migrations. If main consumes a reserved number, renumber only the unshipped allocation in review. Never modify shipped SQL 0008-0011 or earlier conversion stages.

0013 rebuilds webhook_endpoints for optional authentication, creates inbound_receipts and trigger_admissions, converts surviving receipt/intake facts, installs consumption/recovery indexes and retires webhook_receipts after archival and validation. Keep endpoint id, owner, loop/version/node, token, enabled and created_at. Map signature_scheme to auth_type and signature_message; header, secret_ref and window become nullable. CHECK None has no signing fields; body requires header/secret and no window; timestamp-body requires header/secret and a window of 1-86,400. Preserve token/loop indexes and run-key indexes.

Bind structure/constraints/indexes and migration hashes into sqlHash/readiness. For D12, reconstruct the shipped 0011 snapshot and final snapshots; generation must be a no-op, not re-create template structures. #164 owns journal/test registry/readiness; #165 supplies deletion metadata. SQL alone never stamps a used store.

Archive changed/dropped fields before SQL. Materialize survivors from original inventory, excluding only exact approved #165 retirements. Never silently retire history or regenerate tokens. All rules, tables, ledger and marker commit together.

### Receipt, event and key conversion

Old body receipts retain their IDs, raw hashes, owner/loop/node scope, inbound references and disposition. Every state remains a permanent content claim, including filtered, deduplicated and failed. Map a terminal frozen intent into one target record without allocating a new run ID. Keep attempts and safe failure facts. Admitted targets must match the existing run and first queued event; permanently failed targets remain non-executable. Filtered and key-deduplicated facts have no target intent and are not turned into work.

Preserve every stored body-receipt key as opaque permanent business evidence, including default sig-hash values. The old claim looked up all prior receipt keys, so a later authored key matching such a value must remain consumed. Do not re-evaluate an old expression using missing headers. Multiple historical receipts can evidence the same business key; preserve the facts rather than forcing them into one unique receipt. New audit rows never renew a claim or its expiry.

Old timestamp deliveries and event-bus rows have no complete saved target set. Give them historical receipt records with targets_frozen false; retain payload, type, source, time, key and all run links. Only proven existing run links become historical target rows. Do not reconstruct executable intents, guess missing recipients, replay old filtered events or declare a crash-lost run recovered. D7 fixes future intake, not unknowable past selection. Historical receipts never enter the due sweep.

For timestamp rows, preserve exact endpoint-version key evidence and expiry based on receivedAt plus the endpoint's stored window. Recover signature replay identity only when exact historical configuration and the default sig-hash provenance prove it. Custom keys remain opaque window evidence. Missing or ambiguous live provenance refuses. Disabled orphan endpoints may retain opaque facts only when no execution dependency survives. For event rows, preserve permanent bus keys in the event-origin namespace. Do not transfer webhook keys into that namespace. Report that intentional correction of accidental cross-source collisions.

Keep every committed run-envelope key and the indexed owner/loop/node lookup, including older timestamp, poll and event runs. Pending reservations are refused at old-store cutover, but fresh format-4 tests verify their cross-kind behavior. Corrupt joins, duplicate content claims, conflicting owner/token/version identity, incomplete indexes or unsupported source fields refuse instead of dropping evidence.

### History, snapshots and pending state

Inventory all versions, including draft and historical definitions, plus runs, initial threads, queued events, snapshots and checkpoint state, receipt intents, inbound links, pins, timers, returns, finalization and event caller chains. Mechanical discriminator change does not alter invocation.trigger.kind or payload. Add no eventType inferred from unrecorded headers. Never synthesize a decision or restore visit into old logs.

Agree with #164 and #165 that node.started.configHash remains the hash of what actually executed. Archive exact source definitions/configurations and map original to converted hashes by version/node/source hash. Recompute current draft tokens and export hashes from the final graph, but do not use them to rewrite execution facts. When #164 or #165 explicitly maps factual thread values, apply the same approved mapping to terminal receipt intent, run initial thread and queued evidence; identities remain unchanged and originals remain archived. A trigger-only conversion makes no such factual change. Reviewed header-dependent graphs must reject replay entries lacking that metadata or explicitly handle its absence.

Replay every retained run and checkpoint from its transformed initial thread and events at the recorded sequence. Refuse inconsistent snapshots, missing version provenance and conflicting pins. An old checkpoint is not discarded to make conversion succeed. Failed resumable runs affected by changed graphs and reachable subloops use #164's reviewed disposition; recommend nonresumable preservation with a safe upgrade reason. No changed graph resumes an old visit implicitly.

Refuse all queued, running, waiting or paused runs, all pending ordinary webhook receipts, and unresolved timers, child notifications or effectful finalization. The old build must settle work before a stopped inventory is approved. This converter does not drain, cancel, execute, reallocate or reset it. The refusal must leave data unchanged. #165's proposed in-converter abandon-retired-target exception conflicts with #164's blanket refusal: recommend separate reviewed resolution before cutover and a fresh inventory/hash. Until that rule is jointly changed and approved, pending retired targets also refuse.

Preserve surviving endpoints and claims. #165 may explicitly archive and remove an entire retired component with its exact closure; its hook URL ceases and its IDs/tokens are never reused. Shared inbound rows, ordinary recipients or pins crossing the retirement closure require one reviewed shared disposition, not an automatic unlink. This is the only intentional retirement exception to surviving-token preservation, and it does not authorize losing ordinary recovery evidence.

### Inventory, dry run, backup and apply

Supply bounded, indexed receipt/intake/per-run inventory to #164 (D9). Report identity/value hashes, mappings, refusals, routes, token comparisons, consumption counts and replay results. Routine output contains safe counts/codes; detailed reports are private and exclude credentials and signatures.

Dry-run validates the source read-only and executes the actual SQL, semantic and replay apply on an independent copy. A rollback-only source preview is forbidden because it can change WAL bytes. Only preview may omit approval. Hash the result and plan; any changed rule, source, graph or SQL requires a new preview.

Apply locks the stopped directory/database, verifies complete separate backups, and rechecks source/blockers inside one transaction. Archive before structural changes; apply the rules, validate schemas, owner/pins, consumption and every checkpoint, then stamp and commit once. Failure rolls back data, DDL, ledger and marker. Inspect interruptions. Fresh schema and marker must also commit together (D4/#152).

D5/#118 requires owner approval to unpark #118 and repair provenance, or approve exact #164 inventory resolutions. Verified backups may supply missing definitions; unavailable definitions are not guessed. Without a valid resolution, cutover refuses. This is not permission to delete orphan history.

IndexedDB needs #164's separate lossless transition. Preserve active/set-aside/raw drafts, incomplete text and tokens before replacement; convert proven cases and quarantine the rest for export. Never delete drafts or auto-save old data over the server. Reconcile tokens only from proven mappings, otherwise reload/restore explicitly. Keep frozen conversion in the upgrade subpath (D10).

Rehearse later on supplied stopped copies. Isolate effects and disarm triggers/recovery before execution; a DB copy alone is insufficient. Keep a factual copy, disclose runnable-copy edits, prove backup restoration with old hashes/build, and rehearse upgrading again. Never use the original instance or port 4747 here.

## 5. Runtime, API and editor changes

Keep Zod-only contracts, pure domain logic, infrastructure ports and public package imports. No new dependency or package is planned.

| Source at c379f80 | Planned change |
| --- | --- |
| `packages/contracts/src/nodes.ts:92`, `packages/contracts/src/trigger-integrations.ts:13`, `packages/contracts/src/thread.ts:27` | Define five trigger types, nested webhook fields and optional event metadata. Preserve Probe and PollItems. #164 owns format and route-ID decisions. |
| `packages/infrastructure/src/http/delivery.ts:16`, `apps/api/src/triggers/webhook-body.ts:35` | Verify exact bytes before decoding, retain constant-time checks, and support None plus bounded decoding. Count actual raw duplicate authentication headers case-insensitively. |
| `apps/api/src/triggers/trigger-service.ts:173`, `:288`, `:431`, `:470`, `:507`, `:537` | Replace split webhook/event writes with common claim and target admission. Remove filters, freeze recipients, isolate dedupe namespaces and propagate bus save failures. |
| `apps/api/src/event-bus.ts:30`, `apps/api/src/container.ts:315`, `packages/engine/src/ports.ts:395` | Await durable event intake. Pass trusted emitting owner/run metadata through the internal return port rather than inferring identity from payload or assuming LOCAL_OWNER. Coordinate this small port change with #164 exits. |
| `packages/engine/src/admission.ts:15`, `packages/engine/src/run-manager.ts:347`, `:418`, `:461`, `:536` | Generalize claim/recovery and preserve frozen identity, deletion lock and poll reservations. Bound recovery to five due targets per nonoverlapping 15-second sweep with persisted backoff capped at five minutes. |
| `packages/infrastructure/src/sqlite/admission.ts:74`, `:188`, `packages/infrastructure/src/sqlite/triggers.ts:187`, `:365`, `:405` | Implement intake/target transactions, key claims, links and postcommit notifications. Keep endpoint identity and idempotent arming. #165 removes private template callbacks first. |
| `packages/engine/src/testing/fakes.ts:813`, `packages/engine/src/testing/index.ts:1` | Implement the same port in the fake and export the adapter-neutral contract runner through engine/testing. Infrastructure tests import that runner; engine tests never import SQLite. |
| `apps/api/src/routes/triggers.ts:16`, `:50`, `:107`, `:153` | Keep raw parsing, the body bound and private scopes; change public acknowledgement and safe metadata schemas. Events shows partial fan-out recovery without exposing intents. |
| `apps/api/src/triggers/poll.ts:124`, `:219`, `apps/api/src/triggers/poll-items.ts:15`, `packages/infrastructure/src/http/probes.ts:39` | Preserve both modes and failure-tail semantics. Apply an internal streaming 65,536-byte limit to items HTTP probes before JSON parsing; general probe memory bounds remain #117. |
| `packages/infrastructure/src/scheduler/cron-scheduler.ts:111`, `:169`, `packages/engine/src/handlers/trigger.ts:5` | Retain catch-up, cap 100, persisted fire times and advance-before-listener semantics; the trigger still outputs its payload. |
| `apps/web/src/editor/NodeEditorDialog.tsx:649`, `apps/web/src/forms/fields/structure.tsx:805`, `apps/web/src/editor/Palette.tsx:97`, `apps/web/src/editor/model.ts:63` | Add trigger-specific type ordering and palette shortcuts, not a global change to every union label. Preserve focus, held input, schema errors and undo. |
| `apps/web/src/editor/trigger-presets.ts:44`, `apps/web/src/editor/TriggerPresets.tsx:21`, `apps/web/src/editor/store.ts` | Preview and atomically apply the graph recipe. Preserve successor/output, validate IDs and limits, and make the whole edit one undo step. Reapplication requires explicit replace/cancel review. |
| `apps/mcp/src/describe.ts:23`, `apps/web/src/drafts/local-drafts.ts:74`, `packages/domain/src/upgrade-current.ts:94`, `packages/infrastructure/src/sqlite/upgrade.ts:91` | Update current consumers, then integrate #164's converter, lossless device transition and guard. Do not globally replace unrelated subtype fields or frozen schemas. |

Type changes are undoable and review lost fields. Presets stay optional; see summary review stages. No editor execution or template authority is added.

## 6. Child PR breakdown

Children target `feat/format-4-integration`, reference Part of #168 and require owner review. GPT-6.1 Sol xhigh implements; independent Claude Opus 5.5 xhigh reviews in cloud; separate Sol xhigh provides qa:touched-systems. Supply head/diff, fixtures, safe traces and screenshots without owner-instance access.

| Child | Scope, approximate files and owner-visible result | Verification and documentation |
| --- | --- | --- |
| T1 | 20-35 files put type first and presets below it; prepare typed current fixtures. Owner reviews the five primary choices and Manual/Cron/Poll layouts. | Test keyboard, focus and undo. Update docs/09 and the trigger guide. |
| T2 | 25-38 files add GitHub graph preview, route decision, restore and quiet exit. Owner applies, edits and undoes issue/PR recipes. | Verify signed-body checks, quoting and successor output. Update docs/08-09 and recipe guidance. |
| T3 | About 30-40 files perform the atomic discriminator switch after fixture preparation. Owner reopens and exports configs and inspects MCP descriptions. | Test strict shapes and consumers; regenerate clients/references and update upgrade notes. |
| T4 | 30-40 files add general decoding/extraction, shared webhook/event intake and target recovery. Owner sees quick acknowledgement and saved fan-out. Split a complete visible slice if necessary. | Run the shared adapter suite and crash tests; update docs/05/07-09, API reference and admission ADR. |
| T5 | 22-35 files implement approved repeats, separate replay/business claims and Events explanations. Owner repeats keyed/unkeyed bodies and observes recovery. | Verify races, expiry, restart and stable addresses. Update docs/08, guide, ADR and CHANGELOG. |
| T6 | 25-38 files remove remaining filters and supply reviewed conversion rules and items-probe bounds. Owner reviews the complete final mock-ups and converted graphs. | Test conversion refusals, outputs and poll failures. Complete docs/04/07-09, guide and references. |
| Shared cutover | #164 owns the child; #168 contributes about 12-20 files of rules, SQL and fixtures. Owner reviews supplied converted copies and history. | Verify source preservation, replay, restore and final gates; finalize SQL snapshots, upgrade guide and CHANGELOG. |

Order the wider work as #165 paging/removal, #164 decisions and owner-approved exits, #168, then cutover. Freeze format 3 before any contract edits. Intermediate integration contracts run only on fresh disposable stores and are never independently migrated or shipped. The 147 subtype-containing files include frozen and unrelated code; prepare current fixture factories in small batches before the atomic switch. Count all docs/generated changes and split before exceeding about 40 files. Each split must give the owner a concrete running-product review, not a broken intermediate contract.

Add a new #168 ADR and mark affected ADR-0024 decisions superseded. Keep earlier factual release notes. Regenerate current OpenAPI/client and node references, update MCP/plugin examples, and describe exported/client breaks in CHANGELOG. No assistant attribution belongs in commits. Missing review or owner approval is not replaced by green CI.

## 7. QA plan and acceptance evidence

For D29, export an adapter-neutral scenario runner from engine/testing without importing SQLite or adding a runtime Vitest dependency. Both adapters run identical scenarios/assertions through harness factories. Verify immutable identity despite object property order, caller/owner isolation, keyed and unkeyed claims, content and window policies, atomic target/link/event commit, rollback before notifications, subscriber failure after commit, pin/deletion races, event fan-out, zero recipients, partial recovery and poll reservations. The fake must stage and roll back mutations, not merely imitate happy-path results. SQLite adds real close/reopen and DDL tests; fake restart recreates services around retained backing state. Neither substitutes for the other.

API QA covers all five types, input validation, exact HMAC bytes, missing/ambiguous raw headers, bad UTF-8/JSON, chunked body limits, extraction/fallback errors, oversized keys, scope denial and secret leakage. Test both legitimate repeats and lost-response retries. Faults before save must leave no consumed intake; faults after save must return 202 and recover the original target IDs. Event siblings must recover independently without lost links or repeated admitted work. Exit publication failure before save must reach the producer.

Poll QA retains both payload modes, all-candidate validation, caps excluding seen keys, first-failure tail, script overflow and HTTP streaming boundaries. Cron QA retains DST, invalid publication, persisted fire times, skip, latest run-once beyond 100 misses, and latest-100 run-each order. Conversion QA covers every mapping, reviewed filter, token/key/hash identity, checkpoint, retirement boundary and active/pending refusal, with rollback and copy restoration evidence.

Browser QA uses real controlled deliveries and both themes, keyboard/focus/undo, all dialogs, preset graph edits, 360-1440 pixel widths, 200 percent zoom, offline drafts and Events recovery. Test generic unsigned, existing signed, text/XML/form and binary protocols. Challenge echo and other authentication protocols remain unsupported; do not mark them passed. Record commands, head, fixture, outcomes and safe traces/screenshots in PR and issue.

Run repository gates, formatting, build, upgrade acceptance and touched browser tests at the integrated head. Preserve coverage above 90 percent for lines and branches and typecheck fixtures. Generate current clients/references and require no stale outputs. Use pnpm.cmd and Node 22 for dependency-cruiser when needed. For D13/#127, bypass local Turbo cache or use fresh CI; parked #127 is not assumed fixed. No production tests or servers run in this planning turn.

## 8. Dependencies and exact seams

#165 first removes generic template authority and paging dependencies (D1-D3, D24, D27). Preserve ordinary admission, pins and poll ports. #164 owns frozen schemas, format constants (D6), converter/history/device work (D9-D10, D22), dead decision exports (D23), journal/snapshots (D12) and exit choice after #167. Shared files include nodes/thread/events, admission/ports, container, SQLite schema/upgrade, editor/store, generated clients and guides.

Agree on SQL 0012/0013/conditional 0014 and the single hash-bound manifest. Agree on factual configHash preservation and copy-based dry-run. Disagree only with permitting #165's pending-target abandonment inside apply while #164 refuses pending state; resolve it separately before stop or approve a changed shared rule. Until then all pending state refuses. Stage edits share original IDs/pointers and cannot overwrite one another.

D4/#152 needs owner authorization to unpark or explicitly include atomic fresh initialization in #164. Its draft's migrate-then-stamp wording must require one fresh transaction. D5/#118 needs unparking/repair or exact approved orphan inventory resolution; missing evidence still refuses. D13/#127 can stay parked when verification bypasses cache. No parked issue is silently started. #167's unresolved exit decision blocks final graph factories and cutover, not preliminary type presentation.

## 9. Risks and gap analysis

D19's mode deletion is intentionally excluded; both current features remain. Credential references, approved script directories, generic pagination, initial backfill, persistent cursors and rate-limit/retry policies need separate backlog proposals. D15/#117 retains general HTTP probe memory work; this issue only bounds items input. D11 retention and D20 RunManager extraction remain outside scope. Duplicate audit growth is acknowledged, not solved with deletion.

Generic POST does not cover proprietary signing or verification challenges. Unkeyed Allow cannot distinguish retries. Downstream filtering changes admission and output. Old event selection cannot be reconstructed safely. Propose separate issues for additional signing/challenges, controlled release of old claims, retention and synchronous results. The shared converter, lossless device handling, atomic initialization, provenance resolution and accurate snapshots are prerequisites, not claimed completed repairs.

## 10. Acceptance mapping

| Acceptance | Required evidence |
| --- | --- |
| Approved answers and small product increments | Record Q5 and filter changes; review the summary mock-ups at T1-T6 and the copy rehearsal. |
| Clear types and editable presets | Demonstrate every layout and generic protocol; explicitly qualify deferred challenges. |
| Authentication, repeats and safe responses | Pass raw-order, leakage, key/replay and saved-202 crash scenarios. |
| Poll scope and guarantees | Pass both modes, bounds and restart/race cases; keep deferred operations explicit. |
| Migration and recovery | Prove tokens/consumption/history, ordinary pending refusal, fresh recovery and shared manifest rollback. |
| Touched-system QA and documentation | Supply independent review/QA, browser/accessibility and final gates; align ADR, numbered docs, guides, clients, references and CHANGELOG. |
