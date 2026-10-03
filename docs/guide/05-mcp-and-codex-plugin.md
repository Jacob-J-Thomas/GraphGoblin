# Use MCP and the Codex plugin

## Start the MCP server

Start the [API](01-install-and-first-run.md) first. MCP is a client of that API, so it needs the gateway to remain running. From the built repository root, start stdio transport:

```powershell
$env:GG_API_URL = 'http://127.0.0.1:4747'
node apps/mcp/dist/main.js
```

An MCP client normally launches that command and exchanges protocol messages over stdin/stdout. Diagnostics go to stderr. In API-key mode, set `GG_API_KEY` in the MCP client's environment to your saved token; it becomes a bearer header on gateway requests. It is optional in local trusted mode. CLI flags override environment settings:

```powershell
node apps/mcp/dist/main.js --api-url http://127.0.0.1:4747
```

For Streamable HTTP, start a separate local MCP listener:

```powershell
node apps/mcp/dist/main.js --http --host 127.0.0.1 --port 4748
```

Configure your client to use this endpoint:

```text
http://127.0.0.1:4748/mcp
```

HTTP accepts POST only and is stateless, with a fresh transport per request; GET and DELETE return 405. When bound to loopback it rejects non-loopback Host headers with 403. `GG_MCP_HOST` and `GG_MCP_PORT` supply defaults for the host and port flags. Keep this listener on localhost: `GG_API_KEY` authenticates its outbound API requests, not callers of the MCP HTTP endpoint.

## Choose a tool

| Tool | Use it to |
| --- | --- |
| `list_loops` | Find loops by optional name/description query and see their publish state. |
| `describe_loop` | Inspect triggers, input schemas, input waits, and exit mappings before a start. |
| `start_run` | Start a manual trigger and return its run ID immediately. |
| `wait_for_run` | Wait for completion, or return early for input or a pause. |
| `get_run` | Read status, current node, waiting spec, result, and failure. |
| `get_run_thread` | Read current messages, variables, outputs, artifacts, and usage. |
| `list_runs` | Find recent runs by loop, status, or parent; page with `nextBefore`. |
| `read_run_events` | Read an event page after a sequence cursor and continue with `nextAfter`. |
| `cancel_run` | Request cancellation and then check that the run stops. |
| `pause_run` | Hold execution at a node boundary. |
| `resume_run` | Continue a paused run or retry a failed run through the same API action. |
| `provide_input` | Supply schema-valid input to an input wait. |
| `send_signal` | Send a named signal with an optional payload; inspect `woke`. |

`describe_loop` and `start_run` accept a loop ID or an exact, case-insensitive name. Use IDs when names are duplicated. `start_run` accepts `input`, optional `triggerNodeId`, and `allowDraft` for an unpublished loop.

`wait_for_run` defaults to 60 seconds and accepts up to 600. A timeout returns `finished` false, the status, a cursor, and a suggested next action; call it again with the same run ID. For an input wait, read the prompt and schema, call `provide_input`, then wait again. For a paused run, resume when authorised. A terminal result has `finished` true and the run snapshot.

Resources expose the log and thread through these templates:

```text
graphgoblin://runs/{id}/events
graphgoblin://runs/{id}/thread
```

The event resource stops at 10,000 events and supplies `truncated` and `nextAfter`; use event pages for longer logs. Tool errors include an API code and HTTP status, or `NETWORK_ERROR` when the gateway cannot be reached.

## Install the built Codex plugin

After the repository build, install from its generated local marketplace. Run from the repository root in PowerShell:

```powershell
$marketplacePath = (Resolve-Path 'apps/plugin-codex/dist/marketplace').Path
codex plugin marketplace add "$marketplacePath"
codex plugin add graphgoblin@graphgoblin-local
codex mcp list
```

The marketplace and MCP entry are:

```text
apps/plugin-codex/dist/marketplace/
apps/mcp/dist/main.js
```

The build embeds the absolute MCP entry path because Codex copies plugins into its cache. Keep the checkout at that location. If you move it or change plugin contents, reassemble from the built code and reinstall the cached plugin:

```powershell
pnpm --filter @graphgoblin/plugin-codex assemble
codex plugin add graphgoblin@graphgoblin-local
```

Set `GG_API_URL` and, when required, `GG_API_KEY` before starting Codex. The plugin passes those variables to MCP. Its MCP tool timeout is 660 seconds to accommodate the longest wait call.

## Invoke a skill

| Skill | Use it when |
| --- | --- |
| [run-loop](../../apps/plugin-codex/plugin/graphgoblin/skills/run-loop/SKILL.md) | Start a named loop, build input from its schema, answer requested input, wait, and report its result. |
| [design-loop](../../apps/plugin-codex/plugin/graphgoblin/skills/design-loop/SKILL.md) | Draft or change a definition, validate through REST, and save a draft. It publishes only when explicitly asked. |
| [inspect-run](../../apps/plugin-codex/plugin/graphgoblin/skills/inspect-run/SKILL.md) | Explain a run from its snapshot, events, and thread. It changes the run only when asked. |

Use this prompt after importing and publishing the [example loop](02-build-a-loop.md#import-a-complete-first-loop):

```text
Use $run-loop to run first-summary with topic "event-sourced workflows".
Describe the loop first, start it, and keep calling wait_for_run until it finishes.
If it asks for input, show me the prompt. Report the returned summary and run ID.
```

The run and inspection skills use MCP. The design skill uses REST for editing because the tool list covers run operations rather than graph editing. See [API, streaming, and MCP](../07-api-and-streaming.md) for implementation context.

Continue with [Settings and secrets](06-settings-and-secrets.md).
