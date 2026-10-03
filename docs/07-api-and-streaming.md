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
  POST   /hooks/{endpointToken}         signed webhook receiver (public; HMAC, timestamp window, replay, 1 MB, rate limit; see 08)
  GET    /loops/{id}/triggers           schedules, webhook endpoints (path only, never the secret), armed poll triggers
  POST   /events                        inbound event bus; body: { type, payload, dedupeKey? }; fires event triggers, returns runIds and duplicate
  GET    /events?type=&before=&limit=   stored inbound events (API, exit channels, webhooks), newest first

Settings and catalog
  CRUD   /secrets  /api-keys  /model-catalog  /settings   (schedules follow publish; read them at /loops/{id}/triggers)
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

`apps/mcp` is a thin client over the REST API using the generated client. It runs as stdio for a local Codex session and as Streamable HTTP for remote clients, authenticating to the API with an API key.

Tools:

| Tool                                     | Behaviour                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `list_loops`, `describe_loop`            | Discovery, including trigger input schemas                                                       |
| `start_run`                              | Starts a manual trigger; returns run id immediately                                              |
| `wait_for_run`                           | Long-polls up to a timeout and returns the result or a cursor; agents call again to keep waiting |
| `get_run`, `get_run_thread`, `list_runs` | Inspection                                                                                       |
| `cancel_run`, `pause_run`, `resume_run`  | Control                                                                                          |
| `provide_input`, `send_signal`           | Wake waiting runs                                                                                |
| `read_run_events`                        | Page through the log                                                                             |

Resources: `graphgoblin://runs/{id}/events` and `graphgoblin://runs/{id}/thread`.

Tool descriptions are written for agents: when to call, what to pass, what to do with a cursor.

## Codex plugin (Decided)

`apps/plugin-codex` packages the MCP server registration and a few skills so a Codex user can drive loops from inside a session:

- `run-loop`: start a named loop with input and wait for the result, using the MCP tools.
- `design-loop`: draft a loop definition from a description, validate it through the API, and save it as a draft.
- `inspect-run`: summarise a run's event log for the user.

The owner also wants a slash-command style invocation from inside a harness. In Codex that is a skill the user invokes by name; the skill's instructions call the MCP tools. The exact packaging follows the pinned Codex plugin format and is verified in M7.

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
