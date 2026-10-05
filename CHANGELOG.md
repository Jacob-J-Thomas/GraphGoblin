# Changelog

All notable changes to GraphGoblin. The design is in [docs/](docs/README.md); the user guide is [docs/guide/](docs/guide/README.md).

## Unreleased

### Added

- Settings → **Classifier models**, below the model catalog (#43): built-in Jev and the HTTP classifiers you register, each with its provider and model name, capabilities (Choice shown as "Choice / classification"), whether it is configured (**Needs a key** with the reason and a link to Secrets), and an Enabled switch. Jev can only be enabled or disabled, and its switch says that disabling it also stops Exit predicates that use Jev. **Add classifier**, **Edit**, and **Delete** (with a confirmation naming the consequences) manage custom entries; the form checks the id, names, endpoint, capabilities, and the https-with-a-secret rule against the contract before sending, and offers the owner's secret names for the bearer key. Setting or deleting a secret refreshes the classifiers' status. The decision node's **Jev → Model** picker, shown even before the decision has Jev settings, offers built-in Jev as the default and the enabled classifiers with Choice, flags one that needs a key, and keeps a disabled, deleted, or Choice-less selection visible with the reason instead of clearing it; the node's classifier warnings follow catalog and secret changes without a draft edit. `PUT /classifier-models/{id}` accepts `If-None-Match: *` to create only (409 `CLASSIFIER_EXISTS` for an existing id), and api-client adds `classifierModels.create`; Settings' Add uses it, so it never replaces an entry it had not loaded. Both themes, keyboard operation, and 768 px; see the Settings guide, Configure classifier models.
- Catalog Model and Effort pickers for inference nodes, loop defaults, and decision Codex settings. Missing or disabled models and unsupported efforts stay selected and flagged; an unavailable catalog keeps current values read-only until recovery. Each model picker links to the model catalog in Settings (#16).
- Node editor: cron triggers get a schedule builder with six presets, a searchable time zone picker with Use my time zone, a plain-language summary, and the next five runs in the trigger's zone and yours from the new read-only `POST /triggers/cron/preview` (`loops:read`); the raw expression stays under the schedule's Advanced toggle and custom expressions are kept unchanged (#20).
- Node editor: the inference, decision, script, and subloop dialogs show their basic options first and keep the rest under a collapsed **Advanced** group, in headed sections; while collapsed it says how many of its options are set and how many have problems, and following an issue to an option inside opens it. Trigger, wait, heartbeat, and exit keep every option in sight. A mutate node's operations collapse to one line each (their kind and path). Every node config field has a description in its schema's metadata, shown as the field's help and in the generated node reference, which marks the advanced fields (#14).
- Undo and redo in the loop editor: every change to the draft, from the toolbar's Undo and Redo buttons (named by the change they make) or with Ctrl+Z and Ctrl+Shift+Z or Ctrl+Y (Cmd+Z and Cmd+Shift+Z on a Mac) outside text fields. Typing in one field and one drag are one step each; an undo is saved like any edit; the editor keeps the last 100 steps until it reloads (#17).
- Separate owner-scoped classifier model catalog, with built-in Jev and registered HTTP Choice endpoints using lowercase ids. REST `GET /classifier-models` and `PUT`, `PATCH`, `DELETE /classifier-models/{id}` use settings scopes; PUT with `secretRef` additionally requires `secrets:write`. Authenticated endpoints require HTTPS except on loopback. api-client `classifierModels` wraps these routes. Configured status derives from usable referenced secrets without provider calls.
- Optional Decision `jev.model` catalog selection, shared publish diagnostics, immutable runtime client snapshots with catalog/secret refresh, and `decision.made.classifierModel` provenance. Exit Noul keeps built-in Jev. Kev-4B owner serving/licence/protocol research is documented; model serving is external.

### Changed

- `GET /api-keys` requires a `current` boolean on every list item, identifying the key authenticating that request when keys are required. Settings marks it as **This browser** and warns before revoking it; when a browser stores a key but no row is marked, confirmations explain the possible sign-out and **Forget key** recovery. Changing keys refreshes the marker, and late 401 responses from a previous key no longer show the key panel.
- Model catalog entries now expose source. Harness models, including all migrated legacy rows, can only be enabled/disabled through PATCH; PUT/DELETE return `MODEL_MANAGED_BY_HARNESS`. Existing LiteLLM rows remain editable/deletable, while new LiteLLM entries return `LITELLM_NOT_CONFIGURED` pending provider support.
- Startup refreshes seeded harness names, efforts, and default efforts while preserving enabled. Hand-added legacy metadata remains intact. Validate/publish return advisory disabled/missing-model warnings with field paths, and successful publish now includes issues.

### Upgrade notes

- Migration `0006` adds `classifier_models`; startup seeds managed Jev metadata before recovery while preserving enabled. The new table does not rewrite loop definitions, versions, runs, events, secrets, or LLM catalog data; earlier migrations still apply their intended changes. Omitted `jev.model` defaults to catalog `jev`. Rebuild generated-client consumers together; older strict readers may reject exports containing explicit classifier selection.

- Harness is chosen on inference nodes only. Loop `settings.defaults` now contains model and effort; `settings.defaults.harness` is gone.
- On the first startup after upgrade, migration `0005` removes that field from stored loop versions. Node harnesses, version ids and numbers, published timestamps, and run pins are preserved.
- Exports and API clients that still send the field are rejected with its field path. Remove it before import or create/save/validate. For a bare definition or export envelope:

  ```sh
  jq 'del(.settings.defaults.harness, .loop.settings.defaults.harness)' old-loop.json > loop.json
  ```

- Device drafts saved before this change are discarded by a one-off IndexedDB store upgrade, including set-aside copies. The server copy remains available. New in-progress drafts persist across reloads, including drafts with schema errors.
- Close other GraphGoblin tabs and windows after updating so the device-draft store can upgrade.
- To roll back after migration `0005`, stop the API and restore the pre-upgrade backup of the data directory before running the previous release. The previous release requires the removed field in its loop responses. Alternatively, with the API stopped, restore the field and remove only the `0005` ledger entry:

  ```sql
  UPDATE loop_versions SET definition = json_set(definition, '$.settings.defaults.harness', 'codex') WHERE json_extract(definition, '$.settings.defaults.harness') IS NULL;
  DELETE FROM __drizzle_migrations WHERE created_at = 1791152101266;
  ```

  This manual rollback does not recover edited seed metadata; restore the pre-upgrade backup for that. Re-upgrading applies `0005` again. Current exports and API clients must still use the canonical definition shape.

### Fixed

- Settings model catalog: when another refresh removes a row while its Enabled switch is saving and the API then answers 404, focus moves to the section heading instead of staying on the page body, and the "no longer in the catalog" notice clears on the next toggle (#24 review follow-ups, applied to Classifier models too).
- Seeded Codex model catalog entries now list `max`, matching the editor. The max-effort migration preserves existing edits; startup then refreshes seeded harness metadata as described above, keeping enabled choices. The Codex adapter still maps `max` to `xhigh`.

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
