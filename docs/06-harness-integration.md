# 06 - Harness integration

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
  resume(sessionId: string, req: HarnessTurnRequest, signal: AbortSignal): HarnessSession;
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

- `@openai/codex-sdk` is Apache-2.0 and requires Node 18 or newer. It spawns the `codex` CLI, which the user installs separately, and exchanges JSONL events with it.
- Threads persist under `~/.codex/sessions` and can be resumed with `resumeThread(id)`.
- `run` and `runStreamed` accept an `outputSchema` for structured output.
- `runStreamed` yields events including `item.completed` and `turn.completed` with usage; the final result carries `finalResponse`, `items`, and `usage`.
- The client accepts `env`, `baseUrl`, `config` (flattened to dotted config keys), and `configOverrides` (raw TOML lines). Thread options include `workingDirectory` and `skipGitRepoCheck`.
- Reasoning effort values are `minimal`, `low`, `medium`, `high`, `xhigh`, set through `model_reasoning_effort`.
- Codex has a native Windows sandbox since March 2026, and plugins bundling skills, MCP servers, and connectors since CLI 0.117.0.

Items marked "verify" in the research doc must be checked against the pinned SDK version during M4.

### Authentication (Decided)

GraphGoblin uses the machine's existing Codex login, which may be a ChatGPT subscription. It never stores or proxies Codex credentials. The adapter's `preflight` runs the CLI to confirm it is installed and authenticated, and the settings page shows the result. If an API key is desired later, it is passed through `env`, never persisted by GraphGoblin.

### Mapping inference config to the SDK (Draft)

| Inference config                                                   | SDK mechanism                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model`, `effort`                                                  | `config: { model, model_reasoning_effort }` on the client, or per-thread options where the pinned SDK exposes them                                                                                                       |
| `harnessOptions.sandbox`, `approval`, `networkAccess`, `webSearch` | `config` keys `sandbox_mode`, `approval_policy`, and the corresponding feature flags; verify names against the pinned version                                                                                            |
| `harnessOptions.configOverrides`                                   | `configOverrides` TOML lines, passed through verbatim                                                                                                                                                                    |
| `capabilities.mcpServers`, `plugins`, `skills`                     | Resolved from the capability profile into `config` entries under `mcp_servers.*` and plugin references; skills are directories the CLI discovers                                                                         |
| `workingDirectory`                                                 | `startThread({ workingDirectory, skipGitRepoCheck: true })`                                                                                                                                                              |
| `session.policy`                                                   | `fresh` starts a thread; `resume-previous` resumes the session id recorded by the previous inferencing node in this run; `resume-named` resumes the session id stored under `(loopId, key)` or `(workingDirectory, key)` |
| `prompt.template`                                                  | Rendered with Liquid, passed as the turn prompt                                                                                                                                                                          |
| `output.schema` with `native: true`                                | `outputSchema` on the turn                                                                                                                                                                                               |
| cancellation                                                       | abort the SDK call and kill the process tree                                                                                                                                                                             |

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

A `model_catalog` table seeded at first boot with the Codex models and the five effort levels, editable in settings. Node and loop `model` and `effort` fields are validated against it. Adding a harness later adds rows, not code paths.

### Windows notes

The product owner develops on Windows 11. Codex's native Windows sandbox applies. Process-tree termination must use a tree-kill approach because POSIX signals are not available. Paths are normalised with `node:path` and never built by string concatenation.

### Fixtures (Decided)

Adapter tests replay recorded JSONL event streams captured from real sessions, stored under `packages/adapter-codex/fixtures`. A nightly CI job behind an environment flag runs a small live smoke suite to detect SDK drift. The SDK version is pinned exactly and bumped deliberately.

## Codex as a decider and a repair engine (Decided)

Decision nodes with strategy `codex`, the `coerce` operation's repair, and inferencing-node repair all use short Codex threads with an output schema. This keeps every model call in 1.0 on the subscription. These threads run with a read-only sandbox and no file changes.

## Post-1.0 adapters (recorded)

### Claude Code

Research preserved in `research/claude-code-agent-sdk.md`. Summary of what matters for the port: the Agent SDK is under Anthropic's Commercial Terms and wraps the Claude Code binary; subscription login cannot be offered inside third-party products, so the hosted version needs API keys; the SDK has `resume`, `model`, `effort` (`low` to `max`), `mcpServers`, `permissionMode`, `maxTurns`, `abortController`, `settingSources`, and hooks; structured output exists only on the CLI through a JSON-schema flag; compaction is not controllable. The adapter will need a CLI escape hatch for schema enforcement or rely on GraphGoblin's own validation and repair.

### LiteLLM

A `LiteLLMPort` would provide plain completion calls for decision, coerce, and summarise operations against local or alternative models. It is not a harness: it has no tools or workspace. It would plug in as a `DeciderPort` and as the provider for the post-1.0 `summarise` operation.
