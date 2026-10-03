# 02 - Architecture

## Stack (Decided)

| Layer                | Choice                                                                                                                | Notes                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Language and runtime | TypeScript on Node 22 LTS, everywhere                                                                                 | Shared schemas end to end. Codex has a TypeScript SDK only. |
| Monorepo             | pnpm workspaces, Turborepo, TS project references                                                                     | One repo, many packages.                                    |
| Layer enforcement    | dependency-cruiser rules, package `exports` maps, declared package dependencies                                       | The .NET class-library model. Violations fail CI.           |
| HTTP                 | Fastify 5, Zod type provider, OpenAPI 3.1 generation                                                                  | Plain, fast, testable.                                      |
| API contract         | Zod schemas in `packages/contracts` generate the OpenAPI document and the typed client                                | One definition, three consumers.                            |
| Run state            | REST commands, SSE event stream with sequence cursors, snapshot endpoint, outbound webhooks                           | See 07.                                                     |
| Workflow runtime     | Own event-sourced executor behind a `WorkflowRuntime` port                                                            | LangGraph.js is the recorded alternative. See ADR-0002.     |
| Persistence          | SQLite in WAL mode via better-sqlite3, Drizzle ORM, checked-in migrations                                             | Postgres is the hosted path.                                |
| Scheduling           | croner, schedules persisted in the DB and re-armed at boot                                                            | Also drives wait and heartbeat timers.                      |
| Harness              | `@openai/codex-sdk` in `packages/adapter-codex`                                                                       | Only harness in 1.0. See 06.                                |
| Decisions            | Jev via `@typesafe-ai/sdk`; Codex structured decision; JSONata expressions                                            | See 04.                                                     |
| Templating           | LiquidJS                                                                                                              | Safe templates for prompts and mappings. No code execution. |
| Expressions          | JSONata                                                                                                               | Routing predicates, mappings, redaction selectors.          |
| Frontend             | React 19, Vite, `@xyflow/react`, Zustand, TanStack Query, Tailwind, shadcn/ui, CodeMirror 6, react-hook-form with Zod | See 09.                                                     |
| PWA                  | vite-plugin-pwa with Workbox, `registerType: 'prompt'`                                                                | User confirms updates.                                      |
| MCP                  | `@modelcontextprotocol/sdk`, stdio and Streamable HTTP, implemented over the generated API client                     | See 07.                                                     |
| Testing              | Vitest with v8 coverage thresholds, Testing Library, Playwright, MSW, recorded Codex fixtures                         | See 10.                                                     |
| CI                   | GitHub Actions, Renovate                                                                                              | See 10.                                                     |
| Logging and tracing  | pino; OpenTelemetry with a run as a trace and a node as a span                                                        | Exporters are optional.                                     |
| Secrets              | AES-256-GCM envelope encryption in `node:crypto`; master key from env or OS keyring                                   | See 11.                                                     |
| IDs and time         | ULIDs; UTC ISO-8601 strings                                                                                           | Sortable ids make event logs and run lists cheap.           |

## Layering (Decided)

The repo is split into packages the way a .NET solution is split into class-library projects. A package may only import packages its manifest declares, dependency-cruiser enforces direction, and each package exposes a deliberate public surface through its `exports` map.

| Package     | .NET analogue           | Allowed dependencies                                         |
| ----------- | ----------------------- | ------------------------------------------------------------ |
| `contracts` | Shared models assembly  | `zod` only                                                   |
| `domain`    | Domain class library    | `contracts`                                                  |
| `engine`    | Application services    | `contracts`, `domain`                                        |
| `adapter-*` | Infrastructure projects | `contracts`, `domain`, `engine` ports; never another adapter |
| `apps/*`    | Hosts                   | Anything; they are the composition roots                     |
| `tooling`   | Build props             | none                                                         |

## Package layout (Decided)

```
packages/
  contracts/          Zod schemas and types: loop definition, node configs, context thread,
                      run events, API DTOs, MCP tool schemas. Depends on zod only.
  domain/             Pure logic: graph validation, thread operations and JSON Patch,
                      exit criteria, iteration counters, run state machine. No I/O.
  engine/             Executor, node handlers, run manager, written against ports:
                      HarnessPort, DeciderPort, ScriptPort, EventStorePort, RunRepository,
                      LoopRepository, WorkspacePort, SecretsPort, ClockPort, TimerPort, SignalPort.
  adapter-codex/      HarnessPort over @openai/codex-sdk. Optional install.
  adapter-jev/        DeciderPort over @typesafe-ai/sdk.
  adapter-sqlite/     Drizzle schema, repositories, event store, migrations.
  adapter-scheduler/  TimerPort and cron over croner, persisted schedules.
  adapter-fs/         WorkspacePort: working directories, context files, file return channel.
  adapter-http/       Outbound webhooks and HTTP probes for heartbeat and polling.
apps/
  api/                Fastify composition root: REST, SSE, OpenAPI, auth, static PWA hosting.
  mcp/                MCP server over the generated API client.
  web/                React PWA.
  plugin-codex/       Codex plugin: MCP server registration plus skills.
tooling/              Shared tsconfig, eslint config, dependency-cruiser rules, licence allowlist.
```

Post-1.0 packages: `adapter-claude`, `adapter-litellm`, `adapter-postgres`, `apps/runner`, `apps/plugin-claude`.

## Ports owned by the engine (Draft)

| Port                            | Responsibility                                                             | 1.0 implementation                                         |
| ------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `HarnessPort`                   | Start, resume, stream, and cancel a harness session                        | `adapter-codex`                                            |
| `DeciderPort`                   | Answer a typed choice or yes/no question with confidence                   | `adapter-jev`, Codex-backed decider over `StructuredPort`  |
| `StructuredPort`                | One schema-shaped completion: used for schema repair and Codex decisions   | `adapter-codex` (a read-only Codex thread)                 |
| `ScriptPort`                    | Run a process with stdin, capture stdout and exit code, kill on cancel     | `adapter-process` over `node:child_process` with tree kill |
| `EventStorePort`                | Append and read run events by sequence; notify live subscribers            | `adapter-sqlite`                                           |
| `RunRepository`                 | Runs, thread snapshots, and compare-and-set status transitions             | `adapter-sqlite`                                           |
| `LoopRepository`                | Loop versions by id, latest published, pinned version                      | `adapter-sqlite`                                           |
| `HarnessSessionRepository`      | Session ids per run, node, and attempt; named session scopes               | `adapter-sqlite`                                           |
| `WorkspacePort`                 | Resolve a run's working directory; write context files; write file returns | `adapter-fs`                                               |
| `ArtifactStorePort`             | Store transcripts and other large payloads by reference                    | `adapter-fs`                                               |
| `SecretsPort`                   | Resolve named secrets                                                      | `adapter-sqlite` plus `node:crypto`                        |
| `ClockPort`, `IdPort`, `Logger` | Time, ULIDs, structured logging                                            | real and fake                                              |
| `TimerPort`                     | Schedule a wake-up for a run at a time; survives restart                   | `adapter-scheduler`                                        |
| `HttpProbePort`                 | HTTP requests for heartbeat and poll probes                                | `adapter-http`                                             |
| `ReturnDeliveryPort`            | Outbound webhooks, internal event bus, log sink for return channels        | `adapter-http` plus the API's event bus                    |

Signals and inputs are delivered through the `RunManager` itself, which the API calls directly. Templating and expressions are pure functions in `domain`, not ports.

The engine must boot and pass its full test suite with fake implementations of every port. That is how it reaches the coverage bar without spending tokens. `@graphgoblin/engine/testing` exports those fakes plus a scenario helper for other packages' tests.

## Process topology

### 1.0: one process on a laptop (Decided)

```
+---------------------------- apps/api (one Node process) ----------------------------+
|  Fastify: REST + SSE + OpenAPI + static PWA     Scheduler (cron, timers)             |
|  Run manager + executor (engine)                Signal bus (inputs, signals)         |
|  adapter-sqlite ---> graphgoblin.db (WAL)       adapter-fs ---> working directories  |
|  adapter-codex  ---> spawns `codex` CLI per inferencing node                         |
|  adapter-jev    ---> https (Jev API)            adapter-http ---> webhooks, probes   |
+--------------------------------------------------------------------------------------+
         ^ browser (PWA)        ^ other apps (REST, API key)       ^ MCP server (stdio or HTTP)
```

The API binds to localhost by default. Codex authentication is whatever `codex login` set up on the machine. GraphGoblin stores no Codex credentials.

### Post-1.0: hosted (Draft)

The executor already hands each node execution to a `Runner`. In 1.0 the only runner is in-process. Later, a remote runner is a small agent on a developer machine or in a container that pulls node executions and pushes events over the same event protocol, like a self-hosted CI runner. Combined with owner ids on every table, the auth-provider interface, Postgres-compatible SQL, and a scheduler lease, this is what makes the hosted version a small change rather than a rewrite.

## Cross-cutting concerns (Decided)

- **Configuration**: environment variables for process-level settings, a `settings` table for user-level defaults such as model and effort.
- **Logging**: pino, JSON in production, pretty in development, with run id and node id on every line inside a run.
- **Tracing**: OpenTelemetry. A run is a trace, a node is a span, a harness session is a child span with usage attributes. Exporters off by default.
- **Thread mutation**: nodes return RFC 6902 JSON Patch documents. The engine applies them, validates the result against the thread schema, and stores the patch in the event.
- **Templating and expressions**: LiquidJS for text, JSONata for data. Neither executes user code.
- **Errors**: typed error codes in `contracts`. Every run failure carries one. See the resiliency model in 05.
- **Model catalog**: a small table seeded with Codex models and effort levels, editable in settings. See 06.
