# 04 - Node catalog

Every node has an `id`, `kind`, `label`, `config`, canvas position, and ports. Every node kind implements the same handler contract (see 05). Configs are Zod schemas in `contracts`; the editor renders property panels from them and the API validates against them. Each config field carries metadata in the schema (`fieldMeta`: a description, and whether it is advanced): the editor shows the description as the field's help and keeps the advanced fields of the inference, decision, script, and subloop nodes under a collapsed Advanced group, and the generated [node reference](reference/nodes.md) lists both (see 09, "Basic and advanced fields"). Node-level `model` and `effort` fields are optional and fall back to loop defaults, then to owner settings.

There are **no error ports** in 1.0. Failures are handled by the engine's resiliency model (05). Nodes that legitimately produce different outcomes express them as labelled routes, which is a routing concept, not an error concept.

## Trigger (Decided)

Starts a run. A loop may have several trigger nodes; each is an entry point that produces the same trigger envelope shape.

| Subtype   | Config                                                                                                                                                                 | Notes                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `manual`  | `inputSchema?`, `exposeTo: ('ui' \| 'api' \| 'mcp')[]`                                                                                                                 | Button in the UI, REST call, or MCP tool. Optional input validated against the schema.                                          |
| `cron`    | `expression`, `timezone`, `missedFirePolicy: 'skip' \| 'run-once' \| 'run-each'`, `enabled`                                                                            | Persisted schedule, re-armed at boot. Missed-fire policy is a per-trigger setting.                                              |
| `webhook` | Timestamp signature (`hmac-sha256`) with `replayWindowSeconds`, or raw-body signature (`hmac-sha256-body`) without a window; `dedupeKey?: JSONata`, `filter?: JSONata` | Generic signed endpoint. Body mode durably consumes authenticated content, including filtered deliveries.                       |
| `event`   | `eventType`, `filter?: JSONata`, `dedupeKey?: JSONata`                                                                                                                 | Fires on GraphGoblin's own inbound-event bus. Other loops can emit to it through an exit return channel.                        |
| `poll`    | `intervalSeconds`, `probe: Probe`, `fireWhen: JSONata`, `dedupeKey?`, optional `items: { select, dedupeKey, maxRunsPerPoll? }`                                         | Needs no inbound connectivity. Items mode validates a bounded candidate array and admits unseen items up to the configured cap. |

Concurrency: every firing starts a new run, in parallel with any already running. A per-loop policy is post-1.0.

Ports: `out`.

Invalid cron schedules produce `CRON_INVALID` issues with the trigger's nodeId and
`config.expression` or `config.timezone`, identifying the field to fix. Following
an expression issue in the editor opens the schedule's Advanced group and focuses
the raw expression; a timezone issue focuses the time zone control.

## Decision (Decided, #164 D1)

Choose one `kind`; its fields describe that evaluator directly. See [ADR-0035](decisions/ADR-0035-evaluator-specific-decisions.md).

| Kind         | Required authored fields                                                                      | Result and ports                                               |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `expression` | `jsonata`, `routes`                                                                           | One JSONata snippet returns a declared scalar route ID.        |
| `llm`        | Liquid `instructions`, `routes`, `harness: "codex"`, inherit-or-explicit `model` and `effort` | A checked structured completion chooses one declared route.    |
| `classifier` | catalog `model`, Liquid `question`, `answer`                                                  | Choice options, Noul sides or Score bands derive stable ports. |

Expression and LLM `routes` are 2-64 `{id,label}` declarations. IDs are unique bounded slugs, excluding `in`; trimmed labels are unique, nonblank and at most 120 characters. A plain check becomes a route-returning expression, for example `vars.done ? "done" : "retry"`, with both routes declared.

Classifier Choice retains options with IDs, labels and criteria. Noul retains authored true/false sides: probability at or above `truthThreshold` (default 0.5) selects true, with chosen-side confidence p or 1-p. Optional `minConfidence` rejects below the minimum; equality passes. Score retains ordered zero-based anchors and contiguous named bands; an interior boundary enters the next band and the final endpoint remains inclusive. Scores are never rounded. `recordAlternatives` and provider `context` are classifier fields; LLM also has provider `context`. Expressions have neither setting.

LLM responses require exactly `route`, `confidence` and `reasoning`, with no extra properties. The route must be declared, confidence finite in [0,1], and the stored reasoning excerpt at most 2,048 characters. Confidence is informational: no LLM decision gate exists. There is no repair or evaluator fallback.

Source templates render against the full thread. Provider context selection separately prepares messages, variables and optional bare last output; it does not restrict Liquid exposure. Classifier requests, fractions and retry behaviour remain unchanged. Invalid explicit model/effort or classifier capabilities are admission errors; disabled/unconfigured selections remain visible in drafts and block publication.

The output is `{portId,provenance,observation}`. Route observations contain `kind: "route"`, `routeId`, confidence and reasoning (both null for expressions). Classifier observations contain `kind: "classifier"` and typed `answer`. `decision.made` adds at most three historical diagnostics; fresh emissions have none. A rejected classifier retains validated evidence in failure details and selects no route or output patch. Typed failures, resumability and cancellation retain their existing boundaries.

Current definitions/exports use format 4. Old exports and stores require the integrated cutover; no temporary 3-to-4 converter exists. The generated [node reference](reference/nodes.md) lists exact fields.

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

## Exit (Decided, #99)

Decides whether the loop is done, what it returns, where that goes, and whether to go around again. Criteria run in their authored order; the first match decides the outcome.

A predicate declares `{predicate, match}`. Expression and Codex predicates return a strict boolean and use `match.type: "boolean"`. Classifier predicates declare Choice, Noul or Score under `predicate.answer`; they use matching option IDs, a boolean Noul value or an exact fractional Score comparison. Predicates have no graph routes or Score bands. This separate contract preserves exit behaviour until step 14 removes criteria.

Classifier evaluation requires a catalog model supporting the requested primitive. Disabled, missing or unusable-secret selections block publication and fail at runtime if availability changes. Custom HTTP classifiers and built-in Jev use the same registry. LLM evaluation uses Codex with inherited or explicit model/effort. Expression and LLM predicates are boolean; classifiers support Choice, Noul and Score.

Classifier `minConfidence` and optional LLM `match.minReportedConfidence` are separate acceptance gates. Equality passes. A valid rejected answer is retained as evidence but cannot match, including a false answer with match=false. LLM confidence is self-reported. Invalid responses, provider errors, unavailable configuration and cancellation fail evaluation rather than falling through. There is no fallback.

Questions still render against the full thread. Provider state is the existing trigger payload, all variables, bare last output or null, last message content or null, and iteration. No exit context selector or new session behavior is introduced.

```ts
// Example predicate; see the generated reference for the complete union.
const criterion = {
  when: 'predicate',
  answer: { type: 'noul' },
  evaluation: { kind: 'expression', jsonata: 'vars.done = true' },
  match: { type: 'noul', value: true },
  outcome: 'success',
};

type ExitConfig = {
  criteria: ExitCriterion[];
  default: 'success' | 'loop-back';
  loopBack?: { targetNodeId: string };
  return: {
    mapping: string | 'none';
    channels: ReturnChannel[];
  };
};

// Other criteria retain their existing max-iterations, max-duration and
// last-output-matches shapes and their authored positions.

type ReturnChannel =
  | { kind: 'caller' } // run result, MCP tool result, parent subloop output
  | { kind: 'webhook'; url: string; secretRef?: string } // signed POST
  | { kind: 'file'; path: string; format: 'json' | 'markdown' | 'text' }
  | { kind: 'event'; eventType: string } // emits onto the inbound-event bus; other loops can trigger on it
  | { kind: 'log' };
```

Behaviour: the engine evaluates criteria. A `success` or `failure` outcome, or `exhausted`, finishes the run, renders the return mapping, and delivers it to each channel, recording `return.delivered` or `return.failed` per channel. A loop-back increments `run.iteration` and `counters.nodeVisits`, emits `iteration.incremented`, and moves the token to the target node. Predicates are evaluated before the implicit ceiling: a match at the final iteration may complete, and a provider can still fail there. Only a no-match default loop-back checks the loop's `settings.maxIterations` ceiling and finishes exhausted. It also caps fresh visits per node: a node that would start for the (`maxIterations` + 1)th time fails the run with `MAX_ITERATIONS`, which bounds cycles outside an exit loop-back, such as a decision routing back to itself (see 05).

The caller is whatever created the invocation: a UI session, an API client, an MCP client such as a Codex session that used a skill or tool, a cron schedule, or a parent run. The `caller` channel resolves to the right delivery automatically: the run's `result` field for everyone, the MCP tool result for MCP callers, and the subloop output mapping for parent runs.

Ports: `loopBack` only, and only when configured.

## Post-1.0 node ideas (recorded, not planned)

- Error or debug node: an explicit place to route to when run inspection is not enough for debugging.
- Fan-out and fan-in nodes.
- Summarise node once an LLM provider port exists.
