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

Invalid cron schedules produce `CRON_INVALID` issues with the trigger's nodeId and
`config.expression` or `config.timezone`, identifying the field to fix. Following
an expression issue in the editor opens the schedule's Advanced group and focuses
the raw expression; a timezone issue focuses the time zone control.

## Decision (Decided, #98)

Evaluates exactly one selected method and follows the output port for its answer. Evaluation kind and answer type are separate. This release supports Choice answers with 2–64 options, subject to the selected provider's tighter limits.

```ts
type DecisionConfig = {
  answer: {
    type: 'choice';
    options: { id: string; label: string; criteria: string }[];
  };
  evaluation:
    | { kind: 'expression'; jsonata: string }
    | {
        kind: 'classifier';
        model: string;
        question: string;
        context?: DecisionContext;
        minConfidence?: number;
      }
    | {
        kind: 'llm';
        harness: 'codex';
        question: string;
        context?: DecisionContext;
        model: { mode: 'inherit' } | { mode: 'explicit'; value: string };
        effort: { mode: 'inherit' } | { mode: 'explicit'; value: Effort };
      };
  recordAlternatives: boolean;
};
```

An option's stable `id` is the provider key and output port. Its unique, nonblank `label` is display text; `criteria` explains when it should be selected. Renaming or reordering display labels keeps each connection attached to its option. Strategy arrays, inactive evaluator blocks and unsupported answer/kind combinations are rejected.

**Expression** returns a declared string option ID from JSONata. Values are not implicitly stringified. It invokes no provider. **Classifier** selects an explicit owner-scoped catalog ID with Choice capability. **LLM** selects an implemented harness, currently Codex, and requests a structured answer. Model and effort resolve within that harness from node selection, loop defaults, owner defaults, then process defaults; an invalid explicit value is never silently replaced.

Unknown catalog entries, unsupported capabilities, and invalid model/effort combinations are admission errors. Disabled or unconfigured selections remain visible with draft diagnostics and block publication. Runtime rechecks the selected configuration; an unavailable evaluator fails rather than selecting another kind. An in-flight request retains its starting selection.

Only classifiers accept `minConfidence`. A result below it fails with `EVALUATION_RESULT_REJECTED`; it does not choose another route or provider. LLM confidence is required, finite, and between zero and one. It is informational self-report, not a calibrated probability, and has no threshold. Expression confidence is null. Malformed answers, undeclared option IDs, and expression failures have typed nonresumable errors. Restorable unavailability and transient provider failures are resumable; cancellation remains cancellation. See [execution engine](05-execution-engine.md).

Question templates and context selection retain their existing exposure while #38 awaits the human evaluation. Templates see the full thread; the provider's separately selected state contains trigger payload, role/content messages, variables, and optional last-output value. The selector does not restrict what a question template can expose. Option criteria are sent to the selected evaluator. This change adds no citation or evidence-selection contract.

The recorded output is `{answer:{type:'choice',optionId,confidence,probabilities},portId,provenance:{kind,provider,classifierId,model,effort}}`. Nonapplicable and historically unknown values are null. Runtime events record actual resolved model/effort where applicable. Providers' raw errors and secrets never enter that output. Historical pre-cutover skip diagnostics are retained as event evidence; new decisions have no strategy chain.

Old definitions, exports and persisted outputs require the offline conversion described in the CHANGELOG. Exit predicates retain their existing contract until #99.

## Inferencing (Decided)

Hands a request to a harness session. Choose the harness on each inference node with
`config.harness`; omission defaults to `codex`. The current built-ins are Codex and, on supported
native Windows installations, Claude Code. Loop defaults provide model and effort under
`defaults.byHarness`; `settings.defaults.harness` is an unknown field and is rejected. Full
adapter detail is in 06 and the accepted Claude architecture is in ADR-0023.

```ts
type InferenceConfig = {
  harness: 'codex' | 'claude';
  model?: string;
  effort?: Effort;
  session: { policy: 'fresh' | 'resume-previous' | 'resume-named'; key?: string };
  prompt: { template: string }; // Liquid, rendered against the thread
  input: InputTransform[]; // applied to the thread view the template sees
  contextFiles?: { path: string; template: string }[]; // written under the working directory before the session starts
  harnessOptions: {
    sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'; // Claude supports only explicit read-only or danger-full-access
    approval: 'never' | 'on-request';
    networkAccess?: boolean;
    webSearch?: boolean;
    configOverrides?: Record<string, unknown>; // Codex only; Claude rejects nonempty overrides
  };
  capabilities?: { mcpServers?: string[]; plugins?: string[]; skills?: string[] }; // Claude rejects nonempty capabilities
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

Claude Code accepts only the explicit `read-only`/`never` or `danger-full-access`/`never` policy
pairs. `workspace-write`, `on-request`, explicit `networkAccess: false`, `webSearch: true`,
nonempty `capabilities`, and nonempty raw overrides are rejected during validation and again at
runtime. Its read-only policy limits built-in tools; it does not confine filesystem reads or the
operating system. See [Claude Code](06-harness-integration.md#claude-code-adapter-26).

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
    messages?: 'none' | 'last' | number | 'all' | { where: string }; // selection of the child's messages
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
| `until`    | `timestamp`, a Liquid template rendering an ISO 8601 timestamp            | A persisted timer                                                         |
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

Exit predicates with strategy `jev` continue to use built-in Jev's Noul path and its current enable/secret availability. There is no exit classifier selector; custom HTTP classifiers execute Decision Choice only. Disabled, missing/blank-secret, and unreadable-secret states produce the same classifier warnings as decisions, at `config.criteria.<index>.strategy`. Enable Jev in Settings, Classifier models, or set `jev-api-key` in Settings, Secrets. These warnings remain visible in drafts and block publication under the shared admission policy. An already published Jev predicate still fails with `DECIDER_UNAVAILABLE` if it becomes unavailable before evaluation. Exit evaluation fields and event semantics remain unchanged until #99.

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
