# 06 - Harness integration

Each inference node selects its harness through `config.harness`, defaulting to `codex`.
Loop settings supply per-harness model and effort defaults; loop-level harness input is rejected.
Decision routes and temporary boolean predicates use the Codex decider; structured repair uses the structured-completion port. See
[ADR-0019](decisions/ADR-0019-inference-node-harness.md) and
[ADR-0023](decisions/ADR-0023-installed-claude-code.md).

## The harness port (Decided)

```ts
interface HarnessPort {
  id: 'codex' | 'claude'; // LiteLLM is a recorded later adapter idea
  preflight(): Promise<{
    state: HarnessReadinessState;
    ok: boolean;
    version?: string;
    authenticated?: boolean;
    problems: string[];
    authMethod?: 'claude.ai' | null;
    supportedPolicies?: ClaudePolicy[];
    models?: ClaudeModelCapability[];
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
  | {
      type: 'submitted';
      marker: 'claude.assistant' | 'claude.result' | 'codex.turn.started' | 'fake.accepted';
    }
  | { type: 'turn-complete' }
  | {
      type: 'error';
      code: string;
      message: string;
      retriable: boolean;
      submission: PromptSubmission;
    };

type HarnessResult = {
  finalText: string;
  structured?: unknown;
  usage: Usage;
  items: HarnessItem[];
};
```

Adapters translate native events into this model. The engine never sees SDK types.

## No-turn readiness (#179)

Readiness describes CLI prerequisites, independently of catalog enablement. `ready` confirms
version, required CLI flags and local login only; it never promises account access to a model.
The `models` field lists adapter identities and efforts, even when the CLI is not ready.
No probe sends a prompt, creates a session, or checks entitlement through inference.

| State                 | Meaning and next action                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checking` (web only) | No result exists yet. A recheck keeps the last result instead; this is not a server readiness result.                                                                                     |
| `unknown`             | Timeout, cancellation, empty/unrecognized login output (even after exit 0) or another inconclusive probe. Login stays unestablished. Check the CLI and retry; model support is undecided. |
| `ready`               | Required CLI capabilities and local authentication passed; account model access remains untested.                                                                                         |
| `cli-missing`         | Executable not found. Install it or correct the configured binary path, then retry.                                                                                                       |
| `cli-incompatible`    | Version or required CLI capability failed verification. Update the installed CLI and retry.                                                                                               |
| `auth`                | Positive sign-out, wrong Claude account method or authentication-error evidence, including explicit HTTP/API 401/403. Run `claude auth login` or `codex login`, then retry.               |
| `quota`               | Explicit HTTP/API 429 or allowance/rate-limit diagnostic, even beside incidental network advice. Check account allowance and retry when permitted; preserve the model.                    |
| `transport`           | Explicit connection or temporary provider-service failure. Check connectivity/service status and retry; preserve the model.                                                               |

Only user-disabled models (`MODEL_DISABLED`) or identities absent from GraphGoblin support
(`MODEL_NOT_IN_CATALOG`) mean model unavailable.
A failed catalog fetch is unknown, not removal. An effort or wrong-harness configuration error
is reported separately. This change adds no retirement, substitution or usage-recovery behavior.

Claude probes its configured executable (default `%USERPROFILE%\.local\bin\claude.exe`) in a
fresh empty directory: version (minimum 2.1.285), help with the hidden `--max-turns` parser check,
and local auth status. Help must advertise every launch flag, including `--model` and `--effort`.
Codex probes the SDK-bundled CLI or `GG_CODEX_BINARY`: version (minimum SDK baseline 0.160.0),
`exec --help`, `exec resume --help`, then `login status`, also in a fresh empty directory.
The exec help must advertise `--json`, `--model`, `--sandbox`, `--cd`, `--skip-git-repo-check`,
`--output-schema`, and `--config` (the SDK uses the latter for reasoning effort and policy).
Each command has a 15-second deadline; neither command includes a prompt. Advertised flags
establish syntax only; runtime verification still owns model/effort execution truth.

Draft create, template-draft create, import and save validate catalog/configuration only: they
never probe CLI readiness or wait for a provider prerequisite. Readiness cannot reject a draft.
The editor obtains readiness separately from `/harness/preflight`.
Explicit validate, publish, preflight and manual API/MCP trigger start use an operation-owned memo.
Each referenced harness is probed once per operation, including failures and multiple nodes;
distinct harnesses are probed concurrently. Concurrent requests own separate memos; nothing is
retained on the container or module. Run admission pins the checked version and rejects failed
prerequisites before starting a turn. Readiness issues use `HARNESS_READINESS_<STATE>` (hyphens
become underscores); catalog/configuration issues retain their existing codes.

Manual UI/API/MCP trigger start checks the engine's frozen root definition (published version or
draft snapshot) and every executable pinned subloop definition, recursively. Both `latest` and
numbered child references use the published records the engine prepared for this start, never a
child's draft or a publication that arrives while a probe is pending. A breadth-first walk visits
each version once at its shallowest depth, protects cycles and applies the execution handler's
configured subloop depth limit (or that node's override, at most 64). Harnesses shared by parent
and children share one probe; distinct harnesses are probed concurrently. An unready descendant
returns 422 `HARNESS_NOT_READY`, with the child loop name, loop/version ids and node id in its
issues, before any parent run, queued event, draft snapshot or mutation is committed.
The engine commits the same checked intent after probing and revalidates that its versions still
exist; slow probes do not hold the shared admission/deletion lock.

Replay, scheduled and webhook admissions, internally started subloops and resumes do not gain
this manual trigger-start preflight; their existing execution checks remain in place and can
fail after earlier nodes have run. In particular, replay can return 202 with an unready harness,
execute preceding mutations, then fail when it reaches that harness. Unresolved child references
retain their existing `SUBLOOP_NOT_FOUND` execution behavior. Readiness is an admission-time
observation, not a guarantee of later account access.

`/harness/preflight` exposes seven server states. `checking` is a web-only request state.
`authenticated` is absent if login was not checked or could not be established; false requires
positive signed-out evidence. Claude parses auth-status JSON even on
exit 1 (`loggedIn:false` or an explicit nonempty non-Claude.ai account method). During auth status,
explicit `Not logged in` text on stdout or bounded stderr confirms sign-out even on exit 0.
Empty output, `{}` or an unrecognised login response on exit 0 is `unknown`, with no `authenticated` field;
a successful exit alone establishes no login fact. A recognised Claude.ai status or Codex
"Logged in" status establishes true; an explicit signed-out status establishes false.

No-turn diagnostic precedence is CLI-syntax errors first, explicit HTTP/API 401/403 (`auth`),
429 (`quota`) or 5xx (`transport`) next, then connection errors/wording, then quota/auth keywords.
Thus incidental "network" advice cannot override 401 or 429, while connection errors such as
`ECONNREFUSED` still outrank incidental auth words in server/refresh diagnostics. Version numbers
are not HTTP status evidence. For Claude's unstructured diagnostics, recognised stderr wins
over conflicting stdout because stderr is the CLI's primary error channel; stdout is consulted
when stderr is absent or classified `unknown`, so an unrelated warning cannot hide stdout quota.
Positive Claude auth-status sign-out evidence (structured or explicit text) is handled separately;
process start, timeout, cancellation, overflow and unconfirmed termination remain authoritative.
None of this inference applies to
model-turn stdout or changes turn retry eligibility.
Harness checks in `/system/preflight` carry state alongside the system's `ok`/`warn`/`fail`
severity. Each problem is one detail sentence and one action ending "then retry preflight"
(`readinessMessage` in the domain package); a specific detail, such as the CLI version below the
minimum or the missing option, replaces the generic one rather than being followed by it.
Web queries retain their existing two-second stale interval and focus refresh.
[Frontend readiness behavior](09-frontend-and-pwa.md#claude-readiness-and-saved-selections)
describes first load, background rechecks, offline pauses, completed lookup failures, Retry
controls and transport wording, including the distinction between the Settings card and fields.

Process lifetime was measured with installed no-turn commands under the product runners on
native Windows. No surviving new native process was observed in the recorded before/after
listings; no orphan-process fix is prescribed. This bounded observation does not prove general
turn or descendant lifetime. See the [WP-F1 evidence](qa/2026-10-19-wp-f1-readiness/README.md).

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

| Inference config                               | SDK mechanism (`@openai/codex-sdk` 0.160.0)                                                                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                                        | thread option `model` (`--model`); default from the engine's model resolution, else the adapter's `model` option (`gpt-6-luna`)                                                                                                                                      |
| `effort`                                       | thread option `modelReasoningEffort` (`model_reasoning_effort`); `minimal`, `low`, `medium`, `high`, `xhigh` pass through, `max` maps to `xhigh`                                                                                                                     |
| `harnessOptions.sandbox`                       | thread option `sandboxMode` (`--sandbox`): `read-only`, `workspace-write`, `danger-full-access`                                                                                                                                                                      |
| `harnessOptions.approval`                      | thread option `approvalPolicy` (`approval_policy`): `never` or `on-request`                                                                                                                                                                                          |
| `harnessOptions.networkAccess`                 | thread option `networkAccessEnabled` (`sandbox_workspace_write.network_access`), always set, default `false`                                                                                                                                                         |
| `harnessOptions.webSearch`                     | thread option `webSearchMode` (`web_search`): `live` when true, otherwise `disabled`                                                                                                                                                                                 |
| `harnessOptions.configOverrides`               | client `config` (dotted `--config` keys); values that cannot be TOML (null, non-finite numbers, functions) are dropped                                                                                                                                               |
| `capabilities.mcpServers`, `plugins`, `skills` | Not yet resolved for Codex: the port receives slugs only and there is no capability profile store. Codex logs and ignores them; use Codex-only `configOverrides` (for example `mcp_servers.<name>.*`) until profiles land. Claude rejects nonempty capability lists. |
| `workingDirectory`                             | thread options `workingDirectory` (`--cd`) and `skipGitRepoCheck: true`                                                                                                                                                                                              |
| `session.policy`                               | `fresh` starts a thread; `resume-previous` resumes the session id recorded by the previous inferencing node in this run; `resume-named` resumes the session id stored under `(loopId, key)` or `(workingDirectory, key)`                                             |
| `prompt.template`                              | Rendered with Liquid, passed as the turn prompt                                                                                                                                                                                                                      |
| `output.schema` with `native: true`            | `outputSchema` on the turn; the final message is parsed as JSON into `structured`, and the engine validates it                                                                                                                                                       |
| cancellation                                   | abort the SDK call's signal; see "Cancellation" below                                                                                                                                                                                                                |

`HarnessPort.resume` receives the same `HarnessStartRequest` as `start`: the node's model, effort, harness options, capabilities, and working directory, plus the turn. The engine sends it for `resume-previous` and `resume-named` turns, schema-repair turns, and crash-recovery continuations, so `resumeThread(id, options)` gets exactly the thread options `startThread` would, including after a restart. The adapter keeps no per-session memory.

Composition: `apps/api` builds the Codex adapters from the Codex entry of the harness-keyed process defaults (`GG_DEFAULTS`) and `GG_CODEX_BINARY`, and registers the harness, structured port, Codex structured evaluator and primitive-aware classifier registry. It also registers the Claude harness on supported native Windows hosts using `GG_CLAUDE_BINARY` or the owner-installed CLI path described below. `GG_CODEX_BINARY` remains an optional executable or JavaScript launcher; otherwise the SDK bundled CLI is used. Constructing adapters starts no model session. Old process-default variables are rejected with migration guidance.

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

An `error` item, such as a configuration deprecation warning, is an ordinary item and never fails a turn. A top-level `error` event only counts if the turn then fails. Codes: `HARNESS_QUOTA_EXHAUSTED` (HTTP 429, usage limit, quota; retriable only for plain rate limits), `HARNESS_NOT_AUTHENTICATED` (401, 403, not logged in), `HARNESS_NOT_INSTALLED` (binary not found), `HARNESS_TRANSPORT_FAILED` (5xx and stream disconnects), and `HARNESS_TURN_FAILED` (other failures). The engine's `classifyHarnessError` maps the first two by substring.

Inference `node.progress` uses a strict item variant for each normalized type (`message`, `reasoning`, `command`, `file-change`, `tool-call`, `search`, `error`, and `other`): each has an id, summary (max 2,000 chars), and only allowlisted fields. Commands include a required `status` (`ok`, `failed`, or `running`), optional bounded `commandPreview` (max `COMMAND_PREVIEW_MAX`, currently 160 chars), and optional integer `exitCode`. Other item types may include the normalized status when the SDK supplies one. Error summaries are replaced with a fixed label, tool-call diagnostics are omitted, and progress never includes `detail` or command output. Script progress is a separate strict shape: integer `exitCode`, `stderr` capped at 2,000 chars, and nonnegative integer `stdoutBytes`. Command items recorded before the strict progress contract, which have no status, appear after the offline upgrade as `other` items with their original id and summary, and the original event is kept in the upgrade audit.

### Cancellation (Decided, verified on Windows)

`cancel()` and the caller's AbortSignal both abort the signal passed to `runStreamed`. The SDK hands it to `child_process.spawn`, which kills the CLI. The SDK keeps the child process private, so the adapter cannot reach its pid for a `taskkill /T /F`. It does not need to on Windows: a live test (`LIVE=1`) starts a `workspace-write` session running `Start-Sleep -Seconds 120`, confirms the sleeping process exists, cancels, and confirms nothing with the marker survives, because Codex runs commands inside a job object that ends with the CLI. The same was observed with `danger-full-access`. `result` rejects with an `AbortError`; `cancel()` waits up to `cancelGraceMs` (5 s) for the turn to settle. POSIX behaviour is unverified on the development machine.

### Codex structured completions and decider

`CodexStructured` (`StructuredPort`) starts one fresh thread per call with the schema, sandbox `read-only`, approval `never`, no network, no web search, in the request's working directory or an empty temporary directory it removes afterwards. It returns the parsed JSON (or the raw text if the reply is not JSON) for the engine to validate. `CodexDecider` (`DeciderPort`, `id: 'codex'`) asks `{ route: enum of labels, confidence, reasoning }` for choices and `{ holds, confidence, reasoning }` for yes/no questions; schemas follow OpenAI's strict structured-output rules, so Choice confidence bounds are enforced by complete local validation, without clamping or coercion. The exit yes/no contract remains unchanged pending #99. It is always `available()`; harness health is reported by `preflight`.

### Wiring

```ts
import { createCodexAdapters } from '@graphgoblin/adapter-codex';
import { createJevDecider } from '@graphgoblin/adapter-jev';

const codex = createCodexAdapters({
  logger,
  model: settings.defaults.byHarness.codex?.model,
  effort: settings.defaults.byHarness.codex?.effort,
});
const jev = createJevDecider({ secrets, logger }); // resolves `jev-api-key` in the background
await jev.init();
// ports: harnesses: { codex: codex.harness }, structured: codex.structured, deciders: [jev, codex.decider]
```

The API additionally supplies `ports.classifiers: ClassifierRegistryPort`. Classifier decisions and exit predicates use `resolve(ownerId, catalogId, primitive)` and check the requested capability before dispatch. Codex supplies the structured LLM evaluator; the separate exit judge facade is removed. The registry creates SDK or HTTP clients from immutable configuration snapshots, invalidates them on catalog/referenced-secret writes and deletes, and rechecks metadata and usable secrets on every resolution. An in-flight request keeps its snapshot; subsequent decisions see the edit.

### Context injection (Decided)

A harness cannot accept conversation history as messages. The thread reaches Codex through three channels, all configured on the inferencing node:

1. **Prompt template.** The default template renders the trigger summary, selected variables, the last N messages, and `lastOutput`. Input transforms shape the view the template sees.
2. **Context files.** Optional files written under the working directory before the session starts, from templates. The default location is `.graphgoblin/context/<nodeId>.md` and the default prompt mentions it. GraphGoblin never edits the user's own `AGENTS.md`.
3. **Session resume.** The harness keeps its own history. A resumed turn receives an explicit prompt: a new authored task under its configured policy, a retained definitely-unsubmitted task, or the continuation prompt for uncertain work. See submission markers and recovery below.

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

The model catalog is authoritative for selected and effective models. Shared admission checks reject unknown/wrong-harness models and unsupported effort, including inherited defaults; disabled or unconfigured selections remain visible in draft diagnostics and block publication. Runtime checks the chosen model again without substituting another harness or provider. Defaults share `{byHarness:{codex?:{model?,effort?},claude?:{model?,effort?}}}` across loop, owner and process layers. Owner Settings stores this value under `defaults`; `GG_DEFAULTS` supplies the process layer. The Claude model entry is exact and its effort is recorded as requested because the native CLI does not expose effective effort.

### Windows notes

The product owner develops on Windows 11. Codex's native Windows sandbox applies. POSIX signals are not available, so process trees are killed with `taskkill /T /F` where GraphGoblin owns the process (scripts); for Codex sessions the CLI's own job object ends the tree on abort (see "Cancellation"). `preflight` spawns with `windowsHide: true`; the SDK spawns sessions without it, which only matters if the gateway runs without a console. Paths are normalised with `node:path` and never built by string concatenation.

Windows starts no process whose working directory is missing or longer than 258 characters (error 267). Codex 0.160.0 reports that for a worker command as `CreateProcessWithLogonW failed: 267` (elevated sandbox) or `CreateProcessAsUserW failed: 267` (unelevated). The #102 occurrences came from per-command directories the worker model mistyped, not from GraphGoblin's `--cd`. The Claude and Codex adapters create their `gg-claude-probe-*` and `gg-codex-probe-*` check directories with `mkdir`, because Windows `fs.mkdtemp` fails from 248 characters (247 still works); a name that already exists is never reused or removed, and up to four fresh names are tried. Evidence and the launch comparison matrix: [WP-F5 launch diagnosis](qa/2026-10-19-wp-f5-launch-diagnosis.md).

### Fixtures (Decided)

Adapter tests replay recorded JSONL event streams captured from real sessions, stored under `packages/adapter-codex/fixtures`, through a fake SDK client (`src/__fixtures__/replay.ts`), so they need no CLI or network. Record a new one with `pnpm --filter @graphgoblin/adapter-codex record -- <name> "<prompt>" [--schema file] [--sandbox workspace-write] [--seed file=text]`; it uses `gpt-6-luna` at `low`, `--ephemeral`, a fresh temporary directory, and scrubs home and temporary paths. Current fixtures: `message`, `command-and-file-change`, `structured`, `failed-invalid-model`. `LIVE=1 pnpm --filter @graphgoblin/adapter-codex test -- src/live.test.ts` runs the live smoke suite (preflight, start plus resume, cancellation on Windows, one decision); a nightly CI job behind the same flag detects SDK drift. The SDK version is pinned exactly and bumped deliberately.

## Codex as a decider and a repair engine (Decided)

LLM decisions send rendered Liquid instructions, `{id,label}` route declarations, prepared context and resolved model/effort to `DeciderPort.route`. Exactly `route`, `confidence` and `reasoning` are required; the schema forbids additional properties and constrains route to submitted IDs. The adapter and engine check membership and finite confidence in [0,1]. Confidence is informational with no gate; reasoning is truncated to 2,048 characters. There is one completion, without repair or fallback. Separate `evaluateBoolean` requests serve temporary exit predicates.

Decision nodes with evaluation kind `llm` and harness `codex`, the `coerce` operation's repair, and inferencing-node repair all use short Codex threads with an output schema. These Codex calls use the installed account login; provider authentication and quota failures are reported normally. These threads run with a read-only sandbox and no file changes. Implemented by `CodexStructured` and `CodexDecider` in `packages/adapter-codex`.

## Jev decider (Decided, M4)

Classifier decisions and exit predicates require an explicit `model` catalog id; choose `jev` for the built-in. Startup seeds that built-in before run recovery and refreshes its managed metadata without resetting enabled. Its fixed provider remains the pinned TypeSafe SDK, `jev-latest`, `https://api.typesafe.ai`, and `jev-api-key`. Exit predicates may select any enabled classifier supporting their declared primitive. Configuration status is a local usable-secret check, with no provider request; it does not establish reachability or valid provider authentication.

`packages/adapter-jev` implements `DeciderPort` (`id: 'jev'`) over `@typesafe-ai/sdk` 0.6.0 (MIT, no dependencies). Choice, Noul and Score call `POST https://api.typesafe.ai/v1/systemone` with a bearer key from the secret `jev-api-key`:

- `choose` sends the decision context as `state` and one `choice` question whose criteria map each stable option ID to its authored criterion. It returns the chosen stable option ID, the reported confidence (or that option's probability), and a probability map covering exactly the submitted option IDs. The engine compares classifier confidence with `minConfidence` and rejects a below-threshold answer with `EVALUATION_RESULT_REJECTED`, without fallback.
- `classifyNoul` sends a `noul` question with explicit `true` and `false` criteria and returns its true probability. The engine applies the authored truth threshold (default 0.5), then independently checks confidence in the selected side. Threshold equality passes.
- `score` sends an ordered array of rubric descriptions and preserves the fractional index, exact legend and available confidence/probabilities. The engine selects a stable authored band without rounding. Missing Score confidence is null; an authored minimum then fails with EVALUATION_INVALID_RESPONSE because its gate cannot be evaluated.

`available()` is synchronous: the decider resolves the key in the background at construction and caches a client; `init()` awaits that, and `refresh()` re-reads the secret. Without a key the chosen evaluator is unavailable and execution fails with restoration guidance. Failures carry codes: `DECIDER_UNAVAILABLE`, `DECIDER_NOT_AUTHENTICATED` (401, 403), `DECIDER_RATE_LIMITED` (429), `DECIDER_HTTP_ERROR`, `DECIDER_UNREACHABLE`, and `DECIDER_INVALID_RESPONSE` (the response is validated with Zod). Jev Choice probabilities must cover exactly the submitted stable option IDs; unknown choices are invalid responses. Jev errors use fixed messages with only numeric HTTP status, and SDK logs use fixed summaries without provider text or response headers. Decision and exit-predicate failures share the engine's safe summaries; snapshots, paged events, and streams never retain provider error bodies or stacks. Engine provider warnings carry only safe name, code, status, and strategy metadata. Existing Choice calls retain SDK retries (twice for 408, 429 and 5xx by default). New Noul/Score calls explicitly disable retries and check cancellation before dispatch. The per-attempt timeout is 10 seconds; aborts surface as `AbortError`. The base URL and model are explicit options (`baseUrl`, default `https://api.typesafe.ai`; `model`, default `jev-latest`), never read from `TYPESAFE_*` environment variables.

## HTTP classifier endpoint contract (Decided, ADR-0021)

Register a custom entry with provider `http`, displayName, providerModel, nonempty unique primitives, an HTTP(S) API root without embedded credentials/query/fragment, and optional secretRef. Roots must not include the `/v1/systemone` request path, port 0, or whitespace (including encoded whitespace). When secretRef is supplied, HTTPS is required except for loopback hosts (`localhost`, `127.0.0.0/8`, or `[::1]`). New entries are disabled; metadata edits preserve enabled. The secret reference uses the Secrets name syntax and contains no credential value. HTTP execution supports Choice, Noul and Score; catalog capabilities filter editor choices and are rechecked at admission and dispatch.

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

Probabilities must cover exactly every submitted label, and all probability/confidence values must be finite and in `[0,1]`. The selected choice must be one of the submitted labels; an undeclared choice produces `DECIDER_INVALID_RESPONSE` with fixed text that does not include the value. Omitted confidence uses the selected probability. Provider model/usage and additional provider metadata may accompany the response. Requests have a 10-second deadline and respect executor cancellation. Redirects are not followed: a 3xx produces `DECIDER_REDIRECT` with "Classifier redirects are not followed". Malformed JSON or invalid answers produce `DECIDER_INVALID_RESPONSE`; 401/403 (`DECIDER_NOT_AUTHENTICATED`), 429 (`DECIDER_RATE_LIMITED`), other HTTP errors (`DECIDER_HTTP_ERROR`), connection failures (`DECIDER_UNREACHABLE`), and timeouts (`DECIDER_TIMEOUT`) have fixed diagnostics, with no credential or untrusted provider body in them. Decision provider failures use typed `EVALUATION_*` failures and retain only safe transport diagnostics; cancellation retains its existing behaviour. Unavailable configuration, rejected classifier confidence and unknown selections produce the explicit typed decision failures described in docs/05; they never invoke a different evaluator. Malformed provider answers and transport text are not retained. A valid answer rejected only by confidence retains its validated canonical primitive facts, evaluator provenance and acceptance gate in failure details; it emits no `decision.made` event and selects no route. The registry passes the engine logger to decision-time Jev SDK clients so SDK retries and errors retain fixed log summaries without raw provider text.

Noul uses the same envelope with `questions.answer = { "type": "noul", "instructions": "Is it ready?", "criteria": { "true": "All checks pass", "false": "At least one check fails" } }`. Its response is `answers.answer = { "type": "noul", "noul": 0.8 }`, where `noul` is the true probability, not selected-side confidence.

Score sends `questions.answer = { "type": "score", "instructions": "Rate the result", "criteria": ["Incomplete", "Adequate", "Excellent"] }`. Its response is `answers.answer = { "type": "score", "score": 1.6, "legend": { "0": "Incomplete", "1": "Adequate", "2": "Excellent" } }`, optionally with finite confidence in `[0,1]` and probabilities keyed by every rubric index. The legend must exactly match the submitted rubric; the score must be finite and within `[0,N-1]`. Missing confidence/probabilities remain null. No alternate evaluator is called.

Kev-4B's owner recommends `kev.serve` on CUDA or Apple Silicon MLX; the protocol and Apache-2.0 licence were inspected in owner source, with evidence in [research/jev.md](research/jev.md#kev-http-protocol-verification-2026-10-05). GraphGoblin registers an existing service; it does not install or serve models. A different native protocol needs a bridge exposing this contract. Ordinary LiteLLM chat-completion routing does not supply Choice probabilities, so it is outside this classifier path.

## Claude Code adapter (#26)

GraphGoblin calls the owner's installed Claude Code CLI directly. It adds no Anthropic SDK or
other Anthropic runtime dependency and never installs, downloads, or bundles the CLI. This
adapter currently supports native Windows only and requires CLI `2.1.285` or newer with all required policy and protocol flags;
older versions, missing capabilities and other operating systems fail closed. `GG_CLAUDE_BINARY` selects an explicit
executable. Otherwise the adapter uses `%USERPROFILE%\.local\bin\claude.exe`.

### Authentication and supported models

Preflight and each new or resumed CLI turn run `claude auth status --json` with the adapter's
restricted child environment. Only the `claude.ai` authentication category is accepted. The
response exposes that category, never raw login output, account identity, or credentials. No
GraphGoblin secret stores Claude credentials. Preflight reports the detected CLI version and
missing capabilities, and checks authentication independently even if those checks fail.

The supported models are exact ids; CLI aliases such as `sonnet` or `haiku` are refused. All four
use the same technical readiness, model identity, effort and owner catalog enablement checks
(ADR-0029), and all four seed enabled in the catalog:

| Model id            | Catalog name      | Requested efforts                       | Verification                                                                                           |
| ------------------- | ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `claude-opus-5-5`   | Claude Opus 5.5   | `low`, `medium`, `high`, `xhigh`, `max` | Bounded native fresh/resume turns on CLI 2.1.285 ([#26 QA report](qa/2026-10-07-issue-26.md))          |
| `claude-fable-5-1`  | Claude Fable 5.1  | `low`, `medium`, `high`, `xhigh`, `max` | Same technical checks as Opus (ADR-0029)                                                               |
| `claude-sonnet-5-5` | Claude Sonnet 5.5 | `low`, `medium`, `high`, `xhigh`, `max` | 2026-10-18 on CLI 2.1.292 (#206): direct turns at `low` and `max`; one product turn at `high`          |
| `claude-haiku-5-5`  | Claude Haiku 5.5  | `low`, `medium`, `high`, `xhigh`, `max` | 2026-10-18 on CLI 2.1.292 (#206): direct turns at `low`, `xhigh` and `max`; one product turn at `high` |

`minimal` is not accepted for any Claude model. The CLI does not report the effective effort, so
GraphGoblin records and displays the requested effort and keeps `effectiveEffort` null. Claude
Code documents that a level a model does not support runs at the highest supported level at or
below it; GraphGoblin offers only levels documented for each model, so it expects no such
fallback, but it cannot observe one.

**Sonnet 5.5 and Haiku 5.5 verification (2026-10-18, #206).** Installed CLI 2.1.292 with a
`claude.ai` login. Each direct turn ran `--print` with a one-line prompt, the adapter's restricted
environment and suppression flags, read-only tools, `--max-turns 1` and `--no-session-persistence`
in a fresh empty temporary directory. Every turn succeeded, and the init record, the assistant
message and the result `modelUsage` all reported exactly the requested id. The product turns ran
one trigger, inference and exit loop per model through the API container's own Claude adapter
(`LIVE_CLAUDE=1 pnpm --filter @graphgoblin/api exec vitest run src/live.test.ts`) with a
disposable data directory; both runs succeeded with `harness.session` recording the requested
model and `high` effort, and the CLI's own session records reported the requested model. The
turn-by-turn results are in the [#206 QA record](qa/2026-10-18-issue-206.md).

Real turns exercised Sonnet 5.5 at `low`, `high` and `max`, and Haiku 5.5 at `low`, `high`,
`xhigh` and `max`. The remaining supported levels, `medium` for both and `xhigh` for Sonnet, rest on
documentation rather than a turn: the CLI 2.1.292 model registry lists effort, `xhigh` and `max`
capabilities for `claude-sonnet-5-5`, and Claude Code's
[model configuration page](https://code.claude.com/docs/en/model-config), checked on 2026-10-18,
lists `low`, `medium`, `high`, `xhigh` and `max` for both Sonnet 5.5 and Haiku 5.5. The same page
describes the fallback rule quoted above.

CLI 2.1.292 does not yet list `claude-haiku-5-5` in its model registry. It prints an
`unrecognized_model` notice on stderr, which the adapter does not treat as a refusal (bounded turn
stderr is matched only against the fixed refusal forms below), and treats the model as a
first-party model with every effort level. On 2026-10-23 one real Sonnet 5.5 turn and one real
Haiku 5.5 turn passed again through the built API on Claude Code 2.1.308, which lists both. The
[model configuration page](https://code.claude.com/docs/en/model-config), checked on 2026-10-18,
names Claude Code 2.1.293 as the minimum for Haiku 5.5; the turns above passed on 2.1.292, and GraphGoblin keeps its single CLI
minimum (2.1.285) rather than a per-model one. Not admitted: `claude-haiku-4-5-20251001`, whose
registry entry has no effort capability, so the CLI drops any requested effort (a direct turn at
`max` ran without error, which shows only that the flag is ignored); and `claude-sonnet-5`, the
previous Sonnet.

### Native Windows policy

The supported pairs are `read-only`/`never` and `danger-full-access`/`never`. Read-only enables
the built-in `Read`, `Glob`, and `Grep` tools under the CLI's restricted mode. This is a tool
restriction, not filesystem-read-path or operating-system confinement. Danger-full-access adds
`Edit`, `Write`, and `Bash`; commands and network access are unconfined under the API user's
Windows account. The adapter never promotes another policy to this pair.

`workspace-write`, `on-request`, explicit `networkAccess: false`, `webSearch: true`, nonempty
custom capabilities, and nonempty `configOverrides` are refused during validation and again at
runtime. These settings cannot be silently dropped or reinterpreted. The launch explicitly
restricts tool lists, permission prompts, settings sources, and MCP configuration; it checks
the effective model, authentication source, tools, MCP servers, plugins, and skills reported by
the CLI before accepting the session policy. Managed policy remains in force. The two hostile-project policy canaries passed for the tested restrictions; their limits and bounded native fresh/resume evidence are recorded in the [#26 QA report](qa/2026-10-07-issue-26.md).

The plugin allowlist contains exactly the CLI-bundled `cc-plugin-agents-md` and
`cc-plugin-plugin-authoring`; the explicit built-in skill allowlist includes `plugin-authoring`.
Names are checked individually, without prefix wildcards. Each advertised plugin must also
report `path: "builtin"` and `source: "<name>@builtin"`; a local plugin reusing a built-in name
is refused. `--safe-mode`, empty setting sources
and strict MCP configuration suppress user customizations; an unknown plugin, skill or tool
still fails with `HARNESS_UNSUPPORTED_POLICY` before session evidence is accepted.

When an inference turn requests an output schema, the supported CLI init must advertise exactly
the allowed execution tools plus one `StructuredOutput` carrier. Without a schema, that carrier
is refused. It is virtual output transport, so the CLI `--tools` list and execution-policy
`tools` evidence remain unchanged; separate policy evidence names the carrier. A correlated
carrier call/result records only bounded `other` progress with its name and status, never a
file, command, input, or result body. Duplicate advertised tools, other unexpected tools,
unmatched IDs, and non-boolean error markers fail closed. The final native
`result.structured_output` remains the sole candidate for engine validation and repair; carrier
input or final text cannot replace it. This exact carrier name/set was observed in CLI
`2.1.285` init. Bounded native fresh and same-session resume schema turns at source `3349212` verified correlated carrier calls/settlements, final structured candidates, and exact Opus 5.5 model usage. The resume returned the exact remembered synthetic nonce without that nonce in its prompt. This establishes the tested fresh/resume path, not general recall or prompt-delivery acknowledgment; safe evidence and remaining acceptance are in the
[#26 QA report](qa/2026-10-07-issue-26.md). The official
[CLI reference](https://code.claude.com/docs/en/cli-reference) documents `--json-schema`, and
[structured-output documentation](https://code.claude.com/docs/en/agent-sdk/structured-outputs)
describes the final `structured_output` field; neither establishes this internal carrier name.

### Turns, defaults, and failures

Model and effort resolve only within the selected harness: node, loop, owner Settings, then
`GG_DEFAULTS`. Claude defaults use `defaults.byHarness.claude`; explicit wrong-family or unknown
catalog values fail rather than falling through. Fresh, `resume-previous`, and `resume-named`
policies keep their existing meanings. Session lookup filters by harness before selecting the
newest matching session, so a Codex session is never passed to Claude or vice versa. The same
resolved request is used for normal and structured-output repair turns. Version, help, and authentication probes run in a fresh empty temporary directory; only the actual turn uses the authored working directory.

The CLI streams JSON lines. GraphGoblin records bounded progress, usage, the transcript artifact,
and a policy-evidence item when transcript capture is enabled. Provider response bodies and raw
stderr are not included in diagnostics. Cancellation owns the CLI process tree; if termination
cannot be confirmed, the run fails with `HARNESS_TERMINATION_UNCONFIRMED` and is not reported as
cancelled. Engine and persistence failures retain their original cause and stop the active initial or repair session; unconfirmed cleanup takes precedence. Claude is not a decision evaluator: decision evaluation, exit configuration, and
the separate Codex structured port remain unchanged. Inference schema validation uses the authored repair and failure policy for either harness, preserving the native candidate (including null or a missing candidate) rather than substituting final text. API-provider support remains future work tracked by
[#100](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/100).

`system/commands_changed` and `system/ui_invalidate` can precede or follow init. UI invalidation
requires a nonempty string `event` of at most 100 characters and valid UUID-shaped `uuid` and
`session_id`. Both metadata records must use the same session as each other and init. They emit
no progress, session, prompt-delivery or execution evidence. Verified init alone announces the
session. Status, partial-message and rate-limit metadata also carry no execution evidence.
Before init, only init and the two validated metadata records are accepted. After init,
unrecognised record types and system subtypes emit no events or stored evidence. The system
subtypes `hook_started`, `hook_response`, `hook_progress` and `plugin_install` remain refused
at any time. No record may follow the final result.
The sanitised CLI `2.1.287` capture replays all five records through the JSONL parser and
accumulator, including assistant timestamps/request IDs and result timing/terminal/subagent
fields. These additional fields do not alter exact init/result model identity, integer usage,
native structured-candidate selection, tool correlation or native error checks.

Protocol refusals keep `HARNESS_PROTOCOL_ERROR` and identify an unrecognised pre-init record's `type`
and optional `subtype`; policy refusals name the unexpected plugin, skill or tool. Diagnostics
include the detected CLI version and a hint to update GraphGoblin or report that version.
Diagnostic names contain only letters, digits, `-`, `_` and `.`, with a maximum of 100
characters; other values appear as `<invalid>`. Plugin paths and source strings are never
included. Only bounded name-shaped metadata is included, never prompt, response, tool, account or
rate-limit bodies. A green preflight verifies prerequisites; it does not run a model turn or
guarantee that a future CLI stream will pass runtime verification.

The text-input transport supplies no acknowledgement tied to the exact prompt bytes. Session
init and writing stdin are not proof. The adapter does emit `submitted` on validated evidence
that a turn was consumed (below); it does not claim an exact-byte receipt. Context-delivery
proof and own-session continuity remain with #38/#33.

The earlier [Claude Agent SDK research](research/claude-code-agent-sdk.md) records an alternative
that this adapter does not use.

## Later adapters (recorded)

### LiteLLM

A `LiteLLMPort` would provide plain completion calls for decision, coerce, and summarise operations against local or alternative models. It is not a harness: it has no tools or workspace. It would plug in as a `DeciderPort` and as the provider for the post-1.0 `summarise` operation.

### Submission markers and refusals (#244)

Initialization is session identity, not input acceptance. The engine persists exact pending
prompts and visit provenance before invoking either adapter; see [recovery](05-execution-engine.md#inference-submission-and-recovery).
The run event `harness.submission` says `submitted` with a marker on positive acceptance;
only failed or interrupted turns use the three failure classifications.

| Adapter            | Positive `submitted` marker                                                                                                                                                                                                  | What does not prove acceptance                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Claude stream-json | First validated non-error `assistant` record producing text, thinking or a tool call (`claude.assistant`); a validated successful `result` record proves consumption when no assistant content was emitted (`claude.result`) | `system/init`, the policy transcript item, commands/UI metadata, status, partial-message and rate-limit records    |
| Codex SDK          | `turn.started` (`codex.turn.started`), the input-accepted turn boundary after thread initialization                                                                                                                          | `thread.started`, `resumeThread`, the adapter's early known-ID announcement, configuration/deprecation error items |

Markers emit once per adapter turn. Claude emits `claude.result` as soon as a successful
result record passes session, model, usage and result-text validation, before waiting for CLI exit.
The engine records that acceptance with the visit and turn IDs immediately. Usage totals,
turn completion and the final result still wait for a verified process outcome; a later
transport failure cannot retract the observed acceptance or publish the buffered result.
A lost stream after init or after a marker is uncertain;
markers never claim provider-side durability beyond the observed protocol boundary. A process
kill before the marker is durably recorded remains uncertain too.

Claude local policy/config/auth/readiness failures and confirmed spawn failures are definitely
unsubmitted. Turn stderr is bounded in memory and recognizes only fixed CLI refusal forms:
`error: unknown option` / `error: unexpected argument`, authentication-required diagnostics,
and `No conversation found with session ID:`. Raw diagnostics are discarded. Claude CLI
2.1.304 can emit a pre-init `result` with `is_error: true` and `num_turns: 0` alongside the
missing-session stderr refusal. Before init/acceptance this native refusal result is deferred
until process outcome: the fixed stderr refusal yields `HARNESS_SESSION_MISSING`, ahead of
the otherwise missing-init protocol error. Termination-unconfirmed, abort, timeout and overflow
still take precedence. Without a recognized refusal, a nonzero exit is a generic uncertain
`HARNESS_TURN_FAILED`; an otherwise successful process with an incomplete stream remains a
protocol fault. An init/result mismatch also remains a protocol fault. Once assistant acceptance was
observed, later refusal text cannot make the turn definitely unsubmitted.

Codex reports startup/auth/argument refusals as definitely unsubmitted and positively identified
missing-rollout/thread/session refusals as session missing. Other stream/process failures are
uncertain. The engine prevents later refusal from downgrading already observed acceptance.
An authored/retried authored turn with only an inherited previous/named handle and no durable
acceptance is non-resumable when delivery is uncertain (ADR-0045). Accepted turns and
repair/continuation turns on the visit's own session retain continuation recovery. Unsupported
policy, invalid configuration and argument refusals remain non-resumable even if a generic
adapter error incorrectly advertises retryability. Non-pinned generic Codex failures permit
Resume even when the adapter reports `retriable: false` for a CLI exit or lost stream; generic
Claude failures require the adapter's `retriable` evidence. These eligibility rules do not
override D-022's usable-session requirement. Login, installation and quota retain their
restorable causes.
An abort during readiness probes is conservatively uncertain: the aborted/unknown probe
does not positively identify a pre-send refusal. It does not authorize a blind authored retry.
No readiness probes, probe directories, model selection or fallback policy changed.

## Explicit node harness changes (#204)

An explicit Harness change preserves unset node model/effort inheritance. For an explicit model,
the editor chooses an enabled compatible loop default, then Settings default, then the adapter's
ecosystem default (D-023). It waits for first-time checks already in flight; failed checks preserve
authored selections. A failed catalog lookup shows **Validation unavailable**; a blocked switch
leaves an incompatible draft that cannot be saved until corrected. See [the editor's harness-change rule](09-frontend-and-pwa.md#explicit-node-harness-changes-204)
for compatibility, effort, notices and persistence. Runtime resolution is unchanged; stored values
need no migration.
