# Research - Claude Code and the Claude Agent SDK

Captured 2026-10-02 from the official docs at code.claude.com. Preserved for the post-1.0 Claude Code adapter. Re-verify before implementation; this product moves quickly.

## Licence and packaging

- `@anthropic-ai/claude-agent-sdk` (TypeScript) and `claude-agent-sdk` (Python) are governed by Anthropic's Commercial Terms of Service. They are not open source.
- Both SDKs are wrappers that invoke the Claude Code CLI as a subprocess. The CLI must be installed separately.
- Source: https://code.claude.com/docs/en/agent-sdk/overview.md

## Authentication and billing

- The SDK works with OAuth credentials from `claude login` (Pro, Max, Team, Enterprise) or an API key.
- Anthropic does not allow third-party developers to offer claude.ai login or rate limits in their products, including agents built on the Agent SDK. The documented recommendation for products is API-key authentication.
- Consequence for GraphGoblin: a single-user laptop install can use the user's own login; a hosted product cannot.

## Sessions

- Resume with `resume: "<session-id>"`; discover with `listSessions()` and `getSessionInfo()`. CLI: `--continue`, `--resume <id>`.
- Forking exists on the CLI (`--fork-session`, `/branch`); the SDK exposes `getSessionMessages()` to read history and start a new session from it.
- No way to inject arbitrary conversation history. Only resume, system prompt, prompt text, and project files such as `CLAUDE.md`.

## Structured output

- CLI only: `claude -p --output-format json --json-schema '<schema>'` returns a `structured_output` field.
- The SDKs do not expose a structured-output option. A Claude adapter either drives the CLI directly for schema-enforced turns or relies on GraphGoblin's own validation and repair.

## Model and effort

- `model` option; CLI `--model`.
- `effort`: `low`, `medium`, `high`, `xhigh`, `max`; CLI `--effort` (Claude Code 2.1.205+). A `thinking` config also exists.

## Extensibility options

| Feature             | TypeScript option                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP servers         | `mcpServers: Record<string, McpServerConfig>`; stdio, `http` (Streamable HTTP), and in-process SDK servers via `createSdkMcpServer()` and `tool()` |
| Tools               | `tools`, `allowedTools`, `disallowedTools`, wildcards like `mcp__server__*`                                                                        |
| Permissions         | `permissionMode`: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto`; `canUseTool` callback                                  |
| System prompt       | `systemPrompt` string or `{ type: 'preset', preset: 'claude_code', append }`                                                                       |
| Skills and settings | `settingSources: ['project', 'user']` loads `.claude/skills` and `~/.claude/skills`                                                                |
| Working directory   | `cwd`                                                                                                                                              |
| Limits              | `maxTurns`, `maxBudgetUsd`                                                                                                                         |
| Hooks               | `hooks` keyed by event: SessionStart, Setup, PostToolUse, UserPromptSubmit, PermissionRequest                                                      |
| Cancellation        | `abortController`                                                                                                                                  |

## Streaming and results

- `query()` yields system init, assistant, user, result, and stream events when `includePartialMessages` is set.
- The result message includes `result`, `session_id`, `usage`, `total_cost_usd` (client-side estimate), `num_turns`, and `structured_output` when the CLI schema flag was used.

## Compaction

- No SDK control. Compaction is automatic; the CLI has `/compact`. Context usage can be read with `getContextUsage()`.

## Windows

- Native Windows 10 1809+ and Windows 11 supported. Git for Windows is recommended for the Bash tool; otherwise PowerShell is used. Sandboxing is available only under WSL 2.

## Headless CLI flags of interest

`--output-format text|json|stream-json`, `--input-format stream-json`, `--json-schema`, `--resume`, `--continue`, `--max-turns`, `--permission-mode`, `--allowedTools`, `--mcp-config`, `--model`, `--effort`, `--append-system-prompt`, `--system-prompt-file`, `--bare` (skip auto-discovery of hooks, skills, MCP, CLAUDE.md), `--include-partial-messages`, `--permission-prompt-tool`, `--max-budget-usd`, `--add-dir`, `--plugin-dir`, `--settings`, `--no-session-persistence`.

## What the GraphGoblin harness port already accommodates

- Session start and resume by id.
- Model and effort with a per-harness mapping table; Claude has `max`, Codex has `minimal`.
- Context injection by prompt, system-prompt addition, and workspace files.
- Structured output either native or through GraphGoblin validation and repair.
- Cancellation through an abort signal and process-tree kill.
- Usage reporting as informational events.
