# ADR-0063 - Loop turns run without the machine's personal extensions

Date: 2026-10-28. Status: accepted (owner decision 2026-10-27, option A; #423).

## Context

The final integrated check found every real Codex loop turn starting the machine's own Codex extensions inside the turn's process tree: `node_repl.exe`, plugin MCP servers under `node.exe` and `cmd.exe` ([F2 record](../qa/2026-10-27-final-f2-live/README.md), observation O1). They come from the user's `~/.codex/config.toml`, which the CLI loads for every invocation: `[mcp_servers.*]`, `[plugins.*]` and marketplaces, `[features]` such as `memories` and `apps`, and a `notify` program. [docs/06](../06-harness-integration.md) said per-thread options keep the machine's `config.toml` defaults from leaking into a loop. That held for model, effort, sandbox and approval, not for extensions.

The owner chose option A: loop turns switch off inherited plugins, MCP servers and personal features by default, and a node's existing Codex `configOverrides` stay the way to turn a specific server back on. Option B, a separate Codex home for loops, was not chosen.

## What the pinned CLI allows

Verified on Codex CLI 0.160.0 with dry runs that reach no provider ([WP-423 record](../qa/2026-10-28-wp-423-isolation/README.md)):

- `--config` overrides merge into the loaded tables. `mcp_servers={}`, `plugins={}` and `marketplaces={}` clear nothing; a non-table value such as `mcp_servers=[]` fails the configuration.
- `mcp_servers.<name>.enabled=false` switches one server off. Naming a server that is not configured fails the configuration (`invalid transport`), so the names must come from the configuration the CLI actually loads.
- `features.plugins=false` removes every local and remote plugin, the MCP servers they bring and their marketplaces. A single plugin cannot be enabled while the feature is off. `plugins.<id>.enabled` works only unquoted, because the CLI splits `--config` keys on dots.
- `features.<name>=false` switches a feature off. `notify=[]` replaces the configured program; arrays replace rather than merge.
- Among repeated `--config` keys the last one wins.
- `codex mcp list --json` reads the same layers as a turn, including a trusted project's `.codex/config.toml` from its working directory. `codex exec` reads that project layer from `--cd`.
- `codex exec --ignore-user-config` skips `config.toml` entirely, but the SDK has no option for it.

## Decision

Before each Codex turn, the adapter runs `codex mcp list --json` in the turn's working directory, with the turn's CLI and environment and plugins and apps switched off. The turn then starts with these `--config` arguments, in order:

1. `mcp_servers.<name>.enabled=false` for every server listed.
2. The isolation defaults: `features.plugins=false`, `features.apps=false`, `features.memories=false`, `features.hooks=false`, `features.multi_agent=false`, `features.goals=false` and `notify=[]`.
3. The node's `harnessOptions.configOverrides`, layered key path by key path, with dotted keys read as paths as the CLI reads them.
4. The SDK's thread options (model, effort, sandbox, approval, network access, web search), which no override can weaken.

The switched-off features bring the machine's installs, account connectors or personal state into a turn, or change what an unattended turn can do:

- installed and remote plugins;
- ChatGPT apps;
- the memory store and goals, both personal state;
- lifecycle hook commands;
- sub-agent spawning (`multi_agent`).

On the owner's machine `multi_agent` and `goals` are set in the personal `[features]` table; they are switched off whatever their default (owner decision, 2026-10-28). `notify` is a program the CLI runs after every turn.

A node turns one of the machine's servers back on with `{"mcp_servers": {"<name>": {"enabled": true}}}`, and a server of its own with `mcp_servers.<name>.*` as before. `{"features": {"plugins": true}}` turns all of the machine's plugins back on, and `{"features": {"multi_agent": true}}` sub-agents. The CLI cannot enable a single plugin while the plugin feature is off.

If the listing fails, or a listed name cannot be written as one `--config` key segment, the turn does not start: `HARNESS_TURN_FAILED`, or `HARNESS_NOT_INSTALLED` when the CLI is missing, recorded as definitely not submitted. Starting the turn anyway could start servers the decision excludes. The listing reuses the preflight timeout (15 s by default) and the turn's abort signal.

The Claude adapter already applies the same policy. Its launch flags are `--safe-mode`, `--setting-sources ""` and `--strict-mcp-config`. Its runtime check refuses a session that reports any MCP server, any plugin other than the two CLI built-ins, or any non-bundled skill. CLI 2.1.308's own debug log for a turn with these flags reports claude.ai connectors disabled, installed plugins and their hooks not loaded, 0 hooks registered and skill directory discovery skipped. The owner's user-scope MCP server and claude.ai connectors did not start. No Claude change was needed.

## What a loop turn still inherits

- **Needed for the turn to run.** The machine's login (`auth.json`, or the Claude login), the model catalog and the account's model access, and the CLI's Windows sandbox mode.
- **Built into the CLI, not personal.** The CLI's other features, with the defaults any user gets. This includes the code-mode host (`codex-code-mode-host.exe`), which is the CLI's own tool host, not an extension. It ships in the CLI package beside `codex.exe` and starts when the model runs a tool. With `features.code_mode_host=false`, a real turn ran no shell command at all, so the host stays on.
- **Not covered by this decision.** The rest of `config.toml` that no node setting covers: project trust, model providers and profiles, `service_tier`, `personality`, `shell_environment_policy`, `prevent_idle_sleep`, the skills under `CODEX_HOME`, and the personal `AGENTS.md`. These are open for an owner decision.

## Alternatives not taken

- **Option B**, a separate Codex home: not chosen by the owner.
- **`--ignore-user-config`**: it needs a change to the SDK patch. It also drops settings a turn needs, such as the Windows sandbox mode and project trust.
- **Reading `config.toml` in GraphGoblin**: it would need a TOML parser, would miss other configuration layers and remote plugins, and could name servers the CLI does not load, which fails the turn.
- **Switching off the code-mode host**: the turn then ran no command.

## Consequences

- Each Codex turn, including each structured decision call, adds one short CLI run. It took about 0.1 to 0.5 s in the probes.
- Loops that relied on the machine's MCP servers, plugins or sub-agents must turn them back on per node; the CHANGELOG upgrade note says how.
- **What was and was not verified for `multi_agent` and `goals`.** The CLI accepts both switches (`codex features list` reports them `false`) and receives them in a turn's arguments.
  - **Not verified in a real turn:** whether the model then loses the sub-agent tools. Tools are not part of `codex debug prompt-input`.
  - **What the prompt still shows:** the model-visible context keeps its `multi_agent_role` and `multi_agent_mode` sections with the switch off.
- Codex capability profiles (`capabilities.mcpServers`, `plugins`, `skills`) remain unresolved. They would layer the same way when they land.
