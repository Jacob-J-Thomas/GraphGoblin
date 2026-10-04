# Changelog

All notable changes to GraphGoblin. The design is in [docs/](docs/README.md); the user guide is [docs/guide/](docs/guide/README.md).

## Unreleased

### Fixed

- Seeded Codex model catalog entries now list `max`, matching the editor. A database migration adds it to existing seeded entries whose efforts still match the original five as a set, preserving edited effort sets, display names, default efforts, and enabled states. The Codex adapter still maps `max` to `xhigh`.

## 1.0.0 - 2026-10-03

The first release: design, run, and observe agent loops on your own machine, with Codex as the harness.

### Loops and nodes

- Loop definitions as versioned graphs: drafts are edited, publishing freezes a version, and runs pin the version they started on.
- Nine node kinds: trigger, decision, inference, script, mutate, subloop, wait, heartbeat, and exit. Config schemas, the node reference (`docs/reference/nodes.md`), and editor forms are generated from one set of Zod schemas.
- Exit nodes with ordered criteria (max iterations, max duration, last output matching a JSON Schema, expression or decider predicates), an optional loop-back, a return mapping, and return channels (`caller`, `event`, `log`, `file`, `webhook`).
- Liquid templates and JSONata expressions, checked for syntax on validate, draft save, and publish.
- Validation that agrees across create, import, validate, draft save, and publish, including cron syntax and subloop references.
- `maxIterations` bounds exit loop-backs (the run ends `exhausted`) and fresh visits per node: a cycle outside an exit loop-back fails with `MAX_ITERATIONS`, naming the node.
- Export and import of loop definitions as JSON.

### Engine

- An owned executor with parallel runs (`GG_MAX_CONCURRENT_RUNS`), parking for waits, timers, heartbeats, and child runs, pause, resume, cancel, and crash recovery from the persisted event log.
- A context thread of messages, variables, artifacts, per-node outputs, and counters, changed only through recorded JSON patches; any event's thread can be reconstructed from the log, including a child run's seeded thread.
- Subloops as child runs with inherit, project, and fresh input modes, three output modes, and a depth limit.
- Typed failure reasons with a resume path, and no error ports (ADR-0006).
- Replay from a node: fork a new run at a node the source reached, with the thread from just before it.
- Model and effort resolve from the node, the loop defaults, the owner defaults in Settings, then the process defaults.

### Harnesses and deciders

- Codex through `@openai/codex-sdk` 0.160.0 using the machine's `codex login`: session policies, sandbox and approval settings, structured output with a repair policy, transcripts as artifacts, and cancellation.
- Decisions by JSONata expression, Jev (with a confidence threshold), or Codex, as an ordered fallback list.
- Scripts run as the API's user without a shell wrapper, with exit-code routes, patch output, and Windows process-tree kill.
- The Jev API key can be seeded from the environment: when no `jev-api-key` secret exists, the API stores `GG_JEV_API_KEY` (or `JEV_API_KEY`) in the encrypted secret store at first start; a stored secret always wins and the value is never logged.

### Triggers

- Manual, cron (time zones and the `skip`, `run-once`, and `run-each` missed-fire policies), signed webhooks (HMAC-SHA256, timestamp window, dedupe, size and rate limits), the inbound event bus with a self-trigger guard, and poll triggers.

### API

- REST for commands and an SSE event stream with cursor resume (ADR-0004), RFC 9457 problem details with stable codes, and an OpenAPI 3.1 document with interactive docs at `/docs`. The API reference (`docs/reference/api.md`) is generated from it.
- Local trusted mode by default; `GG_REQUIRE_API_KEY=true` requires hashed, scoped API keys on every non-public route.
- `graphgoblin-api --create-api-key <name> [--scopes a,b]` creates a key and prints it once without starting the server, for the first key in required-key mode.
- Draft conflict detection: `GET /loops/{id}` and `PUT /loops/{id}/draft` return a `draftToken` (body and `ETag`); a save with a stale `If-Match` answers 409 `DRAFT_CONFLICT`.
- Encrypted secrets (AES-256-GCM with a master key from `GG_MASTER_KEY` or `<data-dir>/master.key`), referenced by name and never returned.
- First-run preflight over `GET /system/preflight` and `--preflight`.
- `@graphgoblin/api-client`: a typed client generated from the OpenAPI document, resource wrappers, `subscribeRunEvents`, and `waitForRun`.

### Web app

- A React PWA served by the API under `/app/`: loops, editor, runs, run inspector, events, and settings.
- Editor: canvas with palette and keyboard-accessible Connect form, schema-generated property panels, live validation with the API's own checks, debounced autosave mirrored to IndexedDB, a reload-or-overwrite choice when another tab or device saved the draft, and publish.
- Run inspector over SSE: timeline, thread at any event, patch diffs, input and signal forms, pause, resume, and cancel; runs with thousands of events open in about half a second.
- Settings for the model catalog, owner defaults, secrets, API keys (the app asks for a key when one is required), and the harness preflight.
- Offline shell and a confirm-to-update prompt for new versions.

### MCP and Codex plugin

- `apps/mcp`: fourteen tools (list, describe, start, wait, inspect, control, input, signals, events, and `replay_run`) and run resources over stdio and Streamable HTTP.
- `apps/plugin-codex`: a Codex plugin marketplace with the MCP server and the `run-loop`, `design-loop`, and `inspect-run` skills.

### Install and distribution

- `scripts/install.ps1` and `scripts/install.sh`: check prerequisites, install, build, create the data directory, and run the preflight.
- `pnpm start` at the repository root; the API serves the checkout's web build by default.
- A container image (`Dockerfile`) and `docker-compose.yml`: the API, the web app, and the Codex CLI as a non-root user with a `/data` volume and a health check.
- The data directory defaults to `~/.graphgoblin`. Development builds before 1.0 defaulted to `./data` under the working directory; set `GG_DATA_DIR` to keep using such a directory.

### Known limitations

See "Residual risks and post-1.0 backlog" in [docs/12-implementation-plan.md](docs/12-implementation-plan.md) and the "After 1.0" notes in the guide.
