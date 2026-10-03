# 03 - Domain model

## Vocabulary (Decided)

| Term             | Meaning                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Loop             | A named, owned graph definition with a history of versions.                                                        |
| Loop version     | An immutable snapshot of a loop's definition. Runs pin one.                                                        |
| Node             | A unit of behaviour in the graph with a kind, a config validated by that kind's schema, and ports.                 |
| Port             | A named connection point. Inputs are `in`. Outputs are `out` by default; decisions and exits add labelled outputs. |
| Edge             | A directed connection from a node's output port to another node's input port.                                      |
| Trigger envelope | The normalised payload that starts a run, whatever the source.                                                     |
| Invocation       | Who or what started a run, and how its return should be delivered.                                                 |
| Run              | One execution of a loop version. Owns a context thread and an event log.                                           |
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
  schemaVersion: 1;
  name: string;
  description?: string;
  settings: {
    workingDirectory: WorkingDirectorySpec; // see 04 and 06
    defaults: { harness: 'codex'; model?: string; effort?: Effort };
    maxIterations: number; // hard ceiling, exit nodes may set lower
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
type Edge = { id: string; from: { node: string; port: string }; to: { node: string; port: 'in' } };
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

Validation rules enforced by `domain` before a version can be published:

- At least one trigger node and at least one exit node.
- Every trigger connects, directly or through other nodes, to an exit.
- Every output port of every non-exit node is connected. Exit `loopBack` is optional.
- Node configs validate against their kind's schema. Referenced variables exist. Referenced subloops exist and are published.
- No edge targets a trigger node's input.

## Versioning (Decided)

- Editing creates or updates a **draft** version. Publishing freezes it as the loop's current version.
- A run pins the version it started with and finishes on it, even if a newer version is published meanwhile.
- New runs always use the latest published version.
- A subloop reference resolves to the referenced loop's latest published version at the moment the parent run starts, and the child run pins that version. A reference may instead pin an explicit version number.

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
  source: 'manual.ui' | 'manual.api' | 'manual.mcp' | 'cron' | 'webhook' | 'event' | 'subloop';
  caller?: { kind: 'user' | 'api-key' | 'mcp-client' | 'run'; id: string; label?: string };
  trigger: {
    nodeId: string;
    kind: TriggerKind;
    payload: unknown;
    receivedAt: string;
    dedupeKey?: string;
  };
  returnDefaults?: ReturnChannel[]; // caller-supplied preferences; the exit node may override
};
```

The invocation is immutable for the life of the run and is embedded in the thread so templates and mappings can read it.

## Run (Decided)

| Field                                                  | Notes                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `id`, `ownerId`, `loopId`, `versionId`, `parentRunId?` | Identity and pinning                                                                      |
| `status`                                               | `queued`, `running`, `waiting`, `paused`, `succeeded`, `failed`, `cancelled`, `exhausted` |
| `currentNodeId?`, `iteration`                          | Where the token is                                                                        |
| `waiting?`                                             | `{ nodeId, kind: 'input'                                                                  | 'timer' | 'signal' | 'heartbeat', until?: string, prompt?: string, inputSchema?: JsonSchema }` |
| `cancelRequestedAt?`, `pausedAt?`                      | Persisted intent, honoured after restart                                                  |
| `failure?`                                             | `{ code: RunErrorCode; message: string; nodeId?: string; resumable: boolean }`            |
| `result?`                                              | The exit node's return payload                                                            |
| `outcome?`                                             | `success`, `failure`, `exhausted`                                                         |
| `startedAt`, `finishedAt?`, `lastEventSeq`             | Bookkeeping                                                                               |

## Run events (Decided kinds, Draft payloads)

Each event has `runId`, `seq`, `ts`, `type`, optional `nodeId`, and a typed `payload`. Large payloads are stored as artifacts and referenced.

| Type                                                                 | Payload                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `run.queued`, `run.started`, `run.finished`                          | status, outcome, result reference                                            |
| `run.paused`, `run.resumed`, `run.cancel_requested`, `run.cancelled` | actor                                                                        |
| `run.waiting`, `run.woken`                                           | wait spec, wake reason                                                       |
| `run.failed`                                                         | failure object                                                               |
| `iteration.incremented`                                              | from, to, loopBack target                                                    |
| `node.started`, `node.finished`                                      | config hash; patch, route, duration                                          |
| `node.progress`                                                      | small structured progress from long nodes; harness items are summarised here |
| `harness.session`                                                    | harness, sessionId, mode (`fresh` or `resumed`), model, effort               |
| `harness.usage`                                                      | tokens as reported by the harness, informational                             |
| `decision.made`                                                      | strategy, route, confidence, alternatives                                    |
| `signal.received`, `input.received`                                  | name, payload reference                                                      |
| `heartbeat.beat`                                                     | beat number, probe result summary                                            |
| `child_run.started`, `child_run.finished`                            | child run id, outcome                                                        |
| `return.delivered`, `return.failed`                                  | channel, target, status                                                      |

## Other entities (Decided)

| Entity              | Purpose                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `harness_sessions`  | `(runId, nodeId, attempt)` to harness session id, status, model, effort. Written before the subprocess starts.      |
| `schedules`         | Cron expression, timezone, enabled, next fire, missed-fire policy; one per cron trigger node per published version. |
| `webhook_endpoints` | Path token, secret hash, signature scheme, replay window, loop and trigger node ids.                                |
| `inbound_events`    | Raw inbound events with dedupe keys; what fired which run.                                                          |
| `timers`            | Persisted wake-ups for wait and heartbeat nodes.                                                                    |
| `secrets`           | Name, ciphertext, key id, owner.                                                                                    |
| `model_catalog`     | Harness, model id, display name, allowed efforts, default effort, enabled.                                          |
| `api_keys`          | Hashed keys with labels and scopes.                                                                                 |
| `settings`          | Owner-level defaults.                                                                                               |

Every table carries `ownerId`. 1.0 has one owner, `local`.
