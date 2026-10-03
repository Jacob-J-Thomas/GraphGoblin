# 07 - API, streaming, and MCP

## Principles (Decided)

- Every capability is an HTTP endpoint first. The web app and the MCP server consume the same API through the generated client.
- Zod schemas in `contracts` define request and response bodies. Fastify validates with them and emits OpenAPI 3.1 at `/openapi.json`.
- Commands are REST. State is a snapshot plus an event stream.

## REST surface (Decided)

```
Loops
  GET    /loops                         list
  POST   /loops                         create with an initial draft version
  GET    /loops/{id}                    loop with current published version and draft
  PUT    /loops/{id}/draft              save draft definition (validated, may be unpublishable)
  POST   /loops/{id}/publish            validate and freeze draft as a new version
  GET    /loops/{id}/versions           version history
  GET    /loops/{id}/export             definition as JSON for committing to a repo
  POST   /loops/import                  create or update from exported JSON

Runs
  POST   /loops/{id}/runs               start a run from a manual trigger; body: { triggerNodeId, input?, return?: ReturnChannel[] }
  GET    /runs                          list with filters: loop, status, parent
  GET    /runs/{id}                     snapshot: status, current node, iteration, waiting spec, result, failure
  GET    /runs/{id}/thread              current context thread projection
  GET    /runs/{id}/events?after=N      page of events; with Accept: text/event-stream, a live tail
  POST   /runs/{id}/cancel | pause | resume
  POST   /runs/{id}/input               for a wait node in input mode; validated against its inputSchema
  POST   /runs/{id}/signals/{name}      deliver a named signal
  POST   /runs/{id}/replay              fork a new run at a given node with the same input (Draft)

Triggers and events
  POST   /hooks/{endpointToken}         signed webhook receiver
  POST   /events                        inbound event bus; body: { type, payload, dedupeKey? }

Settings and catalog
  CRUD   /schedules  /secrets  /api-keys  /model-catalog  /settings
  GET    /harness/preflight             Codex installed and authenticated?
  GET    /openapi.json   GET /healthz   GET /version
```

All list endpoints are paginated with cursors. All ids are ULIDs.

## SSE protocol (Decided)

- Endpoint: `GET /runs/{id}/events` with `Accept: text/event-stream`. The query parameter `after` or the `Last-Event-ID` header sets the starting sequence.
- Each SSE message has `id: <seq>`, `event: <run event type>`, and `data: <JSON event>`.
- A `: heartbeat` comment is sent every 15 seconds so proxies and browsers keep the connection open.
- The stream closes after `run.finished`, `run.failed`, or `run.cancelled` is delivered.
- Reconnecting with the last seen `seq` replays everything missed, because the stream is a tail of the persisted log.
- `GET /events/stream` (Draft) offers a multiplexed stream of run status changes across all runs for dashboards.

## Authentication (Decided for 1.0)

- **Local trusted mode**: the API binds to `127.0.0.1` and the browser app on the same machine needs no credentials. A warning is logged if the bind address is changed without API keys enabled.
- **API keys**: other applications and the MCP server authenticate with a bearer key. Keys are shown once, stored hashed, and carry scopes (`loops:read`, `runs:write`, and so on).
- **Post-1.0**: an `AuthProvider` interface in `apps/api` with OIDC as the first hosted implementation. Every handler already receives an `ownerId` from the auth layer; in 1.0 it is always `local`.

## Return delivery (Decided)

The `caller` return channel resolves at delivery time:

| Invocation source                                     | Delivery                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `manual.ui`, `manual.api`, `cron`, `webhook`, `event` | `result` on the run snapshot and `run.finished` event                                         |
| `manual.mcp`                                          | Also returned as the MCP tool result when the client waited; otherwise fetched with `get_run` |
| `subloop`                                             | Handed to the parent run's subloop output mapping                                             |

Other channels, webhook, file, event, and log, are delivered by the engine after the run finishes, with one `return.delivered` or `return.failed` event each.

## MCP server (Decided)

`apps/mcp` (`@graphgoblin/mcp`) is a thin client over the REST API through `@graphgoblin/api-client`, built on `@modelcontextprotocol/sdk` 1.31. It identifies itself with `client: 'mcp'`, so runs it starts record the `manual.mcp` invocation source.

- **Configuration**: `GG_API_URL` or `--api-url` (default `http://127.0.0.1:4747`); `GG_API_KEY` or `--api-key`, sent as a bearer key and optional in local trusted mode.
- **Transports**: stdio by default (the `graphgoblin-mcp` binary, `node apps/mcp/dist/main.js`); Streamable HTTP with `--http [--port <n>] [--host <addr>]` (or `GG_MCP_PORT`, `GG_MCP_HOST`; default `127.0.0.1:4748`) at `POST /mcp`. HTTP is stateless: each POST gets its own server and transport, `GET` and `DELETE` answer 405, and when bound to a loopback address a request whose `Host` is not a loopback name is refused with 403.

Tools (each with a Zod input schema; descriptions tell the agent when to call it and what to do next):

| Tool                                    | Input                                                       | Behaviour                                                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_loops`                            | `query?`                                                    | Loops with `id`, `name`, `description`, `published`, `hasDraft`; `query` filters names and descriptions                                                                                                     |
| `describe_loop`                         | `loopId` (id or exact name)                                 | The published version (or the draft, with a note): triggers with subtype, `inputSchema`, and `startableFromMcp`; input waits with prompt and schema; exits with `default`, `returnMapping`, channel kinds   |
| `start_run`                             | `loopId`, `input?`, `triggerNodeId?`, `allowDraft?`         | Starts a manual trigger and returns `runId` immediately; `allowDraft` runs the draft of an unpublished loop                                                                                                 |
| `wait_for_run`                          | `runId`, `timeoutSeconds?` (default 60, max 600)            | Returns `{ finished: true, run }` at a terminal status, or `{ finished: false, status, cursor, waiting?, next }`; returns early when the run waits for input or is paused; `cursor` is the last event `seq` |
| `get_run`                               | `runId`                                                     | Run snapshot                                                                                                                                                                                                |
| `get_run_thread`                        | `runId`                                                     | Context thread                                                                                                                                                                                              |
| `list_runs`                             | `loopId?`, `status[]?`, `parentRunId?`, `before?`, `limit?` | Compact runs, newest first; `nextBefore` (a `createdAt`) pages                                                                                                                                              |
| `read_run_events`                       | `runId`, `after?`, `limit?` (default 100)                   | `{ items, nextAfter, hasMore }`                                                                                                                                                                             |
| `cancel_run`, `pause_run`, `resume_run` | `runId`                                                     | Control; return the compact run                                                                                                                                                                             |
| `provide_input`                         | `runId`, `input`                                            | Answers a wait node in input mode                                                                                                                                                                           |
| `send_signal`                           | `runId`, `name`, `payload?`                                 | `{ woke, run }`                                                                                                                                                                                             |

`wait_for_run` polls `GET /runs/{id}` once a second rather than calling the client's `waitForRun`, so it can return early, and it sends MCP progress notifications between polls when the caller supplies a progress token. MCP clients have their own tool timeouts (the plugin sets Codex's `tool_timeout_sec` to 660); agents keep calling it until `finished` is true.

Resources: the templates `graphgoblin://runs/{id}/events` (the whole log as JSON, up to 10,000 events, with `truncated` and `nextAfter`) and `graphgoblin://runs/{id}/thread`; listing them returns the 20 most recent runs.

Errors: an API problem becomes a tool result with `isError: true` and the text `GraphGoblin API error <code> (HTTP <status>): <detail>`, followed by the validation `errors` when present; an unreachable gateway is `NETWORK_ERROR (HTTP 0)`. Errors raised by the MCP layer start with their code, for example `LOOP_NOT_FOUND: ...` or `AMBIGUOUS_LOOP_NAME: ...`. Resource reads reject with the API error message, which also starts with the code.

## Codex plugin (Decided)

`apps/plugin-codex` packages the MCP server registration and three skills so a Codex user can drive loops from inside a session:

- `run-loop`: find a loop, build input from `describe_loop`, `start_run`, then `wait_for_run` until finished, answering input requests with `provide_input`, and report the result.
- `design-loop`: draft a definition from a description using a summary of the nine node kinds, validate it through `POST /loops`, `PUT /loops/{id}/draft`, or `POST /loops/{id}/validate` and read `issues`, and save it as a draft; never publish unless asked.
- `inspect-run`: summarise a run's event log and thread.

The user invokes a skill by name (`$run-loop`), which is the slash-command style the owner asked for. The layout, verified against Codex CLI 0.160.0 and the plugins installed on the development machine:

```
apps/plugin-codex/plugin/graphgoblin/   the plugin root
  .codex-plugin/plugin.json              name, version, description, author, "skills": "./skills/",
                                         "mcpServers": "./.mcp.json", interface { displayName, ... }
  .mcp.json                              { "mcpServers": { "graphgoblin": { "command": "node",
                                           "args": ["${GRAPHGOBLIN_MCP_ENTRY}"],
                                           "env_vars": ["GG_API_URL", "GG_API_KEY"], timeouts } } }
  skills/<name>/SKILL.md                 frontmatter name and description, then instructions
apps/plugin-codex/dist/marketplace/      assembled by pnpm build
  .agents/plugins/marketplace.json       { "name": "graphgoblin-local", "plugins": [{ "name": "graphgoblin",
                                           "source": { "source": "local", "path": "./plugins/graphgoblin" } }] }
  plugins/graphgoblin/                   the plugin with the absolute apps/mcp/dist/main.js path filled in
```

Codex installs a plugin by copying it into `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>`, so the source `.mcp.json` carries the placeholder `${GRAPHGOBLIN_MCP_ENTRY}` and the build writes the absolute path. Install with `codex plugin marketplace add <repo>/apps/plugin-codex/dist/marketplace` and `codex plugin add graphgoblin@graphgoblin-local`; `codex mcp list` then shows the server. `env_vars` passes `GG_API_URL` and `GG_API_KEY` through from the environment Codex runs in. See `apps/plugin-codex/README.md`.

## Client (Decided)

`packages/api-client` (`@graphgoblin/api-client`) is the one HTTP client for the web app and the MCP server. It depends only on `contracts` and `openapi-fetch`, and uses nothing but `fetch`, web streams, and `TextDecoderStream`, so it runs in browsers and Node 18+.

- **Generated types.** `openapi.json` (the API's document) and `src/generated/schema.ts` (from `openapi-typescript`) are committed. `pnpm --filter @graphgoblin/api-client generate` re-emits both from the API's source; a test fails with that instruction when either drifts from the live API. The API emits large and recursive contract schemas (`JsonValue`, `LoopDefinition`, `RunRecord`, `RunEvent`, `ContextThread`, ...) as named components from a dedicated registry in `apps/api/src/openapi-registry.ts`; request-side components carry an `Input` suffix.
- **Factory.** `createGraphGoblinClient({ baseUrl, apiKey?, fetch?, client? })` returns a typed openapi-fetch client. `apiKey` becomes `authorization: Bearer ...`; `client: 'ui' | 'mcp'` becomes `x-graphgoblin-client`, which the API maps to the `manual.ui` or `manual.mcp` invocation source.
- **Errors.** Non-2xx responses throw `GraphGoblinApiError` with the problem's `status`, `code`, `detail`, and `errors`; transport failures throw it with `status: 0` and `code: 'NETWORK_ERROR'`. `unwrap(result)` does the same for raw openapi-fetch calls.
- **Resource wrappers.** `loops`, `runs`, `settings`, `secrets`, `apiKeys`, `modelCatalog`, `events`, and `system` take the client first and return the response body, for example `await runs.start(client, loopId, { input })`.
- **Live events.** `subscribeRunEvents({ client, runId, after?, onEvent, signal? })` reads `GET /runs/{id}/events` as SSE, validates each frame with `RunEventSchema`, and calls `onEvent` in `seq` order. It remembers the last delivered `seq`; if the connection drops before `run.finished`, `run.failed`, or `run.cancelled`, it reconnects with `after=<lastSeq>` after an exponential backoff (500 ms doubling, capped at 30 s, reset after a connection that makes progress) and discards replayed events it has already delivered. 408, 425, 429, 5xx, and network errors are retried; other statuses reject `done`. A frame that fails validation is reported through `onError` and skipped. It returns `{ close(), done, lastSeq }`.
- **Waiting.** `waitForRun(client, runId, { timeoutMs, pollMs?, signal? })` polls `GET /runs/{id}` until a terminal status or the timeout and returns `{ run, finished }`; the MCP `wait_for_run` tool is built on it.

## Error responses (Decided)

Problem Details, RFC 9457, with a stable `code` field drawn from `contracts`. Validation errors include the Zod issue path.
