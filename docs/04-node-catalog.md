# 04 - Node catalog

Every node has an `id`, `kind`, `label`, `config`, canvas position, and ports. Every node kind implements the same handler contract (see 05). Configs are Zod schemas in `contracts`; the editor renders property panels from them and the API validates against them. Each config field carries metadata in the schema (`fieldMeta`: a description, and whether it is advanced): the editor shows the description as the field's help and keeps the advanced fields of the inference, decision, script, and subloop nodes under a collapsed Advanced group, and the generated [node reference](reference/nodes.md) lists both (see 09, "Basic and advanced fields"). Node-level `model` and `effort` fields are optional and fall back to loop defaults, then to owner settings.

There are **no error ports** in 1.0. Failures are handled by the engine's resiliency model (05). Nodes that legitimately produce different outcomes express them as labelled routes, which is a routing concept, not an error concept.

## Trigger (Decided)

Starts a run. A loop may have several trigger nodes; each is an entry point that produces the same trigger envelope shape.

| Subtype                 | Config                                                                                                                              | Notes                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `manual`                | `inputSchema?`, `exposeTo: ('ui' \| 'api' \| 'mcp')[]`                                                                              | Button in the UI, REST call, or MCP tool. Optional input validated against the schema.                   |
| `cron`                  | `expression`, `timezone`, `missedFirePolicy: 'skip' \| 'run-once' \| 'run-each'`, `enabled`                                         | Persisted schedule, re-armed at boot. Missed-fire policy is a per-trigger setting.                       |
| `webhook`               | `signature: { scheme: 'hmac-sha256'; header: string; secretRef }`, `replayWindowSeconds`, `dedupeKey?: JSONata`, `filter?: JSONata` | Generic signed endpoint. A payload that fails the filter is recorded and ignored.                        |
| `event`                 | `eventType`, `filter?: JSONata`, `dedupeKey?: JSONata`                                                                              | Fires on GraphGoblin's own inbound-event bus. Other loops can emit to it through an exit return channel. |
| `poll` (Draft, stretch) | `intervalSeconds`, `probe: Probe`, `fireWhen: JSONata`, `dedupeKey?`                                                                | A trigger-side heartbeat. Needs no inbound connectivity. Shares the probe model with the heartbeat node. |

Concurrency: every firing starts a new run, in parallel with any already running. A per-loop policy is post-1.0.

Ports: `out`.

## Decision (Decided strategies, Draft config)

Chooses one of several labelled routes.

```ts
type DecisionConfig = {
  routes: { label: string; description: string }[]; // at least two
  question: string; // Liquid template rendered against the thread
  context?: {
    messages?: 'none' | 'last' | number | 'all';
    vars?: string[];
    includeLastOutput?: boolean;
  };
  strategy: ('jev' | 'codex' | 'expression')[]; // ordered fallback chain
  jev?: { primitive: 'choice'; model?: string; minConfidence?: number }; // classifier catalog id
  codex?: { model?: string; effort?: Effort }; // a Codex thread with an output schema of { route, reasoning }
  expression?: { jsonata: string }; // must evaluate to one of the route labels
  recordAlternatives: boolean;
};
```

Behaviour: strategies are tried in order. `jev.model` selects an exact owner-scoped classifier catalog id; omission defaults to built-in `jev` (provider model `jev-latest`). The registry resolves it at each decision, including resumed execution. An explicit selection never substitutes the built-in. Unknown ids (`CLASSIFIER_MODEL_NOT_FOUND`) and entries without Choice (`CLASSIFIER_PRIMITIVE_UNSUPPORTED`) block publication. Disabled models (`CLASSIFIER_MODEL_DISABLED`), missing or blank required secrets (`CLASSIFIER_SECRET_MISSING`), and unreadable secrets (`CLASSIFIER_SECRET_UNREADABLE`) warn at `config.jev.model`, naming the node, model, and Settings remedy. These unavailable strategies are skipped with the specific reason in `DECISION_NO_ROUTE`'s `tried` details. Without another strategy the decision cannot currently produce a route.

If a classifier answers below `minConfidence`, the next strategy runs. Kev rescales confidence as `(p_max - 1/K) / (1 - 1/K)`, where `K` is the number of routes: two routes with selected probability 0.75 give confidence 0.5. See the [Kev research note](research/jev.md#kev-http-protocol-verification-2026-10-05) when choosing a threshold. An undeclared selected label also tries the next strategy, recording "chose unknown route" in the exhausted chain's `tried` details. Malformed responses and provider errors fail the step and cancellation propagates; HTTP errors do not silently fall through. The chosen route, confidence, and alternatives are written to `decision.made` and `lastOutput`; successful classifier events also carry `classifierModel`, the catalog id. `lastOutput` keeps its existing shape. Classification is Choice with categorical labels. Scorer-only entries can be listed but cannot execute a Choice decision.

Ports: one output per route label.

## Inferencing (Decided)

Hands a request to a harness session. Choose the harness on each inference node with
`config.harness`; omission defaults to `codex`. Loop defaults provide model and effort;
`settings.defaults.harness` is an unknown field and is rejected.
Codex is the only harness in 1.0. Full adapter detail is in 06.

```ts
type InferenceConfig = {
  harness: 'codex';
  model?: string;
  effort?: Effort;
  session: { policy: 'fresh' | 'resume-previous' | 'resume-named'; key?: string };
  prompt: { template: string }; // Liquid, rendered against the thread
  input: InputTransform[]; // applied to the thread view the template sees
  contextFiles?: { path: string; template: string }[]; // written under the working directory before the session starts
  harnessOptions: {
    sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
    approval: 'never' | 'on-request';
    networkAccess?: boolean;
    webSearch?: boolean;
    configOverrides?: Record<string, unknown>;
  };
  capabilities?: { mcpServers?: string[]; plugins?: string[]; skills?: string[] }; // names resolved by the adapter
  output: {
    captureTranscript: 'artifact' | 'none';
    toMessages: 'final' | 'final-and-notes' | 'none';
    transforms: OutputTransform[]; // truncate, redact, replace, inject, drop
    schema?: { jsonSchema: JsonSchema; native: boolean; repair: RepairPolicy };
  };
  timeoutSeconds?: number; // optional watchdog, default none
};

type RepairPolicy = {
  enabled: boolean;
  maxAttempts: number;
  prompt?: string;
  onFailure: 'fail-run' | 'continue-raw';
};
```

Behaviour: the engine writes the harness session row, renders the prompt and context files, starts or resumes the session, streams events into `node.progress`, stores the transcript as an artifact, applies output transforms, validates against the schema if present, runs the configurable repair turns on the same session if validation fails, then patches `messages`, `lastOutput`, and `counters.usage`.

Ports: `out`.

## Script (Decided)

Runs a user-written program.

```ts
type ScriptConfig = {
  command: string;
  args: string[]; // args may use Liquid templates
  cwd?: 'workspace' | string;
  env?: Record<string, string>; // values may be `secret:<name>`
  stdin: 'thread' | 'last-output' | 'none';
  stdout: 'patch' | 'last-output' | 'ignore'; // 'patch' expects an RFC 6902 document
  exitCodeRoutes?: Record<string, string>; // e.g. { "0": "out", "3": "needs-review" }
  timeoutSeconds?: number;
};
```

Behaviour: non-zero exit codes without a configured route fail the run with `SCRIPT_EXIT_CODE`, which is resumable after the script is fixed. Scripts should be idempotent because crash recovery may run them again (05).

Ports: `out` plus any labels in `exitCodeRoutes`.

## Context mutation (Decided operations)

Applies an ordered list of operations to the thread. No LLM calls in 1.0.

| Operation              | Parameters                                                                                            | Effect                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `set`                  | `path`, `value` (Liquid or JSONata)                                                                   | Set a var or any thread path                                                   |
| `delete`               | `path`                                                                                                | Remove a var, message, or artifact                                             |
| `append-message`       | `role`, `content` template, `tags`                                                                    | Inject additional context                                                      |
| `inject`               | `position: 'start' \| 'end' \| index`, `messages[]`                                                   | Insert templated messages                                                      |
| `truncate`             | `keep: { last?: number; first?: number; maxEstimatedTokens?: number }`, `by?: 'messages' \| 'tokens'` | Drop messages by count or token estimate                                       |
| `drop`                 | `where: JSONata`                                                                                      | Remove messages or artifacts matching a predicate, for example tool noise      |
| `replace`              | `where: JSONata`, `pattern`, `replacement`                                                            | Rewrite content                                                                |
| `redact`               | `where: JSONata`, `patterns[]`, `replacement`                                                         | Mask secrets or PII before content reaches a harness or a return channel       |
| `coerce`               | `source: path`, `jsonSchema`, `repair: RepairPolicy`, `target: path`                                  | Validate and reshape a value; repair uses a Codex structured turn when enabled |
| `summarise` (post-1.0) | `where`, `into`, `model`                                                                              | Reserved; requires an LLM provider                                             |

The same operations power `InputTransform` and `OutputTransform` on inferencing nodes, so "structural mutation or omission of input and output" is one vocabulary everywhere.

Ports: `out`.

## Subloop (Decided, mappings Draft)

Executes another loop as a child run and waits for it.

```ts
type SubloopConfig = {
  loopRef: { loopId: string; version: 'latest' | number };
  input: {
    mode: 'inherit' | 'project' | 'fresh';
    exclude?: ('messages' | 'artifacts' | 'vars' | 'lastOutput')[]; // inherit mode
    vars?: Record<string, string>; // childVar: JSONata over the parent thread
    messages?: 'none' | 'last' | number | 'all' | { where: string }; // selection, project mode
    artifacts?: 'none' | 'all' | { where: string };
    inject?: { role: Message['role']; content: string; tags?: string[] }[]; // templated messages added to the child
    trigger?: { payload: string }; // JSONata building the child trigger payload
  };
  output: {
    mode: 'result-only' | 'merge' | 'custom';
    resultTo?: { lastOutput?: boolean; var?: string }; // where the child's return payload lands
    vars?: { strategy: 'child-wins' | 'parent-wins' | 'explicit'; map?: Record<string, string> };
    messages?: 'none' | 'result-note' | 'all' | { where: string };
    artifacts?: 'none' | 'all' | { where: string };
    custom?: { patch: string }; // JSONata producing a JSON Patch for the parent thread
    usage: 'roll-up' | 'separate';
  };
  depthLimitOverride?: number;
};
```

Behaviour: the child run has its own id, event log, iteration counter, and version pin. The parent run enters `waiting` with kind `child` until the child finishes. Cancelling the parent cancels the child. The child's outcome does not fail the parent by itself; its return payload and outcome are available to the output mapping and to downstream decision nodes.

Ports: `out`.

## Wait (Decided purpose, Draft config)

Parks the run until something happens. In engine terms the run stops and is later resumed from this node.

| Mode       | Config                                                                    | Resumed by                                                                |
| ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `input`    | `prompt` template, `inputSchema?`, `exposeTo: ('ui' \| 'api' \| 'mcp')[]` | A human or agent providing input through the UI, REST, or the MCP tool    |
| `duration` | `seconds`                                                                 | A persisted timer                                                         |
| `until`    | `timestamp` (Liquid or JSONata)                                           | A persisted timer                                                         |
| `signal`   | `name`, `filter?: JSONata`                                                | A named signal delivered through REST or MCP, or a matching inbound event |

Common fields: `timeoutSeconds?`, `onTimeout: 'continue' | 'fail-run'` (default `continue`, with `lastOutput = { timedOut: true }` so a decision node can branch).

Behaviour: the node emits `run.waiting` and the run releases its worker. On wake, the received input or signal payload is appended as a message with role `user` or `note` and set as `lastOutput`.

Ports: `out`.

## Heartbeat (Draft - interpretation to confirm)

Repeats a probe on an interval until a condition holds, a deadline passes, or a maximum number of beats is reached. Each beat emits a `heartbeat.beat` event. Between beats the run is parked exactly like a wait, so a long poll never holds a worker or a harness session.

```ts
type HeartbeatConfig = {
  intervalSeconds: number;
  probe: Probe; // { kind: 'http', request } | { kind: 'script', ... } | { kind: 'signal-count', name } | { kind: 'none' }
  until?: string; // JSONata over { probe, thread, beat }; omitted means "beat until maxBeats or deadline"
  maxBeats?: number;
  deadline?: string;
  onExhausted: 'continue' | 'fail-run'; // default 'continue' with lastOutput = { exhausted: true }
  record: 'summary' | 'full';
};
```

Two readings of "heartbeat" fit this node. The first is "poll until a condition is true", such as waiting for an external job to finish. The second is "emit a periodic keep-alive to another system while the loop is paused", which is the same node with a `probe` that performs the ping and no `until`. If the owner meant something else, this section changes.

Ports: `out`.

## Exit (Decided semantics, Draft config)

Decides whether the loop is done, what it returns, where that goes, and whether to go around again.

Exit predicates with strategy `jev` continue to use built-in Jev's Noul path and its current enable/secret availability. There is no exit classifier selector; custom HTTP classifiers execute Decision Choice only. Disabled, missing/blank-secret, and unreadable-secret states produce the same classifier warnings as decisions, at `config.criteria.<index>.strategy`. Enable Jev in Settings, Classifier models, or set `jev-api-key` in Settings, Secrets. These warnings allow publication; an unavailable Jev predicate fails with `DECIDER_UNAVAILABLE` when evaluated.

```ts
type ExitConfig = {
  criteria: ExitCriterion[]; // evaluated in order; the first that matches decides
  default: 'success' | 'loop-back'; // what happens when no criterion matches
  loopBack?: { targetNodeId: string }; // rendered as an explicit edge on the canvas
  return: {
    mapping: string | 'none'; // JSONata over the thread producing the return payload
    channels: ReturnChannel[]; // at least one unless mapping is 'none'
  };
};

type ExitCriterion =
  | { when: 'max-iterations'; value: number; outcome: 'exhausted' }
  | { when: 'max-duration'; seconds: number; outcome: 'exhausted' }
  | {
      when: 'predicate';
      strategy: 'expression' | 'jev' | 'codex';
      question?: string;
      jsonata?: string;
      outcome: 'success' | 'failure';
    }
  | { when: 'last-output-matches'; jsonSchema: JsonSchema; outcome: 'success' };

type ReturnChannel =
  | { kind: 'caller' } // run result, MCP tool result, parent subloop output
  | { kind: 'webhook'; url: string; secretRef?: string } // signed POST
  | { kind: 'file'; path: string; format: 'json' | 'markdown' | 'text' }
  | { kind: 'event'; eventType: string } // emits onto the inbound-event bus; other loops can trigger on it
  | { kind: 'log' };
```

Behaviour: the engine evaluates criteria. A `success` or `failure` outcome, or `exhausted`, finishes the run, renders the return mapping, and delivers it to each channel, recording `return.delivered` or `return.failed` per channel. A loop-back increments `run.iteration` and `counters.nodeVisits`, emits `iteration.incremented`, and moves the token to the target node. The loop's `settings.maxIterations` is a hard ceiling the exit node cannot exceed. It also caps fresh visits per node: a node that would start for the (`maxIterations` + 1)th time fails the run with `MAX_ITERATIONS`, which bounds cycles outside an exit loop-back, such as a decision routing back to itself (see 05).

The caller is whatever created the invocation: a UI session, an API client, an MCP client such as a Codex session that used a skill or tool, a cron schedule, or a parent run. The `caller` channel resolves to the right delivery automatically: the run's `result` field for everyone, the MCP tool result for MCP callers, and the subloop output mapping for parent runs.

Ports: `loopBack` only, and only when configured.

## Post-1.0 node ideas (recorded, not planned)

- Error or debug node: an explicit place to route to when run inspection is not enough for debugging.
- Fan-out and fan-in nodes.
- Summarise node once an LLM provider port exists.
