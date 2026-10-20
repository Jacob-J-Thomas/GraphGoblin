# 03 - Domain model

## Vocabulary (Decided)

| Term             | Meaning                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Loop             | A named, owned graph definition with a history of versions.                                                        |
| Loop version     | A record of a loop's definition: the editable draft, or an immutable published version or draft snapshot.          |
| Node             | A unit of behaviour in the graph with a kind, a config validated by that kind's schema, and ports.                 |
| Port             | A named connection point. Inputs are `in`. Outputs are `out` by default; decisions and exits add labelled outputs. |
| Edge             | A directed connection from a node's output port to another node's input port.                                      |
| Trigger envelope | The normalised payload that starts a run, whatever the source.                                                     |
| Invocation       | Who or what started a run, and how its return should be delivered.                                                 |
| Run              | One execution of an immutable loop version it pins for life. Owns a context thread and an event log.               |
| Child run        | A run started by a subloop node. Has a parent run id.                                                              |
| Run event        | One append-only record in a run's log, with a sequence number.                                                     |
| Context thread   | The run's shared state: messages, variables, artifacts, counters, last output.                                     |
| Harness          | An external agent engine. Codex in 1.0.                                                                            |
| Harness session  | One harness thread or session, tied to a run and node, with the harness's own id so it can be resumed.             |
| Return channel   | A destination for the exit node's return payload.                                                                  |
| Signal           | A named external message delivered to a waiting run.                                                               |

## Loop definition (Decided shape, Draft details)

Stored as JSON in `loop_versions.definition`, validated by `contracts`.

```ts
type LoopDefinition = {
  schemaVersion: 4;
  name: string;
  description?: string; // an empty string is distinct from absence
  settings: {
    workingDirectory: WorkingDirectorySpec; // see 04 and 06
    defaults: { byHarness: { codex?: { model?: string; effort?: Effort } } };
    maxNodeVisits: number; // independent safety cap on fresh visits per node
    subloopDepthLimit: number; // default 8
  };
  variables: Record<string, JsonSchema>; // declared vars with schemas; the editor uses these
  nodes: Node[];
  edges: Edge[];
};

type Node = {
  id: string;
  kind: NodeKind;
  label: string;
  config: unknown;
  ui: { x: number; y: number };
};
type Edge = {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: 'in' };
  ui?: { route: number[] }; // manual canvas route (#44); without it the editor routes automatically
};
type NodeKind =
  | 'trigger'
  | 'decision'
  | 'inference'
  | 'script'
  | 'mutate'
  | 'subloop'
  | 'wait'
  | 'heartbeat'
  | 'exit';
```

An edge's `ui.route` is canvas layout, like a node's `ui`: the positions of the route's inner segments in canvas coordinates, alternating the x of a vertical segment and the y of a horizontal one (`x, y, ..., x`, so an odd count from 1 to 63). The first and last segments are horizontal and run from the ports' own heights, so the route stays attached when a card moves. The route lives on the edge it draws: deleting the edge deletes it, renaming a node keeps it, and versions pin it with the rest of the definition. The engine ignores it. The route field itself does not change the format. Current definitions and exports use version 4; the integrated cutover preserves these routes.

Trigger nodes store `config.type`: `manual`, `cron`, `webhook`, `event`, or `poll`.
Both webhook signing variants use `type: 'webhook'`. Current configs and exports
reject `subtype`; old exports are converted only by the format-4 offline upgrade.

Validation rules enforced by `domain` before a version can be published:

- At least one trigger node and at least one exit node.
- Every trigger connects, directly or through other nodes, to an exit.
- Every output port is connected, including a marked gate's `limit-reached`. Exits are terminal and have no outputs.
- Node configs validate against their kind's schema. Referenced variables exist. Referenced subloops exist and are published (checked by the API, which can see other loops; a loop may reference itself).
- Every supplied Liquid template parses and every JSONata expression contains non-whitespace source and compiles, in node configs and loop settings (`TEMPLATE_INVALID`, `EXPRESSION_INVALID`, each with the field's `path`: `config.<path>` relative to its node, or `settings.<path>`). Empty and whitespace-only templates are valid and render exactly as authored. Omit optional blank expressions; the editor clears them. For optional templates, only exactly empty input means absent in the form; whitespace is preserved. This authoring rule lives in shared domain validation, so API imports and publishing agree with the editor without changing contracts parsing or fixture defaults.
- No edge targets a trigger node's input.

Harness selection belongs to inference nodes (`config.harness`, default `codex`). Loop defaults
provide only model and effort. Definitions containing `settings.defaults.harness` are rejected
as unknown keys; imports and API clients must remove it. There is no compatibility parser.
Current definitions and exports use format 4. Decisions are a strict union on kind: expressions return a declared route ID, LLMs use Liquid instructions and declared routes, and classifiers retain Choice, Noul and Score. Outputs contain portId, provenance and observation. Decision gates own repeat markers and limits; exits are terminal (ADR-0036). [ADR-0035](decisions/ADR-0035-evaluator-specific-decisions.md) supersedes the earlier decision matrix and output shape. Frozen V3 conversion stages remain format 3; old stores and exports are refused until the integrated cutover adds the 3-to-4 stage. Thread format remains 1.

## Versioning (Decided)

- Upgrade migration `0005` rewrites stored version definitions once, removing only
  `settings.defaults.harness`. Existing inference nodes already carry their explicit harness.
  Version ids, numbers, creation and publication timestamps, and run pins stay unchanged.
- Editing creates or updates a **draft** version. Publishing freezes it as the loop's current version.
- A run pins an immutable definition record and finishes on it, through waits, resume, replay forks and restarts, even if the loop is edited or a newer version is published meanwhile ([ADR-0041](decisions/ADR-0041-runs-pin-immutable-definitions.md)). A published start pins that version. A draft start (a test run, `allowDraft`) pins a **draft snapshot**: a `loop_versions` row with status `snapshot`, a new id, the draft's number and the definition exactly as the start read it, committed with the run. A snapshot is never published, never latest, not the loop's draft, not listed in `GET /loops/{id}/versions` and never started directly; `GET /loops/{id}/versions/{versionId}` still returns it. Storage triggers refuse any change to a snapshot and its deletion while a run pins it; run deletion removes snapshots no run pins.
- The run's `versionId` is that record, and `run.pinned` describes it: `source` (`published` or `draft`), the version number, the loop name in the pinned definition, a readable `label` (`Review v3`, `Review draft v4`) and the inherited model defaults pinned at start (`defaults.owner` from Settings, `defaults.process` from `GG_DEFAULTS`) and `classifiers`, the catalog binding (provider, provider model, endpoint, primitives, secret name) of every classifier the definition uses. None of it changes during the run; a classifier's existence, enabled switch and secret value are still checked when it is called.
- New runs always use the latest published version, or freeze the current draft, with the defaults current at their start.
- A subloop reference resolves to the referenced loop's latest published version at the moment the parent run starts, and the child run pins that version. A reference may instead pin an explicit version number. A child has its own pin and inherits its parent's pinned defaults, so later Settings changes do not reach a running tree either.
  - "Starts" means the parent run is created: the resolution covers every loop reachable through subloop references, at any depth, and is recorded on the parent's `run.queued` event as `subloopVersions` (loop id to version id). Children inherit the map, replay forks copy it, and recovery reads it from the log, so a version published while the parent waits never reaches the parent's tree (05, ADV-004). A loop that an active run can still start (its own runs, or runs whose pins or references reach it) cannot be deleted (409 `LOOP_IN_USE`).

## Deleting a loop (Decided)

Deleting a loop deletes its drafts, published versions and **all of its run history** in one
transaction. This includes `runs` (initial threads, snapshots, checkpoints, results and artifact
references), `run_events`, `harness_sessions` and `timers`, plus the loop's `schedules`,
`webhook_endpoints` and `webhook_receipts`. Configured template-instance bindings containing the
deleted loop are removed; other member loops remain. Poll triggers are disarmed after commit.
Shared inbound deliveries remain, with deleted run IDs removed from `run_ids`; their `source`
strings remain historical provenance. Artifact content is stored as shared content-addressed
files, not run-owned database rows; deleting references removes run API access, while those
shared files remain on disk.

Queued, running, waiting or paused runs refuse deletion with 409 `LOOP_IN_USE`; cancel them
first. Existing protection also refuses deletion while an active run or pending webhook
admission can still start the loop as a subloop. Refusal or a storage failure changes no rows.

Deleting a child loop leaves parent runs in other loops and their immutable histories intact.
The inspector identifies a referenced child as no longer available. Children in other loops
are retained; their live `parent_run_id` association is cleared if the parent was deleted,
while their initial thread and event history remain unchanged. Published definitions in other
loops are neither rewritten nor deleted: their authored subloop reference remains, and a
future attempt to execute it fails with `SUBLOOP_NOT_FOUND`.

`SqliteRunRepository.deleteOrphans()` transactionally deletes runs whose version or loop no
longer exists, using the same run-owned cleanup. It is an offline maintenance operation for
the later format-4 cutover; the current offline upgrade is unchanged. See
[ADR-0033](decisions/ADR-0033-loop-deletion-removes-runs.md).

## Context thread (Draft - to be co-designed)

The product owner and the architect will design this together before M1 closes. The shape below is the starting point. Everything in it is negotiable except these three properties: it is a plain JSON document, nodes change it only through patches, and every patch is recorded in the event log.

```ts
type ContextThread = {
  schemaVersion: 1;
  run: { id: string; loopId: string; versionId: string; parentRunId?: string; iteration: number };
  invocation: Invocation; // see below; carries the trigger envelope
  messages: Message[]; // the conversational spine
  vars: Record<string, unknown>; // declared variables, validated by the loop's variable schemas
  artifacts: Artifact[]; // references to large things: transcripts, files, diffs, JSON blobs
  outputs: Record<string, { value: unknown }>;
  gates: Record<string, { passes: number }>; // engine-owned, one-based per decision gate
  counters: {
    nodeVisits: Record<string, number>;
    usage: { inputTokens: number; outputTokens: number };
  };
  lastOutput?: { nodeId: string; value: unknown; schemaRef?: string };
};

type Message = {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool' | 'note';
  content: string;
  nodeId: string;
  ts: string;
  tags?: string[];
};
type Artifact = {
  id: string;
  kind: 'transcript' | 'file' | 'diff' | 'json' | 'text';
  ref: string;
  nodeId: string;
  label?: string;
  bytes?: number;
};
```

Authored patches may mutate only `/messages`, `/vars`, `/artifacts`, `/outputs` and
`/lastOutput`, including their descendants. The document root, `/schemaVersion`, `/run`,
`/invocation`, `/counters` and `/gates` are protected. Every mutating destination is checked
before the patch is applied: `add`, `replace`, `remove`, `move` and `copy` check `path`,
and `move` also checks `from` because it removes its source. `copy` may read protected
context into a writable destination; `test` may read any location. Rejecting any operation
rejects the entire patch without changing the thread. Engine-owned bookkeeping uses its
own patches and can update protected locations.

Questions to settle together, tracked in 13:

1. Are messages the right spine, or should the thread be variables plus artifacts with messages as one artifact kind?
2. Should harness transcripts be imported into messages at all, or only summarised into a note with the transcript as an artifact?
3. How are per-node outputs addressed: `lastOutput` only, or a map keyed by node id?
4. What is the token estimate strategy for truncation rules?
5. Which parts are visible to templates by default, and which must be opted in?

## Invocation (Decided)

```ts
type Invocation = {
  id: string;
  source:
    'manual.ui' | 'manual.api' | 'manual.mcp' | 'cron' | 'webhook' | 'event' | 'poll' | 'subloop';
  caller?: { kind: 'user' | 'api-key' | 'mcp-client' | 'run'; id: string; label?: string };
  trigger: {
    nodeId: string;
    kind: TriggerKind;
    payload: unknown;
    receivedAt: string;
    dedupeKey?: string;
  };
  returnDefaults?: ReturnChannel[]; // caller-supplied preferences; the exit node may override
  replayOf?: { runId: string; nodeId: string }; // set only on a replay fork (05)
};
```

The invocation is immutable for the life of the run and is embedded in the thread so templates and mappings can read it. A run forked by replay-at-node carries `replayOf`, naming the source run and the node it was forked at; its `run.queued` event carries the same object.

JSON Patch treats property names such as `__proto__` as ordinary own JSON keys,
including inside copied values. Custom subloop output patches obey the mutable
regions too: they cannot write engine-owned counters or move a value out of an
engine-owned region. Usage roll-up remains an engine operation.

## Run (Decided)

| Field                                                  | Notes                                                                                                                                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `ownerId`, `loopId`, `versionId`, `parentRunId?` | Identity; `versionId` is the immutable definition record the run executes                                                                                                                                        |
| `pinned`                                               | `{ source, version, name, label, defaults: { owner, process }, classifiers }`, at start                                                                                                                          |
| `status`                                               | `queued`, `running`, `waiting`, `paused`, `succeeded`, `failed`, `cancelled`, `exhausted`                                                                                                                        |
| `currentNodeId?`, `iteration`                          | Where the token is                                                                                                                                                                                               |
| `waiting?`                                             | `{ waitId: string, startedSeq: number, nodeId: string, kind: WaitKind, until?: string, timeoutAt?: string, prompt?: string, inputSchema?: JsonSchema, signalName?: string, childRunId?: string, beat?: number }` |
| `cancelRequestedAt?`, `pausedAt?`                      | Persisted intent, honoured after restart                                                                                                                                                                         |
| `failure?`                                             | `{ code: RunErrorCode; message: string; nodeId?: string; resumable: boolean }`                                                                                                                                   |
| `result?`                                              | The exit node's return payload                                                                                                                                                                                   |
| `outcome?`                                             | `success`, `failure`, `exhausted`                                                                                                                                                                                |
| `startedAt`, `finishedAt?`, `lastEventSeq`             | Bookkeeping                                                                                                                                                                                                      |

A missing run `result` means no payload was returned, whereas `result: null` is a present JSON value, preserved distinctly from `false`, `0`, `""`, `[]` and `{}` across storage and restart.

## Run events (Decided kinds, Draft payloads)

Each event has `runId`, `seq`, `ts`, `type`, optional `nodeId`, and a typed `payload`. Large payloads are stored as artifacts and referenced.

| Type                                                                 | Payload                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `run.queued`                                                         | `versionId` and `pinned` as on the run, initial thread, subloop pins, replay origin                   |
| `run.started`, `run.finished`                                        | status, outcome, result reference                                                                     |
| `run.paused`, `run.resumed`, `run.cancel_requested`, `run.cancelled` | actor                                                                                                 |
| `run.waiting`, `run.woken`                                           | wait spec, wake reason                                                                                |
| `run.failed`                                                         | failure object                                                                                        |
| `iteration.incremented`                                              | historical from, to, target; not emitted by new gates                                                 |
| `node.started`, `node.finished`                                      | config hash; patch, route, duration                                                                   |
| `node.progress`                                                      | small structured progress from long nodes; harness items are summarised here                          |
| `harness.session`                                                    | harness, sessionId, mode (`fresh` or `resumed`), model, effort                                        |
| `harness.usage`                                                      | tokens as reported by the harness, informational                                                      |
| `decision.made`                                                      | portId, provenance, observation, optional gate pass/limit evidence, at most three factual diagnostics |
| `exit.evaluated`                                                     | nodeId, terminal outcome                                                                              |
| `signal.received`, `input.received`                                  | name, payload reference                                                                               |
| `heartbeat.beat`                                                     | beat number, probe result summary                                                                     |
| `child_run.started`, `child_run.finished`                            | child run id, outcome                                                                                 |
| `return.delivered`, `return.failed`                                  | channel, target, status                                                                               |

## Other entities (Decided)

| Entity              | Purpose                                                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness_sessions`  | `(runId, nodeId, attempt)` to harness session id, status, model, effort. Written before the subprocess starts.                                                                                                                                                                           |
| `schedules`         | One per cron trigger node per published version: loop, version, and trigger node ids, expression, timezone, missed-fire policy, enabled, `next_fire_at`, `last_fired_at`. Rows of earlier versions are disabled, not deleted.                                                            |
| `webhook_endpoints` | One per webhook trigger node per published version: loop, version, and trigger node ids, path token (kept across versions for the same node), `secret_ref` naming the signing secret in `secrets`, signature header and scheme, nullable replay window (null for body signing), enabled. |
| `inbound_events`    | Every event from `POST /events`, exit-node `event` channels, and webhook deliveries: type, JSON payload, dedupe key, source (`api`, `run:<runId>`, `webhook:<endpointId>`), received time, and the ids of the runs it started.                                                           |
| `timers`            | Persisted wake-ups for wait and heartbeat nodes. Keyed by run and `<kind>@<waitId>` (the wait that armed it). Delivered at least once: a row is removed only after the wake is handled, and recovery re-arms both deadlines from the waiting run's wait spec (05).                       |
| `secrets`           | Name, ciphertext, key id, owner.                                                                                                                                                                                                                                                         |
| `model_catalog`     | Harness, model id, display name, allowed efforts, default effort, enabled.                                                                                                                                                                                                               |
| `api_keys`          | Hashed keys with labels and scopes.                                                                                                                                                                                                                                                      |
| `settings`          | Owner-level defaults.                                                                                                                                                                                                                                                                    |

Body-signed webhooks also keep `webhook_receipts`: a unique owner/loop/trigger/content hash, inbound-event link, filtered/deduplicated/pending/admitted/failed state, frozen admission intent, attempts, next-attempt time and safe failure code. Pending admissions retain target pins. The admission port commits run identity, initial thread, subloop pins, queued event and receipt link together; notifications follow commit. See [ADR-0024](decisions/ADR-0024-github-trigger-admission.md).

Every table carries `ownerId`. 1.0 has one owner, `local`.

## Gate and exit invariants (#164 E1)

A decision becomes a gate when exactly one route is marked `repeat: true`. This marker belongs on an expression/LLM route, Choice option, Noul side or Score band; it is never inferred from canvas direction. Require `maxPasses` (1–10,000); optionally set `maxRunTimeSeconds` (positive integer seconds, at most 31,536,000). Without a repeat marker neither limit is allowed. Reserve the port ID `limit-reached`: authors cannot use it as a route ID. The gate exposes **Limit reached** only while a repeat is marked, and that output must be connected. The repeat route must lead through a cycle back to the gate; exits are terminal and triggers cannot be repeat targets.

Passes are one-based, available to JSONata as `gates.<nodeId>.passes` (quote an ID with punctuation, for example `gates."my-gate".passes`). Every marked gate starts at 1. Evaluation happens first. An allowed repeat increments its count once; a non-repeat choice or a refused repeat leaves it unchanged. A non-repeat choice on the last allowed pass wins. If the decision chooses repeat at `maxPasses`, or after the optional run-time limit, it takes `limit-reached` instead. Both limits reached together are recorded as `max-passes`.

Maximum run time is elapsed wall time from `run.startedAt` (falling back to `createdAt`), including waits, pauses and recovery downtime. It is checked after evaluation and only on a repeat choice; it does not interrupt running work or override a finishing choice. A replay fork keeps the checkpoint's passes and starts its own run clock.

Exits are terminal: `{outcome, returns, destinations}`. `outcome` is `success` (default), `failure` or `exhausted`; `returns` is a JSONata expression or `none` (default); `destinations` defaults to `[{kind:"caller"}]` and supports caller, webhook, file, event and log. Exits have no criteria, predicate, default routing or loop-back, and no output ports.

Success finishes `succeeded`, Failure finishes `failed`, and Exhausted finishes the distinct terminal status `exhausted`. Exhausted means the authored graph gave up further repetition; normally a gate's Limit reached output leads here. It is an outcome, not a resumable node failure. Every outcome evaluates the same return expression and delivers its value unchanged; Exhausted adds no wrapper or implicit last output. Use `outputs.<workNodeId>.value` when returning work output, because the preceding gate replaces `lastOutput`.

`/gates` is engine-owned; authored mutation patches cannot alter counts. Graph validation reports a noncyclic repeat at its precise `config.*.repeat` path (`REPEAT_ROUTE_NOT_CYCLIC`), and an unconnected Limit reached at `config.maxPasses` (`PORT_UNCONNECTED`). Schema validation identifies missing limits and extra repeat markers directly.
