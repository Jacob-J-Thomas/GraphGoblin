# ADR-0065 - Codex loop turns inherit configured plugins

Date: 2026-11-07. Status: accepted (owner direction D2/D3; #439).

## Context

ADR-0063 switched off personal extensions for unattended loop turns. On 2026-11-07 the owner accepted familiar Codex defaults for D2: the settings that GraphGoblin does not explicitly control, installed skills, and personal instructions remain inherited. D3 extends that direction to the user's configured plugins. Inheriting the effective configuration must respect disabled plugins and a disabled plugin feature; it does not mean enabling every installed plugin.

The pinned SDK and CLI are 0.160.0. The CLI resolves user and trusted project configuration for its invocation. GraphGoblin should use that resolution rather than parse, copy or rewrite the user's plugin configuration. The SDK exposes no `--profile` selector, and this change adds none. CLI 0.160.0 refuses the legacy root `profile` setting with instructions to use `--profile` and a separate profile file; GraphGoblin preserves that refusal rather than silently choosing another configuration.

## Decision

Codex turns no longer inject a default for `features.plugins`. The CLI resolves the configured plugin set, including each plugin's settings and enabled/disabled state, in the same environment and working directory as the turn. Plugin-provided MCP tools and services may load with an enabled plugin. This applies to fresh and resumed inference turns and the common adapter used for structured decisions.

A node may opt out with `harnessOptions.configOverrides = {"features":{"plugins":false}}`. Its existing explicit `true` override still enables the plugin feature, but individually disabled plugins stay disabled. The SDK's explicit model, effort, sandbox, approval, network and web-search options still take precedence over raw overrides. Existing key validation and pre-submission refusal behavior remain.

Standalone MCP discovery remains separate: `codex mcp list --json` runs with `features.plugins=false` as well as the other isolation switches. Only the standalone servers that this listing returns receive `mcp_servers.<name>.enabled=false` in the turn. The discovery-only plugin switch is never copied to execution. A node can still enable a standalone server through its existing config override.

The defaults for independently configured MCP servers, ChatGPT apps, memories, hooks, goals, sub-agents and `notify` remain as in ADR-0063. D2 confirms inheritance of other ordinary settings, skills and personal `AGENTS.md`; it does not remove those explicit isolation defaults. Claude's separate launch policy and a plugin picker are outside this decision.

## Verification and consequences

The [native fixture record](../qa/2026-11-07-439-plugin-inheritance/README.md) uses a disposable Codex home and local marketplace, a harmless MCP tool, the actual SDK/CLI worker and a local Responses endpoint. Its tool-execution evidence establishes availability in the worker, beyond arguments or a process snapshot. No owner configuration, credentials or store are needed.

Existing loops now receive enabled configured plugins automatically. To retain the previous plugin opt-out, set `features.plugins=false` per node. No stored format or schema changes. Effective plugin behavior can change when the user changes their Codex configuration or installed plugins, as in their ordinary Codex sessions.

CLI-reported configuration errors stop the turn with the existing actionable refusal. Inheritance does not validate installed packages: CLI 0.160.0 silently ignores unknown configured plugin IDs and skips a missing plugin MCP file. A successful turn therefore does not establish that every configured plugin is healthy. The native record preserves both cases; broader diagnostics are tracked in [#442](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/442), rather than adding a plugin inventory or filesystem validator to this adapter change.

This supersedes only ADR-0063's Codex plugin-off default and resolves its open D2 question about ordinary defaults, skills and personal instructions. The rest of ADR-0063 remains in force.
