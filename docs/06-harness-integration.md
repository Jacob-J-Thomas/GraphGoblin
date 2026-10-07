# 06 - Harness integration

Each inference node selects its harness through `config.harness`, defaulting to `codex`.
Loop settings supply model and effort only; loop-level harness input is rejected.
Decision strategies and structured repair still use their own Codex ports. See [ADR-0019](decisions/ADR-0019-inference-node-harness.md).

## The harness port (Decided)

```ts
interface HarnessPort {
  id: 'codex'; // 'claude' and 'litellm' post-1.0
  preflight(): Promise<{
    ok: boolean;
    version?: string;
    authenticated: boolean;
    problems: string[];
  }>;
  start(req: HarnessStartRequest, signal: AbortSignal): HarnessSession;
  resume(sessionId: string, req: HarnessStartRequest, signal: AbortSignal): HarnessSession;
}

type HarnessStartRequest = {
  workingDirectory: string;
  model?: string;
  effort?: Effort;
  options: InferenceConfig['harnessOptions'];
  capabilities?: InferenceConfig['capabilities'];
  turn: HarnessTurnRequest;
};
type HarnessTurnRequest = { prompt: string; outputSchema?: JsonSchema };

interface HarnessSession {
  sessionId: Promise<string>; // resolves as soon as the harness reports it
  events: AsyncIterable<HarnessEvent>; // normalised, see below
  result: Promise<HarnessResult>;
  cancel(): Promise<void>;
}

type HarnessEvent =
  | { type: 'session'; sessionId: string; mode: 'fresh' | 'resumed' }
  | { type: 'item'; item: HarnessItem } // message, reasoning summary, command, file change, tool call, search
  | { type: 'usage'; inputTokens: number; outputTokens: number; cached?: number }
  | { type: 'turn-complete' }
  | { type: 'error'; code: string; message: string; retriable: boolean };

type HarnessResult = {
  finalText: string;
  structured?: unknown;
  usage: Usage;
  items: HarnessItem[];
};
```

Adapters translate native events into this model. The engine never sees SDK types.

## Codex adapter for 1.0 (Decided)

### Facts the design relies on

Verified on 2026-10-02 against the `openai/codex` repository and docs. Full notes in `research/codex-sdk.md`.

- `@openai/codex-sdk` is Apache-2.0 and requires Node 18 or newer. It is pinned exactly at 0.160.0. It depends on `@openai/codex` at the same version, which ships the native CLI, and by default runs that bundled binary (the adapter's `codexBinary` option overrides it). It exchanges JSONL events with the CLI over stdio.
- Threads persist under `~/.codex/sessions` and can be resumed with `resumeThread(id, options)`.
- `run` and `runStreamed` accept an `outputSchema` for structured output and an AbortSignal.
- `runStreamed` yields `thread.started`, `turn.started`, `item.started|updated|completed`, `turn.completed` (usage), `turn.failed`, and `error` events.
- The client accepts `codexPathOverride`, `env`, `baseUrl`, `apiKey`, `config` (flattened to dotted `--config` keys), and `configOverrides` (raw `key=value` strings). Thread options are `model`, `modelReasoningEffort`, `sandboxMode`, `approvalPolicy`, `networkAccessEnabled`, `webSearchMode`, `webSearchEnabled`, `workingDirectory`, `skipGitRepoCheck`, `additionalDirectories`, and `threadSource`.
- Reasoning effort values used are `minimal`, `low`, `medium`, `high`, `xhigh` (`model_reasoning_effort`).
- Codex has a native Windows sandbox since March 2026, and plugins bundling skills, MCP servers, and connectors since CLI 0.117.0.

All of this was verified against the pinned version in M4; `research/codex-sdk.md` lists every option with the CLI argument it becomes.

### Authentication (Decided)

GraphGoblin uses the machine's existing Codex login, which may be a ChatGPT subscription. It never stores or proxies Codex credentials. The adapter's `preflight` runs the CLI to confirm it is installed and authenticated, and the settings page shows the result. If an API key is desired later, it is passed through `env`, never persisted by GraphGoblin.

### Mapping inference config to the SDK (Decided, verified in M4)

Every behaviour-affecting setting is passed as a per-thread option on every session, so the machine's `config.toml` defaults (on the owner's machine: model `gpt-6.1-sol`, effort `xhigh`, sandbox `danger-full-access`, approval `never`) never leak into a loop. Thread options become CLI arguments that come after any `config` overrides, so they also win over `configOverrides`.

| Inference config                               | SDK mechanism (`@openai/codex-sdk` 0.160.0)                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model`                                        | thread option `model` (`--model`); default from the engine's model resolution, else the adapter's `model` option (`gpt-6-luna`)                                                                                          |
| `effort`                                       | thread option `modelReasoningEffort` (`model_reasoning_effort`); `minimal`, `low`, `medium`, `high`, `xhigh` pass through, `max` maps to `xhigh`                                                                         |
| `harnessOptions.sandbox`                       | thread option `sandboxMode` (`--sandbox`): `read-only`, `workspace-write`, `danger-full-access`                                                                                                                          |
| `harnessOptions.approval`                      | thread option `approvalPolicy` (`approval_policy`): `never` or `on-request`                                                                                                                                              |
| `harnessOptions.networkAccess`                 | thread option `networkAccessEnabled` (`sandbox_workspace_write.network_access`), always set, default `false`                                                                                                             |
| `harnessOptions.webSearch`                     | thread option `webSearchMode` (`web_search`): `live` when true, otherwise `disabled`                                                                                                                                     |
| `harnessOptions.configOverrides`               | client `config` (dotted `--config` keys); values that cannot be TOML (null, non-finite numbers, functions) are dropped                                                                                                   |
| `capabilities.mcpServers`, `plugins`, `skills` | Not yet resolved: the port receives slugs only and there is no capability profile store. The adapter logs and ignores them; use `configOverrides` (for example `mcp_servers.<name>.*`) until profiles land               |
| `workingDirectory`                             | thread options `workingDirectory` (`--cd`) and `skipGitRepoCheck: true`                                                                                                                                                  |
| `session.policy`                               | `fresh` starts a thread; `resume-previous` resumes the session id recorded by the previous inferencing node in this run; `resume-named` resumes the session id stored under `(loopId, key)` or `(workingDirectory, key)` |
| `prompt.template`                              | Rendered with Liquid, passed as the turn prompt                                                                                                                                                                          |
| `output.schema` with `native: true`            | `outputSchema` on the turn; the final message is parsed as JSON into `structured`, and the engine validates it                                                                                                           |
| cancellation                                   | abort the SDK call's signal; see "Cancellation" below                                                                                                                                                                    |

`HarnessPort.resume` receives the same `HarnessStartRequest` as `start`: the node's model, effort, harness options, capabilities, and working directory, plus the turn. The engine sends it for `resume-previous` and `resume-named` turns, schema-repair turns, and crash-recovery continuations, so `resumeThread(id, options)` gets exactly the thread options `startThread` would, including after a restart. The adapter keeps no per-session memory.

Composition: `apps/api` builds `createCodexAdapters({ logger, model: GG_DEFAULT_MODEL, effort: GG_DEFAULT_EFFORT, codexBinary: GG_CODEX_BINARY })` and registers harness `codex`, the structured port, deciders for Codex and built-in Jev Noul, and the classifier registry for Decision Choice. `GG_CODEX_BINARY` is optional: a path to a `codex` executable or `.js` launcher; unset, the SDK's bundled CLI is used. Building the adapters spawns nothing; the CLI starts only with a session or a preflight.

### Event normalisation (Decided)

| Codex event                                                       | `HarnessEvent`                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thread.started`                                                  | `session` with `mode: 'fresh'`, as soon as it arrives. On resume the known id is announced before the CLI starts.                                                                                                                                                                                       |
| `item.completed`                                                  | `item`; `agent_message` → `message`, `reasoning`, `command_execution` → `command`, `file_change` → `file-change`, `mcp_tool_call` → `tool-call`, `web_search` → `search`, `error`, anything else → `other`, each with a one-line summary and the raw item (command output capped at 16 KiB) as `detail` |
| `item.started`, `item.updated`                                    | not emitted                                                                                                                                                                                                                                                                                             |
| SDK item `status`                                                 | Explicit `completed`, `failed`, and in-progress/running states normalize to `ok`, `failed`, and `running`. Command items also derive status from integer `exit_code` when present; every command has a status. Other item types include status only when the SDK reports one.                           |
| `command_execution` fields                                        | Normalized command items carry a one-line `commandPreview` (max `COMMAND_PREVIEW_MAX`, currently 160 chars), an optional integer `exitCode`, and a required status. The bounded summary is independent of these fields, so a long command cannot hide its exit code.                                    |
| `turn.completed`                                                  | `usage` (`input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`), then `turn-complete`                                                                                                                                                                                       |
| `turn.failed`, thrown SDK error, stream ending without completion | `error { code, message, retriable }`, and `result` rejects with the same `code`                                                                                                                                                                                                                         |

An `error` item, such as a configuration deprecation warning, is an ordinary item and never fails a turn. A top-level `error` event only counts if the turn then fails. Codes: `HARNESS_QUOTA_EXHAUSTED` (HTTP 429, usage limit, quota; retriable only for plain rate limits), `HARNESS_NOT_AUTHENTICATED` (401, 403, not logged in), `HARNESS_NOT_INSTALLED` (binary not found), and `HARNESS_TURN_FAILED` (everything else; retriable for 5xx and stream disconnects). The engine's `classifyHarnessError` maps the first two by substring.

Inference `node.progress` uses a strict item variant for each normalized type (`message`, `reasoning`, `command`, `file-change`, `tool-call`, `search`, `error`, and `other`): each has an id, summary (max 2,000 chars), and only allowlisted fields. Commands include a required `status` (`ok`, `failed`, or `running`), optional bounded `commandPreview` (max `COMMAND_PREVIEW_MAX`, currently 160 chars), and optional integer `exitCode`. Other item types may include the normalized status when the SDK supplies one. Error summaries are replaced with a fixed label, tool-call diagnostics are omitted, and progress never includes `detail` or command output. Script progress is a separate strict shape: integer `exitCode`, `stderr` capped at 2,000 chars, and nonnegative integer `stdoutBytes`.

### Cancellation (Decided, verified on Windows)

`cancel()` and the caller's AbortSignal both abort the signal passed to `runStreamed`. The SDK hands it to `child_process.spawn`, which kills the CLI. The SDK keeps the child process private, so the adapter cannot reach its pid for a `taskkill /T /F`. It does not need to on Windows: a live test (`LIVE=1`) starts a `workspace-write` session running `Start-Sleep -Seconds 120`, confirms the sleeping process exists, cancels, and confirms nothing with the marker survives, because Codex runs commands inside a job object that ends with the CLI. The same was observed with `danger-full-access`. `result` rejects with an `AbortError`; `cancel()` waits up to `cancelGraceMs` (5 s) for the turn to settle. POSIX behaviour is unverified on the development machine.

### Codex structured completions and decider

`CodexStructured` (`StructuredPort`) starts one fresh thread per call with the schema, sandbox `read-only`, approval `never`, no network, no web search, in the request's working directory or an empty temporary directory it removes afterwards. It returns the parsed JSON (or the raw text if the reply is not JSON) for the engine to validate. `CodexDecider` (`DeciderPort`, `id: 'codex'`) asks `{ route: enum of labels, confidence, reasoning }` for choices and `{ holds, confidence, reasoning }` for yes/no questions; schemas follow OpenAI's strict structured-output rules, so confidence bounds are enforced by clamping, not in the schema. It is always `available()`; harness health is reported by `preflight`.

### Wiring

```ts
import { createCodexAdapters } from '@graphgoblin/adapter-codex';
import { createJevDecider } from '@graphgoblin/adapter-jev';

const codex = createCodexAdapters({
  logger,
  model: settings.defaultModel,
  effort: settings.defaultEffort,
});
const jev = createJevDecider({ secrets, logger }); // resolves `jev-api-key` in the background
await jev.init();
// ports: harnesses: { codex: codex.harness }, structured: codex.structured, deciders: [jev, codex.decider]
```

The API additionally supplies `ports.classifiers: ClassifierRegistryPort`. Choice decisions use `resolve(ownerId, catalogId)`; `deciders` continues to supply Codex decisions and the built-in Noul exit facade. The facade gates `available()` on the built-in catalog's enabled state and calls `jev.refresh()` after `jev-api-key` changes. The registry creates SDK or HTTP clients from immutable configuration snapshots, invalidates them on catalog/referenced-secret writes and deletes, and rechecks metadata and usable secrets on every resolution. An in-flight request keeps its snapshot; subsequent decisions see the edit.

### Context injection (Decided)

A harness cannot accept conversation history as messages. The thread reaches Codex through three channels, all configured on the inferencing node:

1. **Prompt template.** The default template renders the trigger summary, selected variables, the last N messages, and `lastOutput`. Input transforms shape the view the template sees.
2. **Context files.** Optional files written under the working directory before the session starts, from templates. The default location is `.graphgoblin/context/<nodeId>.md` and the default prompt mentions it. GraphGoblin never edits the user's own `AGENTS.md`.
3. **Session resume.** The harness keeps its own history. Resuming continues it without re-sending anything.

### Structured output and repair (Decided)

Codex enforces `outputSchema` natively. GraphGoblin still validates the parsed result against the schema. On failure, the configurable repair policy applies: up to `maxAttempts` extra turns on the same session with a repair prompt that quotes the validation errors, then either `fail-run` with code `OUTPUT_SCHEMA_MISMATCH` or `continue-raw`. The same `RepairPolicy` type is used by the `coerce` mutation operation.

### Usage recording (Decided)

Usage reported by the harness is written to `harness.usage` events and rolled into `counters.usage`. It is informational. No limits, warnings, or budgets are derived from it.

### Output handling (Decided)

- Transcript: the full item list is stored as an artifact of kind `transcript` when `captureTranscript` is `artifact`.
- Messages: `final` appends one assistant message with the final text. `final-and-notes` also appends short notes for file changes and commands run, tagged `harness-note`, which later truncation and drop operations can target.
- Output transforms run before messages are appended, so redaction and truncation apply to what enters the thread.

### Model catalog (Decided)

There are two catalogs: `model_catalog` is the harness LLM catalog described below; `classifier_models` is an owner-scoped catalog of Choice/classification, Noul, and Score capabilities, with provider model ids, API roots, and optional secret references. Classifiers have no harness effort fields. See [ADR-0021](decisions/ADR-0021-classifier-model-catalog.md).

The `model_catalog` table carries `source: 'harness' | 'litellm'` and `enabled`. Harness entries are enable/disable only, using PATCH; their metadata cannot be edited or deleted through the API. Startup inserts missing seeds as harness entries and refreshes seeded display names, efforts, and default efforts from `DEFAULT_MODEL_CATALOG`, preserving enabled. It lists all six canonical efforts; Codex maps `max` to `xhigh`.

Migration `0004` adds source with a harness default, preserving every legacy row. User-edited seeded rows become harness-owned and their metadata re-syncs on the next startup, while enabled stays as chosen. Hand-added legacy rows also become harness-owned: they keep their values and can be toggled, but are frozen for PUT/DELETE. Existing LiteLLM rows can be edited/deleted and are never refreshed by the harness seed. Creating LiteLLM entries returns `LITELLM_NOT_CONFIGURED` until the provider work ships; no new key convention is defined.

The catalog is advisory. API validate and publish report `MODEL_DISABLED` or `MODEL_NOT_IN_CATALOG` warnings for explicit inference models, decision Codex models when the strategy includes Codex, and loop-default models under the inference default harness (`codex`). Node warnings use node-relative field paths alongside nodeId. These warnings never block publication, and runtime execution does not enforce membership or efforts. Preflight still checks the default model by model id without filtering harness. See [ADR-0018](decisions/ADR-0018-model-catalog-source.md) for migration/rollback and ownership alternatives.

### Windows notes

The product owner develops on Windows 11. Codex's native Windows sandbox applies. POSIX signals are not available, so process trees are killed with `taskkill /T /F` where GraphGoblin owns the process (scripts); for Codex sessions the CLI's own job object ends the tree on abort (see "Cancellation"). `preflight` spawns with `windowsHide: true`; the SDK spawns sessions without it, which only matters if the gateway runs without a console. Paths are normalised with `node:path` and never built by string concatenation.

### Fixtures (Decided)

Adapter tests replay recorded JSONL event streams captured from real sessions, stored under `packages/adapter-codex/fixtures`, through a fake SDK client (`src/__fixtures__/replay.ts`), so they need no CLI or network. Record a new one with `pnpm --filter @graphgoblin/adapter-codex record -- <name> "<prompt>" [--schema file] [--sandbox workspace-write] [--seed file=text]`; it uses `gpt-6-luna` at `low`, `--ephemeral`, a fresh temporary directory, and scrubs home and temporary paths. Current fixtures: `message`, `command-and-file-change`, `structured`, `failed-invalid-model`. `LIVE=1 pnpm --filter @graphgoblin/adapter-codex test -- src/live.test.ts` runs the live smoke suite (preflight, start plus resume, cancellation on Windows, one decision); a nightly CI job behind the same flag detects SDK drift. The SDK version is pinned exactly and bumped deliberately.

## Codex as a decider and a repair engine (Decided)

A decider's supplied confidence must be finite and in `[0, 1]`. An invalid
confidence rejects that strategy's result and tries the next configured strategy;
if none succeeds, the run fails with `DECISION_NO_ROUTE`.

Decision nodes with strategy `codex`, the `coerce` operation's repair, and inferencing-node repair all use short Codex threads with an output schema. This keeps every model call in 1.0 on the subscription. These threads run with a read-only sandbox and no file changes. Implemented by `CodexStructured` and `CodexDecider` in `packages/adapter-codex`.

## Jev decider (Decided, M4)

Decision `jev.model` is an optional classifier catalog id, defaulting to `jev`. Startup seeds that built-in before run recovery and refreshes its managed metadata without resetting enabled. Its fixed provider remains the pinned TypeSafe SDK, `jev-latest`, `https://api.typesafe.ai`, and `jev-api-key`. Exit Noul continues through this built-in alone. Configuration status is a local usable-secret check, with no provider request; it does not establish reachability or valid provider authentication.

`packages/adapter-jev` implements `DeciderPort` (`id: 'jev'`) over `@typesafe-ai/sdk` 0.6.0 (MIT, no dependencies). Both primitives call `POST https://api.typesafe.ai/v1/systemone` with a bearer key from the secret `jev-api-key`:

- `choose` sends the decision context as `state` and one `choice` question whose criteria map each route label to its description. It returns the chosen label, the reported confidence (or the label's probability), and every other label with its probability as `alternatives`, highest first. The engine compares the confidence with `jev.minConfidence` and falls through to the next strategy below it.
- `judge` sends one `noul` (yes/no) question; `holds` is `noul >= 0.5` and `confidence` is the probability of the answer given.

`available()` is synchronous: the decider resolves the key in the background at construction and caches a client; `init()` awaits that, and `refresh()` re-reads the secret. Without a key it is unavailable and the engine skips it. Failures carry codes: `DECIDER_UNAVAILABLE`, `DECIDER_NOT_AUTHENTICATED` (401, 403), `DECIDER_RATE_LIMITED` (429), `DECIDER_HTTP_ERROR`, `DECIDER_UNREACHABLE`, and `DECIDER_INVALID_RESPONSE` (the response is validated with Zod). Jev Choice probabilities must cover exactly the submitted labels; an unknown choice with otherwise valid probabilities still reaches the engine's next-strategy fallback. Jev errors use fixed messages with only numeric HTTP status, and SDK logs use fixed summaries without provider text or response headers. Decision and exit-predicate failures share the engine's safe summaries; snapshots, paged events, and streams never retain provider error bodies or stacks. Engine provider warnings carry only safe name, code, status, and strategy metadata. The SDK retries 408, 429, and 5xx twice by default with a 10 s per-attempt timeout; aborts surface as `AbortError`. The base URL and model are explicit options (`baseUrl`, default `https://api.typesafe.ai`; `model`, default `jev-latest`), never read from `TYPESAFE_*` environment variables.

## HTTP classifier endpoint contract (Decided, ADR-0021)

Register a custom entry with provider `http`, displayName, providerModel, nonempty unique primitives, an HTTP(S) API root without embedded credentials/query/fragment, and optional secretRef. Roots must not include the `/v1/systemone` request path, port 0, or whitespace (including encoded whitespace). When secretRef is supplied, HTTPS is required except for loopback hosts (`localhost`, `127.0.0.0/8`, or `[::1]`). New entries are disabled; metadata edits preserve enabled. The secret reference uses the Secrets name syntax and contains no credential value. Capability listing may include Noul/Score, but HTTP execution in this change implements Choice only.

The infrastructure HTTP client sends `POST {endpoint}/v1/systemone`, `Content-Type: application/json`, and `Authorization: Bearer <resolved secret>` only when secretRef is set:

```json
{
  "model": "kev-latest",
  "state": { "task": "Review the change" },
  "questions": {
    "answer": {
      "type": "choice",
      "instructions": "Which route?",
      "criteria": { "ship": "Ready to merge", "fix": "Needs work" }
    }
  }
}
```

Minimum response:

```json
{
  "answers": {
    "answer": {
      "type": "choice",
      "choice": "ship",
      "confidence": 0.8,
      "probabilities": { "ship": 0.8, "fix": 0.2 }
    }
  }
}
```

Probabilities must cover exactly every submitted label, and all probability/confidence values must be finite and in `[0,1]`. The selected choice must be one of the submitted labels; an undeclared choice produces `DECIDER_INVALID_RESPONSE` with fixed text that does not include the value. Omitted confidence uses the selected probability. Provider model/usage and additional provider metadata may accompany the response. Requests have a 10-second deadline and respect executor cancellation. Redirects are not followed: a 3xx produces `DECIDER_REDIRECT` with "Classifier redirects are not followed". Malformed JSON or invalid answers produce `DECIDER_INVALID_RESPONSE`; 401/403 (`DECIDER_NOT_AUTHENTICATED`), 429 (`DECIDER_RATE_LIMITED`), other HTTP errors (`DECIDER_HTTP_ERROR`), connection failures (`DECIDER_UNREACHABLE`), and timeouts (`DECIDER_TIMEOUT`) have fixed diagnostics, with no credential or untrusted provider body in them. Provider errors fail the run with `INTERNAL_ERROR` and retain the transport code in `failure.details.code`; cancellation retains its existing behaviour. Unavailable configuration and low confidence fall through the strategy chain. Built-in Jev and Codex unknown selections also fall through with fixed text naming the strategy, without retaining the answer. Decision failure details in snapshots and events never contain the provider's raw answer. The registry passes the engine logger to decision-time Jev SDK clients so SDK retries and errors retain fixed log summaries without raw provider text.

Kev-4B's owner recommends `kev.serve` on CUDA or Apple Silicon MLX; the protocol and Apache-2.0 licence were inspected in owner source, with evidence in [research/jev.md](research/jev.md#kev-http-protocol-verification-2026-10-05). GraphGoblin registers an existing service; it does not install or serve models. A different native protocol needs a bridge exposing this contract. Ordinary LiteLLM chat-completion routing does not supply Choice probabilities, so it is outside this classifier path.

## Post-1.0 adapters (recorded)

### Claude Code

Research preserved in `research/claude-code-agent-sdk.md`. Summary of what matters for the port: the Agent SDK is under Anthropic's Commercial Terms and wraps the Claude Code binary; subscription login cannot be offered inside third-party products, so the hosted version needs API keys; the SDK has `resume`, `model`, `effort` (`low` to `max`), `mcpServers`, `permissionMode`, `maxTurns`, `abortController`, `settingSources`, and hooks; structured output exists only on the CLI through a JSON-schema flag; compaction is not controllable. The adapter will need a CLI escape hatch for schema enforcement or rely on GraphGoblin's own validation and repair.

### LiteLLM

A `LiteLLMPort` would provide plain completion calls for decision, coerce, and summarise operations against local or alternative models. It is not a harness: it has no tools or workspace. It would plug in as a `DeciderPort` and as the provider for the post-1.0 `summarise` operation.
