# ADR-0065 - Codex loop turns inherit configured plugins

Date: 2026-11-07. Status: accepted (owner direction D2/D3; #439).

## Context

ADR-0063 switched off personal extensions for unattended loop turns. On 2026-11-07 the owner accepted familiar Codex defaults for D2: the settings that GraphGoblin does not explicitly control, installed skills, and personal instructions remain inherited. D3 extends that direction to the user's configured plugins. Inheriting the effective configuration must respect disabled plugins and a disabled plugin feature; it does not mean enabling every installed plugin.

The pinned SDK and CLI are 0.160.0. The CLI resolves user and trusted project configuration for its invocation. GraphGoblin should use that resolution rather than parse, copy or rewrite the user's plugin configuration. The SDK exposes no `--profile` selector, and this change adds none. CLI 0.160.0 refuses the legacy root `profile` setting with instructions to use `--profile` and a separate profile file; GraphGoblin preserves that refusal rather than silently choosing another configuration.

## Decision

Codex turns no longer inject a default for `features.plugins`. The CLI resolves the configured plugin set, including each plugin's settings and enabled/disabled state, in the same environment and working directory as the turn. Plugin-provided MCP tools and services may load with an enabled plugin. This applies to fresh and resumed inference turns and the common adapter used for structured decisions.

An inference node may opt out of all plugins by adding `"features":{"plugins":false}` to its existing `harnessOptions.configOverrides`. This applies to its inference turns, resumes and same-session output-schema repairs. Its existing explicit `true` override still enables the plugin feature, but individually disabled plugins stay disabled. The SDK's explicit model, effort, sandbox, approval, network and web-search options still take precedence over raw overrides. Existing key validation and pre-submission refusal behavior remain. Plugin IDs contain `@`, which that key validation rejects, so a node cannot select or disable one individual plugin through these overrides.

LLM decisions and `coerce`/output-transform repairs use separate `CodexStructured` calls. Their current engine callers pass neither node `configOverrides` nor a working directory, so they start in a fresh temporary directory and inherit user/global Codex configuration, not the caller's inference-node override or its trusted-project layer. To disable plugins for those calls, disable the feature or the individual plugin in the effective user/global Codex configuration; this also affects ordinary Codex sessions. An inference node's explicit feature enable can override a user feature disable, while an individually disabled plugin stays disabled. No new structured-call option or profile selector is introduced.

Standalone MCP discovery remains separate: `codex mcp list --json` runs with `features.plugins=false` as well as the other isolation switches. Only the standalone servers that this listing returns receive `mcp_servers.<name>.enabled=false` in the turn. The discovery-only plugin switch is never copied to execution. A node can still enable a standalone server through its existing config override.

The defaults for independently configured MCP servers, ChatGPT apps, memories, hooks, goals, sub-agents and `notify` remain as in ADR-0063. D2 confirms inheritance of other ordinary settings, skills and personal `AGENTS.md`; it does not remove those explicit isolation defaults. Claude's separate launch policy and a plugin picker are outside this decision.

## Verification and consequences

The [native fixture record](../qa/2026-11-07-439-plugin-inheritance/README.md) uses a disposable Codex home and local marketplace, a harmless MCP tool, the actual SDK/CLI worker and a local Responses endpoint. Its tool-execution evidence establishes availability in the worker, beyond arguments or a process snapshot. No owner configuration, credentials or store are needed.

Existing loops now receive enabled configured plugins automatically, including subsequent turns of older pinned runs and paused runs resumed after upgrading. Add the inference override above to retain plugin opt-out for inference sessions; separate structured calls require the user/global configuration change described above. No stored format or schema changes. Effective plugin behavior can change when the user changes their Codex configuration or installed plugins, as in their ordinary Codex sessions.

The inherited GraphGoblin plugin can connect to the gateway itself: its MCP server defaults to `http://127.0.0.1:4747`, and an API that does not require keys treats a keyless request as the local owner. Its tools can read and control runs, subject to the CLI's tool policy and the gateway's authentication/scopes. Recursive run starts and effects on other runs are therefore source-reachable possibilities. A read-only command sandbox does not restrict that service authority or guarantee side-effect-free inference, decisions or repairs. The native fixture verified only a harmless read-only-annotated echo tool, not GraphGoblin mutations or recursive runs against the owner's gateway.

To restrict this authority, disable the GraphGoblin plugin in effective user/global Codex configuration, or deliberately configure gateway authentication and scoped plugin credentials. Requiring API keys alone does not reduce the authority of a valid inherited wildcard key. The owner direction recorded above authorizes normal configured-plugin inheritance; these service-authority consequences are source observations documented by this change.

CLI-reported configuration errors stop the turn with the existing actionable refusal. Inheritance does not validate installed packages: CLI 0.160.0 silently ignores unknown configured plugin IDs and skips a missing plugin MCP file. A successful turn therefore does not establish that every configured plugin is healthy. The native record preserves both cases; broader diagnostics are tracked in [#442](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/442), rather than adding a plugin inventory or filesystem validator to this adapter change.

This supersedes only ADR-0063's Codex plugin-off default and resolves its open D2 question about ordinary defaults, skills and personal instructions. The rest of ADR-0063 remains in force.
