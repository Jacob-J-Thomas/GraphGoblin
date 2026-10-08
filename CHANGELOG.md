# Changelog

All notable changes to GraphGoblin. The design is in [docs/](docs/README.md); the user guide is [docs/guide/](docs/guide/README.md).

## Unreleased

### Added

- Decisions offer Noul true/false answers and fractional Score rubrics alongside Choice. Primitive-aware classifier selection, separate Noul truth/confidence thresholds and stable Score bands make routing explicit. Existing Choice and context behavior remain unchanged. (#97)

- Claude Code inference harness for the owner's native Windows CLI, pinned to 2.1.285. It uses only Claude.ai account authentication, adds no Anthropic SDK dependency, admits exact model `claude-opus-5-5`, and reports account-dependent billing without promising subscription inclusion. Only explicit `read-only`/`never` and `danger-full-access`/`never` policies are supported; Fable remains blocked while billing is unverified. Requested effort is recorded; effective effort is not reported. (#26)
- Generic body-signed webhooks accept GitHub payloads with durable content replay protection and recoverable atomic run admission. Optional poll items mode drains a bounded queue with per-item dedupe. GitHub presets remain editable generic trigger configurations. (#29)

- Decision nodes choose one explicit Expression, Classifier or LLM evaluator, with Choice options whose stable IDs keep connections attached when display labels change. Inspectors record the selected kind, answer and resolved provider/model. There is no implicit fallback to another evaluator. (#98)

- Runs explain why an exit completed, looped back, or reached a limit. Select `exit.evaluated` in the inspector to read each criterion's result and confidence, the model or classifier used, and the Codex judge's short reasoning. Converted historical decisions preserve recorded reasons why earlier strategies were skipped; new explicit-kind decisions have no fallback chain.

- A **Go to Loops** link on the 404 page, with a "Page not found" heading and explanation (#41).
- Settings → **Appearance → Font** lets you choose a typeface for this browser and preview each option: Geist is the default, with Space Grotesk, Chakra Petch, Atkinson Hyperlegible Next, OpenDyslexic, and Inter as alternatives. Your choice applies immediately, appears without a flash on the next visit, and works across tabs and offline; code remains in Geist Mono. Text size and spacing are unchanged. (#40)
- Validation badges on nodes and beside Publish open popovers with issues and links to the fields that need attention. Checks rerun for saved drafts and after model catalog changes, so node badges reflect when a selected model becomes unavailable or disabled. (#15)
- Editor notices can be dismissed individually (#45).
- Settings includes a **Classifier models** section for built-in Jev and registered HTTP classifiers. Each entry shows its provider, model, supported capabilities, whether it needs a key, and whether it is enabled; Jev can be enabled or disabled, and custom classifiers can be added, edited, or removed. When setting up a bearer key, choose one of your saved secrets. Changing or removing a secret refreshes classifier status. The Decision node's **Jev → Model** picker offers built-in Jev and enabled classifiers that support Choice, and keeps disabled, deleted, or unsupported selections visible with a reason. Catalog and secret changes refresh classifier warnings and validation badges without a draft edit. Classifier decisions stay within their configured routes, provider answers and error details stay private, the later #98 cutover makes unavailable, invalid and low-confidence responses typed failures without a fallback evaluator. Both themes and keyboard controls are supported; see the Settings guide, Configure classifier models. (#43)
- Catalog Model and Effort pickers for inference nodes, loop defaults, and Decision Codex settings. Missing or disabled models and unsupported efforts stay selected and flagged; when the catalog is unavailable, current choices stay read-only until it recovers. Each picker links to the model catalog in Settings. The Codex catalog includes max effort to match the editor, and catalog refreshes preserve saved edits and enabled choices. (#16, #22)
- Node editor: cron triggers get a schedule builder with six presets, a searchable time zone picker with **Use my time zone**, a plain-language summary, and the next five runs shown in both the trigger's zone and yours. The raw expression stays under **Advanced**, and custom expressions are kept unchanged. Validation badges focus the expression or time zone and open **Advanced** for raw expressions; preview errors identify the field. Incomplete edits keep the last valid time and days for the next preset, and the summary asks you to choose a time or at least one day. (#20)
- Node editor: the inference, decision, script, and subloop dialogs show their basic options first and keep the rest under a collapsed **Advanced** group, in headed sections; while collapsed it says how many of its options are set and how many have problems, and following an issue to an option inside opens it. Trigger, wait, heartbeat, and exit keep every option in sight. A mutate node's operations collapse to one line each (their kind and path). Every node option includes a help description shown in its form and the generated node reference, which marks advanced options. (#14)
- Editable edge routes in the loop editor: select a connection and drag a handle on one of its horizontal or vertical segments, including the loop-back's return lane; arrow keys move a focused handle by one grid step (Shift: five). The route stays square and attached to its ports, and is saved with the loop through autosave, reload, export, import, and publishing. Runs ignore manual routes. **Reset route** restores automatic routing, and moving a card onto a manual route resets it as part of that move's undo step when its automatic replacement is clear; otherwise the route stays dotted with **Crosses a card**, during the drag and after release. Older loops keep their automatic routes. (#44)
- Padded, rounded orthogonal routing for backward editor edges, with adaptive clearance for close cards, inner-first return lanes, distinct vertical trunks, obstacle avoidance, accessible labels and focus, and the existing animated loop-back dash. Connections prefer free lanes, keep labels apart, and return to the same routes when cards move away and back; forward-pointing loop-backs keep valid detours, including during dragging (#18).
- Undo and redo in the loop editor: every draft change is one step, including each form choice; typing in one field and one drag are each a step. Use the named toolbar buttons or Ctrl+Z and Ctrl+Shift+Z or Ctrl+Y (Cmd+Z and Cmd+Shift+Z on a Mac) outside text fields. Undo is saved like any edit, and the editor keeps the last 100 steps until it reloads. Undo and redo leave the node editor's Advanced group and opened list items open. (#17)

### Changed

- Inference progress shows a bounded command preview, exit code, and status while the node is running; failed tool calls and other harness-reported item failures are also visible without provider diagnostics. Codex capability slugs are recorded but not yet resolved; Codex-only raw harness config overrides remain available. Claude rejects nonempty custom capabilities and raw overrides under its launch policy.
- Every screen works from 360 px to wide desktop without sideways scrolling or clipped controls, including at 200% zoom. Loops, Runs, and Events show stacked rows below 1024 px (Settings' tables below 768 px), with values under their column names. Forms become one column below 640 px and the header links fold into Menu. In the editor, the toolbar wraps instead of hiding Publish, while loop settings and the palette float over the canvas on smaller screens. Touch controls are at least 44 px in both dimensions. Canvas ports counter-scale their absolute hit boxes with fixed 44 px rows on coarse pointers; row-pitch and neighbouring-card caps make targets smaller when zoomed out, while card layout stays fixed. The node dialog's Connect form provides full-size connection controls. Loop update times stay under loop names, and run patch diffs stack on narrow screens. (#41)
- The light theme keeps the page white and gives cards, panels, the editor toolbar, and dialogs warm brown fills, borders, and control edges. Titles and column headings use dark brown; the dark theme is unchanged. See Settings → Appearance. (#11)
- Forms share switches, segmented controls, file pickers, fieldsets, required-field markers, help text, and per-field errors. Structured rows keep parse errors with their rows, reject duplicate keys, and preserve focus and announcements when rows change. (#8, #53)
- The node palette can be collapsed. Loop settings stay in the panel titled **Loop settings**, and the toolbar's Loop settings button has been removed (#59).
- Settings marks the API key currently used by this browser as **This browser** and warns before revoking it. If a stored key matches no current entry, confirmation explains the possible sign-out and **Forget key** recovery. Changing keys refreshes the marker, and late sign-in errors from an earlier key no longer reopen the key panel. (#54)
- Model catalog entries show whether a model is managed by a harness or added by the owner. Harness models, including older entries, can only be enabled or disabled; existing LiteLLM entries remain editable or removable, while adding new ones waits for provider support. Startup refreshes seeded harness names, effort options, and defaults while preserving enabled choices and hand-added details. Validation and publishing warn when models are missing or disabled and identify the affected fields. (#23)
- Settings' Model catalog uses Enabled switches to turn entries on or off. If a refresh removes a row while its switch is saving, focus returns to the section heading, and the notice that the model is no longer available clears on the next toggle. (#24)

### Upgrade notes

- **#99 advances current definitions and exports to format 3.** Exit predicates now declare `answer`, `evaluation` and `match`, using the shared Noul/Choice/Score evaluator with existing context unchanged. Every legacy provider predicate needs explicit true/false criteria in the conversion manifest; coercing expressions need a reviewed boolean rewrite. The offline tool composes frozen format 1-to-2 conversion with 2-to-3, preserving raw history and refusing unresolved or nonterminal stores. Rebuild clients and review replay-only dispositions for affected failed runs. Back up the complete stopped data directory and rehearse conversion/restoration first. Restoring the old backup discards post-upgrade edits and runs.

- #97 extends the existing format-2 decision contract with Noul and Score; existing Choice definitions and evidence need no rewrite. Custom engine clients must pass the requested primitive to `ClassifierRegistryPort.resolve(ownerId, modelId, primitive)` and implement `classifyNoul`/`score` on classifier ports. The HTTP adapter export is now `HttpClassifier` (replacing `HttpChoiceClassifier`). Regenerate API clients for the new answer variants. Context and session behavior are unchanged.

- The trigger cutover extends the same stopped-instance format-2 converter. An earlier format-2 development database may still need endpoint/receipt structures; startup refuses it until inventory, resolution and verified-backup apply complete. Pending admissions and nonterminal runs must be resolved first. Proven default timestamp-signature keys become hashes; authored keys remain unchanged, and ambiguous provenance blocks the conversion. (#29)

The current format-3 workflow supersedes the older pre-release upgrade notes below. Follow [Offline upgrade](docs/guide/08-offline-upgrade.md); do not apply an old field-deletion or draft-discard instruction instead of that workflow.

- **#98 is an offline format cutover.** Loop definitions and exports use version 2. Stop the old service, back up the complete data directory, inventory it with the offline upgrade tool, review its resolution manifest, and convert before starting this build. Existing unconverted stores are refused before migrations, recovery or triggers. All nonterminal runs must be drained or explicitly cancelled with the old build. Mixed strategy chains, uncertain expression coercion, changed output references and affected failed-run resumability require explicit manifest decisions. Never upgrade the live instance merely by starting this build.
- Inference nodes may now select Claude Code on supported native Windows hosts. Install and authenticate the exact owner-managed CLI separately; existing Codex nodes and defaults are unchanged. Claude API-provider support is not included and remains tracked by #100.
- Decisions now use `answer.options[{id,label,criteria}]` and an `evaluation` kind. Output is `{answer:{type:'choice',optionId,confidence,probabilities},portId,provenance:{kind,provider,classifierId,model,effort}}`. Update clients and authored expressions/templates; the tool refuses ambiguous rewrites. Historical unknowns remain null, known skip evidence is retained, and original converted records are archived in the upgrade audit. Old exports require the offline tool named by `LOOP_FORMAT_UPGRADE_REQUIRED`.
- Loop and owner defaults use `defaults.byHarness`; owner Settings stores one `defaults` value. Process defaults use `GG_DEFAULTS` with the same JSON shape. Old `GG_DEFAULT_MODEL` and `GG_DEFAULT_EFFORT` variables are rejected. Catalog membership and effective effort are enforced, and unavailable selections block publication. This supersedes older advisory-only defaults/catalog notes below.
- Device drafts use the same pure converter; ambiguous raw drafts remain available through the existing set-aside/export flow. Reload clients after the server upgrade so their cached event schema matches. No per-node session policy or new question/context contract is introduced; #33 and #38 are both deferred.

- Codex model names in node configuration and loop, owner, and process defaults are limited to 256 characters, matching recorded exit evidence. Shorten longer names in saved configuration before using it with this version.
- Stored events are now validated on read. A non-conforming row rejects the entire event page; JSON and SSE replay return `STORED_EVENT_INVALID`, naming the run, sequence, and type. No event is silently repaired or skipped. Migration `0007` supplies historical decisions with `skipped: []`; these empty lists carry no evidence about earlier skips.

- `decision.made` now requires `skipped`; rebuild generated-client consumers with the server. Migration `0007` adds `skipped: []` to stored decisions that lack the field. The inspector starts a fresh session event cache and replays from the server. Earlier skip reasons and exit evaluations cannot be reconstructed. New `exit.evaluated` events include zero-based criterion indices; the inspector displays them starting at 1. No old event-shape parsing path is retained.

- Migration `0006` adds `classifier_models`; startup seeds managed Jev metadata before recovery while preserving enabled. The new table does not rewrite loop definitions, versions, runs, events, secrets, or LLM catalog data; earlier migrations still apply their intended changes. Omitted `jev.model` defaults to catalog `jev`. Rebuild generated-client consumers together; older strict readers may reject exports containing explicit classifier selection.

- Harness is chosen on inference nodes only. Loop `settings.defaults` now contains model and effort; `settings.defaults.harness` is gone. (#19)
- On the first startup after upgrade, migration `0005` removes that field from stored loop versions. Node harnesses, version ids and numbers, published timestamps, and run pins are preserved.
- Exports and API clients that still send the field are rejected with its field path. Remove it before import or create/save/validate. For a bare definition or export envelope:

  ```sh
  jq 'del(.settings.defaults.harness, .loop.settings.defaults.harness)' old-loop.json > loop.json
  ```

- Device drafts saved before this change are discarded by a one-off IndexedDB store upgrade, including set-aside copies. The server copy remains available. New in-progress drafts persist across reloads, including drafts with schema errors. If another GraphGoblin tab blocks the upgrade, the editor marks unsaved changes **Kept in this window only** until device storage is available again, then saves them; a server save shows **All changes saved**. (#19)
- Close other GraphGoblin tabs and windows after updating so the device-draft store can upgrade.
- Before upgrading, follow [Back up and restore](docs/guide/06-settings-and-secrets.md#back-up-and-restore). To roll back, stop the API and restore the pre-upgrade data-directory backup before running the previous release; there is no partial rollback.

### Fixed

- Decision routes are connectable immediately after editing, without reloading the loop. Connections stay with their own rows while labels are incomplete, whichever row you finish first. Renaming a route keeps its connection and line layout; removing a route removes its connection even while its label is invalid. Undo and Redo restore both together.
- Exit explanations respect the recorded completion reason, outcome, and limit even when no criterion index was recorded. A failure match stays a failure, and a configured duration limit stays a duration limit.

- The app probes API reachability and restores queries, event streams, and autosave when the API returns (#55).
- The app checks for service worker updates when it regains focus (#56).

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
- Claude through the owner-installed native Windows Claude Code CLI 2.1.285 using Claude.ai account auth. This is inference-only; billing is account-dependent, and effective effort is not reported.
- Decisions by explicit JSONata expression, Jev classifier, or Codex LLM evaluator; a failed evaluator never falls back to another kind.
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
