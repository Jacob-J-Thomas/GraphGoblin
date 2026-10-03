# GraphGoblin plugin for Codex

Drive GraphGoblin loops from a Codex session. The plugin registers the GraphGoblin MCP server (`apps/mcp`) and ships three skills:

| Skill          | Use it to                                                                                |
| -------------- | ---------------------------------------------------------------------------------------- |
| `$run-loop`    | Start a named loop with input, wait for it (answering input requests), report the result |
| `$design-loop` | Draft a loop definition from a description, validate it, and save it as a draft          |
| `$inspect-run` | Summarise a run's event log and context thread                                           |

## Layout

```
plugin/graphgoblin/
  .codex-plugin/plugin.json      manifest: name, version, "skills": "./skills/", "mcpServers": "./.mcp.json", interface
  .mcp.json                      { "mcpServers": { "graphgoblin": { command, args, env_vars, timeouts } } }
  skills/<name>/SKILL.md         frontmatter name + description, then instructions
```

Codex copies an installed plugin into its cache (`~/.codex/plugins/cache/<marketplace>/<plugin>/<version>`), so the MCP server path must be absolute. The source `.mcp.json` holds the placeholder `${GRAPHGOBLIN_MCP_ENTRY}`; the build assembles a local marketplace under `dist/marketplace` with the absolute path of `apps/mcp/dist/main.js` filled in.

## Install

Requires Node 22+, the Codex CLI (0.117.0 or later; verified with 0.160.0), and a built repository.

```
pnpm install
pnpm build                                   # builds apps/mcp and assembles apps/plugin-codex/dist/marketplace
codex plugin marketplace add <repo>/apps/plugin-codex/dist/marketplace
codex plugin add graphgoblin@graphgoblin-local
codex mcp list                               # shows graphgoblin: node <repo>/apps/mcp/dist/main.js
```

Start the API (`pnpm --filter @graphgoblin/api start`, default `http://127.0.0.1:4747`). The MCP server reads `GG_API_URL` and `GG_API_KEY` from the environment Codex was started in (`env_vars` passes them through); neither is needed for a local API in trusted mode. Then, in Codex: `Use $run-loop to run <loop name>`.

After rebuilding, run `pnpm --filter @graphgoblin/plugin-codex assemble` (part of `build`) and reinstall with `codex plugin add` to refresh the cached copy. Remove with `codex plugin remove graphgoblin@graphgoblin-local` and `codex plugin marketplace remove graphgoblin-local`.

## Without the plugin

Register only the MCP server:

```
codex mcp add graphgoblin --env GG_API_URL=http://127.0.0.1:4747 -- node <repo>/apps/mcp/dist/main.js
```

or for a single session:

```
codex exec -c 'mcp_servers.graphgoblin.command="node"' -c "mcp_servers.graphgoblin.args=['<repo>/apps/mcp/dist/main.js']" -c 'mcp_servers.graphgoblin.env={GG_API_URL="http://127.0.0.1:4747"}' "List my GraphGoblin loops"
```

## Tests

`pnpm --filter @graphgoblin/plugin-codex test` validates the manifest, `.mcp.json`, and every `SKILL.md`, and assembles the marketplace into a temporary directory. `LIVE=1` adds one real Codex session (model `gpt-6-luna`, `low` effort) against an in-process API with the fake harness; it needs `pnpm build` first.
