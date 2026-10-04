# #7 token cutover: before and after screenshots

Date: 2026-10-04. The real app, built with `pnpm build` and served by `apps/web/e2e/server.ts` (the in-memory API with the fake harness), with seeded loops, runs, inbound events, a disabled catalog model, and a secret. Edge (Chromium), reduced motion so pulses are still, viewport screenshots.

- `before/`: the app at `430c647`, before the cutover (light only; there was no theme).
- `after-dark/`: after the cutover in the default theme (`data-theme="dark"`, set statically in `index.html` until #11).
- `after-light/`: the same screens with the attribute flipped to `light`.

Regenerate with `node docs/qa/2026-10-04-issue-7-screenshots/capture.mjs before|after` after `pnpm build` (`before` needs a build of the earlier commit).

## Screens

Each screen is captured at 1024x768 (`-1024`) and 1440x900 (`-1440`).

| File               | Screen                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `loops`            | Loops list with create, import, and six loops in every publish state and last-run status        |
| `editor-trigger`   | Editor, `nightly-triage` (one node of each kind and a loop-back), the trigger node selected     |
| `editor-decision`  | The same loop, the decision node selected (routes, Liquid question, JSONata expression)         |
| `editor-inference` | The inference node selected (harness, model, effort, session, Liquid template)                  |
| `editor-script`    | The script node selected (command, args, cwd, env, stdin)                                       |
| `editor-mutate`    | The mutate node selected (operations with a Liquid content field)                               |
| `editor-subloop`   | The subloop node selected (subloop picker with the child's trigger input and return)            |
| `editor-wait`      | The wait node selected (mode, prompt, input schema, expose-to checkboxes)                       |
| `editor-heartbeat` | The heartbeat node selected (interval, probe, JSONata `until`, deadline)                        |
| `editor-exit`      | The exit node selected (criteria, default, loop back, return mapping)                           |
| `editor-search`    | The inference node's template with CodeMirror's search panel open (Ctrl+F) and a match selected |
| `runs`             | Runs list with filters and four runs (waiting, succeeded, cancelled, failed)                    |
| `inspector`        | Run inspector on a waiting run: input form, timeline (live), thread at the last event           |
| `events`           | Events list with two inbound events and their payloads                                          |
| `settings`         | Settings, top of the page (model catalog with a disabled model, defaults)                       |
| `api-key`          | A second API instance with `GG_REQUIRE_API_KEY=true`: the "API key required" panel              |
| `not-found`        | An unknown route                                                                                |
| `offline`          | Loops with the browser offline: the offline banner                                              |
| `update-toast`     | Loops with a new build waiting (`graphgoblinPwa.simulateUpdate()`): the update toast            |

## Differences from the approved sample

The sample is `docs/design/visual-direction/sample.html`. The cutover matches its tokens, type, surfaces, buttons, fields, badges, alerts, cards, tables, header and navigation, node cards, palette, property panel, validation panel, inspector, toast, and offline banner in both themes. Where the app differs:

- **Theme control.** The header has no System, Light, and Dark control: that is #11. Dark is set statically.
- **Waiting-for-input dot.** `MainNav` draws the magenta dot (with screen-reader text) when an item has `attention`, but nothing feeds it yet, so no screenshot shows it. A cheap data source (for example a waiting-for-input count from the runs the app already polls) is a follow-up.
- **Loops row actions.** Edit stays a link and Export and Delete stay ghost buttons in the new tokens; the bordered action group with icons and the soft destructive Delete are #6.
- **Form controls.** Booleans are native checkboxes in the accent colour, optional booleans and enums are selects, and the file picker is the native input with its button drawn like an outline button. The switch, segmented controls, toggle chips, compact route rows, and the one-row wait form are #8.
- **Editor at narrow widths.** No palette rail or bottom sheet at 1024 px and below; the palette (200 px) and side panel (380 px) keep their widths, so at 1024 px the canvas is narrower than before. Narrow layouts are #41.
- **Toolbar validation pill.** Not added (a proposal); the validation panel and the Publish button's title keep the error count.
- **Canvas.** Edges use xyflow's built-in `smoothstep` path, so they are orthogonal with rounded corners, but they are not routed around other cards (#18) and run under the cards. The loop-back label has no loop icon (xyflow's default label is text only). The zoom controls are the stock xyflow buttons restyled.
- **Run inspector.** The timeline title keeps its text, "Timeline (N events, live)"; a pulsing violet dot replaces the sample's separate "live" pill. Kind chips beside node events in the timeline are not added. The publish-success "moment" toast is not built; publishing still reports in an inline alert (toasts are #9).
- **Mascot.** Only the header mark; empty states, not-found, and the error boundary art are #10.
- **Text rendering.** Edge's screenshots use subpixel antialiasing, so thin glyphs (quotes, braces, small canvas text) can show coloured fringes in the PNGs. The colours are the tokens'; zoomed screenshots at device scale 2 show plain text.

## Checks beyond the screenshots

- **Forced colours** (`forced-colors: active`, both themes): focus rings stay visible (2 px outline in the system colour), buttons, fields, cards, and badges keep their boundaries, the selected canvas node keeps its 2 px outline, and the current timeline row keeps an outline.
- **Reduced motion:** `--duration-*` resolve to 0 s, transitions collapse to the global 0.01 ms rule, and no keyframe animation runs (`animation: none`; `document.getAnimations()` is empty), so the running and live pulses hold at full opacity. The first pass only shortened animations to 0.01 ms, which left the pulse running and its glyph faded (I7-QA-03 in `docs/qa/2026-10-04-issue-7-qa.md`); `apps/web/e2e/issue-7-qa.spec.ts` covers it.
- **200% zoom** (a 1440x900 window at 200%, a 720x450 CSS viewport): no horizontal page scroll on Loops, Runs, Run inspector, Events, Settings, or the editor. Wide tables scroll sideways inside their cards. The editor's canvas is narrow at that size (#41).
