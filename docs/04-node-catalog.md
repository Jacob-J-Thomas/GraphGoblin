# 04 - Node catalog

Every node has an `id`, `kind`, `label`, `config`, canvas position, and ports. Every node kind implements the same handler contract (see 05). Configs are Zod schemas in `contracts`; the editor renders property panels from them and the API validates against them. Each config field carries metadata in the schema (`fieldMeta`: a description, and whether it is advanced): the editor shows the description as the field's help and keeps the advanced fields of the inference, decision, script, and subloop nodes under a collapsed Advanced group, and the generated [node reference](reference/nodes.md) lists both (see 09, "Basic and advanced fields"). Node-level `model` and `effort` fields are optional and fall back to loop defaults, then to owner settings.

There are **no error ports** in 1.0. Failures are handled by the engine's resiliency model (05). Nodes that legitimately produce different outcomes express them as labelled routes, which is a routing concept, not an error concept.

## Trigger (Decided)

Starts a run. A loop may have several trigger nodes; each is an entry point that produces the same trigger envelope shape. The strict config discriminator is `type`; both webhook signing variants use `type: 'webhook'`.

| Type      | Config                                                                                                                         | Notes                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `manual`  | `inputSchema?`, `exposeTo: ('ui' \| 'api' \| 'mcp')[]`                                                                         | Button in the UI, REST call, or MCP tool. Optional input validated against the schema.                                          |
| `cron`    | `expression`, `timezone`, `missedFirePolicy: 'skip' \| 'run-once' \| 'run-each'`, `enabled`                                    | Persisted schedule, re-armed at boot. Missed-fire policy is a per-trigger setting.                                              |
| `webhook` | `authentication`, `body`, `eventType`, `dedupeKey?: JSONata`                                                                   | General POST endpoint; None or either HMAC recipe. Payload checks run downstream.                                               |
| `event`   | `eventType`, `dedupeKey?: JSONata`                                                                                             | Fires on the inbound-event bus; payload checks run downstream.                                                                  |
| `poll`    | `intervalSeconds`, `probe: Probe`, `fireWhen: JSONata`, `dedupeKey?`, optional `items: { select, dedupeKey, maxRunsPerPoll? }` | Needs no inbound connectivity. Items mode validates a bounded candidate array and admits unseen items up to the configured cap. |

Concurrency: every firing starts a new run, in parallel with any already running. A per-loop policy is post-1.0.

Ports: `out`.

Webhook and Event configs reject `filter`. Use a downstream decision, classifier or script to branch away or quietly exit. A quiet exit is terminal Success with `returns: "none"` and no destinations. Poll `fireWhen` remains the poll's condition. See [ADR-0038](decisions/ADR-0038-downstream-payload-checks.md).

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

Expression and LLM `routes` are 2-64 `{id,label}` declarations. IDs are unique bounded slugs, excluding `in` and `limit-reached`; trimmed labels are unique, nonblank and at most 120 characters. A plain check becomes a route-returning expression, for example `vars.done ? "done" : "retry"`, with both routes declared.

Classifier Choice retains options with IDs, labels and criteria. Noul retains authored true/false sides: probability at or above `truthThreshold` (default 0.5) selects true, with chosen-side confidence p or 1-p. Optional `minConfidence` rejects below the minimum; equality passes. Score retains ordered zero-based anchors and contiguous named bands; an interior boundary enters the next band and the final endpoint remains inclusive. Scores are never rounded. `recordAlternatives` and provider `context` are classifier fields; LLM also has provider `context`. Expressions have neither setting.

LLM responses require exactly `route`, `confidence` and `reasoning`, with no extra properties. The route must be declared, confidence finite in [0,1], and the stored reasoning excerpt at most 2,048 characters. Confidence is informational and has no acceptance threshold. There is no repair or evaluator fallback.

Source templates render against the full thread. Provider context selection separately prepares messages, variables and optional bare last output; it does not restrict Liquid exposure. Classifier requests, fractions and retry behaviour remain unchanged. Invalid explicit model/effort or classifier capabilities are admission errors; disabled/unconfigured selections remain visible in drafts and block publication.

The output is `{portId,provenance,observation}`. Route observations contain `kind: "route"`, `routeId`, confidence and reasoning (both null for expressions). Classifier observations contain `kind: "classifier"` and typed `answer`. `decision.made` adds at most three historical diagnostics; fresh emissions have none. A rejected classifier retains validated evidence in failure details and selects no route or output patch. Typed failures, resumability and cancellation retain their existing boundaries.

Current definitions/exports use format 4. Old exports and stores require the integrated cutover; no temporary 3-to-4 converter exists. The generated [node reference](reference/nodes.md) lists exact fields.

### Gates and repeat limits (#164 E1)

A decision becomes a gate when exactly one route is marked `repeat: true`. This marker belongs on an expression/LLM route, Choice option, Noul side or Score band; it is never inferred from canvas direction. Require `maxPasses` (1–10,000); optionally set `maxRunTimeSeconds` (positive integer seconds, at most 31,536,000). Without a repeat marker neither limit is allowed. Reserve the port ID `limit-reached`: authors cannot use it as a route ID. The gate exposes **Limit reached** only while a repeat is marked, and that output must be connected. The repeat route must lead through a cycle back to the gate; exits are terminal and triggers cannot be repeat targets.

Passes are one-based, available to JSONata as `gates.<nodeId>.passes` (quote an ID with punctuation, for example `gates."my-gate".passes`). Every marked gate starts at 1. Evaluation happens first. An allowed repeat increments its count once; a non-repeat choice or a refused repeat leaves it unchanged. A non-repeat choice on the last allowed pass wins. If the decision chooses repeat at `maxPasses`, or after the optional run-time limit, it takes `limit-reached` instead. Both limits reached together are recorded as `max-passes`.

Maximum run time is elapsed wall time from `run.startedAt` (falling back to `createdAt`), including waits, pauses and recovery downtime. It is checked after evaluation and only on a repeat choice; it does not interrupt running work or override a finishing choice. A replay fork keeps the checkpoint's passes and starts its own run clock.

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

Behaviour: the engine renders the prompt and context files, persists the pending turn and harness session row, starts or resumes the session, streams events into `node.progress`, stores the transcript as an artifact, applies output transforms, validates against the schema if present, runs the configurable repair turns on the same session if validation fails, then patches `messages`, `lastOutput`, and `counters.usage`.

Before invoking the harness, the engine durably records `harness.turn`: the exact rendered
prompt, selected resume ID, prompt kind and logical visit/turn identities. `harness.submission`
records refusal, uncertainty, missing-session status and any positive acceptance marker.
A definitely-not-submitted turn retries that saved task with its original session-policy
selection when the cause is resumable. Uncertain authored work cannot continue a previous/named
conversation on its inherited ID alone: this visit needs durable acceptance or a newly
established session. Repairs and continuations can use the visit's own session. Without a
usable session, or with a missing session, the run fails non-resumably; Replay from the node
is the available deliberate new attempt. Named-session lookup still applies on replay.
See [submission recovery](05-execution-engine.md#inference-submission-and-recovery).

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

Stdout and stderr use independent streaming UTF-8 decoders, so two-, three- and
four-byte characters survive arbitrary subprocess chunk boundaries. Capture is
limited to 10 MiB of raw bytes per stream by default (`ProcessScripts.maxOutputBytes`);
probe callers may request stricter byte caps. A character split by a capture cap
is omitted; an incomplete trailing sequence at end of stream becomes U+FFFD
(the replacement character), including after timeout or cancellation.
`stdoutBytes`/`stderrBytes` count captured raw bytes before decoding, and
`stdoutOverflow`/`stderrOverflow` report truncation for default and explicit caps.
The counts exclude synthetic spawn diagnostics and replacement-character encoding.
Timeout and cancellation retain process-tree termination.

Ports: `out` plus any labels in `exitCodeRoutes`.

## Context mutation (Decided operations)

Applies an ordered list of operations to the thread. No LLM calls in 1.0.

Authored operations write only `/vars`, `/messages`, `/artifacts`, `/outputs` and
`/lastOutput` and their descendants. Protected context remains readable. Script JSON
Patch stdout obeys the same boundary: every mutating `path` is checked, and a `move`
also checks `from`. A `copy` from protected context into a writable destination and a
read-only `test` of protected context are permitted. A protected write or move source
rejects the entire patch; earlier operations in that patch are not retained.

| Operation              | Parameters                                                                                            | Effect                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `set`                  | `path`, `value` (Liquid or JSONata)                                                                   | Set a var or another writable thread path                                      |
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

Behaviour: the node emits `run.waiting` with a required `wait.waitId`, also exposed as `waiting.waitId` in the run snapshot, and the run releases its worker. Input and signal callers must return that observed identity. Stale, unknown and already answered identities reject with 409 `WAIT_MISMATCH` without changing the run or log. On wake, the received input or signal payload is appended as a message with role `user` or `note` and set as `lastOutput`.

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

A logical visit lasts until this node records `node.finished`. Signal observations and recorded beat numbers persist across beats, retries and restart within that visit; a gate returning to the completed node starts from zero observations and beat 1. Each park exposes a new `waiting.waitId`: send signals with the identity observed in that snapshot. Signals for earlier parks or visits reject with 409 `WAIT_MISMATCH` and cannot increase the count. Two separately accepted signals are two observations, even if their payloads match.

Two readings of "heartbeat" fit this node. The first is "poll until a condition is true", such as waiting for an external job to finish. The second is "emit a periodic keep-alive to another system while the loop is paused", which is the same node with a `probe` that performs the ping and no `until`. If the owner meant something else, this section changes.

Ports: `out`.

## Exit (Decided, #164 E1)

Exits are terminal: `{outcome, returns, destinations}`. `outcome` is `success` (default), `failure` or `exhausted`; `returns` is a JSONata expression or `none` (default); `destinations` defaults to `[{kind:"caller"}]` and supports caller, webhook, file, event and log. Exits have no criteria, predicate, default routing or loop-back, and no output ports.

Success finishes `succeeded`, Failure finishes `failed`, and Exhausted finishes the distinct terminal status `exhausted`. Exhausted means the authored graph gave up further repetition; normally a gate's Limit reached output leads here. It is an outcome, not a resumable node failure. Every outcome evaluates the same return expression and delivers its value unchanged; Exhausted adds no wrapper or implicit last output. Use `outputs.<workNodeId>.value` when returning work output, because the preceding gate replaces `lastOutput`.

The caller destination resolves to the run result, the MCP caller or the parent subloop output mapping. Delivery records `return.delivered` or `return.failed` for each destination.

## Post-1.0 node ideas (recorded, not planned)

- Error or debug node: an explicit place to route to when run inspection is not enough for debugging.
- Fan-out and fan-in nodes.
- Summarise node once an LLM provider port exists.
