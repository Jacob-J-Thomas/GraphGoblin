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
  GET    /runs                          owner-scoped list with run/template filters and a stable nextCursor
  GET    /runs/{id}                     snapshot: status, current node, iteration, waiting spec, result, failure
  GET    /runs/{id}/thread              current context thread projection
  GET    /runs/{id}/events?after=N      page of events; with Accept: text/event-stream, a live tail
  POST   /runs/{id}/cancel | pause | resume
  POST   /runs/{id}/input               for a wait node in input mode; validated against its inputSchema
  POST   /runs/{id}/signals/{name}      deliver a named signal
  POST   /runs/{id}/replay              fork a new run at a node; body: { nodeId }; 202 { run }; 409 REPLAY_NODE_NOT_REACHED (see 05)

Triggers and events
  POST   /triggers/cron/preview         next cron slots without saving or arming; loops:read
  POST   /hooks/{endpointToken}         signed webhook receiver (public; timestamp/body or raw-body HMAC, scheme-specific replay protection, 1 MiB, rate limit; see 08)
  GET    /loops/{id}/triggers           schedules, webhook endpoints (path only, never the secret), armed poll triggers
  POST   /events                        inbound event bus; body: { type, payload, dedupeKey? }; fires event triggers, returns runIds and duplicate
  GET    /events?type=&before=&limit=   stored inbound events (API, exit channels, webhooks), newest first

Settings and catalog
  CRUD   /secrets  /api-keys  /settings   (schedules follow publish; read them at /loops/{id}/triggers)
  GET    /api-keys                      owner key metadata with required current: boolean (the key authenticating this request)
  GET    /model-catalog                 catalog entries, including source and enabled (settings:read)
  PATCH  /model-catalog/{harness}/{model}  { enabled: boolean }, 200 entry (settings:write)
  PUT    /model-catalog/{harness}/{model}  edit existing LiteLLM metadata (settings:write)
  DELETE /model-catalog/{harness}/{model}  remove a LiteLLM entry, 204 (settings:write)
  GET    /classifier-models             owner classifier summaries with configured/enabled (settings:read)
  PUT    /classifier-models/{id}        create/replace custom HTTP metadata, 200 summary (settings:write; also secrets:write with secretRef); If-None-Match: * creates only
  PATCH  /classifier-models/{id}        exactly { enabled: boolean }, 200 summary (settings:write)
  DELETE /classifier-models/{id}        remove custom metadata, 204; preserve secrets/references (settings:write)
  GET    /harness/preflight             Codex installed and authenticated?
  GET    /system/preflight              first-run checks: Node, data dir, master key, database, harnesses, Jev, default model (11)
  GET    /openapi.json   GET /healthz   GET /version   (all public; Swagger UI at /docs when enabled)
```

Run and loop lists are paginated with cursors. Loop/run ids are ULIDs; classifier ids are bounded URL-safe names, with `jev` reserved for the built-in.

## Loop definition inputs

Loop settings have model and effort defaults only. Select `config.harness` on each inference
node; omission defaults to Codex. Create, draft save, and validate request bodies use the
canonical `LoopDefinitionSchema`. `settings.defaults.harness` is rejected as an unknown key,
with its field path, regardless of its value.

`POST /loops/import` delegates to `domain.importLoop`, accepting canonical bare definitions
and portable export envelopes. Envelope errors retain paths such as
`loop.settings.defaults.harness`, `formatVersion`, or `exportedAt`, under `LOOP_IMPORT_ERROR`.
Ordinary bodies use `VALIDATION_FAILED`. Responses and exports use the canonical, encodable
schemas. The current definition and export formats are version 2. Historical migration `0005` removed loop-level harness selection; the later decision/default cutover requires the stopped-instance [offline upgrade](guide/08-offline-upgrade.md). Old-format imports receive `LOOP_FORMAT_UPGRADE_REQUIRED`, and unconverted stores stop before ordinary migrations or recovery. There is no tolerant runtime read path. See the CHANGELOG upgrade notes.

## SSE protocol (Decided)

- Endpoint: `GET /runs/{id}/events` with `Accept: text/event-stream`. The query parameter `after` or the `Last-Event-ID` header sets the starting sequence.
- Each SSE message has `id: <seq>`, `event: <run event type>`, and `data: <JSON event>`.
- `node.progress` is validated against the strict `RunEventSchema` payload contract. Inference item variants expose only the bounded summary and allowlisted command/status fields; script progress has its own `{ exitCode, stderr, stdoutBytes }` shape. Invalid progress fields are rejected by clients and are absent from the OpenAPI schema.
- A `: heartbeat` comment is sent every 15 seconds so proxies and browsers keep the connection open.
- The stream closes after `run.finished`, `run.failed`, or `run.cancelled` is delivered, whether that event is replayed or arrives live.
- If the run is already terminal when the client subscribes and the cursor is at or past its terminal event, the response ends right after the replay (a `: connected` comment and no events), so a reconnect after the end never idles. Since WP-G the terminal event is persisted before terminal status (05), so a healthy current log needs no grace. If no terminal event is visible even after re-reading the log, the stream allows up to 2 seconds for late subscription delivery, then closes instead of idling forever. This is a defensive bound for incomplete legacy or inconsistent logs.
- Reconnecting with the last seen `seq` replays everything missed, because the stream is a tail of the persisted log.
- `GET /events/stream` (Draft) offers a multiplexed stream of run status changes across all runs for dashboards.

## Evaluation events

JSON event pages and SSE carry the same strict `RunEvent` contract, also advertised in
`/openapi.json`. Both preserve execution evidence before the run's terminal event.

| Event            | Evidence                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `exit.evaluated` | Node, iteration, hard ceiling, ordered criteria with zero-based indices, strategy, matched/not-matched verdict, predicate boolean and confidence, resolved Codex model or Jev classifier, bounded Codex reasoning, skipped reasons and safe errors. `result` names completion and its matching criterion, loop-back and its cause, a configured or hard limit and its value, failure, or cancellation. |
| `decision.made`  | Canonical `answer`, stable `portId`, resolved `provenance`, and bounded `diagnostics` preserving historical pre-cutover skips. Unknown historical facts are null. New decisions evaluate exactly one kind.                                                                                                                                                                                             |

Skip messages and failure diagnostics use fixed summaries and allowlisted codes; provider
error bodies, credential values, and raw response payloads are excluded. Codex reasoning
is its returned short justification, capped at 2,048 characters. Clients consuming the
strict contract must upgrade with the server; migration `0007` supplies empty skip lists
for historical decisions, whose missing evidence cannot be recovered.

SQLite reads validate every stored row against `RunEventSchema`. A non-conforming row fails
the entire requested page; it is neither repaired nor converted into a synthetic event.
JSON and SSE replay return HTTP 500 Problem Details with code `STORED_EVENT_INVALID` and
the run id, sequence, and event type in `detail`, without payloads or provider diagnostics.
SSE validates its replay, including any terminal-status recheck, before sending headers or
frames, and releases its subscription on failure. No event cursor advances for a rejected
page. Migration `0007`, rather than the reader, repairs historical decisions missing `skipped`.

## Authentication (Decided for 1.0)

- **Local trusted mode**: the API binds to `127.0.0.1` and the browser app on the same machine needs no credentials. A warning is logged if the bind address is changed without API keys enabled.
- **API keys**: other applications and the MCP server authenticate with a bearer key. Keys are shown once, stored hashed, and carry scopes (`loops:read`, `runs:write`, and so on).
- **Scopes (Decided by implementation, WP-G, 2026-10-03)**: every private route, read or write, needs a scope, checked in the same `onRequest` hook that authenticates the key, before the body is parsed or any data is read (`requiredScope` in `apps/api/src/plugins/auth.ts`). The scope is `<resource>:read` for `GET` and `HEAD` and `<resource>:write` for everything else, where the resource is the route's first path segment: `loops`, `runs`, `settings`, `secrets`, `api-keys`, `events`, and `system`. `/model-catalog` and `/classifier-models` share `settings`, and `/harness/preflight` shares `system` with `/system/preflight`. Three routes are overridden: `POST /loops/{id}/runs` needs `runs:write`, and `POST /loops/{id}/validate`, which saves nothing, needs `loops:read`; `POST /triggers/cron/preview` also saves nothing and needs `loops:read`. A write scope implies the read scope of the same resource, so a `runs:write` key can follow the runs it starts. `*` grants everything, and local trusted mode (no key presented, keys not required) acts with `*`. A key without the scope gets `403 FORBIDDEN`, even when the request would also fail validation. A request that matches no route gets its `404` regardless of scopes. The adversarial API suite holds a table of every advertised route and its scope; adding a route means adding it there.
- **Current API key**: `GET /api-keys` adds a required `current: boolean` to every item. It is true only when keys are required and the authenticated API-key actor id matches that row. Exactly the key authenticating this request is flagged; revoked keys cannot authenticate, and other owners' keys are not listed; a list request already accepted can report its own key as both current and revoked. In trusted mode every row is false, with or without a valid bearer key. The flag is a response snapshot, never persisted or included in the creation response; tokens and hashes are never listed. Headers (including `x-graphgoblin-client`), query parameters, bodies, and labels cannot choose the flag.
- **API-key delegation**: `POST /api-keys` requires `api-keys:write`. Local trusted mode and callers holding `*` may grant any scopes; omitting `scopes` defaults to `["*"]` only for them. A scoped caller must list `scopes` explicitly or gets `400 VALIDATION_FAILED` with a message explaining that requirement. It may grant only scopes it holds, including reads implied by its write scopes, and may never grant `*`. A request containing unheld scopes or `*` gets `403 SCOPE_NOT_DELEGABLE`, listing all offending scopes in `detail` and `errors.scopes`, without creating a key. An `api-keys:write` key can still list and revoke every key for the local owner, including `*` keys. See [ADR-0016](decisions/ADR-0016-api-key-scope-delegation.md).
- **Path ids**: resource ids in paths (loop, version, run, API key) must be ULIDs. A malformed id is a `400 VALIDATION_FAILED`, not a lookup that ends in `404`. Node names, signal names, secret names, model names, setting keys, artifact ids, and webhook tokens keep their own formats.
- **Required keys** (`GG_REQUIRE_API_KEY=true`): every route outside the [public route list](#public-routes-decided-by-implementation-2026-10-03) needs a key. On the first 401 the web app asks for a key, keeps it in the browser's `localStorage`, and sends it on every request and event stream. Settings can forget it.
- **Post-1.0**: an `AuthProvider` interface in `apps/api` with OIDC as the first hosted implementation. Every handler already receives an `ownerId` from the auth layer; in 1.0 it is always `local`.

PUT `/classifier-models/{id}` also requires `secrets:write` when its validated body supplies `secretRef`, because the registered endpoint will receive that secret as a bearer. This additional check returns `403 FORBIDDEN` before persistence or secret resolution. `secrets:read` is insufficient; local trusted mode and `*` retain access. A settings-only metadata edit may omit `secretRef`, which clears authentication. Changing an existing entry's endpoint with `settings:write` alone is an accepted capability of that scope: no secret travels to the new endpoint, but later decisions that select the entry send their context (the rendered question, labels, and state) there, as that scope already decides which models and defaults runs use.

### Public routes (Decided by implementation, 2026-10-03)

The authentication hook treats these six prefixes (`PUBLIC_PREFIXES` in `apps/api/src/plugins/auth.ts`) as public: `/healthz`, `/version`, `/openapi.json`, `/docs`, `/hooks/`, and `/app/`. The four without a trailing slash match the path itself, the path with a trailing slash, and every path beneath it, so `/docs/static/...` is public but `/healthzX` is not. `/hooks/` and `/app/` match every path that starts with them, such as `/hooks/<token>` and `/app/assets/...`; `/hooks` without the slash is private. The two exact public paths (`PUBLIC_EXACT`) are `/` and `/app`. The query string is ignored.

Public paths bypass API-key authentication. If no route handles a public path, the response is `404`, never `401`.

The `/docs` prefix is on the public list, but the Swagger UI is registered there only when `GG_SWAGGER_UI` is true (the default). With `GG_SWAGGER_UI=false`, nothing is registered under `/docs`, so `/docs` and every path beneath it return `404` without asking for a key; `/openapi.json` is always served.

`/hooks/<token>` needs no API key because the HMAC signature is the credential; see [webhook signing](08-triggers-and-integrations.md). `/app/`, `/`, and `/app` stay public because the web shell holds no data and every API call it makes is still authenticated.

Everything outside these public prefixes and exact paths is private. With `GG_REQUIRE_API_KEY=true`, it needs a bearer API key. When keys are not required, a request without a key runs in local trusted mode; a request that presents a key is still authenticated and limited to that key's scopes.

## Cron preview (Decided, #20)

`POST /triggers/cron/preview` requires `loops:read` (also implied by `loops:write`).
Its JSON body is `{ expression, timezone, count?, from? }`: expression at most 256
characters, timezone at most 64, count an integer from 1 to 10 (default 5), and
from an ISO timestamp with a UTC marker or offset (default the server clock).
The response is 200 `{ next: [timestamps] }`, containing UTC ISO timestamps
strictly after from. Each slot is computed through `CronScheduler.nextFire`,
including daylight-saving changes. A finite or impossible schedule can return
fewer slots or an empty array. The route creates no schedules and starts no runs.

An invalid expression or timezone returns 400 Problem Details with code
`CRON_INVALID`, with `errors: [{ path, message }]` naming `/expression` or
`/timezone`, following the request body's JSON-pointer convention used by
`VALIDATION_FAILED` for malformed fields or bounds.
There is no server summary: the web control describes the preset model, and labels
other expressions as custom without rewriting them. Validate and publish retain
their `CRON_INVALID` issues, with nodeId and node-relative `config.expression` or
`config.timezone` paths.
Following an expression issue opens Advanced and focuses the raw expression;
following a timezone issue focuses the time zone control.

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

- **Generated types.** `openapi.json` (the API's document) and `src/generated/schema.ts` (from `openapi-typescript`) are committed. `pnpm --filter @graphgoblin/api-client generate` re-emits both from the API's source; a test fails with that instruction when either drifts from the live API. The API emits large and recursive contract schemas (`JsonValue`, `LoopDefinition`, `RunRecord`, `RunEvent`, `ContextThread`, ...) as named components from a dedicated registry in `apps/api/src/openapi-registry.ts`; request-side components carry an `Input` suffix. `RunEvent` includes the discriminated strict progress variants, including inference item types and the script shape documented above.
- **Factory.** `createGraphGoblinClient({ baseUrl, apiKey?, fetch?, client? })` returns a typed openapi-fetch client. `apiKey` becomes `authorization: Bearer ...`; `client: 'ui' | 'mcp'` becomes `x-graphgoblin-client`, which the API maps to the `manual.ui` or `manual.mcp` invocation source.
- **Errors.** Non-2xx responses throw `GraphGoblinApiError` with the problem's `status`, `code`, `detail`, and `errors`; transport failures throw it with `status: 0` and `code: 'NETWORK_ERROR'`. `unwrap(result)` does the same for raw openapi-fetch calls.
- **Resource wrappers.** `loops`, `runs`, `settings`, `secrets`, `apiKeys`, `modelCatalog`, `classifierModels`, `events`, and `system` take the client first and return the response body, for example `await runs.start(client, loopId, { input })` or `await runs.replay(client, runId, nodeId)`. Classifier helpers are `list(client)`, `upsert(client, id, metadata)`, `create(client, id, metadata)` (the same PUT with `If-None-Match: *`, refused with `CLASSIFIER_EXISTS` when the id exists), `setEnabled(client, id, enabled)`, and `remove(client, id)`; ids are encoded and API problems propagate unchanged.
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

### Classifier catalog (Decided, ADR-0021)

`/classifier-models` shares the `settings` scope alias: GET needs `settings:read`; PUT/PATCH/DELETE need `settings:write`, checked before body parsing. PUT additionally requires `secrets:write` when the validated body carries `secretRef`; otherwise it returns `403 FORBIDDEN`. Trusted mode and `*` have both scopes. Secret-read scope is not required to see configuration status. Entries expose id, displayName, source (`builtin`/`custom`), provider (`typesafe`/`http`), providerModel, unique nonempty primitives (`choice`, `noul`, `score`), endpoint, optional secretRef, and enabled. Summaries add configured and an optional configurationReason naming a missing/blank or unreadable secret and the Settings, Secrets remedy. GET makes no provider request and does not establish reachability or valid provider authentication. GET orders built-in Jev first, then custom entries by id.

PUT requires strict custom HTTP metadata, including provider `http`; it rejects id, source, enabled, status fields, and credentials in the body. Creation starts disabled; replacement preserves enabled and clears an omitted secretRef. A PUT carrying `If-None-Match: *` creates only: when the id already exists it answers 409 `CLASSIFIER_EXISTS` and changes nothing, so a client that has not seen the current catalog (a list still loading, a stale tab) cannot replace an entry by adding one with the same id. Settings' Add sends it; Edit and scripts that mean to replace do not. Any other `If-None-Match` value is a 400 `VALIDATION_FAILED`. PUTs for one owner and id are serialized in the API process, so of two concurrent create-only requests exactly one creates the entry. PATCH accepts exactly enabled, even when a required secret is absent. Built-in `jev` is enable-only, seeded before recovery; restart refreshes managed metadata and preserves enabled. DELETE leaves secrets and published loop references intact. Classifier id syntax is `[a-z][a-z0-9_.-]{0,63}`; uppercase variants are rejected. Endpoint roots require HTTP(S) with no credentials, query, fragment, whitespace, port 0, or terminal `/v1/systemone` path. Authenticated endpoints require HTTPS except on loopback (`localhost`, `127.0.0.0/8`, `[::1]`); secretRef follows the Secrets name syntax.

| Code                           | HTTP | Meaning                                                 |
| ------------------------------ | ---- | ------------------------------------------------------- |
| `VALIDATION_FAILED`            | 400  | Invalid id or strict input, with field paths.           |
| `CLASSIFIER_MODEL_NOT_FOUND`   | 404  | Missing PATCH/DELETE target.                            |
| `CLASSIFIER_MANAGED_BY_SYSTEM` | 409  | PUT or DELETE of built-in `jev`.                        |
| `CLASSIFIER_EXISTS`            | 409  | Create-only PUT (`If-None-Match: *`) of an existing id. |

Decision events and output now use `{answer:{type:"choice",optionId,confidence,probabilities},portId,provenance:{kind,provider,classifierId,model,effort}}`. Every key is present; inapplicable or unknown historical values are null. The event additionally has `diagnostics`, limited to three entries for preserved pre-cutover skips. Fresh emissions undergo strict per-kind validation. This is a breaking contract; regenerate clients and use the offline upgrade tool for old exports and stored records.

Decision and exit-predicate failures never retain provider raw answers, messages, stacks or secret-bearing error bodies. Decisions use typed `EVALUATION_*` failures with explicit resumability; exit predicates retain their existing failure contract pending #99. Classifier probabilities must cover exactly the submitted stable option IDs. Unknown choices and malformed confidence are invalid responses, not reasons to try another evaluator. Persisted diagnostics contain only fixed safe text and validated identifiers/numbers.

## Validation agreement (Decided, WP-D2)

Classifier validation joins the same issue collection for create, import, draft save, validate and publish. It applies to `evaluation.kind: classifier` and its explicit `config.evaluation.model`, requiring Choice capability. Unknown models and unsupported capability are admission errors. Disabled, missing/blank-secret and unreadable-secret selections remain visible as diagnostics and block publication. Runtime rechecks the chosen entry and fails without fallback if it is unavailable.

`POST /loops`, `POST /loops/import`, `PUT /loops/{id}/draft`, `POST /loops/{id}/validate`, and `POST /loops/{id}/publish` report the same issue list: the `domain` rules (`validateLoop`, which includes Liquid and JSONata syntax checks), trigger checks such as cron syntax, and subloop references, which must name a loop of the same owner with a published version (`SUBLOOP_NOT_FOUND`, `SUBLOOP_NOT_PUBLISHED`; a loop may reference itself). `publishable` from validate is true exactly when publish would accept the draft. The editor runs the `domain` rules locally and adds the API-only issues from validate.

The API validates explicit and inherited model/effort selections within the selected harness. Unknown or wrong-harness models and unsupported effective effort are errors. Disabled or unconfigured models block publication. Loop and owner defaults use `defaults.byHarness`; process defaults use the same shape through `GG_DEFAULTS`. Precise node-relative paths identify decision `evaluation` selections and inference fields; loop diagnostics identify the selected harness entry. Runtime enforces the same resolution policy.

Known limitation: loop-default model warnings always check the Codex catalog, the only supported
inference harness. Revisit this check when a second harness exists so a model inherited by nodes
using different harnesses can be checked against each relevant catalog.

Exit predicates whose strategy is `jev` check built-in Jev in the same five admission endpoints. They report `CLASSIFIER_MODEL_DISABLED`, `CLASSIFIER_SECRET_MISSING`, or `CLASSIFIER_SECRET_UNREADABLE` warnings at node-relative `config.criteria.<index>.strategy`, naming the exit, model, and Settings remedy. These warnings block publication, as they do for other selected evaluators. If an already published predicate becomes unavailable and is evaluated, the exit fails with `DECIDER_UNAVAILABLE`. Codex exit predicates also validate their effective inherited model/effort and block publication when the selected model or harness is unavailable; the exit evaluation contract itself is unchanged.

## Draft conflicts (Decided, WP-F2, ADR-0015)

A draft has a version token, `draftToken`: a hash of the definition the next draft save replaces, which is the draft, or the published version when there is no draft. Equal content gives an equal token, so publishing (which keeps the content) does not change it. `GET /loops/{id}` returns it in the body and as the `ETag` header; `PUT /loops/{id}/draft` returns the new one the same way.

`PUT /loops/{id}/draft` with `If-Match: "<draftToken>"` saves only when the server copy still has that token; otherwise it answers 409 `DRAFT_CONFLICT` with the server's current token as the problem's `draftToken` extension member, and saves nothing. `*`, weak tags (`W/"…"`), and lists are accepted. Draft saves and publishes of one loop are serialized in the API process, so of two different saves with the same token exactly one wins; a stale save whose definition already equals the server draft is a no-op 200 rather than a conflict. Storage also refuses to modify a version row that is no longer a draft: a save racing a publish creates a new draft, and a published version never changes. A save without `If-Match` stays unconditional (last write wins), for scripts and the MCP `design-loop` flow. In the client, `loops.saveDraft(client, loopId, definition, { ifMatch })` sends the header and a conflict surfaces as `GraphGoblinApiError` with `code: 'DRAFT_CONFLICT'` and `problem.draftToken`.

`PUT /settings` validates the shared `defaults` value (`{byHarness:{codex:{model?,effort?}}}`). Catalog metadata default effort remains guidance, not a hidden resolver layer. Old owner `defaultModel` and `defaultEffort` values are converted offline. Deleting the `defaults` setting restores process defaults.

## Template catalog and instances (#28)

The owner-scoped API exposes `GET /templates`, `GET /templates/{id}`, `POST /templates/{id}/prerequisites`, `POST /templates/{id}/instantiate` and `GET /template-instances/{id}`. Catalog entries contain a manifest, settings schema, current defaults and a structured prerequisite report. Each failed check includes remediation and states whether it blocks authoring or runtime. Reports do not grant authority; instantiation repeats the checks using the submitted settings.

Instantiation returns `{instance, prerequisites}`. The instance records the installed template ID/version, owner, settings and allocated loop/version map. A single storage transaction creates the complete bundle and its immutable binding. Dependencies are published first; the parent remains a draft and does not start or arm its triggers. All declared subloops are remapped to their allocated child IDs and pinned versions. Separate creations have separate IDs. Settings fill declared literal data slots and role fields, never executable source strings. The generated client exposes `templates.list/get/prerequisites/instantiate/instance`.

The initial production catalog registers only the verified starter template. Repository recipe eligibility and effect authorization belong to the API integration, not the generic engine or domain bundle validator. Unregistered recipes cannot be created by guessing their IDs.

### Template subjects and run pagination

`GET /runs` returns `{items, nextCursor}` in descending creation-time and run-ID order.
Reuse the returned opaque `cursor` with the same filters; `nextCursor: null` ends the
listing. Equal creation timestamps do not skip runs. The default page size is 100,
with `limit` from 1 to 500. A malformed cursor receives `400 INVALID_CURSOR`.
The timestamp-only `before` filter is still available, but cannot accompany `cursor`.

Alongside `loopId`, comma-separated `status`, and `parent` (a run ID or `none`),
filters include lowercase `repository` (`owner/repository`), positive `issue` and
`pullRequest` numbers, exact 40-character lowercase `head` and `mergeSha`, and
`templateInstanceId`. Reads always remain scoped to the authenticated owner.
Both the typed client's `GET('/runs')` and the generated OpenAPI contract expose
the complete page; the convenience `runs.list` wrapper returns its items only.

Run-list items and `GET /runs/{id}` may include `templateSubject`. This API-owned
metadata describes a repository workflow's role, template instance/version,
repository, issue/attempt and relevant PR/head/merge SHA. A worker also names its
parent run, mapped subloop node and visit. Ordinary runs omit it. The generic
engine `RunRecord` and context thread do not acquire GitHub-specific fields.

The source is either `{kind: 'implementation', runId}` for an authenticated
implementation attempt or `{kind: 'external'}` for a trusted standalone PR.
A standalone review may have both issue and attempt set to null; it then has no
issue-label or rework authority. QA requires one unambiguous linked issue.
Linked external originals start at attempt one. The API derives and persists
these identities during admission; authored run input cannot assert them.
Repository recipes remain unregistered in this foundation release.
