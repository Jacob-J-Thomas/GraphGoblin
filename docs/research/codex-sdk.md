# Research - OpenAI Codex SDK and CLI

Captured 2026-10-02. Sources: the `openai/codex` repository, OpenAI Codex configuration docs, and secondary write-ups. Everything below was re-verified during M4 (WP-B) against the pinned `@openai/codex-sdk` 0.160.0 (`dist/index.d.ts` and `dist/index.js`), `codex exec --help` of CLI 0.160.0, and real sessions on the development machine.

## Package facts (verified 2026-10-02, SDK 0.160.0)

- Package `@openai/codex-sdk`, licence Apache-2.0, engines `node >= 18`, pinned exactly (`"0.160.0"`) in `packages/adapter-codex`.
- **Correction:** the SDK now depends on `@openai/codex` at the same version (Apache-2.0), whose optional per-platform package (`@openai/codex-win32-x64` and so on) carries the native CLI, about 430 MB on Windows. With no `codexPathOverride`, the SDK runs that bundled binary, not the `codex` on `PATH`. Both read the same `~/.codex` login. The adapter's `codexBinary` option overrides the binary.
- The SDK spawns `codex exec --experimental-json [flags] [resume <id>]` with `child_process.spawn(binary, args, { env, signal })`, writes the prompt to stdin, and reads JSONL from stdout. It does not set `windowsHide` or `detached`, and it does not expose the child process or its pid.
- The SDK's `.d.ts` imports `@modelcontextprotocol/sdk/types.js`, which it lists only as a dev dependency; with `skipLibCheck: true` (the repository default) the unresolved type is harmless.

## Client and thread API (verified)

- `new Codex({ codexPathOverride, baseUrl, apiKey, config, configOverrides, env })`
  - `config`: a JSON object flattened to dotted `--config key=value` arguments with TOML literals (strings JSON-quoted, numbers, booleans, arrays, inline tables). `null`, non-finite numbers, and other types throw.
  - `configOverrides`: raw `key=value` strings passed as `--config` after `config`.
  - `env`: when given, replaces (does not extend) the inherited environment.
- `codex.startThread(options?)` and `codex.resumeThread(id, options?)` both take `ThreadOptions`.
- `thread.runStreamed(input, { outputSchema?, signal? })` returns `{ events: AsyncGenerator<ThreadEvent> }`; `thread.run` returns `{ items, finalResponse, usage }`. The output schema is written to a temporary file and passed as `--output-schema`.

## Per-thread options (verified) and the CLI arguments they become

| `ThreadOptions`         | CLI argument                                             | Accepted values                                                                     |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `model`                 | `--model <id>`                                           | any model id                                                                        |
| `modelReasoningEffort`  | `--config model_reasoning_effort="<v>"`                  | SDK type: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`, `persistent` |
| `sandboxMode`           | `--sandbox <v>`                                          | `read-only`, `workspace-write`, `danger-full-access`                                |
| `approvalPolicy`        | `--config approval_policy="<v>"`                         | `never`, `on-request`, `on-failure`, `untrusted`                                    |
| `networkAccessEnabled`  | `--config sandbox_workspace_write.network_access=<bool>` | boolean; only meaningful with `workspace-write`                                     |
| `webSearchMode`         | `--config web_search="<v>"`                              | `disabled`, `cached`, `live`                                                        |
| `webSearchEnabled`      | `--config web_search="live"` or `"disabled"`             | boolean; ignored when `webSearchMode` is set                                        |
| `workingDirectory`      | `--cd <dir>`                                             | path                                                                                |
| `skipGitRepoCheck`      | `--skip-git-repo-check`                                  | boolean                                                                             |
| `additionalDirectories` | `--add-dir <dir>` (repeated)                             | paths                                                                               |
| `threadSource`          | `--thread-source <v>` (new threads only)                 | string                                                                              |

Thread options are emitted after `config` and `configOverrides`, so they win over both and over `config.toml`. The adapter therefore uses thread options for every behaviour-affecting setting and `config` only for `harnessOptions.configOverrides`. The adapter maps the canonical effort `max` to `xhigh`, the highest level the research and the CLI docs confirm; the SDK type also lists `max`, `ultra`, and `persistent`, which were not tested.

Unknown `--config` keys are accepted but produce a warning item ("Codex is ignoring 1 unrecognized configuration setting"), so the adapter adds no marker keys of its own.

## Event and item types (verified)

`ThreadEvent` is `thread.started` (`thread_id`), `turn.started`, `turn.completed` (`usage`), `turn.failed` (`error.message`), `item.started`, `item.updated`, `item.completed` (`item`), and `error` (`message`). `ThreadItem` is `agent_message` (`text`), `reasoning` (`text`), `command_execution` (`command`, `aggregated_output`, `exit_code?`, `status`), `file_change` (`changes[{ path, kind: add|delete|update }]`, `status`), `mcp_tool_call` (`server`, `tool`, `arguments`, `result?`, `error?`, `status`), `web_search` (`query`), `todo_list` (`items[{ text, completed }]`), and `error` (`message`). Usage carries `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, and `reasoning_output_tokens`.

The adapter relies on the SDK's TypeScript types rather than a Zod schema: it reads only the fields above, tolerates unknown event and item types (`other`), and treats missing counters as zero, so a newer CLI that adds types does not break it.

Observed in recordings: `file_change` items are also emitted with `status: "in_progress"` on `item.started`; a resumed thread (`codex exec resume <id>`) emits `thread.started` again with the same id; a failing API call emits a top-level `error` event followed by `turn.failed`, both carrying the API error as a JSON string (`{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"..."}}`), and the CLI exits with code 1.

## Cancellation (verified on Windows)

`runStreamed(input, { signal })` hands the signal to `spawn`, so aborting it kills the CLI process (`TerminateProcess` on Windows). On 2026-10-02 with CLI 0.160.0, aborting mid-turn while Codex was running `powershell -Command "Start-Sleep -Seconds 120; ..."` left no surviving process in either `workspace-write` or `danger-full-access`: Codex runs commands inside a job object that dies with it. The SDK does not expose the pid, so a GraphGoblin-side `taskkill /T /F` is not possible without patching `child_process`; it is also not needed on Windows. POSIX behaviour (SIGTERM to the CLI, which then ends its children) is unverified on this machine.

## Fixtures

`pnpm --filter @graphgoblin/adapter-codex record -- <name> "<prompt>" [--schema f] [--sandbox read-only|workspace-write] [--seed file=text]` runs the bundled CLI with `exec --json --ephemeral --skip-git-repo-check -m gpt-6-luna -c model_reasoning_effort="low" -c approval_policy="never" -c web_search="disabled"` in a fresh temporary directory and writes `fixtures/<name>.jsonl`, replacing home and temporary paths with `<HOME>`, `<TMP>`, and `<WORKDIR>` and appending the exit code as `{"type":"x-recorder.exit"}`. Recorded: `message`, `command-and-file-change` (workspace-write, temporary directory), `structured` (with `fixtures/structured.schema.json`), and `failed-invalid-model`.

## Verified on this machine (2026-10-02, codex-cli 0.160.0, logged in with ChatGPT)

Command used for the smoke test, run from a scratch directory:

```
codex exec -m gpt-6-luna -c 'model_reasoning_effort="low"' -s read-only --skip-git-repo-check --ephemeral --json "Reply with exactly the single word OK and nothing else."
```

JSONL emitted, one object per line:

```
{"type":"thread.started","thread_id":"01a0ff45-..."}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"`[features].collab` is deprecated. Use `[features].multi_agent` instead. ..."}}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"OK"}}
{"type":"turn.completed","usage":{"input_tokens":18572,"cached_input_tokens":12032,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
```

Observations that shape the adapter:

- `thread.started` carries `thread_id`; that is the value to persist in `harness_sessions` for resume.
- Configuration warnings arrive as `item.completed` with `item.type === "error"` and do not stop the turn. The adapter must not treat an `error` item as a failed turn; `turn.failed` is the failure signal.
- `turn.completed.usage` includes `cached_input_tokens` and `reasoning_output_tokens` in addition to input and output tokens.
- The user's global `config.toml` sets `model = "gpt-6.1-sol"`, `model_reasoning_effort = "xhigh"`, `sandbox_mode = "danger-full-access"`, and `approval_policy = "never"`. The adapter must set model, effort, sandbox, and approval explicitly on every session so loop behaviour does not depend on the machine's defaults. `--ignore-user-config` is available if full isolation is needed; auth still works with it.
- The owner's model choice for GraphGoblin development and testing is `gpt-6-luna` at `low` effort. Other model ids seen on this machine: `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-astra`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.5`. These seed the model catalog.
- `codex exec` also offers `--output-schema <FILE>`, `-o/--output-last-message <FILE>`, `--ephemeral`, `--worktree`, `--add-dir`, `--cd`, and `resume`/`fork` subcommands. The SDK wraps the same protocol.

## Platform

- Windows: native Windows support with a Windows-native sandbox since March 2026, distributed through the Microsoft Store and npm. Windows 11 is the recommended baseline.
- Plugins: since CLI 0.117.0 (March 2026) plugins bundle skills, MCP server configs, and app connectors into one installable unit. Skills use the `SKILL.md` format. MCP servers in a plugin are declared in a `.mcp.json` with the same format as `.codex/mcp.json`. Verified details are in "Plugins and MCP configuration (verified)" below.

## Plugins and MCP configuration (verified 2026-10-02, codex-cli 0.160.0)

Sources: `codex plugin --help`, `codex mcp --help`, the plugins installed under `~/.codex/plugins/cache` and `~/.codex/.tmp/bundled-marketplaces` (OpenAI's `code-review`, `codex-app-tools`, `unified-computer-use`, and the owner's `living-world-aidlc`), and an install of the GraphGoblin plugin into a scratch `CODEX_HOME`.

- **Plugin root**: `.codex-plugin/plugin.json` is the manifest: `name`, `version`, `description`, `author.name`, optional `license`, `keywords`, `homepage`, `repository`, `"skills": "./skills/"`, `"mcpServers": "./.mcp.json"`, optional `hooks`, and `interface` (`displayName`, `shortDescription`, `longDescription`, `developerName`, `category`, `capabilities`, `defaultPrompt[]`, `brandColor`, `composerIcon`, `logo`).
- **Skills**: `skills/<name>/SKILL.md` with YAML frontmatter `name` and `description`; an optional `skills/<name>/agents/openai.yaml` sets `interface.display_name`, `short_description`, and `default_prompt`. Users invoke a skill as `$<name>`.
- **MCP servers**: `.mcp.json` is `{ "mcpServers": { "<name>": { ... } } }` with the keys of a `[mcp_servers.<name>]` table in `config.toml`: `command`, `args`, `cwd` (relative to the plugin root), `env` (literal values), `env_vars` (names passed through from Codex's environment), `enabled`, `startup_timeout_sec`, `tool_timeout_sec`, `enabled_tools`, `default_tools_approval_mode`, and per-tool `tools.<tool>.approval_mode`.
- **Marketplaces**: a marketplace is a directory with `.agents/plugins/marketplace.json`: `{ "name", "interface": { "displayName" }, "plugins": [{ "name", "source": { "source": "local", "path": "./plugins/<name>" }, "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" }, "category" }] }`. `~/.agents/plugins/marketplace.json` is the personal marketplace (root `~`). `codex plugin marketplace add <path | owner/repo[@ref] | git URL>` registers one (`[marketplaces.<name>]` in `config.toml`); `codex plugin add <plugin>@<marketplace>` installs (`[plugins."<plugin>@<marketplace>"] enabled = true`); `codex plugin list` and `codex plugin remove` complete the set.
- **Install copies**: an installed plugin is copied to `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/`, so paths outside the plugin must be absolute. GraphGoblin's build writes the absolute `apps/mcp/dist/main.js` path into the assembled `.mcp.json`. After install, `codex mcp list` shows the plugin's server alongside the user's own.
- **Per-session MCP servers**: `codex exec` accepts `-c mcp_servers.<name>.command="node"`, `-c "mcp_servers.<name>.args=['<path>']"` (TOML literal strings avoid escaping Windows backslashes), and `-c 'mcp_servers.<name>.env={GG_API_URL="http://127.0.0.1:4747"}'`. With `--ignore-user-config` the user's servers and plugins are not loaded and authentication still works. `-c approval_policy="never"` with `-c mcp_servers.<name>.default_tools_approval_mode="approve"` let MCP tools run unattended (the live check passed both; which one is strictly required was not isolated). `codex mcp add <name> [--env K=V] -- <command...>` (stdio) or `--url <url> [--bearer-token-env-var VAR]` (Streamable HTTP) persists a server.
- **JSONL**: MCP calls appear as `item.started` and `item.completed` with `item.type: "mcp_tool_call"`, `server`, `tool`, `arguments`, `result: { content, structured_content }`, `error`, and `status` (`in_progress`, `completed`).

## Authentication

Codex CLI supports ChatGPT subscription login and API-key login. GraphGoblin relies on whatever `codex login` configured. See ADR-0011.

## Implications for the adapter

- Structured output is native; GraphGoblin still validates and applies its repair policy.
- Threads resume by id, which is the basis for crash recovery and the `resume-previous` and `resume-named` session policies.
- Usage arrives per turn; record it as `harness.usage`.
- Cancellation aborts the SDK call; the CLI and the commands it runs end with it (see "Cancellation" above).
