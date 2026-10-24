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
  GET    /loops/{id}/versions           version history: published versions and the draft (no draft snapshots)
  GET    /loops/{id}/versions/{vid}     one version, draft or draft snapshot, with its definition (a run's versionId)
  GET    /loops/{id}/export             definition as JSON for committing to a repo
  POST   /loops/import                  create or update from exported JSON
  DELETE /loops/{id}                    delete loop, versions, drafts, triggers and all run history; 204, 404 or 409

Runs
  POST   /loops/{id}/runs               start a run from a manual trigger; body: { triggerNodeId?, input?, return?: ReturnChannel[], versionId?, allowDraft? }; 202 { run } with its pin
  GET    /runs                          owner-scoped list with run/template filters and a stable nextCursor
  GET    /runs/{id}                     snapshot: pinned definition, status, current node, iteration, waiting spec, result, failure
  GET    /runs/{id}/thread              current context thread projection
  GET    /runs/{id}/events?after=N      page of events; with Accept: text/event-stream, a live tail
  POST   /runs/{id}/cancel | pause | resume
  POST   /runs/{id}/input               body: { waitId, input }; observed identity and inputSchema validated
  POST   /runs/{id}/signals/{name}      body: { waitId, payload? }; deliver to the observed wait
  POST   /runs/{id}/replay              fork a new run at a node; body: { nodeId }; 202 { run }; 409 REPLAY_NODE_NOT_REACHED (see 05)

Triggers and events
  POST   /triggers/cron/preview         next cron slots without saving or arming; loops:read
  POST   /hooks/{endpointToken}         webhook receiver (None or HMAC; JSON/text/bytes); 202 {accepted:true} after atomic receipt claim, asynchronous dispatch (1 MiB, rate limit; 422 WEBHOOK_PAYLOAD_TOO_DEEP above nesting depth 994; see 08)
  GET    /loops/{id}/triggers           schedules, webhook endpoints (path only, never the secret), armed poll triggers
  POST   /events                        targeted Event intake; body: { loopId, triggerNodeId?, type, payload?, dedupeKey? }; durably accepts one entry, returns admissionId, target, delivery, runIds and duplicate
  GET    /events?type=&before=&limit=   stored inbound events (API, webhooks), newest first

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
  GET    /harness/preflight             Configured harness capabilities and local login?
  GET    /system/preflight              first-run checks: Node, data dir, master key, database, harnesses, Jev, default model (11)
  GET    /openapi.json   GET /healthz   GET /version   (all public; Swagger UI at /docs when enabled)
```

Run and inbound-event lists are paginated with opaque cursors. Loop listings return every owner loop with its latest-run summary and exact run count. Loop/run ids are ULIDs; classifier ids are bounded URL-safe names, with `jev` reserved for the built-in.

Webhook endpoint summaries expose nested safe `authentication`, pinned `body`, `eventType`,
optional `dedupeKey`, and `configurationAvailable`. Secret references are names only. Webhook and Event configs reject `filter`; payload checks belong in downstream decisions. Historical `filtered` receipt states remain readable.
`GET /events` exposes that summary under optional `webhook` for webhook deliveries, retaining the
existing delivery state/attempts/retry/failure/run-link fields. Disabled orphans mark configuration
unavailable. Enabled mismatches log a safe warning while both listings stay readable; intake still
refuses with `HOOK_NOT_READY`. Events lookups share request-local endpoint/version/loop caches. Public hooks return only
`202 {accepted:true}` after saving; raw-byte authentication precedes decoding/extraction. See 08
for `EVENT_TYPE_AMBIGUOUS` (400), `EVENT_TYPE_INVALID` (422), bounds and exact recipes. Invocation
event metadata does not change `POST /events` or publish anything to the bus.

The owner-scoped `GET /runs/diagnostics` endpoint (`runs:read`) identifies unreadable run rows or event history with `HISTORY_UNREADABLE`, a run ID, and a readable reason. It changes no persisted status or history; see the crash-recovery and troubleshooting procedures.

Diagnostics are paged by `nextCursor`; pass it back as `?cursor=...` until null. Each request checks at most 20 runs, two threads per run and 100 events per run (at most 2,000 events total). A long event history resumes within the same run. Ordinary run lists skip unreadable rows while advancing their cursor; diagnostics identifies those rows. A direct unreadable snapshot returns `STORED_RUN_INVALID` with its run ID; unreadable event pages retain `STORED_EVENT_INVALID`. Unrelated loop deletion continues to work; active run references still protect their own and reachable loops.

## Pinned execution limits (#243)

Run responses expose `pinned.limits`: `maxNodeVisits` defaults to 10 and
`runDeadlineSeconds` defaults to null (no deadline). Explicit null removes the visit
cap; an authored positive deadline starts at first execution and includes waits,
pauses and downtime. Queue time is excluded. Editing a loop or Settings cannot change
an existing run's pin. Expiry fails with non-resumable `RUN_DEADLINE_EXCEEDED` and
cancels awaited children; explicit Cancel remains `cancelled`. Observation deadlines
on client/MCP waits only stop observation and do not impose a run deadline.

## Artifact downloads

`GET /runs/{id}/artifacts/{artifactId}` returns the artifact's verified content, with SHA-256 checked before decoding. Missing artifact metadata or content returns `404 ARTIFACT_NOT_FOUND`; bytes that do not match the reference return `500 ARTIFACT_CORRUPT`, without serving partial or corrupt content. `ARTIFACT_CORRUPT` is an API problem code, not a run failure code. A publication failure during a run is the resumable run failure `ARTIFACT_WRITE_FAILED`, with the artifact `ref` in its details; resuming the run continues the recorded provider session (docs/05).

## Loop deletion

`DELETE /loops/{id}` commits the loop, versions, runs and their dependent rows together
(see [domain model](03-domain-model.md#deleting-a-loop-decided)). It returns 204 with no body
on success, 404 `LOOP_NOT_FOUND` for a missing or unowned loop, and 409 `LOOP_IN_USE` while any
run of the loop is queued, running, waiting or paused, or an active run or pending webhook
admission can still start it. The problem detail gives the reason and asks the user to cancel
the run or resolve the pending admission first. Refusals leave the loop, history and triggers
unchanged. References from other published definitions remain authored; their existence alone
does not block deletion.

## Loop definition inputs

Loop settings have model and effort defaults only. Select `config.harness` on each inference
node; omission defaults to Codex. Create, draft save, and validate request bodies use the
canonical `LoopDefinitionSchema`. `settings.defaults.harness` is rejected as an unknown key,
with its field path, regardless of its value.

`POST /loops/import` explicitly converts old-format bare definitions and portable
exports before current-schema admission. Its `201` response contains `loop`, `draft`,
validation `issues` and automatic conversion `notices` (`code`, `path`, `message`).
Current imports have an empty notices array. The web import result displays these
changes alongside validation issues.

Pending conversion returns `400 LOOP_FORMAT_UPGRADE_REQUIRED` with `errors.issues`
and hash-bound `errors.reviewItems`. The detail points to the [portable export
workflow](guide/08-offline-upgrade.md#convert-a-portable-export) and the offline
`--resolutions resolutions.json` file with its `v3` item map. Each conversion issue
is classified as `kind: "pending"` or `kind: "invalid"`. Mixed refusals include both
kinds and both correction and review instructions. Simply invalid old
source/envelopes return `LOOP_IMPORT_SOURCE_INVALID`; current envelope errors retain
paths such as `loop.settings.defaults.harness`, `formatVersion` or `exportedAt`
under `LOOP_IMPORT_ERROR`. Ordinary bodies use `VALIDATION_FAILED`.

Responses and exports use format 4. The server-store cutover remains separate:
unconverted stores still stop before ordinary migrations or recovery. No tolerant
runtime reader is added. See the CHANGELOG upgrade notes.

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

| Event            | Evidence                                                                                                                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exit.evaluated` | Terminal `{nodeId,outcome}`; no criteria or routing result. Appended atomically with completion.                                                                                                                                                                                                     |
| `decision.made`  | Stable `portId`, resolved `provenance`, evaluator-specific `observation`, and at most three factual `diagnostics`. Fresh route/classifier decisions have empty diagnostics. Gates additionally record `gate` with previous/current passes, repeat route, limits, elapsed seconds and stopping limit. |

Skip messages and failure diagnostics use fixed summaries and allowlisted codes; provider
error bodies, credential values, and raw response payloads are excluded. Codex reasoning
is its returned short justification, capped at 2,048 characters. Clients consuming the
strict contract must upgrade with the server; migration `0007` supplies empty skip lists
for historical decisions, whose missing evidence cannot be recovered. The offline converter also gives decisions recorded without skip evidence empty diagnostics, which means none were recorded.

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

Run snapshots include optional `deliveries` for outbound webhooks, with separate pending,
delivered or failed state, stable identity, attempts/budget, next attempt and typed last error.
REST run detail/list, the generated api-client, MCP `get_run` and `wait_for_run` preserve it.
`wait_for_run.finished` means execution finished, even with pending or failed delivery; call
`get_run` again to observe delivery. The inspector polls once per second while delivery is
pending. SSE still closes on execution's terminal event; subsequent JSON event pages expose
`delivery.queued`, `delivery.attempted`, `delivery.attempt_finished` and `delivery.finished`.
Unknown acknowledgement is never represented as non-delivery. The required
`acknowledgementUncertain` flag in each delivery snapshot retains earlier uncertainty even
when `lastError` is a later rejection and the final acknowledgement is accepted. The inspector
keeps its possible-duplicate warning in that case; rejection-only retries do not set the flag.
An invalid HTTP response status is a retryable `transport` error with unknown acknowledgement
and no `httpStatus`. See ADR-0043.

The `caller` return channel resolves at delivery time:

| Invocation source                                     | Delivery                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `manual.ui`, `manual.api`, `cron`, `webhook`, `event` | `result` on the run snapshot and `run.finished` event                                         |
| `manual.mcp`                                          | Also returned as the MCP tool result when the client waited; otherwise fetched with `get_run` |
| `subloop`                                             | Handed to the parent run's subloop output mapping                                             |

The file and log channels are delivered by the engine after the run finishes, with one `return.delivered` or `return.failed` event each; webhooks use the delivery journal above. There is no Event channel: a loop that needs another loop's result calls it as an awaited subloop (ADR-0044).

## MCP server (Decided)

`apps/mcp` (`@graphgoblin/mcp`) is a thin client over the REST API through `@graphgoblin/api-client`, built on `@modelcontextprotocol/sdk` 1.31. It identifies itself with `client: 'mcp'`, so runs it starts record the `manual.mcp` invocation source.

- **Configuration**: `GG_API_URL` or `--api-url` (default `http://127.0.0.1:4747`); `GG_API_KEY` or `--api-key`, sent as a bearer key and optional in local trusted mode.
- **Transports**: stdio by default (the `graphgoblin-mcp` binary, `node apps/mcp/dist/main.js`); Streamable HTTP with `--http [--port <n>] [--host <addr>]` (or `GG_MCP_PORT`, `GG_MCP_HOST`; default `127.0.0.1:4748`) at `POST /mcp`. HTTP is stateless: each POST gets its own server and transport, `GET` and `DELETE` answer 405, and when bound to a loopback address a request whose `Host` is not a loopback name is refused with 403.

Tools (each with a Zod input schema; descriptions tell the agent when to call it and what to do next):

| Tool                                    | Input                                                       | Behaviour                                                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_loops`                            | `query?`                                                    | Loops with `id`, `name`, `description`, `published`, `hasDraft`; `query` filters names and descriptions                                                                                                       |
| `describe_loop`                         | `loopId` (id or exact name)                                 | The published version (or the draft, with a note): triggers with type, `inputSchema`, and `startableFromMcp`; input waits with prompt and schema; exits with `default`, `returnMapping`, channel kinds        |
| `start_run`                             | `loopId`, `input?`, `triggerNodeId?`, `allowDraft?`         | Starts a manual trigger and returns `runId`, `versionId`, `definition` (the pin label) and `pinned` immediately; `allowDraft` runs a snapshot of the draft of an unpublished loop                             |
| `wait_for_run`                          | `runId`, `timeoutSeconds?` (1 to 600, default 60)           | Returns `{ finished: true, run }` at a terminal status, or `{ finished: false, status?, cursor?, waiting?, next }`; returns early when the run waits for input or is paused; `cursor` is the last event `seq` |
| `get_run`                               | `runId`                                                     | Run snapshot                                                                                                                                                                                                  |
| `get_run_thread`                        | `runId`                                                     | Context thread                                                                                                                                                                                                |
| `list_runs`                             | `loopId?`, `status[]?`, `parentRunId?`, `cursor?`, `limit?` | `{ items, nextCursor }`: compact runs, newest first; pass the opaque `nextCursor` as `cursor` with the same filters, even when `items` is empty; null ends the listing                                        |
| `read_run_events`                       | `runId`, `after?`, `limit?` (default 100)                   | `{ items, nextAfter, hasMore }`                                                                                                                                                                               |
| `cancel_run`, `pause_run`, `resume_run` | `runId`                                                     | Control; return the compact run. A run paused while parked resumes to `waiting` on the same wait, otherwise to `running` (05)                                                                                 |
| `provide_input`                         | `runId`, `waitId`, `input`                                  | Answers the observed input wait                                                                                                                                                                               |
| `send_signal`                           | `runId`, `name`, `waitId`, `payload?`                       | `{ woke, run }`                                                                                                                                                                                               |
| `replay_run`                            | `runId`, `nodeId`                                           | Forks a new run at `nodeId` with the thread from just before that node (`POST /runs/{id}/replay`); returns the compact fork with `replayOf` and a hint to call `wait_for_run`                                 |

`wait_for_run` uses the client's shared `observeRun` polling implementation, once a second,
with early returns for input and paused runs and MCP progress notifications when the caller
supplies a progress token. Its deadline covers pending HTTP requests, response bodies,
progress notification delivery and sleeps. At the deadline it returns `finished: false`
with the latest timely status and cursor. If no snapshot arrived, it omits status/waiting
and cursor fields and asks the caller to check again. `timeoutSeconds` must be an
integer from 1 to 600 (default 60). MCP request cancellation interrupts observation through the SDK's
cancellation error; it never calls the run cancellation endpoint. MCP clients have their
own tool timeouts (the plugin sets Codex's `tool_timeout_sec` to 660); agents keep calling
until `finished` is true.

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
- **Waiting.** `waitForRun(client, runId, { timeoutMs, pollMs?, signal? })` polls `GET /runs/{id}` until a terminal status or the deadline. Every GET and sleep receives a signal combining caller cancellation and the total observation budget. Caller abort rejects promptly with the signal's exact reason, including before the first request. The deadline resolves `{ finished: false, run? }` without waiting for an in-flight request or sleep, retaining only the last snapshot received before the deadline; when none arrived, `run` is omitted. The deadline result carries the last timely snapshot, which can be up to one poll interval old during normal polling (older if a request stalls). A zero budget makes no request. A timely terminal snapshot returns `{ finished: true, run }`. Late responses and rejections cannot change the settled result or trigger another poll. The first cancellation cause wins; a caller signal already aborted at entry wins over a zero deadline. Timers and caller listeners are removed on completion. `observeRun(client, runId, options, { stopWhen?, onPoll? })` shares these semantics while supporting MCP's early returns and progress reporting.
- **Observation and run cancellation.** Aborting a client wait or MCP request, reaching its deadline, or closing/aborting an SSE subscription stops observation only. The run continues. Cancelling the run requires the explicit `POST /runs/{id}/cancel` endpoint (`runs.cancel` / MCP `cancel_run`). SSE already passes its subscription signal into the fetch and body reader, including reconnects; closing or aborting resolves its `done` promise.

Both input and signal paths require the opaque `waitId` from `GET /runs/{id}` at `waiting.waitId`, or the `run.waiting` event at `wait.waitId`. The matching input or signal-mode answer is consumed once. Stale, unknown or already consumed identities return RFC 9457 409 `WAIT_MISMATCH` without appending another answer or replacing the accepted payload. A retry can finish the status acknowledgement and enqueue an earlier durable answer. A matching identity on a paused run returns 409 `INVALID_STATE` with a paused-run message; resume first, then answer the same observed wait. Missing identities are 400 validation errors. Input and signal acceptance retry at most ten conditional-append conflicts; a saturated caller receives `WAIT_MISMATCH` and must refresh its observed snapshot. Heartbeat signals are observations within the current logical visit; every accepted signal is counted once, and each new park has a new identity. The browser submits the identity associated with its displayed form. MCP callers obtain it from `get_run` or `wait_for_run`.

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

Decision evaluation failures never retain provider raw answers, messages, stacks or secret-bearing error bodies. Decisions use typed `EVALUATION_*` failures with explicit resumability. Exits only evaluate return mappings. Classifier probabilities must cover exactly the submitted stable option IDs. Unknown choices and malformed confidence are invalid responses, not reasons to try another evaluator. Persisted diagnostics contain only fixed safe text and validated identifiers/numbers.

## Validation agreement (Decided, WP-D2)

Classifier validation joins the same issue collection for create, import, draft save, validate and publish. It applies to `config.kind: classifier` at `config.model`, requiring the declared Choice, Noul or Score capability, without an exit predicate path. Expression source issues identify `config.jsonata`; LLM issues identify `config.instructions`, `config.model.value` or `config.effort.value`. Unknown models and unsupported capability are admission errors. Disabled, missing/blank-secret and unreadable-secret selections remain visible as diagnostics and block publication. Runtime rechecks the chosen entry and fails without fallback if it is unavailable.

`POST /loops`, `POST /loops/import` and `PUT /loops/{id}/draft` report catalog/configuration issues without CLI probes. `POST /loops/{id}/validate` and `POST /loops/{id}/publish` add fresh readiness issues. All share the same base checks: the `domain` rules (`validateLoop`, which includes Liquid and JSONata syntax checks), trigger checks such as cron syntax, and subloop references, which must name a loop of the same owner with a published version (`SUBLOOP_NOT_FOUND`, `SUBLOOP_NOT_PUBLISHED`; a loop may reference itself). `publishable` from validate is true exactly when publish would accept the draft. The editor runs the `domain` rules locally and adds the API-only issues from validate.

The API validates explicit and inherited model/effort selections within the selected harness. Unknown or wrong-harness models and unsupported effective effort are errors. Disabled or unconfigured models block publication. Loop and owner defaults use `defaults.byHarness`; process defaults use the same shape through `GG_DEFAULTS`. Precise node-relative paths identify decision `evaluation` selections and inference fields; loop diagnostics identify the selected harness entry. Draft creation, import and saving allow unresolved inherited model or effort defaults, returning catalog/configuration issues for later repair. They never probe harness readiness. Explicit validate, publish and manual API/MCP trigger start probe once per referenced harness per request, concurrently across harnesses; `/harness/preflight` supplies editor readiness separately. Manual trigger start returns 422 `HARNESS_NOT_READY` with typed readiness issues before a turn starts when prerequisites fail. Replay (`POST /runs/{id}/replay`) has a separate admission policy and does not perform this preflight: it can return 202, execute preceding mutations and then fail at an unready harness. Scheduled/webhook starts, internal subloops and resumes also retain their existing execution checks; see [no-turn readiness](06-harness-integration.md#no-turn-readiness-179). Explicit invalid node or loop selections still fail admission. Publication and runtime keep enforcing the full resolution policy.

Known limitation: loop-default model warnings always check the Codex catalog, the only supported
inference harness. Revisit this check when a second harness exists so a model inherited by nodes
using different harnesses can be checked against each relevant catalog.

## Draft conflicts (Decided, WP-F2, ADR-0015)

A draft has a version token, `draftToken`: a hash of the definition the next draft save replaces, which is the draft, or the published version when there is no draft. Equal content gives an equal token, so publishing (which keeps the content) does not change it. `GET /loops/{id}` returns it in the body and as the `ETag` header; `PUT /loops/{id}/draft` returns the new one the same way.

`PUT /loops/{id}/draft` with `If-Match: "<draftToken>"` saves only when the server copy still has that token; otherwise it answers 409 `DRAFT_CONFLICT` with the server's current token as the problem's `draftToken` extension member, and saves nothing. `*`, weak tags (`W/"…"`), and lists are accepted. Draft saves and publishes of one loop are serialized in the API process, so of two different saves with the same token exactly one wins; a stale save whose definition already equals the server draft is a no-op 200 rather than a conflict. Storage also refuses to modify a version row that is no longer a draft: a save racing a publish creates a new draft, and a published version never changes. A save without `If-Match` stays unconditional (last write wins), for scripts and the MCP `design-loop` flow. In the client, `loops.saveDraft(client, loopId, definition, { ifMatch })` sends the header and a conflict surfaces as `GraphGoblinApiError` with `code: 'DRAFT_CONFLICT'` and `problem.draftToken`.

`PUT /settings` validates the shared `defaults` value (`{byHarness:{codex:{model?,effort?}}}`). Catalog metadata default effort remains guidance, not a hidden resolver layer. Old owner `defaultModel` and `defaultEffort` values are converted offline. Deleting the `defaults` setting restores process defaults.

## Template catalogue and ordinary drafts (#165)

`GET /templates` and `GET /templates/{id}` require `loops:read` and return entries shaped exactly as `{manifest}`. They perform no prerequisite, provider, GitHub or secret probes. `POST /templates/{id}/draft` requires `loops:write`, accepts only an optional name, and creates one owner-scoped ordinary loop and editable draft. It returns `{loop, draft, issues}` without publication, run, child or binding. Ordinary invalid-configuration admission remains; missing login does not block authoring.

The prerequisite, instantiate and template-instance endpoints and their client helpers are removed. Loop detail no longer carries `templateInstanceId`; the editor performs no instance-origin lookup. The remaining client methods are `templates.list/get/createDraft`. Unknown catalogue IDs return 404 `TEMPLATE_NOT_FOUND`; trusted installed-asset failures return the fixed sanitized 503 `TEMPLATE_PACKAGE_INVALID`. Arbitrary server errors remain 500 `INTERNAL_ERROR`.

The loader and dormant configured contracts/services are removed in the next bounded #165 split. The four current manifests still carry configured metadata during this integration-only interval. No deployment or stored-data cutover is part of this child.

### Ordinary run listing and pagination

`GET /runs` returns `{items, nextCursor}` in descending creation-time and run-ID order.
Reuse the returned opaque `nextCursor` as `cursor` with the same filters; `nextCursor: null` ends the
listing. Equal timestamps are ordered by ID; IDs follow creation order within one process through a monotonic ULID generator, so ties do not skip runs. The default page size is 100,
with `limit` from 1 to 500. The run repository fetches one extra row (at most 501)
to determine whether another page exists. Cursors are bounded to 256 characters,
canonical base64url encodings of strict `{createdAt: Timestamp, id: ULID}` JSON.
A malformed, oversized or noncanonical cursor receives `400 INVALID_CURSOR`.
The timestamp-only `before` filter is an exclusive time bound, not a paging cursor; it composes with `cursor` and stays unchanged on every page.
Accepted `before` timestamps are normalized to UTC with milliseconds before comparison,
so offsets and omitted milliseconds select the same page as the canonical timestamp.

Filters are `loopId`, comma-separated `status`, `parent` (a run ID or `none`),
`before`, `cursor` and `limit`. Strict query validation rejects unknown filters,
including the removed `repository`, `issue`, `pullRequest`, `head`, `mergeSha`
and `templateInstanceId`. Reads always remain scoped to the authenticated owner.
The exclusive `(created_at, id)` boundary keeps newer insertions between requests
out of subsequent pages. Both `runs.list(client, query)` and MCP `list_runs` expose
`{items, nextCursor}`. Consumers never decode or reconstruct a cursor; repeat the active
filters and copy `nextCursor` unchanged into `cursor`. Pass it even when `items` is empty
because damaged rows were skipped; stop when `nextCursor` is null. Invalid statuses
(including empty or partly invalid comma-separated lists) receive `400 VALIDATION_FAILED`,
with a `/status` error explaining: "Use comma-separated run statuses."
MCP `list_runs` accepts `cursor` and its loop/status/parent filters; its parameters do not include `before`.

`GET /events` and `events.list(client, query)` return `{items, nextCursor}`, ordered by
`receivedAt DESC, id DESC`, using one lookahead row and the same 100 default / 500 maximum.
The opaque inbound cursor is distinct from a run-list cursor; malformed, oversized and
noncanonical values receive `400 INVALID_CURSOR`. The `type` and exclusive `before`
filters compose with `cursor`; keep them unchanged on subsequent pages. A cursor is a
position, not a snapshot: concurrent insertions ahead of it do not appear in older pages.
It encodes only a position; reusing it with different filters continues from that position
under the new filters. Inbound rows sharing a timestamp are ordered by ID, which follows
creation order within one process. Unknown query parameters return 400, and `before` must
be a timestamp. The inbound cursor has the same 256-character bound as the run cursor.

`GET /runs/{id}/events` retains its sequence-number continuation, returning
`{items, nextAfter, hasMore}`. One raw lookahead row determines `hasMore`; an exactly full
final page returns false. Only requested rows are decoded and validated: malformed
lookahead cannot fail a healthy page, but requesting that event still returns
`STORED_EVENT_INVALID`, including when it is in the middle of a larger page. Inbound
event and run lists likewise decode only their requested rows. `read_run_events`
forwards that authoritative API result.
This sequence cursor remains a number; it is not interchangeable with list cursors.

Runs and Events append older rows through a new outline **Load more** button.
Filters remain part of the query key and every page request; changing a filter selects
its own history. Runs expose loop/status/parent selects; Events has no hidden URL-only
filters. The control is busy only during a next-page fetch, so background polling does
not block it. End-of-list text appears after an append and receives keyboard focus
when that user-initiated load exhausts the list. Next-page failures retain the loaded rows and expanded details and
show an error with a retry through the same button. Runs retain their five-second polling;
Events retain pending-delivery polling. No manual Events refresh is added here.

### Pinned definitions (ADR-0041)

Every run, draft runs included, executes one immutable definition record for its whole life.
`RunRecord.versionId` names it and `RunRecord.pinned` describes it:
`{ source: 'published' | 'draft', version, name, label, defaults: { owner, process }, classifiers }`,
where `classifiers` maps each classifier id the definition uses to the catalog binding it calls
(`provider`, `providerModel`, `endpoint`, `primitives`, `secretRef?`; never the secret value).
The start responses (`POST /loops/{id}/runs`, `POST /runs/{id}/replay`, MCP `start_run`) return it,
and the first event of every run, `run.queued`, carries the same `versionId` and `pinned`, so the
SSE stream identifies the definition before anything runs. A draft start
(`{ versionId: <draft id>, allowDraft: true }`) answers with a new `versionId`: the draft snapshot
taken at start, readable at `GET /loops/{id}/versions/{versionId}` (status `snapshot`) and never
listed in the version history. Starting a snapshot directly answers 409 `VERSION_NOT_PUBLISHED`.
`label` and `name` are those of the pinned definition, so renaming or editing the loop later does
not change them. MCP compact runs (`list_runs`, control tools) include `definition`, the label.

**Stored definitions that predate ADR-0044 (#242).** A version, draft or draft-run snapshot saved
before exits stopped publishing Events can still hold an exit destination `{ kind: "event" }`.
It is refused before it is served or run, never dropped silently: `GET /loops/{id}`,
`GET /loops/{id}/versions`, `GET /loops/{id}/versions/{versionId}`, `GET /loops/{id}/export`,
`POST /loops/{id}/publish`, `POST /loops/{id}/runs` and `POST /runs/{id}/replay` answer 409
`LOOP_UPGRADE_REQUIRED` with the extension members `loopId`, `versionId`, `version` and `paths`
(JSON Pointers to each such destination); the `detail` explains the repair. A run already pinned
to such a definition fails before its next node with `failure.code` `LOOP_UPGRADE_REQUIRED`
(`resumable: false`, the same identity in `details`), and a parent whose subloop would start or
awaits such a loop fails with it at its subloop node. Repair: replace the destination with a
Subloop call and publish. A published version or draft that still holds one can be repaired by
removing the destination from its stored JSON by hand with GraphGoblin stopped; a draft-run
snapshot cannot be edited even then (migration 0014's immutability trigger), so delete the loop
once its runs are terminal (`DELETE /loops/{id}` still works and removes its runs and snapshots)
or reset the store. The store-level startup check does not refuse a definition whose only
departure from the current contract is such a destination (in the former channel's exact shape,
`{ kind: "event", eventType: <slug> }`), so the API starts and the refusal stays per loop. The
offline format cutover (`inspect`/`apply`) still converts every definition strictly: a store
holding such a destination needs explicit repair, loop deletion or a reset before a cutover.

Run-list items and `GET /runs/{id}` return the canonical `RunRecord`, without
`templateSubject` or a template-store lookup. Regenerate strict clients for these
response and query changes. Existing template runtime subjects remain internal
until the later retirement; this paging change does not delete instances or bindings.

The source is either `{kind: 'implementation', runId}` for an authenticated
implementation attempt or `{kind: 'external'}` for a trusted standalone PR.
A standalone review may have both issue and attempt set to null; it then has no
issue-label or rework authority. QA requires one unambiguous linked issue.
Linked external originals start at attempt one. The API derives and persists
these identities during admission; authored run input cannot assert them.
Repository recipes remain unregistered in this foundation release.

Ordinary copied drafts use the ordinary engine resume behavior. The API installs no template admission, execution, resume or reporting policy. Dormant configured runtime modules await deletion in the next #165 split.

### Loop listing summaries

`GET /loops` returns `{items}` with `latestRun: {id, status, createdAt} | null` and an
exact `runCount` on each loop. One SQL statement selects each authenticated owner's
loops, joins its latest run through a correlated `ORDER BY created_at DESC, id DESC LIMIT 1`
subquery, and counts that loop's owner-scoped runs. The covering
`runs_loop_owner_history_idx (loop_id, owner_id, created_at, id)` index supports both
lookup and counting (migration `0016_loop_owner_history`). There is no global
history-page limit or N+1 API fan-out. A null summary with `runCount: 0` means no history.
The selected latest row's run record (including its pin), `initial_thread` and any
present `thread_snapshot` pass through the shared strict decoders used by run and
recovery readers before its summary is returned. An absent cached snapshot (SQL
NULL) remains valid: readers rebuild from the initial thread and event log. Damage in any
of those stored values makes `latestRun` null while its row remains counted; an
older run is never substituted. Only the selected latest row is decoded, not every
run in the loop. Its event log also passes the same strict decoder as recovery, in
batches of at most 100 rows, stopping at the first unreadable event, which likewise
makes `latestRun` null. Recovery logs
failures without retaining a reusable set; diagnostics scans on demand. The repository
therefore caches event readability by latest-run identity and event count (one entry
per loop). Each listing counts events using the run-event index; unchanged histories
need no event decoding or payload reads. Counting still walks that run's indexed
entries. An append or a different latest run invalidates the cache.
Cold validation is linear in the selected history up to its first bad event, with
bounded batch memory; it never scans older runs. Out-of-band edits or repairs that
leave the count unchanged require an API restart. Database failures remain errors,
not cached unavailability. Recovery refuses damaged records, threads and events
before repairing status; checking these boundaries here too prevents a valid but
stale status column from becoming a badge after
a damaged snapshot missed a terminal update, including after restart. The UI says
"latest run unavailable" and directs the operator to run history diagnostics (`GET /runs/diagnostics`).
Healthy loops remain available; database read failures remain errors. Loops refresh their summaries every five seconds; deletion confirmation uses
the exact server count.

## Gate admission and terminal outcomes (#164 E1)

Create, import, draft save, validate and publish share the gate and terminal-exit schemas and graph checks. A missing `maxPasses` points at `nodes.<index>.config.maxPasses`; node-relative issues use `config.maxPasses`. Multiple repeat markers identify the extra `config.routes.<index>.repeat`, `config.answer.options.<index>.repeat`, Noul side or Score band path. A noncyclic repeat is `REPEAT_ROUTE_NOT_CYCLIC`; a missing Limit reached connection is `PORT_UNCONNECTED` at `config.maxPasses`. Reserve `limit-reached` in all authored route IDs.

Exits are terminal: `{outcome, returns, destinations}`. `outcome` is `success` (default), `failure` or `exhausted`; `returns` is a JSONata expression or `none` (default); `destinations` defaults to `[{kind:"caller"}]` and supports caller, webhook, file and log (no Event channel; loops compose as awaited subloops, ADR-0044). Exits have no criteria, predicate, default routing or loop-back, and no output ports.

Success finishes `succeeded`, Failure finishes `failed`, and Exhausted finishes the distinct terminal status `exhausted`. Exhausted means the authored graph gave up further repetition; normally a gate's Limit reached output leads here. It is an outcome, not a resumable node failure. Every outcome evaluates the same return expression and delivers its value unchanged; Exhausted adds no wrapper or implicit last output. Use `outputs.<workNodeId>.value` when returning work output, because the preceding gate replaces `lastOutput`.

JSON event pages, SSE, generated clients and MCP use the same `exhausted` status. SSE and MCP waiting stop on it. `run.finished` carries status/outcome; `run.result` carries the return value, including on Failure or Exhausted. A failed exit outcome has no resumable failure object. See [ADR-0036](decisions/ADR-0036-decision-gates-terminal-exits.md).

### Targeted Event intake (#343)

`POST /events` requires `{loopId, type, payload?, dedupeKey?, triggerNodeId?}` and `events:write`, plus ownership of the loop. A new request selects one matching Event trigger of the current published version; ambiguous matches require `triggerNodeId`. There is no broadcast form. `events.publish(client, body)` uses this same generated request contract. MCP currently has no tool that publishes an Event, and the web app only lists inbound Events.

The 202 response is the saved Event with `duplicate`, durable `admissionId`, pinned `target: {loopId, versionId, triggerNodeId}` and current `delivery`. `runIds` is empty until atomic run admission. `GET /events` exposes the same target and delivery state. Keyed retries return the original delivery, even across later publication, in owner/loop/trigger/type scope. Missing/invalid body fields are 400 `VALIDATION_FAILED`; foreign/missing loop 404 `LOOP_NOT_FOUND`; no published version 409 `VERSION_NOT_PUBLISHED`; unmatched/ambiguous entry 422 `EVENT_TRIGGER_NOT_FOUND`/`EVENT_TRIGGER_AMBIGUOUS`; failed key expression 422 `EVENT_KEY_EXPRESSION_FAILED`; excessive payload depth 422 `EVENT_PAYLOAD_TOO_DEEP`; unconfirmed persistence 503 `EVENT_ADMISSION_FAILED`; unreadable stored delivery on a keyed retry 500 `STORED_EVENT_INVALID`. See [08](08-triggers-and-integrations.md#inbound-events-decided-targeted-durable-admission-adr-0048) for retry, nesting and permanent key semantics. URL webhook acknowledgements remain exactly `{accepted:true}`.

Targeted Event request keys must contain well-formed Unicode (400 `VALIDATION_FAILED` otherwise); an authored key that cannot be stored as valid Unicode is refused with 422 `EVENT_KEY_INVALID`. This prevents SQLite text normalization from changing an accepted identity.
