# #168 technical plan: trigger configuration and general webhooks

This second approval comment follows plan-168-summary.md. Citations use c379f80; review corrections override stale peer inputs. HMAC means hash-based message authentication code; PR means pull request; QA means quality assurance. SQL is the database language; JSON means JavaScript Object Notation; UI means user interface; MCP means Model Context Protocol. Tests are proposed, not claimed executed.

## 1. Summary

Present five trigger configurations with type replacing subtype, retain Cron and optional editable GitHub presets, and add general webhook body/extraction controls. Move payload filters into reviewed downstream graphs.

D7 repairs atomic webhook admission; Event fan-out is deferred. D17 acknowledges saved input; D29 tests fake/SQLite parity. Preserve token/owner identity, secrets, raw authentication order, constant-time comparisons, existing bounds, receipt transactions, pins/recovery, both poll modes and cron catch-up.

Q5 recommends Allow uniformly, without a stored policy switch; old receipts/keys remain history. Estimate 16-23 worker days including QA, review and rehearsal. Confidence is high for editor/protocol work and medium for conversion/recovery.

## 2. Owner decisions and reconciliation

Apply the recorded answers exactly: one trigger node kind with a primary configuration selector; retain Cron; accept ordinary POSTs from any sender; retain existing signature checks without new authentication; put payload checks in downstream decisions/classifiers/scripts; acknowledge quickly after saving; exclude poll credentials, pagination, backfill, cursors and rate-limit work.

Q5 remains open. Recommend Allow uniformly across all webhooks, signed or unsigned: identical valid bodies can create separate runs unless an explicit business key is consumed. This supports legitimate repeats but permits another run after an unkeyed lost-acknowledgement retry. The alternative is permanent raw-body consumption in owner/loop/trigger scope across versions, suppressing legitimate identical repeats too. Existing timestamp freshness still applies under either choice; a valid timestamp does not select another dedupe mode. Ship only the chosen algorithm, with no saved policy switch. Old receipts/keys remain factual history; section 4 explains how the uniform behavior uses them.

Moving filters produces quiet runs for formerly ignored input, moves expression errors after acknowledgement, and can consume keys before downstream checks. Each stored filtered version needs exact reviewed graph conversion or explicit removal/replacement. Section 4 preserves evaluatePredicate coercion without requiring a Boolean result.

#167 recommends option 3 (variant C), medium confidence; #164 agrees. Decisions own policy, a Continue node owns maxPasses with repeat/exhausted connections, and terminal exits declare outcomes/returns. Its separate cumulative node safety cap and maxPasses both start from old maxIterations. #168's quiet finish needs only the approved terminal exit. A one-Continue-node-per-loop limit is an owner-reviewed proposal, not settled. Option 1 (variant A) keeps loop-back; option 2 (variant B) uses decisions and ordinary edges. The owner has not decided; postponing option 3 would require another cutover.

| Debt item | Disposition |
| --- | --- |
| D7 | Absorb atomic webhook receipt/intent and run/link commits. Defer Event fan-out and producer acknowledgement; they are not required for settled-history conversion. |
| D17 | Absorb webhook 202 once saved, including duplicates/pending work; use 503 only when save cannot be confirmed or signing readiness fails. |
| D18 | Absorb type-first configuration, nested signing, optional presets and reviewed removal of trigger filters. |
| D19 | Follow the revised register by preserving both poll modes and current script directory. Credentials/directories remain backlog work; there is no disagreement. |
| D29 | Absorb one fake/SQLite TriggerAdmissionPort contract suite covering receipt transactions, identity, rollback, keys, pins and notifications. |

#152 and #118 are parked owner choices: unpark #152 or authorize its bounded initialization repair in #164; unpark #118 or approve exact #164 orphan dispositions. Missing definitions cannot be guessed. #127 can remain parked because verification bypasses the affected cache. #164 owns the joint pending-state rule cited in sections 4 and 8.
## 3. Target contract

### Stored and exported trigger definitions

Use one strict config.type union within kind: trigger. #164 owns format 4 and decision/Continue/exit schemas. Current parsers reject subtype, filter, old signing shapes and unknown fields; frozen schemas are offline conversion/replay inputs. Before: {id: 'start', kind: 'trigger', config: {subtype: 'manual'}}. After: the same ID/kind with config: {type: 'manual', exposeTo: ['ui', 'api', 'mcp']}.

Retain Expression as a nonempty string up to 100,000 characters, node IDs as the existing 64-character Slug, and SecretName as a nonempty reference up to 128 characters. HeaderName uses RFC token characters, canonical lowercase and length 1-128. EventName is nonblank, control-free and length 1-128. Converted defaults are explicit; use Zod .prefault({}) for defaulted objects.

| Type | Stored/exported config fields |
| --- | --- |
| Manual | type: 'manual'; optional inputSchema: JsonSchema; nonempty exposeTo: ('ui' or 'api' or 'mcp')[], default all three. Retain input validation; exposure enforcement is separate. |
| Cron | type: 'cron'; expression length 1-256; timezone length 1-64, default UTC; missedFirePolicy: skip/run-once/run-each, default skip; enabled: boolean, default true. Retain schedule/timezone validation. |
| Event | type: 'event'; eventType: Slug; optional dedupeKey: Expression. Retain subscriptions/keys; remove filter through review. |
| Poll | type: 'poll'; intervalSeconds: integer 5-86,400; probe: Probe; fireWhen: Expression; optional dedupeKey: Expression; optional items: PollItems; enabled: boolean, default true. Whole-probe dedupe and items remain mutually exclusive. |
| Webhook | type: 'webhook'; authentication: WebhookAuthentication, default None; body: WebhookBody, default JSON; eventType: WebhookEventType, default constant webhook; optional dedupeKey: Expression. |

```ts
type WebhookAuthentication =
  | { type: 'none' }
  | { type: 'hmac-sha256'; message: 'body';
      header: HeaderName; secretRef: SecretName }
  | { type: 'hmac-sha256'; message: 'timestamp-body';
      header: HeaderName; secretRef: SecretName; windowSeconds: number };
type WebhookBody = { type: 'json' } | { type: 'text' } | { type: 'bytes' };
type WebhookEventType =
  | { source: 'constant'; value: EventName }
  | { source: 'header'; name: HeaderName; fallback: EventName }
  | { source: 'json-pointer'; pointer: string; fallback: EventName };
```

All objects are strict. Timestamp windowSeconds is integer 1-86,400, default 300. Preserve SHA256, hexadecimal sha256= prefix/case acceptance and constant-time comparison. Body defaults to x-hub-signature-256; timestamp-body defaults to x-graphgoblin-signature. The fixed x-graphgoblin-timestamp retains ISO/Unix seconds; sign timestamp UTF-8, dot and raw bytes. None has no signing fields.

Webhook has no repeatPolicy, dedupe scope/retention, empty-body policy, filter or response template. The existing two authentication protocols do not select different admission behavior. windowSeconds controls signature freshness only.
### Decoding, event extraction and one business-key behavior

Resolve the owner secret and authenticate raw bytes before decoding, parsing, extraction or expressions. Count raw duplicate authentication headers case-insensitively and reject ambiguity. Retain the 1 MiB raw-body bound, including chunked input. None establishes no authenticated sender identity.

Every webhook's JSON mode uses fatal UTF-8 and valid nonempty JSON; empty/whitespace input returns 400, while literal null is valid. Text yields a JSON string, including empty string. Bytes yields {encoding: 'base64', data: string}, bounded by the input limit. No authentication recipe chooses another empty-JSON rule. Content-type conversion, decompression, multipart and form parsing remain excluded; downstream scripts can interpret text.

Event extraction selects a constant, header or JSON Pointer. Missing/blank/nonscalar values use fallback; ambiguous headers return 400 EVENT_TYPE_AMBIGUOUS; control/overlong values return 422 EVENT_TYPE_INVALID. Pointers permit 1,024 characters, 32 segments, valid RFC 6901 escapes, own properties and array indices, including a string root. They require JSON mode. Metadata is neither an Event-bus publication nor trusted repository authority.

An absent dedupeKey generates no business identity, including no automatic signature-hash key. A configured expression sees decoded payload and the current bounded $headers binding excluding the signature header. For every webhook, null/undefined/empty string returns 422 KEY_INVALID; other values use the current string-or-JSON form and reject above 512 characters rather than truncate. Whitespace strings remain literal keys. This one rule has no empty-key selector. Event and Poll key rules stay unchanged.

Explicit keys are permanent in owner/loop/trigger-node scope across versions. Consult preserved receipt/inbound claims, pending reservations and committed run-envelope keys. There is no endpoint window, expiry refresh or signature-hash replay ledger. Timestamp freshness remains an authentication check; Q5 changes only uniform raw-body suppression.

### Poll definitions remain unchanged

Keep strict Probe. HTTP retains GET/POST/HEAD, default GET, templated URL/optional headers/body and integer timeout 1-300 seconds, default 30. Script retains nonempty command, templated args default [], and integer timeout 1-3,600 seconds, default 60. Signal-count has a Slug name; None has no fields. Scripts still use the data directory and ambient local command line credentials.

PollItems keeps select/dedupeKey expressions and maxRunsPerPoll integer 1-25, default 5. Preserve validation of all 200-or-fewer candidates and unique nonblank string keys up to 512 characters before admission, both payload modes, first-failure tail and serialized sweeps. Verify existing time/script-output bounds; add no 64 KiB HTTP limit. Credentials, directories, pagination, backfill, cursors, rate limits and retry policy remain backlog work.
### Editable GitHub graph recipe

Use #164's expression decision config with declared routes and a route-ID result. A fresh label recipe is:

```json
{"kind":"expression","routes":[{"id":"pass","label":"Continue"},{"id":"ignore","label":"Ignore"}],"jsonata":"($p := invocation.trigger.payload; invocation.trigger.eventType = 'issues' and $p.repository.full_name = 'octo-team/service-repo' and $p.action = 'labeled' and $exists($p.issue) and $not($exists($p.issue.pull_request)) and $p.label.name = 'ready') ? 'pass' : 'ignore'"}
```

JSON-escape user literals. Set body HMAC, JSON, x-github-event extraction with webhook fallback, and x-github-delivery as an explicit key. Headers are unsigned hints; repository/action/object/label checks use the authenticated body. PR recipes retain draft/merged/base-branch checks. Every generated node remains editable; classifier decisions or scripts also support downstream filtering.

```text
hook.out -> event-check --pass--> restore-output.out -> former successor
                       --ignore--> quiet terminal exit
```

A decision changes lastOutput. An ordinary mutate restores /lastOutput from outputs[triggerId], using safely quoted access and preserving nodeId/value/at/schemaRef. The quiet terminal success exit has no returns or continuation. Visits and quiet runs remain visible. Preview fields/edges, validate limits, apply as one undo step and preserve successor input. Cancel changes nothing; reapplication requires explicit replacement review of owner edits.

### API, envelope and receipt contract

Keep invocation.trigger nodeId/kind/payload/receivedAt/optional dedupeKey; add optional eventType: EventName. New webhooks set it through StartRunInput, initial thread and sequence-1 queued event. Other kinds/history need not. Trigger output remains payload. InboundEventRecord.type remains webhook; extracted metadata does not change Event-bus behavior.

POST /events and internal publication retain their response/fan-out semantics. No frozen recipients, trigger_admissions table or return-port owner change is added. Event filters move downstream, but the split-write crash gap remains. publish is apps/api/src/event-bus.ts:33; subscriber errors are swallowed at apps/api/src/triggers/trigger-service.ts:555, deferred under D7.

Public hooks return fixed 202 {accepted: true} once saved or confirmed consumed, without payload/signature/event/run IDs. Preserve 400 malformed input, 401 signature/window failure, 404 unknown/disabled hook, 413 body bound, 422 extraction/key failure, 429 with Retry-After and 503 signing readiness/unconfirmed save. Saved pending/failed admission never causes public 503 or retry 409; execution is asynchronous.

Endpoint summaries retain id/ownerId/loopId/versionId/triggerNodeId/path/enabled/createdAt. Replace flat signing with the safe authentication recipe and pinned body/extraction/key config; expose secret names only. configurationAvailable: false describes disabled orphans; enabled missing provenance refuses. Events shows status/attempts/nextAttemptAt/safe failureCode/run links, excluding intents and credential material.

Keep the narrow TriggerAdmissionPort and RunAdmission: run, initialThread, queued event fields without runId/seq/ts, and unique pinnedLoopIds including the loop. Preserve parseRunAdmission and immutable identity checks. WebhookClaim has id/ownerId/loopId/triggerNodeId/contentHash/inbound. Remove dedupeByKey: a present authored key always uses the one rule. contentHash is raw SHA256, lowercase 64 characters, for every auth recipe; it is audit evidence under Allow or the uniform body key under permanent consumption.

WebhookReceipt retains id/ownerId/loopId/triggerNodeId/contentHash/inboundId/status/optional intent/attempts/optional nextAttemptAt/optional failureCode, with existing ID/time scalars and nonnegative attempts. Status keeps filtered/deduplicated/pending/admitted/failed as factual dispositions; new code never produces filtered. Preserve WEBHOOK_ADMISSION_RETRY, WEBHOOK_TARGET_REMOVED and WEBHOOK_INTENT_CONFLICT. There is no consumption flag, origin selector, business scope/expiry or signature replay claim.

### Atomic webhook admission (D7), acknowledgement (D17) and adapter parity (D29)

Every auth choice validates/extracts, prepares one frozen RunAdmission under the deletion lock, and uses claim/create. Claim revalidates target/owner/version/keys and atomically saves inbound plus receipt, complete intent and pin/key reservation. Failure saves nothing. A nonduplicate becomes pending; an explicit-key duplicate becomes deduplicated without executable intent. The chosen Q5 algorithm either creates another receipt for identical unkeyed bytes or returns the consumed receipt. Ship only that algorithm, with no policy flag or signature-dependent branch.

Create atomically commits run, thread, pins, queued event, admitted receipt and inbound link, then notifies. Recovery uses the stored intent/ID and verifies immutable facts; it never allocates another run. Pending pins protect deletion; corrupt/conflicting intents fail safely. Retain the nonoverlapping 15-second sweep, five due receipts maximum and persisted backoff capped at five minutes. 202 follows durable claim, without waiting for create or execution. An unkeyed external repeat under Allow is a new delivery, distinct from recovery.

D29 exports one adapter-neutral contract runner through engine/testing, with fake and SQLite factories and shared assertions. Keep engine independent of SQLite and omit any runtime Vitest dependency. SQLite persistence checks supplement conformance; section 7 specifies the cases.
## 4. Stored data and the single format-4 converter

### Shared stage and exact manifest

Agree with #164's sections 4 and 6: freeze format-3 schemas/traversal/replay before edits, retain earlier stages, and collect nonoverlapping changes against original IDs/pointers. #168 contributes rules to one converter and stamp, not an independent wrapper.

Use the published strict Manifest exactly. All fields/maps are required; empty maps are allowed. Its envelope is format, targetVersion, hashAlgorithm, sourceHash, converterHash, sqlHash, versions, historyResolutions, retirements, failedRuns, expectedResultHash and approval. format is graphgoblin-upgrade-manifest; targetVersion is 4; hashAlgorithm is sha256-canonical-records-v1. Hash means 64 lowercase SHA256 hexadecimal characters. approval is null for preview or {approvedBy, approvedAt, approvedPlanHash} for apply. Each version has definitionHash, disposition: convert/archive, required legacyStages.{v1ToV2,v2ToV3} with frozen resolutions or null, and resolutions.{decisions,exits,templates,triggers}.

The trigger map keys are frozen-input JSON Pointers, not node IDs. For example, versions[id].resolutions.triggers['/nodes/3/config'] refers to the original index while the proposal also binds the stable node ID. Use #164's Rule type verbatim:

```ts
type Rule = {
  sourceHash: Hash;
  action: 'replace' | 'approve-generated' | 'review-unchanged';
  replacement: JsonValue | null;
  proposalHash: Hash | null;
  reason: string;
  sourceEdits: Record<JsonPointer, {sourceHash: Hash; replacement: JsonValue}>;
};
```

replace requires a validated replacement and null proposalHash. approve-generated binds proposalHash and has null replacement. review-unchanged has both null and no edits. Reasons are nonblank. sourceEdits address exact frozen-input pointers/hashes; cross-node consumer edits remain in the owning namespace. Do not add sourceConfigHash/action: automatic/filter-resolution fields to Rule.

For a generated trigger mapping or filter graph, use approve-generated. Its hash-bound proposal records source/target config hashes, original node/successor IDs, generated decision/restore/exit/edge IDs, expression and final graph hash. Deterministic generation and final graph validation are required. Reviewed replacement/removal uses replace with a valid current config or reviewed graph and exact sourceEdits; the reason acknowledges broader behavior when a filter is removed. Header-dependent metadata/route changes belong in this same validated replacement. Overlapping edges/pointers need a composed approved resolution; unused/stale/conflicting writes refuse.

historyResolutions is exactly Record<Id, {runId, record, seq, pointer, sourceHash, replacement, reason}>. record is initial-thread/snapshot/event/result; seq is number or null; pointer is RFC 6901; replacement is JsonValue. Use it only for actual factual run/history edits. Endpoint/receipt/key mappings are deterministic SQL rules bound by inventory, sqlHash and expectedResultHash; unsupported manual row repair refuses instead of inventing another history namespace.

Use retirements.components/privateReports/orphans and failedRuns exactly as #164 publishes them. Private-report dispositions are retirements.privateReports[runId], binding componentId/runHash/reportEvidenceHash and archive-private-template-report plus reason. #165 owns components; #164 owns orphan and failed-run policy. #168 validates endpoint/receipt/key/pin survivors against those exact closures.

Q5 is fixed by implementation/converter/SQL hashes, not per-version policy. Portable exports bind exact file hashes. approvedPlanHash covers the manifest excluding approval, including source/rules/SQL/expected result. Changed inputs need new preview/approval; plan approval is not data approval.
### Stored config and endpoint mappings

Manual/Cron/Poll rename subtype to type, preserving all other values/defaults/IDs/settings/positions. Event preserves subscription/key and removes filter only through review. Unknown/conflicting discriminators, extra fields, invalid expressions/probes or unsupported source fields refuse.

Every webhook becomes JSON with constant webhook metadata and its authored dedupeKey, if any. Map hmac-sha256 to timestamp-body and move replayWindowSeconds to windowSeconds; map hmac-sha256-body to body with no window. Preserve secretRef; lowercase header names without changing case-insensitive lookup. Reject invalid headers/windows, unknown schemes, a body window or inconsistent endpoint owner/token/version/node provenance. Provider labels never establish a protocol.

Both use the same nonempty JSON, fixed key rule and chosen Q5 algorithm. Preview reports empty timestamp JSON now rejecting, empty authored keys rejecting, overlong keys rejecting instead of truncation, strict UTF-8, and permanent cross-version keys replacing timestamp-window suppression. Preserve old null payloads/truncated keys as facts. Do not convert old signing type into a live dedupe mode.

0013 maps each endpoint's signing columns to the fields below, preserving its identity/token/enabled/time. Enabled endpoints require proven config/version ownership. A disabled orphan needs an explicit common disposition with no execution dependency; retain opaque evidence without guessing missing config.
### Filter conversion preserves predicate coercion

Review every filtered version even when its proposal is generated. Evaluate the escaped original source once against invocation.trigger.payload, then apply exactly packages/domain/src/expression.ts:199: undefined/null is false; nonempty arrays/objects are true; other values use JavaScript Boolean. No static Boolean proof or JSONata $boolean substitution is allowed.

Replace ORIGINAL_SOURCE with a JSON-escaped literal in this route expression:

```text
(
  $v := $eval(ORIGINAL_SOURCE, invocation.trigger.payload);
  $t := $type($v);
  $truth := $exists($v) and (
    $t = 'array' ? $count($v) > 0 :
    $t = 'object' ? $count($keys($v)) > 0 :
    $t = 'string' ? $length($v) > 0 :
    $t = 'number' ? ($v != 0 and $v = $v) :
    $t = 'boolean' ? $v :
    $t = 'function' ? true : false
  );
  $truth ? 'pass' : 'ignore'
)
```

Compare the wrapper with evaluatePredicate for missing/null/booleans/numbers/strings, empty/nonempty arrays/objects, [false], [null], {a: false}, nested arrays, sequences and functions. Characterize any additional evaluator value category and complete the wrapper before accepting it. This preserves coercion without a runtime compatibility helper; a nonempty collection with false-valued members passes.

Keep guarded $eval, regex, deadline/recursion checks and the Expression bound for source/wrapper. Header/clock/random/dynamic-source/unavailable-context dependencies need a reviewed replacement because run decisions lack intake context. Approved eventType metadata, scripts or classifiers may express replacements; never persist full headers or add new preset predicates silently.

Generate deterministic collision-free Slug decision/restore/exit/edge IDs. Preserve trigger and old successor-edge IDs; repoint the old edge from restore to the original successor, clearing/reporting invalidated manual routes. Add trigger-to-decision, pass-to-restore and ignore-to-exit. Restore exact trigger output. Refuse ambiguous/multiple outgoing edges, missing destinations, exhausted IDs or graphs exceeding 500 nodes/2,000 edges. Never reuse an effectful exit.

Bind each version/fragment hash and acknowledge quiet runs, error/key timing and extra visits/safety-cap effects. Removal requires explicit broader-behavior approval. Replacement supplies a valid graph, not merely a reason; approvals never transfer between versions.
### SQL and receipt/key history

Agree on 0012_retire_template_instances (#165), 0013_trigger_configuration (#168) and conditional 0014_format_four_cutover (#164 exit/replay metadata). Omit unused migrations; renumber only unshipped allocations if necessary. Shipped 0008-0011 and earlier stages stay intact. No Event-intake/trigger_admissions DDL is included.

0013 rebuilds webhook_endpoints with id, owner_id, loop_id, version_id, trigger_node_id, token, auth_type, signature_message, signature_header, secret_ref, window_seconds, enabled and created_at. None requires null signing fields; HMAC body requires header/secret and null window; timestamp-body requires header/secret and integer window 1-86,400. Preserve token/loop-version indexes. Body/extraction/key configuration lives in the pinned definition.

Keep webhook_receipts, its existing columns/IDs, unique inbound_id, due index, status/intent checks and run-key indexes. For Allow, replace the owner/loop/trigger/content unique index with a nonunique index so old facts and repeated new receipts coexist. For permanent consumption, retain the unique index and use it for all webhooks. Ship only the approved index definition; no per-row consumption flag or partial legacy-policy index exists.

Retain every receipt's raw hash/inbound link/status/intent/attempts/failure facts. Filtered/deduplicated/admitted/permanently failed rows never become pending. Admitted run/intent/queued-event identities must agree; terminal intents retain original IDs. Under Allow, old consumed raw hashes remain evidence but do not suppress future identical input. Under permanent consumption, all known raw claims suppress it, including filtered receipts.

Keep inbound payload/type/source/time/key/runIds exactly, including timestamp/Event rows without receipts. Invent no receipts, recipient sets, executable intents or missing links. Decoded JSON cannot prove original raw bytes; report historical unknown-hash coverage. Permanent consumption uses all known hashes plus every future receipt's raw hash, without a source-recipe exception.

Preserve opaque keys, including truncated and sig-hash values, and prove owner/loop/node scope through exact endpoint/source and run-envelope identity. One explicit-key query consults these historical claims, pending reservations and committed run keys across kinds/versions. Old default keys are not regenerated; old timestamp expiry stays archived rather than becoming a live algorithm. Future explicit keys are permanent. Matching a preserved literal remains consumed; duplicate historical evidence stays intact. Missing required provenance, corrupt joins or inconsistent identities refuse.

#165 may retire only its exact approved evidence closure; IDs/tokens are never reused. #164 owns readiness, journal, migration registry and D12 snapshot repair; #168 supplies 0013 metadata. Reconstruct shipped schema before generating final coordinated snapshots, then require disposable generation to be a no-op. Archive before rebuild. SQL, semantic edits, ledger and marker commit together; 0013 alone never upgrades a used store.
### History, snapshots, pending state and configuration hashes

Inventory all versions/drafts, endpoints/receipts/inbound links, runs/initial threads/queued events, snapshots/checkpoints, frozen intents/pins, timers, child notifications, returns/finalization and caller chains. Discriminator conversion leaves trigger.kind/payload unchanged; invent neither old eventType nor decision visits.

Keep node.started.configHash as the executed config's hash. Archive source definitions/configs and bind original/final hashes by version/node. Recompute current draft/export tokens without altering hook tokens or executed facts. Any approved factual-thread mapping must also update corresponding terminal intent/initial-thread/queued evidence through #164; #168's rename alone changes none. Converted header-dependent graphs refuse incompatible executable replay entries or explicitly handle absent metadata.

Replay retained runs/checkpoints at their recorded sequences. Missing provenance, inconsistent snapshots or conflicting pins refuse; checkpoints are not discarded. Affected resumable failures and reachable subloops use #164's reviewed nonresumable dispositions/replay maps, never implicit resume through new graph nodes.

Apply #164's joint pending-state rule exactly: the cutover refuses any store with queued, running, waiting or paused runs, pending webhook receipts or frozen admission intents awaiting admission, unfinished child notifications or timers. The old build settles them first; the converter never abandons, drains or executes them. Terminal runs with unfinished finalization are also refused, with one exception: a retired template run whose only unfinished item is its private template report may be archived through an explicit retirements.privateReports[runId] disposition that the owner approves, with reason recorded and evidence preserved. This excludes pending deliveries, general returns and ordinary finalizers. #165 withdrew pending abandonment; no conflict remains.

### Inventory, dry run, apply and device drafts

Supply #164's bounded indexed inventory with safe IDs/hashes/counts, automatic/reviewed/refused mappings, graph diffs, token/key/raw-hash coverage, blockers and replay/config-hash maps. #164 owns D9 streaming. Private detailed reports exclude credentials/signatures.

Dry-run reads a stopped source and executes the real SQL/semantic/replay apply on an independent verified copy. Rollback-only source preview is forbidden because it can change WAL bytes. Bind source/tool/SQL/manifest/result hashes; changed input needs fresh preview and approval. Only preview can omit approval.

Apply locks the directory/database, verifies a separate complete backup of database/WAL/SHM, secret/key material, artifacts and supplied evidence, and rechecks blockers/hashes in one transaction. Archive before SQL; compose rules, validate schemas/relations/pins/claims/history/snapshots, and stamp last. Failure rolls back structure/data/ledger/marker. Inspect interruptions and verify post-commit readback, restore with old logical hashes/build, then re-upgrade.

#152 requires authorization and atomic initialization; #118 requires authorization or exact orphan dispositions. Missing definitions cannot be replaced with current catalog guesses. #164 preserves active/set-aside/raw device drafts, incomplete source and tokens before conversion; ambiguous copies stay inert/exportable. Reconcile only proven tokens or require explicit reload/restore. Never delete drafts or overwrite server data with old autosaves; load frozen conversion separately (D10).

Rehearse only on supplied stopped copies, retaining baseline, factual and isolated runnable copies. Disarm ingress/recovery and isolate scripts, secrets, workspaces and return destinations; disclose safety edits/hashes. A database copy alone does not isolate effects. Never access the installed store, port 4747 or ~/.graphgoblin here.
## 5. Runtime, API and editor changes

Keep contracts dependent on Zod only, pure domain logic, engine ports and infrastructure implementations. Use public package entry points. No new package or dependency is planned. Citations below identify the current implementation on c379f80, not the planned line positions.

| Source | Change or preserved responsibility |
| --- | --- |
| packages/contracts/src/nodes.ts:92; packages/contracts/src/trigger-integrations.ts:13; packages/contracts/src/thread.ts:27 | Define the five type configs, nested webhook auth/body/extraction and optional event metadata. Preserve Probe and PollItems. Remove current filter and compatibility-mode fields. |
| packages/infrastructure/src/http/delivery.ts:16; apps/api/src/triggers/webhook-body.ts:35 | Separate raw-byte verification from bounded decoding, keep constant-time HMAC and owner secrets, support None and the existing two recipes, and reject ambiguous raw authentication headers. |
| apps/api/src/triggers/trigger-service.ts:173; :288; :431 | Keep stable endpoint arming across versions. Replace timestamp's insert/start/link branch with the same receipt/intent path as every webhook. Remove intake filters and apply one key and repeat algorithm. |
| apps/api/src/triggers/trigger-service.ts:470; :507; :537; :555; apps/api/src/event-bus.ts:33 | Preserve Event publication/subscription and existing fan-out; remove configured Event filters through reviewed downstream graphs. publish is at :33; subscriber errors are swallowed at :555, a deferred reliability gap. No durable fan-out or return-port ownership change is made. |
| packages/engine/src/admission.ts:15; packages/engine/src/run-manager.ts:347; :418; :461; :536 | Preserve narrow RunAdmission, deletion lock, immutable intent identity and pins. Adapt claim/create for all webhooks with one Q5 algorithm, keeping bounded persisted recovery and poll reservations. |
| packages/infrastructure/src/sqlite/admission.ts:74; :188; packages/infrastructure/src/sqlite/triggers.ts:187; :365; :405 | Implement receipt/inbound and run/event/link transactions with post-commit notifications, one explicit-key lookup and stable endpoint updates. #165 removes private callbacks first. |
| packages/engine/src/testing/fakes.ts:813; packages/engine/src/testing/index.ts:1 | Apply the same port semantics in the fake and export the adapter-neutral admission contract runner. Infrastructure tests run it against SQLite through a factory. |
| apps/api/src/routes/triggers.ts:16; :50; :107; :153 | Keep raw parsing and existing private scopes; expose fixed 202 after saving and safe endpoint/receipt metadata. POST /events response semantics remain unchanged. |
| apps/api/src/triggers/poll.ts:124; :219; apps/api/src/triggers/poll-items.ts:15; packages/infrastructure/src/http/probes.ts:39 | Preserve both payload modes, validation, time/output limits, first-failure tail and dedupe. No new HTTP 64 KiB limit, credential binding or script directory is introduced. |
| packages/infrastructure/src/scheduler/cron-scheduler.ts:111; :169; packages/engine/src/handlers/trigger.ts:5 | Retain catch-up cap 100, persisted fire times and advance-before-listener behavior. The trigger continues to output its payload. |
| apps/web/src/editor/NodeEditorDialog.tsx:649; apps/web/src/forms/fields/structure.tsx:805; apps/web/src/editor/Palette.tsx:97; apps/web/src/editor/model.ts:63 | Put trigger types first, keep a single trigger node kind, and make presets optional. Use trigger-specific labels rather than relabel every schema union. Preserve focus, held input, validation and undo. |
| apps/web/src/editor/trigger-presets.ts:44; apps/web/src/editor/TriggerPresets.tsx:21; apps/web/src/editor/store.ts | Preview and apply an editable decision/restore/quiet-exit fragment atomically. Preserve successor output and support one-step undo. No filter is compiled into trigger config. |
| packages/domain/src/expression.ts:199; packages/domain/src/upgrade-current.ts:94; packages/infrastructure/src/sqlite/upgrade.ts:91 | Generate exact predicate-coercion wrappers through the single converter, preserving frozen earlier stages. Contribute SQL/data rules to #164's offline apply, not a separate upgrader. |
| apps/mcp/src/describe.ts:23; apps/web/src/drafts/local-drafts.ts:74; packages/api-client/src/generated/schema.ts | Update current descriptions, generated clients and device consumers. Do not globally replace unrelated subtype fields or frozen history schemas. |

## 6. Child PR breakdown and integration order

Use #164's exact steps 20-25 after selected exits in steps 14-19, without exception. Shared converter/device/cutover is steps 26-28. All children target feat/format-4-integration. GPT-6.1 Sol xhigh implements; independent Claude Opus 5.5 xhigh reviews in cloud; separate Sol xhigh performs qa:touched-systems. Supply head/diff, fixtures and safe traces. Owner product review is required before every child merges; these roles authorize no delegation in this research thread.

| Step and child | Scope, files and running review | Checks and updates |
| --- | --- | --- |
| 20: T1, Trigger types first | About 20-35 files make types primary/presets optional and prepare fixtures. First Manual/Cron/Poll layouts and Event/Webhook choices. | Test keyboard/focus/undo/themes. Update docs/09 and guide. |
| 21: T2, Editable GitHub checks | About 25-38 files add graph preview, decision, output restore and quiet exit. First GitHub preview with edit/apply/undo. | Test signed-body checks, quoting, successor input and cancel. Update docs/08-09 and recipe guide. |
| 22: T3, One type contract | About 30-40 files switch current subtype to type. Review reopen/save/export/MCP. | Test strict configs/consumers; regenerate clients/node/API references and upgrade notes. |
| 23: T4, General webhook intake | About 28-38 files add decoding/extraction and atomic receipt admission. First general Webhook controls, quick 202 and saved-pending Events. | Run D29 and D7/D17 crash checks. Update docs/05/07-09, API reference and ADR. |
| 24: T5, One repeat/key behavior | About 22-35 files implement only approved Q5 and permanent explicit keys. Review repeats/duplicates/recovery without a policy selector. | Test races, lost acknowledgement, restart and tokens. Update docs/08, guide, ADR and CHANGELOG. |
| 25: T6, Filter-free final editor | About 25-38 files remove remaining filters, complete conversion/coercion/refusals and regress unchanged polls. First complete Event/Webhook and final GitHub mock-ups. | Test reviewed graphs, coercion/output parity and poll failures. Finish docs/04/07-09, guide and references. |
| 26-28: Shared #164 cutover | Contribute about 12-20 files of rules/0013/fixtures to #164's children. Review supplied converted copies, addresses/claims/history. | Prove refusal, replay, restore, snapshots and uncached gates; finish upgrade guide/CHANGELOG. |

Split before about 40 files, including generated changes/deletions, in the same sequence slot. Every split needs a complete running review. Shared cutover is #164 C2 at step 28. Fresh disposable intermediate stores are never independently upgraded or shipped.

Add a #168 ADR superseding affected ADR-0024 admission/preset decisions; retain historical text and coordinate #164's exit ADR. Update docs/08-09, trigger routes in docs/07, engine explanations, guides/examples, MCP/plugin descriptions and generated outputs. CHANGELOG records format/export/client breaks, uniform Q5/body/key behavior, filter reviews and the offline upgrade. Checks do not replace independent or owner review.
## 7. QA plan and acceptance evidence

Record integrated head, commands, fixture identities, outcomes and safe traces/screenshots in PR and issue. Distinguish planned/executed/unavailable evidence; coverage alone does not prove behavior. Separate GPT-6.1 Sol qa:touched-systems covers every boundary with positive and negative cases.

| System | Cases |
| --- | --- |
| Contracts/clients | Save/reopen/export all types/body modes. Reject old fields, unknown shapes, invalid bounds/pointers/headers and incompatible poll options. Typecheck fixtures without hiding errors. |
| Authentication/decoding | Actual unsigned/body-HMAC/timestamp-HMAC bytes and valid timestamps. Reject missing/ambiguous/wrong signatures, wrong-owner secret, stale/future timestamp, altered bytes, bad UTF-8/JSON, empty JSON and chunked overflow. Assert no decode/expression/claim before authentication failure; verify limiter/readiness and constant-time comparisons. |
| Extraction/authority | Header/constant/pointer/fallback, escaping and own-property/array traversal. Reject ambiguous/control/overlong metadata and invalid/non-JSON pointers. GitHub repository authority comes only from the signed body. |
| Atomic admission/202 | Inject faults at claim and create writes; assert complete rollback and post-commit notification. Crash after claim returns 202 and recovers the same ID. Repeated create commits no duplicate effects. Reject corrupt intent/identity/owner and conflicting pins. Pending/failed saved work does not produce 503/409. |
| Q5/keys | Apply the one approved algorithm to every auth recipe. Allow yields distinct unkeyed identical receipts/runs; permanent consumption yields one across versions. Ship only the selected policy suite. Explicit keys are permanent, reject empty/overlong values and see old claims/pending reservations/committed runs. Distinguish lost-acknowledgement external repeats from same-ID recovery and timestamp freshness. |
| D29 adapters | Run identical ordinary create, createPollItem and webhook scenarios against fake/SQLite: immutable identity despite property order, rollback, notification, keys, pending pins, cross-kind reservations and deletion races. Fake stages rollback; SQLite close/reopen supplements parity. |
| Graphs/filters | Every issue/PR recipe passes/quietly exits, restores the exact trigger output, quotes safely and supports edit/apply/cancel/undo. Exercise classifier/script alternatives. Compare wrapper coercion for missing/null and non-Boolean arrays/objects; expression failure happens in the admitted run after 202. |
| Events | Regress POST /events responses, subscriptions/bus/node keys, caller-chain exclusion and chain limit. Review filter/key timing. Do not claim the deferred fan-out/subscriber crash defects fixed. |
| Polls | Both payload modes; all-candidate validation; 200 items, 512-character keys and 25-run cap; seen keys do not consume the cap; pending/committed dedupe; first-failure tail; serialized sweeps; HTTP/script failures and existing time/output limits. Add no 64 KiB HTTP assertion. |
| Cron/handler | Invalid schedules/timezones, disabled triggers, daylight saving transitions, persisted fires, skip, latest run-once beyond 100 misses and ordered latest-100 run-each. Trigger output remains original payload. |
| Conversion/storage | Automatic/reviewed/refused rules, stable addresses/owner/node IDs, old claims/keys/terminal intents, hashes/logs/checkpoints/pins and unknown raw-byte coverage. Refuse all joint pending states including retired targets. Verify the exact private-report exception, SQL rollback, restore/re-upgrade and same-ID restart without duplicate effects. |
| Browser/devices | All mock-ups in their named children; keyboard/focus/validation/undo, both themes, 360-1,440 pixel widths and 200 percent zoom. Controlled deliveries and Events states, exports and lossless offline-draft restore use disposable state. |

Provider-independent fixtures cover supported JSON POST, XML/form text, bytes and both existing HMAC recipes. The owner named no mandatory provider/challenge. Record unsupported protocols/challenges as unsupported, not passed; never claim literal universal protocol compatibility.

Run relevant tests per child and required gates at the integrated head: typecheck, lint, layers, dependency/license checks, coverage, formatting, build and generated-reference checks. Keep line/branch coverage above 90 percent. Use pnpm.cmd, Node 22 for dependency-cruiser if needed, and uncached checks/fresh CI for parked #127. This research turn starts no server or product tests.
## 8. Dependencies and exact seams

Follow #164 steps 20-25 after the approved exits in steps 14-19; shared converter/device/cutover is steps 26-28. #165 first removes template authority and separates ordinary paging (D1-D3/D24/D27), preserving ordinary admission/poll ports. #164 owns frozen schemas, format constant (D6), converter/history/devices (D9-D10/D22), dead decision exports (D23), snapshots/journal (D12) and #152/#118 prerequisites.

Shared files are nodes/thread/events, admission/ports/run manager, SQLite schema/admission/upgrade, API container/routes, editor/store/presets, generated clients/references and guides. No return-port identity change is included. #168 metadata remains absent from old factual envelopes; graph proposals use original IDs and #164 builders. Overlap needs one reviewed resolution.

Agree on 0012/0013/conditional 0014 and the exact envelope including hashAlgorithm, versions[id].resolutions.triggers and common historyResolutions/retirements/failedRuns. #165 owns retirement closures; #168 proves endpoint/receipt/key survivors. Section 4 cites #164's joint pending rule and sole private-report exception. Pending abandonment was withdrawn; no disagreement remains.

The owner decides Q5/#167 and authorizes parked prerequisites. #167's 40 research cases do not prove Continue; #168 follows the approved exit builder.

#164's revised trigger overview still requests atomic Event intake and a Boolean-only filter proof. Those clauses conflict with review F4/F10: apply this plan's webhook-only admission and exact coercion wrapper, and reconcile that overview before posting. Its published manifest, sequence and SQL numbering are accepted.

## 9. Risks and gap analysis

Allow permits another run after an unkeyed retry; permanent consumption suppresses legitimate repeats. Choose one behavior under ADR-0020. Old facts remain stored; they never select legacy admission modes. Filter movement changes visible runs, key/error timing and visits even when routing/input is preserved. Unavailable context/provenance requires review or refusal.

Event fan-out/subscriber crash gaps remain. Settled-history conversion cannot invent missing recipients, and pending work must settle under the old build. Poll operational gaps remain because the owner excluded expansion. Cutover still needs per-version approvals, exact dispositions, backup/restore evidence and owner-controlled installation. Frozen conversion and factual archives are not alternate live contracts.

These backlog proposals are titles and scopes, not permission to implement or create issues:

| Proposed title | Scope |
| --- | --- |
| Make Event fan-out admission durable | Atomically save owner-scoped recipients/recovery IDs and producer acknowledgement; address D7's deferred Event portion. |
| Bound HTTP items-poll bytes before parsing | Design a reviewed streaming/cancellation limit; do not add the proposed 64 KiB limit here. |
| Carry trusted emitting identity through returns | Review owner/run arguments and subscriber failure propagation without trusting payload; no change is cutover-required. |
| Bind poll credentials to owner-scoped secrets | Define explicit substitution/redaction instead of ambient credentials. |
| Configure approved poll script directories | Define bounded directory selection while preserving the current data directory. |
| Add poll pagination, cursors and backfill | Specify persistent traversal, initialization, crash semantics and page/item bounds. |
| Add poll rate-limit and failed-item retry policy | Specify retries/scheduling without weakening current dedupe/failure-tail guarantees. |
| Add webhook protocols and challenges | Require refined real fixtures beyond None and the two existing HMAC recipes. |
| Add reviewed webhook reprocessing | Specify deliberate reprocessing without erasing original claims. |
| Resolve general probe memory bounds (#117) | Fix the broader resource defect separately; verify current limits here. |

D17 covers webhook acknowledgement, not an Event API redesign; D29 adds parity tests, not a generalized adapter. #118/#152 require owner authorization, while #127 is bypassed in verification. No new security hardening or response programming is included.

## 10. Acceptance mapping

| Acceptance checkbox | Evidence |
| --- | --- |
| Owner-approved contract/migration plan, mock-ups and small increments | Sections 2-4 apply answers and keep Q5/#167/prerequisites open. Summary shows every type/GitHub mock-up and first review child; section 6 requires independent and owner product review. |
| Primary types, optional editable presets and sender/challenge fixtures | Sections 3/5/6 specify one selector and editable graph. Section 7 verifies supported provider-independent fixtures; no provider/challenge was mandated, and unsupported protocols are disclosed. |
| Authentication, malformed/unsigned/ambiguous/filter/duplicate/replay/repeat policy | Sections 2-4 define uniform Q5, fixed keys, raw auth order, 202, exact filter coercion and retained history. Section 7 tests failure cases, signed-body authority and leakage. |
| Poll scope, bounds/failures/credentials/cursors and dedupe | Sections 3/5/7 retain both modes and guarantees. Sections 2/9 explicitly defer operational expansion with proposals. |
| Migration/restart identity, consumption facts/recovery and active-state refusal | Section 4 preserves tokens/keys/hashes/terminal intents and refuses pending work under the joint rule. Section 7 requires transaction/restart, restore and real-copy evidence. |
| All touched systems, adversarial/browser/accessibility QA, gates and agreed docs | Sections 5-7 assign positive/negative cases, fake/SQLite parity, browser checks, docs/08-09, routes, ADR-0024 successor, guides, clients/references and CHANGELOG. |

Before posting, the orchestrator checks #164's final published manifest schema and sequence numbers against these contributions and reconciles any later register correction. Plan approval does not approve an unseen data manifest, installed upgrade or merge.
