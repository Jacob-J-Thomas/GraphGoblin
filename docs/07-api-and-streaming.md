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
  PUT    /loops/{id}/draft              save draft definition (validated, may be unpublishable; If-Match)
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
  POST   /runs/{id}/replay              fork a new run at a node; body: { nodeId }; 202 { run }; 409 REPLAY_NODE_NOT_REACHED (see 05)

Triggers and events
  POST   /hooks/{endpointToken}         signed webhook receiver (public; HMAC, timestamp window, replay, 1 MB, rate limit; see 08)
  GET    /loops/{id}/triggers           schedules, webhook endpoints (path only, never the secret), armed poll triggers
  POST   /events                        inbound event bus; body: { type, payload, dedupeKey? }; fires event triggers, returns runIds and duplicate
  GET    /events?type=&before=&limit=   stored inbound events (API, exit channels, webhooks), newest first

Settings and catalog
  CRUD   /secrets  /api-keys  /settings   (schedules follow publish; read them at /loops/{id}/triggers)
  GET    /model-catalog                 catalog entries, including source and enabled (settings:read)
  PATCH  /model-catalog/{harness}/{model}  { enabled: boolean }, 200 entry (settings:write)
  PUT    /model-catalog/{harness}/{model}  edit existing LiteLLM metadata (settings:write)
  DELETE /model-catalog/{harness}/{model}  remove a LiteLLM entry, 204 (settings:write)
  GET    /harness/preflight             Codex installed and authenticated?
  GET    /system/preflight              first-run checks: Node, data dir, master key, database, harnesses, Jev, default model (11)
  GET    /openapi.json   GET /healthz   GET /version   (all public; Swagger UI at /docs when enabled)
```

All list endpoints are paginated with cursors. All ids are ULIDs.

## Loop definition inputs

Loop settings have model and effort defaults only. Select `config.harness` on each inference
node; omission defaults to Codex. Create, draft save, and validate request bodies use the
canonical `LoopDefinitionSchema`. `settings.defaults.harness` is rejected as an unknown key,
with its field path, regardless of its value.

`POST /loops/import` delegates to `domain.importLoop`, accepting canonical bare definitions
and portable export envelopes. Envelope errors retain paths such as
`loop.settings.defaults.harness`, `formatVersion`, or `exportedAt`, under `LOOP_IMPORT_ERROR`.
Ordinary bodies use `VALIDATION_FAILED`. Responses and exports use the canonical, encodable
schemas. Startup migration `0005` removes the obsolete field from stored version definitions
once; there is no tolerant read path. Schema and format versions stay 1. Older files and API
clients must remove the field before sending a definition (see the CHANGELOG upgrade notes).

## SSE protocol (Decided)

- Endpoint: `GET /runs/{id}/events` with `Accept: text/event-stream`. The query parameter `after` or the `Last-Event-ID` header sets the starting sequence.
- Each SSE message has `id: <seq>`, `event: <run event type>`, and `data: <JSON event>`.
- A `: heartbeat` comment is sent every 15 seconds so proxies and browsers keep the connection open.
- The stream closes after `run.finished`, `run.failed`, or `run.cancelled` is delivered, whether that event is replayed or arrives live.
- If the run is already terminal when the client subscribes and the cursor is at or past its terminal event, the response ends right after the replay (a `: connected` comment and no events), so a reconnect after the end never idles. Since WP-G the terminal event is persisted before terminal status (05), so a healthy current log needs no grace. If no terminal event is visible even after re-reading the log, the stream allows up to 2 seconds for late subscription delivery, then closes instead of idling forever. This is a defensive bound for incomplete legacy or inconsistent logs.
- Reconnecting with the last seen `seq` replays everything missed, because the stream is a tail of the persisted log.
- `GET /events/stream` (Draft) offers a multiplexed stream of run status changes across all runs for dashboards.

## Authentication (Decided for 1.0)

- **Local trusted mode**: the API binds to `127.0.0.1` and the browser app on the same machine needs no credentials. A warning is logged if the bind address is changed without API keys enabled.
- **API keys**: other applications and the MCP server authenticate with a bearer key. Keys are shown once, stored hashed, and carry scopes (`loops:read`, `runs:write`, and so on).
- **Scopes (Decided by implementation, WP-G, 2026-10-03)**: every private route, read or write, needs a scope, checked in the same `onRequest` hook that authenticates the key, before the body is parsed or any data is read (`requiredScope` in `apps/api/src/plugins/auth.ts`). The scope is `<resource>:read` for `GET` and `HEAD` and `<resource>:write` for everything else, where the resource is the route's first path segment: `loops`, `runs`, `settings`, `secrets`, `api-keys`, `events`, and `system`. `/model-catalog` shares `settings`, and `/harness/preflight` shares `system` with `/system/preflight`. Two routes are overridden: `POST /loops/{id}/runs` needs `runs:write`, and `POST /loops/{id}/validate`, which saves nothing, needs `loops:read`. A write scope implies the read scope of the same resource, so a `runs:write` key can follow the runs it starts. `*` grants everything, and local trusted mode (no key presented, keys not required) acts with `*`. A key without the scope gets `403 FORBIDDEN`, even when the request would also fail validation. A request that matches no route gets its `404` regardless of scopes. The adversarial API suite holds a table of every advertised route and its scope; adding a route means adding it there.
- **API-key delegation**: `POST /api-keys` requires `api-keys:write`. Local trusted mode and callers holding `*` may grant any scopes; omitting `scopes` defaults to `["*"]` only for them. A scoped caller must list `scopes` explicitly or gets `400 VALIDATION_FAILED` with a message explaining that requirement. It may grant only scopes it holds, including reads implied by its write scopes, and may never grant `*`. A request containing unheld scopes or `*` gets `403 SCOPE_NOT_DELEGABLE`, listing all offending scopes in `detail` and `errors.scopes`, without creating a key. An `api-keys:write` key can still list and revoke every key for the local owner, including `*` keys. See [ADR-0016](decisions/ADR-0016-api-key-scope-delegation.md).
- **Path ids**: resource ids in paths (loop, version, run, API key) must be ULIDs. A malformed id is a `400 VALIDATION_FAILED`, not a lookup that ends in `404`. Node names, signal names, secret names, model names, setting keys, artifact ids, and webhook tokens keep their own formats.
- **Required keys** (`GG_REQUIRE_API_KEY=true`): every route outside the [public route list](#public-routes-decided-by-implementation-2026-10-03) needs a key. On the first 401 the web app asks for a key, keeps it in the browser's `localStorage`, and sends it on every request and event stream. Settings can forget it.
- **Post-1.0**: an `AuthProvider` interface in `apps/api` with OIDC as the first hosted implementation. Every handler already receives an `ownerId` from the auth layer; in 1.0 it is always `local`.

### Public routes (Decided by implementation, 2026-10-03)

The authentication hook treats these six prefixes (`PUBLIC_PREFIXES` in `apps/api/src/plugins/auth.ts`) as public: `/healthz`, `/version`, `/openapi.json`, `/docs`, `/hooks/`, and `/app/`. The four without a trailing slash match the path itself, the path with a trailing slash, and every path beneath it, so `/docs/static/...` is public but `/healthzX` is not. `/hooks/` and `/app/` match every path that starts with them, such as `/hooks/<token>` and `/app/assets/...`; `/hooks` without the slash is private. The two exact public paths (`PUBLIC_EXACT`) are `/` and `/app`. The query string is ignored.

Public paths bypass API-key authentication. If no route handles a public path, the response is `404`, never `401`.

The `/docs` prefix is on the public list, but the Swagger UI is registered there only when `GG_SWAGGER_UI` is true (the default). With `GG_SWAGGER_UI=false`, nothing is registered under `/docs`, so `/docs` and every path beneath it return `404` without asking for a key; `/openapi.json` is always served.

`/hooks/<token>` needs no API key because the HMAC signature is the credential; see [Webhook](08-triggers-and-integrations.md#webhook-decided-shipped-in-m6). `/app/`, `/`, and `/app` stay public because the web shell holds no data and every API call it makes is still authenticated.

Everything outside these public prefixes and exact paths is private. With `GG_REQUIRE_API_KEY=true`, it needs a bearer API key. When keys are not required, a request without a key runs in local trusted mode; a request that presents a key is still authenticated and limited to that key's scopes.

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
| `cancel_run`, `pause_run`, `resume_run` | `runId`                                                     | Control; return the compact run. A run paused while parked resumes to `waiting` on the same wait, otherwise to `running` (05)                                                                               |
| `provide_input`                         | `runId`, `input`                                            | Answers a wait node in input mode                                                                                                                                                                           |
| `send_signal`                           | `runId`, `name`, `payload?`                                 | `{ woke, run }`                                                                                                                                                                                             |
| `replay_run`                            | `runId`, `nodeId`                                           | Forks a new run at `nodeId` with the thread from just before that node (`POST /runs/{id}/replay`); returns the compact fork with `replayOf` and a hint to call `wait_for_run`                               |

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
- **Resource wrappers.** `loops`, `runs`, `settings`, `secrets`, `apiKeys`, `modelCatalog`, `events`, and `system` take the client first and return the response body, for example `await runs.start(client, loopId, { input })` or `await runs.replay(client, runId, nodeId)`.
- **Live events.** `subscribeRunEvents({ client, runId, after?, onEvent, signal? })` reads `GET /runs/{id}/events` as SSE, validates each frame with `RunEventSchema`, and calls `onEvent` in `seq` order. It remembers the last delivered `seq`; if the connection drops before `run.finished`, `run.failed`, or `run.cancelled`, it reconnects with `after=<lastSeq>` after an exponential backoff (500 ms doubling, capped at 30 s, reset after a connection that makes progress) and discards replayed events it has already delivered. 408, 425, 429, 5xx, and network errors are retried; other statuses reject `done`. A frame that fails validation is reported through `onError` and skipped. It returns `{ close(), done, lastSeq }`.
- **Waiting.** `waitForRun(client, runId, { timeoutMs, pollMs?, signal? })` polls `GET /runs/{id}` until a terminal status or the timeout and returns `{ run, finished }`; the MCP `wait_for_run` tool is built on it.

## Error responses (Decided)

Problem Details, RFC 9457, with a stable `code` field drawn from `contracts`. Validation errors include the Zod issue path. Request errors Fastify raises itself use stable codes too: `MALFORMED_BODY` (invalid or empty JSON, 400), `BODY_TOO_LARGE` (over the 8 MB limit, 413), `UNSUPPORTED_MEDIA_TYPE` (415); other framework errors are `BAD_REQUEST`, so no `FST_ERR_*` code reaches a client.

### Model catalog (Decided, ADR-0018)

Entries include `source: 'harness' | 'litellm'`. GET requires `settings:read`; all mutations require `settings:write`. PATCH accepts only `{ enabled: boolean }` and returns the full entry with 200; repeated toggles are safe. Use `modelCatalog.setEnabled(client, harness, model, enabled)` in the client. Existing `upsert` and `remove` helpers remain for LiteLLM rows; no client helper was removed.

PUT retains displayName, efforts, defaultEffort, and optional enabled (omitting it preserves the entry's current value), adding optional source. Existing source governs ownership and cannot be changed. An omitted source on creation means harness, so old scripts creating harness models are now refused. Requesting `source: 'litellm'` on a new entry is also refused until LiteLLM configuration ships. Existing LiteLLM entries may be edited without specifying source. Scripts that previously PUT a complete harness entry to toggle enabled must use PATCH instead. MCP tools and Codex plugin skills do not call these catalog routes.

| Code                       | HTTP | Meaning                                                                                                                                                                                                 |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODEL_MANAGED_BY_HARNESS` | 409  | Existing harness edit/delete: "Harness models can only be enabled or disabled". Harness creation: "Models for this harness come from the harness and cannot be added". Includes hand-added legacy rows. |
| `LITELLM_NOT_CONFIGURED`   | 409  | LiteLLM creation: "LiteLLM is not configured; adding local models is not available yet". Settings Add model requests this source.                                                                       |
| `MODEL_NOT_FOUND`          | 404  | PATCH or DELETE of a missing entry.                                                                                                                                                                     |
| `INVALID_INPUT`            | 400  | LiteLLM PUT changes source or defaultEffort is absent from efforts.                                                                                                                                     |
| `VALIDATION_FAILED`        | 400  | Invalid body, including a missing/non-boolean enabled or extra PATCH fields.                                                                                                                            |

## Validation agreement (Decided, WP-D2)

`POST /loops`, `POST /loops/import`, `PUT /loops/{id}/draft`, `POST /loops/{id}/validate`, and `POST /loops/{id}/publish` report the same issue list: the `domain` rules (`validateLoop`, which includes Liquid and JSONata syntax checks), trigger checks such as cron syntax, and subloop references, which must name a loop of the same owner with a published version (`SUBLOOP_NOT_FOUND`, `SUBLOOP_NOT_PUBLISHED`; a loop may reference itself). `publishable` from validate is true exactly when publish would accept the draft. The editor runs the `domain` rules locally and adds the API-only issues from validate.

The API reads the catalog once per issue collection, next to subloop checks, and adds warning-severity `MODEL_DISABLED` or `MODEL_NOT_IN_CATALOG` for explicit inference `config.model` (the node's harness), decision `config.codex.model` (Codex, only when strategy includes `codex`), and `settings.defaults.model` (the inference default harness, `codex`). Node warnings include nodeId and node-relative paths `config.model` or `config.codex.model`; loop-default warnings use `settings.defaults.model` without nodeId. Unspecified models and unused decision Codex settings add no catalog warning. Publishing succeeds when only warnings exist and returns `{ version, issues }`; warnings do not enforce the catalog at runtime. The shared contracts issue schema supports optional paths, and the editor already shows warnings and their node identity.

Known limitation: loop-default model warnings always check the Codex catalog, the only supported
inference harness. Revisit this check when a second harness exists so a model inherited by nodes
using different harnesses can be checked against each relevant catalog.

## Draft conflicts (Decided, WP-F2, ADR-0015)

A draft has a version token, `draftToken`: a hash of the definition the next draft save replaces, which is the draft, or the published version when there is no draft. Equal content gives an equal token, so publishing (which keeps the content) does not change it. `GET /loops/{id}` returns it in the body and as the `ETag` header; `PUT /loops/{id}/draft` returns the new one the same way.

`PUT /loops/{id}/draft` with `If-Match: "<draftToken>"` saves only when the server copy still has that token; otherwise it answers 409 `DRAFT_CONFLICT` with the server's current token as the problem's `draftToken` extension member, and saves nothing. `*`, weak tags (`W/"…"`), and lists are accepted. Draft saves and publishes of one loop are serialized in the API process, so of two different saves with the same token exactly one wins; a stale save whose definition already equals the server draft is a no-op 200 rather than a conflict. Storage also refuses to modify a version row that is no longer a draft: a save racing a publish creates a new draft, and a published version never changes. A save without `If-Match` stays unconditional (last write wins), for scripts and the MCP `design-loop` flow. In the client, `loops.saveDraft(client, loopId, definition, { ifMatch })` sends the header and a conflict surfaces as `GraphGoblinApiError` with `code: 'DRAFT_CONFLICT'` and `problem.draftToken`.

`PUT /settings` checks the keys the engine reads: `defaultModel` must be a non-empty string and `defaultEffort` an effort level. Other keys are stored as given. `DELETE /settings/{key}` returns a key to the server default.
