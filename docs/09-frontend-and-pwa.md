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
