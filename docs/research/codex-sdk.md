# Research - OpenAI Codex SDK and CLI

Captured 2026-10-02. Sources: the `openai/codex` repository (`sdk/typescript/package.json` and `README.md`), OpenAI Codex configuration docs, and secondary write-ups. Items marked **verify** must be confirmed against the pinned SDK version during M4 and this file updated.

## Package facts (verified)

- Package `@openai/codex-sdk`, licence Apache-2.0, engines `node >= 18`.
- The SDK does not list `@openai/codex` as a dependency. It spawns the `codex` CLI found on the machine and exchanges JSONL events with it over stdin and stdout. The CLI must be installed separately.
- The Codex CLI itself is Apache-2.0.

## Client and thread API (verified from the README)

- `new Codex({ env, baseUrl, config, configOverrides })`
  - `config`: a JSON object flattened to dotted config keys, equivalent to `config.toml` entries.
  - `configOverrides`: raw TOML override lines.
- `codex.startThread({ workingDirectory, skipGitRepoCheck })`.
- `codex.resumeThread(threadId)`. Threads are persisted under `~/.codex/sessions`.
- `thread.run(prompt, { outputSchema })` and `thread.runStreamed(prompt, { outputSchema })`.
- `runStreamed` yields events including `item.completed` with an `item` and `turn.completed` with `usage`.
- The run result contains `finalResponse`, `items`, and `usage`.

## Configuration keys (from Codex docs)

- `model`: model id.
- `model_reasoning_effort`: `minimal`, `low`, `medium`, `high`, `xhigh`. Also settable per session with the `-e` CLI flag or `--config model_reasoning_effort=...`.
- `sandbox_mode`: **verify** exact values; CLI documents `read-only`, `workspace-write`, `danger-full-access`.
- `approval_policy`: **verify** values.
- `mcp_servers.<name>`: MCP server definitions in `config.toml`.
- Network access and web search flags: **verify** key names.

## Per-thread options possibly available (verify)

Secondary sources describe per-thread configuration for `model`, `sandboxMode`, `modelReasoningEffort`, `approvalPolicy`, `networkAccessEnabled`, and `webSearchEnabled`. The README fetched on 2026-10-02 documented only `workingDirectory` and `skipGitRepoCheck`. Use `config` dotted keys until confirmed.

## Event and item types (verify)

Expected item types from the CLI protocol: agent message, reasoning summary, command execution, file change, MCP tool call, web search, todo list, error. Expected event types: thread started, turn started, item started, item updated, item completed, turn completed, turn failed, error. Confirm and encode as a Zod schema in the adapter.

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
- Cancellation means aborting the SDK call and killing the CLI process tree.
