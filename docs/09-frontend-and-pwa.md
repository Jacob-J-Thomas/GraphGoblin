# 09 - Frontend and PWA

## Shape (Decided)

A React single-page application built with Vite, served by the API process in 1.0, installable as a PWA. It talks to the API only through the generated typed client and to run state only through SSE. It contains no business rules: validation, routing, and execution semantics live in `contracts`, `domain`, and the backend. The editor can still validate drafts locally by importing `contracts` and `domain`, since both are pure.

## Screens (Decided list, Draft details)

| Screen        | Purpose                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Loops         | List, create, import, export, publish state, last run status                                                                            |
| Editor        | Canvas with palette, property panel, validation panel, version bar with draft and publish                                               |
| Runs          | List across loops with filters; parent and child relationships                                                                          |
| Run inspector | Timeline of events, thread view at any point, per-node diff of the patch, waiting-for-input form, cancel, pause, resume, replay-at-node |
| Settings      | Model catalog, defaults for model and effort, secrets, API keys, harness preflight status, scheduler status                             |
| Events        | Inbound events and webhook deliveries, with what they triggered                                                                         |

## Editor (Draft)

- Canvas: `@xyflow/react` with custom node components per kind, labelled output handles for decision routes and exit loop-back, and edge validation that refuses connections into triggers or out of unknown ports.
- Palette: the nine node kinds, drag to add.
- Property panel: generated from the node kind's Zod schema with react-hook-form. Templates and expressions use CodeMirror with Liquid and JSONata modes and a preview that renders against a sample thread.
- Validation panel: the same `domain` validation the backend runs, surfaced live, so publish never fails by surprise.
- Subloop picker: searches published loops and shows their trigger input schema and return shape.
- Variables: the loop's declared variables with schemas, edited in a side sheet.

## Run inspector (Draft)

- Timeline from the SSE stream with the cursor stored so reload resumes without gaps.
- Thread viewer that reconstructs the thread at any event by replaying patches client-side using `domain`.
- Node progress drawer that shows harness items as they arrive.
- Wait handling: when the run is waiting on input, a form rendered from the wait node's `inputSchema` appears inline.

## PWA behaviour (Decided)

- `vite-plugin-pwa` with Workbox, `registerType: 'prompt'`.
- Update flow: the service worker detects a new build, the app shows a toast "A new version is available" with an Update button, the user confirms, the new worker activates, and the page reloads. No automatic activation.
- Precache: the app shell only. API responses are never cached by the worker.
- Offline: the shell opens and unsaved editor drafts persist in IndexedDB. Anything needing the backend shows a clear offline state. There is no offline execution.
- Install: a web manifest with icons; an install hint in settings.

## State and data (Decided)

- Server state: TanStack Query over the generated client.
- Live run state: a small SSE hook that appends to a per-run event store in Zustand and exposes projections.
- Editor state: Zustand store holding the draft definition; autosave to the draft endpoint with debounce; local IndexedDB mirror for offline.

## Accessibility and UX baseline (Draft)

Keyboard navigation for palette and property panels, visible focus states, colour-blind-safe status colours, and reduced-motion support. The canvas gets keyboard shortcuts for add, delete, connect, and fit-to-view.

## What shipped in M5, first pass (Draft)

`apps/web` (`@graphgoblin/web`) implements every screen above except replay-at-node (M8) and webhook deliveries on the Events screen (they arrive with WP-C's events listing).

- **Serving.** The API serves the production build when `GG_WEB_DIST` points at `apps/web/dist` (`apps/api/src/plugins/static.ts`). The app lives under `/app/`, so its routes (`/app/loops`, `/app/runs/:id`, ...) never collide with API paths such as `/loops`; `/` and `/app` redirect to `/app/`, extension-less `/app/*` paths fall back to `index.html`, a missing asset is a 404, fingerprinted assets are immutable, and `index.html`, `sw.js`, and the manifest are `no-cache`. In development, `vite` serves `/app/` and proxies the API (`GG_API_URL`, default `http://127.0.0.1:4747`).
- **Client.** One `@graphgoblin/api-client` instance created with `client: 'ui'`, so runs started here are `manual.ui`. TanStack Query holds server state; Zustand holds the editor draft (`src/editor/store.ts`), per-run event logs (`src/runs/event-store.ts`), and the PWA update state. Browser code imports only `contracts`, `domain`, and `api-client`; lint (`no-restricted-imports`) and dependency-cruiser (`web-is-browser-only`) refuse `engine` and `infrastructure`.
- **Editor.** Palette of the nine kinds (drag onto the canvas, or press a palette button to add below the graph). Custom node cards with an input handle (none on triggers) and one labelled output handle per port: decision routes, script exit-code routes, and the optional exit `loopBack`, which is always drawn; connecting it sets `config.loopBack.targetNodeId`, removing the edge clears it. Connections into triggers, from unknown ports, or from an already connected port are refused. Validation runs `LoopDefinitionSchema` then `validateLoop` from `domain` on every change; schema issues are listed first with their node and path, and clicking an issue selects its node. Autosave is debounced (600 ms): every edit is mirrored to IndexedDB first, then a schema-valid draft goes to `PUT /loops/{id}/draft`; a schema-invalid draft stays on the device with a notice, an offline save retries on the `online` event, and an unsynced local draft wins over the server copy on reload. Publish saves first, then shows the 422 issue list if the server refuses. A Run tab starts the published version from any manual trigger, with an input form generated from the trigger's `inputSchema`. A subloop picker lists published loops and shows their trigger input schemas and return mappings.
- **Schema-driven forms** (`src/forms`). `SchemaForm` takes a node kind's config schema from `contracts` and renders it with react-hook-form and the Zod resolver; the same component renders loop settings and declared variables. Introspection reads Zod 4's `_zod.def`: strings (plain, `TemplateSchema` as a Liquid CodeMirror editor, `ExpressionSchema` as a JSONata editor, both with a live preview against `sampleThread()`), numbers (integer, bounds), booleans (checkbox, or a tri-state select when optional without default), enums and multi-value literals (select; arrays of enums become checkbox groups), single literals (read-only), objects (optional ones get Add and Remove), arrays (add and remove items, respecting min and max), records (key and value rows; string values as inputs, anything else as JSON), discriminated and plain unions (a variant picker that seeds the chosen variant), defaults and prefaults (shown as placeholders or initial selections), and `unknown`, `z.json()`, and `JsonSchemaSchema` as JSON editors. Refinements are not introspected; their messages appear in the form's issue summary. Clearing a field stores an internal "unset" marker that is stripped before validation, because react-hook-form otherwise restores a field's initial value when it becomes `undefined`.
- **Run inspector.** The timeline comes from `subscribeRunEvents`; events are kept per run in session storage, so a reload resumes after the stored cursor and a finished run does not reopen the stream. Selecting an event reconstructs the thread at that point with `replayThread` from `domain` (starting from the current thread's `run` and `invocation` with empty collections, and counting `node.started` for node visits, which the engine keeps outside patches); a `node.finished` event also shows its patch with the value before and after each path. A progress drawer groups `node.progress`, harness session, usage, decision, and heartbeat events per node. Waiting runs show an input form generated from the wait node's `inputSchema` (or a signal form); cancel, pause, and resume are buttons.
- **Settings.** Model catalog (add, edit, enable, delete), default model and effort (stored as the owner settings `defaultModel` and `defaultEffort`; the engine still reads its defaults from configuration), write-only secrets, API keys (the token is shown once), harness preflight, and an install hint.
- **PWA.** `vite-plugin-pwa` generates the worker (`registerType: 'prompt'`, `injectRegister: false`, scope `/app/`); the app registers it with `workbox-window`. A waiting worker raises the "A new version is available" toast; only Update sends `SKIP_WAITING`, and the page reloads when the new worker takes control. Only the app shell is precached, there is no runtime caching, and navigation fallback is limited to `/app/`. `window.graphgoblinPwa.simulateUpdate()` drives the same toast for tests. The manifest has 192 and 512 px icons (generated by `scripts/generate-icons.mjs`). Screens that need the API show an explicit offline notice, and a banner appears while the browser is offline.

Deviations: the canvas has no custom keyboard shortcuts yet beyond xyflow's (Delete or Backspace removes, controls for fit-to-view); palette buttons are the keyboard path for adding nodes. Templates use CodeMirror's Jinja2 stream mode for Liquid and its JavaScript mode for JSONata. With `GG_REQUIRE_API_KEY=true` the API's auth hook also guards `/app/*`, so the UI supports local trusted mode only for now.
