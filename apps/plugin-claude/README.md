# GraphGoblin for Claude Code

Use the local plugin to design and validate a loop draft, run a loop you explicitly request, and inspect its result and events. Launch Claude Code with the plugin after building GraphGoblin and starting its API gateway. Claude Code owns the plugin's stdio MCP process for that session.

The plugin is for a Claude Code session you launch to control GraphGoblin. GraphGoblin's Claude harness for inference turns runs with personal extensions disabled.

## Run from a local build

From the GraphGoblin checkout, use Node 22.22.2 or later in major 22 and the repository-pinned pnpm. The verified platform is Windows with Claude Code 2.1.311.

```powershell
pnpm.cmd build
$pluginPath = (Resolve-Path 'apps/plugin-claude/dist/plugin/graphgoblin').Path
claude plugin validate --strict $pluginPath
claude --plugin-dir $pluginPath
```

For a Bash shell, the equivalent commands are below. Native macOS verification is pending.

```bash
pnpm build
plugin_path="$PWD/apps/plugin-claude/dist/plugin/graphgoblin"
claude plugin validate --strict "$plugin_path"
claude --plugin-dir "$plugin_path"
```

Claude inherits `GG_API_URL` (default `http://127.0.0.1:4747`) and the optional `GG_API_KEY` from the environment you launch it in. Authoring needs `loops:write`. Starting a run needs loop read access and `runs:write`. Inspecting a specific run needs `runs:read`. Set the variables in your launching process and keep the API key out of Claude settings, skill arguments, and generated files.

If your shell has a different Node first on PATH, set `GG_NODE_BINARY` to the full path of the supported Node executable before launching Claude. To see the runtime guard's diagnostic, invoke the registered MCP command directly in PowerShell:

```powershell
$pluginPath = (Resolve-Path 'apps/plugin-claude/dist/plugin/graphgoblin').Path
$mcpEntry = (Resolve-Path 'apps/mcp/dist/main.js').Path
$node = if ($env:GG_NODE_BINARY) { $env:GG_NODE_BINARY } else { (Get-Command node).Source }
& $node --require (Join-Path $pluginPath 'check-runtime.cjs') $mcpEntry --draft-tools
```

This uses the same preload and arguments as the generated plugin configuration. A successful guard leaves the MCP server attached to stdio; stop it with Ctrl+C. `claude --plugin-dir <path> mcp list` reports a connection failure without showing the guard's diagnostic. Tool failures report gateway reachability and authorization separately.

## Invoke a skill

- `/graphgoblin:design-loop draft a manual loop that returns "hello"` saves and validates a draft.
- `/graphgoblin:run-loop run that unpublished draft of a loop with no published version` starts the draft after explicit authorization and waits for its result.
- `/graphgoblin:inspect-run <run ID>` reports the run's outcome, path, and result from its events.

`allowDraft: true` only permits execution when a loop has no published version; it cannot select a newer draft of a published loop. Explain this limitation and do not run the published version in its place unless the user explicitly confirms running it.

## Install locally and refresh

`--plugin-dir` loads the artifact for one session. To load it in every local session, explicitly copy the generated `graphgoblin` folder intact into `~/.claude/skills/` or `$CLAUDE_CONFIG_DIR/skills/` if configured. Use an unused target. Start a new Claude Code session and check `claude plugin list` for `graphgoblin@skills-dir`.

The copied artifact uses the absolute path to the built MCP entry in your checkout. If you move that checkout, build at the new location. To refresh an installed copy, inspect and move the prior `graphgoblin` folder aside, copy the refreshed artifact into its place, and start a new Claude Code session. To remove it, move the installed copy out of your skills directory. These operations concern only the explicitly selected plugin directory.

If your chosen Node executable moves, update `GG_NODE_BINARY` or your PATH and restart Claude. Rebuilding defaults to `apps/plugin-claude/dist/plugin/graphgoblin`. An existing output must be empty or match its complete generated inventory. To select a fresh destination after a refusal, run `pnpm --filter @graphgoblin/plugin-claude assemble --out <absolute-path>` with the workspace built. The `--out` path must be absolute because package scripts resolve relative paths from `apps/plugin-claude`.
