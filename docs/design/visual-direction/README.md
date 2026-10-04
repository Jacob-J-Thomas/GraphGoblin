# Visual direction sample (#7)

Status: second round, after the owner's feedback on the first sample ("really really solid"). Dark is now the lead theme and light is the alternate. This is the design checkpoint that comes before the token cutover in #7; it changes no app code.

## Open it

- Open `sample.html` in a browser straight from disk. It opens in the dark theme. Each view has a hash: `#loops`, `#editor`, `#nav`, `#inspector`, and `#components`; without a hash the page shows an index followed by every view. The System, Light, and Dark control in the header switches the theme (System follows the operating system while it is chosen). Resize the window to see the narrow layouts (breakpoints at 1024 px and 640 px). The menu button (390 px) and the sheet chevron (768 px) work; nothing else is wired.
- `node docs/design/visual-direction/capture.mjs sample` regenerates the screenshots: the dark set in `screenshots/`, the light set in `screenshots/light/`. `node docs/design/visual-direction/capture.mjs before` (after `pnpm build`) starts `apps/web/e2e/server.ts`, seeds six loops and four runs through the API, and photographs the real screens. Both use Playwright from `apps/web` with the installed Edge.
- `node docs/design/visual-direction/contrast.mjs` regenerates `contrast.md` from `tokens.css` for both themes and exits 1 when a pair falls short; `--check` also fails when the committed table is stale.

## Rationale

Dark leads. The surfaces are warm near-blacks with a brown undertone, stepped by elevation: wells and fields (`--surface-sunken`, `--surface-field`) sit below the page, cards rise one step, and sheets, menus, and toasts rise another. Edges are quiet (`--border-default` is a single step above the card), so depth comes from the surface steps and from black shadows with a faint top rim; only control boundaries keep a 3:1 border. The palette is designed for dark rather than inverted: status tints become deep 950 fills with light 200 text, node kinds become bright chips with ink icons over deep tinted bands, and syntax colours move to the 300 steps.

Goblin green is the same bright lime in both themes. It carries ink text (8.63:1) and a deeper green edge. It means "go" or "on": the primary button, the current page's underline, a switch or checkbox that is on, the focus ring in dark.

Purple and magenta now mark moments, sparingly but on purpose: the header's purple-to-magenta hairline, the glow beneath the current page's underline, the waiting-run dot on Runs, the running pulse, an attention button for Run, notification edges and icons, the publish-success moment, the selected node's ring and glow, and the mascot's eyes. They are never a surface, a status, or the main action.

Meaning stays where it was. Run status keeps blue for success and orange for failure, always with an icon; amber is waiting and paused, violet is running. Node kinds no longer borrow meaning colours: subloop is teal and exit is ink (bone in dark), so orange and red mean failure and danger only.

## Palette

Primitive scales (only the semantic tier references these). Teal and slate are new; every scale gained a 950 step for the dark theme's tints.

| Scale     | 50      | 100     | 200     | 300     | 400     | 500     | 600     | 700     | 800     | 900     | 950     |
| --------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| `green`   | #f1f9e9 | #e0f2cc | #c3e69e | #a2d76b | #84c743 | #6aaf2a | #528e1e | #3f701a | #315717 | #264414 | #16260c |
| `brown`   | #f8f3ec | #f0e5d6 | #e2cfb4 | #cdb089 | #b48e5e | #9a7142 | #7d5932 | #634627 | #4b361f | #352718 | #221911 |
| `grey`    | #f6f5f2 | #edebe6 | #e0ddd6 | #cbc6bd | #a8a298 | #847d72 | #6a645a | #524c44 | #33302b | #26231f | #1a1815 |
| `magenta` | #fdf0fa | #fadcf2 | #f5b5e4 | #ee85d0 | #e254ba | #cc2e9f | #ad1e85 | #8c186c | #6d1555 | #4f1140 | #2c0b22 |
| `violet`  | #f5f2ff | #eae4fe | #d6cbfd | #b8a5fa | #9a7df4 | #7f5ae8 | #6a42d2 | #5833b0 | #482b8e | #3b2672 | #211640 |
| `blue`    | #eff5ff | #dce8fe | #bdd4fc | #8fb6f8 | #5e92f0 | #3b73e0 | #2a5bc4 | #22489e | #1e3b7e | #1b3163 | #13213f |
| `orange`  | #fff4ec | #ffe4d0 | #fec7a0 | #fba068 | #f57b36 | #e35f14 | #c24a0c | #9c3b0d | #7c3110 | #632a10 | #351707 |
| `amber`   | #fff9e8 | #fef0c3 | #fde08a | #fbcb4e | #f5b420 | #dc9908 | #b57a04 | #8e5e08 | #74490d | #5f3c10 | #2e2108 |
| `red`     | #fef2f2 | #fde1e0 | #fbc5c3 | #f69b97 | #ee6a64 | #de4039 | #cf342d | #a2241f | #841f1c | #6c1d1b | #2e0e0c |
| `teal`    | #edfbf8 | #d0f4ee | #a3e9de | #6cd6c9 | #3bbdb0 | #1ea196 | #15827a | #146862 | #14534f | #134542 | #0a2624 |
| `slate`   | #f3f5f8 | #e4e9f0 | #cbd4e0 | #a8b6c8 | #8496ad | #66798f | #526377 | #424f60 | #333d4a | #263039 | #161c22 |

Extra steps: `grey-0` #ffffff and `grey-25` #fbfaf8 (light surfaces); `grey-850` #2b2723, `grey-925` #1f1c18, `grey-975` #15120f, and `grey-990` #0e0c0a (dark surfaces); `brown-975` #150f0a (the dark wells). `red-600` moved from #c42d27 to #cf342d so the destructive fill keeps 3:1 against the dark sheet.

Semantic tokens in both themes (tokens marked \* are additions to the plan's table, see Proposals):

| Token                         | Dark                      | Light                     |
| ----------------------------- | ------------------------- | ------------------------- |
| `--surface-app`               | `--grey-975` #15120f      | `--grey-50` #f6f5f2       |
| `--surface-raised`            | `--grey-925` #1f1c18      | `--grey-0` #ffffff        |
| `--surface-sunken`            | `--brown-975` #150f0a     | `--grey-50` #f6f5f2       |
| `--surface-overlay`           | `--grey-900` #26231f      | `--grey-0` #ffffff        |
| `--surface-hover`\*           | `--grey-800` #33302b      | `--grey-100` #edebe6      |
| `--surface-control`\*         | `--grey-850` #2b2723      | `--grey-50` #f6f5f2       |
| `--surface-field`\*           | `--grey-990` #0e0c0a      | `--grey-0` #ffffff        |
| `--surface-inverse`           | `--grey-990` #0e0c0a      | `--grey-950` #1a1815      |
| `--surface-inverse-raised`\*  | `--grey-850` #2b2723      | `--grey-800` #33302b      |
| `--text-default`              | `--grey-100` #edebe6      | `--grey-900` #26231f      |
| `--text-muted`                | `--grey-300` #cbc6bd      | `--grey-700` #524c44      |
| `--text-subtle`               | `--grey-400` #a8a298      | `--grey-600` #6a645a      |
| `--text-inverse`              | `--grey-100` #edebe6      | `--grey-0` #ffffff        |
| `--text-inverse-muted`\*      | `--grey-300` #cbc6bd      | `--grey-300` #cbc6bd      |
| `--text-link`                 | `--green-300` #a2d76b     | `--green-700` #3f701a     |
| `--text-on-accent`            | `--grey-950` #1a1815      | `--grey-950` #1a1815      |
| `--text-on-danger`\*          | `--grey-0` #ffffff        | `--grey-0` #ffffff        |
| `--border-default`            | `--grey-850` #2b2723      | `--grey-200` #e0ddd6      |
| `--border-strong`             | `--grey-500` #847d72      | `--grey-500` #847d72      |
| `--border-subtle`             | `--grey-900` #26231f      | `--grey-100` #edebe6      |
| `--border-inverse`\*          | `--grey-850` #2b2723      | `--grey-800` #33302b      |
| `--accent`                    | `--green-400` #84c743     | `--green-400` #84c743     |
| `--accent-hover`              | `--green-300` #a2d76b     | `--green-300` #a2d76b     |
| `--accent-active`             | `--green-500` #6aaf2a     | `--green-500` #6aaf2a     |
| `--accent-subtle`             | `--green-950` #16260c     | `--green-100` #e0f2cc     |
| `--accent-on-subtle`          | `--green-200` #c3e69e     | `--green-800` #315717     |
| `--accent-strong`\*           | `--green-600` #528e1e     | `--green-700` #3f701a     |
| `--accent-highlight`\*        | `--magenta-400` #e254ba   | `--magenta-600` #ad1e85   |
| `--accent-highlight-subtle`\* | `--magenta-950` #2c0b22   | `--magenta-50` #fdf0fa    |
| `--accent-glow`\*             | `--violet-400` #9a7df4    | `--violet-500` #7f5ae8    |
| `--accent-hairline`\*         | violet-400 to magenta-400 | violet-400 to magenta-400 |
| `--danger`                    | `--red-600` #cf342d       | `--red-600` #cf342d       |
| `--danger-hover`              | `--red-700` #a2241f       | `--red-700` #a2241f       |
| `--danger-subtle`             | `--red-950` #2e0e0c       | `--red-50` #fef2f2        |
| `--danger-on-subtle`          | `--red-300` #f69b97       | `--red-700` #a2241f       |
| `--status-neutral-bg`         | `--grey-850` #2b2723      | `--grey-100` #edebe6      |
| `--status-neutral-fg`         | `--grey-200` #e0ddd6      | `--grey-800` #33302b      |
| `--status-neutral-border`     | `--grey-500` #847d72      | `--grey-500` #847d72      |
| `--status-good-bg`            | `--blue-950` #13213f      | `--blue-100` #dce8fe      |
| `--status-good-fg`            | `--blue-200` #bdd4fc      | `--blue-800` #1e3b7e      |
| `--status-good-border`        | `--blue-400` #5e92f0      | `--blue-600` #2a5bc4      |
| `--status-bad-bg`             | `--orange-950` #351707    | `--orange-100` #ffe4d0    |
| `--status-bad-fg`             | `--orange-200` #fec7a0    | `--orange-800` #7c3110    |
| `--status-bad-border`         | `--orange-400` #f57b36    | `--orange-600` #c24a0c    |
| `--status-warn-bg`            | `--amber-950` #2e2108     | `--amber-100` #fef0c3     |
| `--status-warn-fg`            | `--amber-200` #fde08a     | `--amber-800` #74490d     |
| `--status-warn-border`        | `--amber-500` #dc9908     | `--amber-600` #b57a04     |
| `--status-info-bg`            | `--violet-950` #211640    | `--violet-100` #eae4fe    |
| `--status-info-fg`            | `--violet-200` #d6cbfd    | `--violet-800` #482b8e    |
| `--status-info-border`        | `--violet-400` #9a7df4    | `--violet-600` #6a42d2    |
| `--kind-on`\*                 | `--grey-950` #1a1815      | `--grey-0` #ffffff        |
| `--kind-trigger`              | `--green-400` #84c743     | `--green-600` #528e1e     |
| `--kind-trigger-subtle`       | `--green-950` #16260c     | `--green-50` #f1f9e9      |
| `--kind-decision`             | `--blue-400` #5e92f0      | `--blue-600` #2a5bc4      |
| `--kind-decision-subtle`      | `--blue-950` #13213f      | `--blue-50` #eff5ff       |
| `--kind-inference`            | `--violet-400` #9a7df4    | `--violet-600` #6a42d2    |
| `--kind-inference-subtle`     | `--violet-950` #211640    | `--violet-50` #f5f2ff     |
| `--kind-script`               | `--slate-300` #a8b6c8     | `--slate-600` #526377     |
| `--kind-script-subtle`        | `--slate-950` #161c22     | `--slate-50` #f3f5f8      |
| `--kind-mutate`               | `--brown-400` #b48e5e     | `--brown-600` #7d5932     |
| `--kind-mutate-subtle`        | `--brown-950` #221911     | `--brown-50` #f8f3ec      |
| `--kind-subloop`              | `--teal-400` #3bbdb0      | `--teal-600` #15827a      |
| `--kind-subloop-subtle`       | `--teal-950` #0a2624      | `--teal-50` #edfbf8       |
| `--kind-wait`                 | `--amber-400` #f5b420     | `--amber-600` #b57a04     |
| `--kind-wait-subtle`          | `--amber-950` #2e2108     | `--amber-50` #fff9e8      |
| `--kind-heartbeat`            | `--magenta-400` #e254ba   | `--magenta-600` #ad1e85   |
| `--kind-heartbeat-subtle`     | `--magenta-950` #2c0b22   | `--magenta-50` #fdf0fa    |
| `--kind-exit`                 | `--grey-200` #e0ddd6      | `--grey-900` #26231f      |
| `--kind-exit-subtle`          | `--grey-850` #2b2723      | `--grey-100` #edebe6      |
| `--focus-ring`                | `--green-400` #84c743     | `--green-600` #528e1e     |
| `--code-bg`                   | `--grey-990` #0e0c0a      | `--grey-25` #fbfaf8       |
| `--code-active-line`\*        | `--green-950` #16260c     | `--green-50` #f1f9e9      |
| `--code-fg`                   | `--grey-100` #edebe6      | `--grey-900` #26231f      |
| `--code-gutter`               | `--grey-400` #a8a298      | `--grey-600` #6a645a      |
| `--code-keyword`              | `--violet-300` #b8a5fa    | `--violet-700` #5833b0    |
| `--code-string`               | `--green-300` #a2d76b     | `--green-700` #3f701a     |
| `--code-number`               | `--blue-300` #8fb6f8      | `--blue-700` #22489e      |
| `--code-comment`              | `--grey-400` #a8a298      | `--grey-600` #6a645a      |
| `--code-operator`             | `--brown-300` #cdb089     | `--brown-600` #7d5932     |
| `--canvas-bg`                 | `--grey-975` #15120f      | `--grey-25` #fbfaf8       |
| `--canvas-grid`               | `--brown-900` #352718     | `--brown-200` #e2cfb4     |
| `--canvas-edge`               | `--grey-500` #847d72      | `--grey-500` #847d72      |
| `--canvas-edge-selected`      | `--green-400` #84c743     | `--green-700` #3f701a     |
| `--canvas-edge-loop`\*        | `--brown-400` #b48e5e     | `--brown-500` #9a7142     |
| `--canvas-handle`             | `--grey-300` #cbc6bd      | `--grey-700` #524c44      |
| `--canvas-node-selected`\*    | `--magenta-400` #e254ba   | `--magenta-500` #cc2e9f   |
| `--mascot-skin`\*             | `--green-400` #84c743     | `--green-400` #84c743     |
| `--mascot-shade`\*            | `--green-600` #528e1e     | `--green-600` #528e1e     |
| `--mascot-ink`\*              | `--grey-990` #0e0c0a      | `--grey-990` #0e0c0a      |
| `--mascot-glint`\*            | `--magenta-400` #e254ba   | `--magenta-400` #e254ba   |
| `--mascot-tooth`\*            | `--grey-25` #fbfaf8       | `--grey-25` #fbfaf8       |
| `--mascot-port`\*             | `--grey-100` #edebe6      | `--grey-100` #edebe6      |

The other scales live in `tokens.css` and do not change by theme: `--font-sans`, `--font-mono`, `--font-ui`, `--font-code`, `--font-size-2xs` (10 px) to `--font-size-2xl` (28 px), line heights, weights, letter spacing, `--space-1` to `--space-12` with the named gaps, `--radius-sm` (4) to `--radius-xl` (16) and `--radius-full`, and `--duration-*` and `--ease-*`, which drop to 0 ms under `prefers-reduced-motion`. The shadows (`--shadow-0` to `--shadow-3`) are retuned per theme: warm and soft in light, black with a faint top rim in dark.

## Where purple and magenta appear

Every placement, in both themes (all proposals):

1. **Header hairline**: a 2 px purple-to-magenta line that fades out along the bottom edge of the header (`--accent-hairline`).
2. **Navigation**: a faint magenta glow under the current page's green underline, a magenta underline on hover, and a magenta dot on Runs while a run waits for input.
3. **Buttons**: the attention button (magenta edge, text, and soft glow) for Run in the editor and "Run it" after a publish; a magenta sheen around the lime primary on hover. Neither is ever the default button or a fill.
4. **Notifications**: a magenta edge on toasts, the dot on "A new version is available", and the sparkle icon and purple-to-magenta crown on the "Published version 4." moment.
5. **Running and live**: the running badge's soft purple glow and pulse, and the purple "live" pill with a pulsing dot on the timeline.
6. **Canvas**: the selected node's magenta ring and deep purple glow.
7. **Kinds and badges**: the heartbeat kind, and the "New" badge on the component sheet.
8. **Mascot**: the magenta glint in the goblin's eyes.

Brown appears in the dark theme's wells (`--surface-sunken`), the mutate kind, the canvas dot grid, the dashed loop-back edge, Liquid and JSONata operators, and the light theme's warm shadow tint. Warm dark grey is the dark theme itself, the header in both themes, the exit kind in light, and the ink on every lime surface.

## Mascot (placeholder for #10)

A goblin-node head drawn for this sample as inline SVG: the favicon's node with sharp ears, port dots for cheeks, slanted brows, slit eyes with a magenta glint, and teeth. Three faces, each shown on the component sheet at 160 px on a dark and a light surface and at 32, 24, and 16 px:

- **Smirk** (default, in the header): narrowed eyes under angry brows, a crooked smirk with one fang.
- **Scowl**: brows pulled down hard, slit eyes, a snarl of teeth.
- **Sly side-eye**: one brow raised, half-lidded eyes glancing aside, a lopsided grin.

The sheet also shows the header lockups: mark and wordmark (the default), the wordmark alone, and both on a light surface, where "Goblin" switches to the deeper green.

## Owner decisions

- **Default theme (decided by owner)**: dark is the default. The theme control offers System, Light, and Dark with Dark preselected; System follows the operating system only when chosen, and dark stays the answer when the system gives no preference. #11 currently says the app follows the system setting; it needs updating to match.
- **Primary action (decided by owner)**: lime with dark ink text. Re-evaluated in dark (component sheet, "Primary in the dark theme: options weighed"): a deeper lime loses the punch and looks muddy on near-black, and lime on an ink ledge reads as a cartoon outline whose ledge disappears into the dark surfaces. Lime with ink text and a deeper green ledge (the chosen treatment) stays vivid and keeps a visible lower edge, so I recommend keeping it.
- **Active navigation (decided by owner)**: a 3 px green underline with a faint magenta glow, not the pill.
- **Purple and magenta (decided by owner)**: more of it, sparingly but pointedly; every placement is listed above.
- **Node kinds (decided by owner)**: no meaning colours. Subloop is teal (was the failure orange) and exit is ink in light and bone in dark (was the destructive red); script moved from warm grey to slate so it stays distinct from the ink exit. All nine stay distinct, keep their icons, and pass in both themes.
- **Sunken surface (decided by owner)**: neutral grey in light (`--grey-50`). In dark I tried the earthy brown and kept it: `--brown-975` reads as a warm well under the table headers, palette rail, segmented tracks, and code previews, a step apart from the neutral fields and code editors, without the beige cast the cream had in light.
- **Logo (decided by owner)**: the mascot mark plus wordmark stays in the header; the wordmark-alone variant is on the component sheet.
- **Status icons (decided by the orchestrator)**: SVG status icons, with the hourglass for waiting.
- **Narrow widths (decided by the orchestrator, assumed pattern for #41)**: 768 px is the floor for editing; phones get every screen except editing, with a view-only canvas. The sample's 390 px views show the list and navigation patterns only.
- **Font licence (decided by the orchestrator)**: the font-only OFL entry is added to `tooling/license-allowlist.json` at the cutover; this sample does not touch it.

## Open decisions for the owner

1. Which mascot face is the default: smirk (shown in the header), scowl, or sly side-eye.
2. The attention button for Run: keep it magenta next to the lime Publish, or keep Run outlined and save magenta for the post-publish "Run it" moment only.
3. The earthy brown wells in dark, or neutral grey there too.

## Proposals

Everything below is my addition, flagged for the owner; none of it is decided unless listed above.

- **Proposal: added semantic tokens** (marked \* above), including `--surface-control` and `--surface-field` (secondary buttons and inputs need their own fills once dark wells are darker than cards), `--kind-on` (icon colour on kind chips: white in light, ink in dark), `--accent-glow`, `--accent-hairline`, and the `--mascot-*` tokens; plus `--focus-ring-width`, `--font-code`, `--radius-xl`, and `--duration-pulse`. Type sizes are named `--font-size-*` rather than `--text-*`, because Tailwind v4's `@theme` uses `--text-*` for font sizes.
- **Proposal: theme scoping**: the semantic tier is declared on `:root, [data-theme='light']` and `[data-theme='dark']`, so any element can show the other theme (the mascot stages on the component sheet use this).
- **Proposal: teal and slate scales** for the subloop and script kinds, and the kind icons (trigger bolt, decision diamond, inference sparkle, script prompt, mutate pencil, subloop nested squares, wait hourglass, heartbeat pulse, exit flag), all original SVG.
- **Proposal: every purple and magenta placement listed above.**
- **Proposal: row actions for #6**: Edit, Export, and Delete as one group of bordered small buttons with icons; Delete uses a soft destructive style and Confirm delete the solid one.
- **Proposal: canvas styling**: orthogonal edges with rounded corners, port labels as pills, the dashed brown loop-back edge with a loop icon, a tinted header band and kind chip on every node card, and restyled zoom controls.
- **Proposal: editor details**: kind descriptions in the palette, an always-visible validation pill in the toolbar, node id and label side by side, compact route rows, and a language tag on code fields.
- **Proposal: controls for #8**: a switch for booleans with a default, a three-way segmented control for optional booleans, segmented controls for small enums and union variants, toggle chips for arrays of enums, and a styled file picker.
- **Proposal: narrow-width patterns for #41**: at 640 px and below the navigation collapses into a Menu button with a full-width panel and tables become stacked cards; at 1024 px and below the palette becomes an icon rail, the property panel a bottom sheet, and the inspector one column.
- **Proposal: inspector details**: kind chips beside node events in the timeline and the wait form's fields in one row on wide screens.
- **Proposal: page width** capped at 1240 px for list pages. `theme-color` becomes the dark header colour (#0e0c0a).

## Fonts

Geist and Geist Mono 1.7.2, SIL Open Font License 1.1, copyright Vercel in collaboration with basement.studio. Taken from the `geist` npm package (`https://registry.npmjs.org/geist/-/geist-1.7.2.tgz`, `dist/fonts/geist-sans/Geist-Variable.woff2` and `dist/fonts/geist-mono/GeistMono-Variable.woff2`); the licence text is `fonts/OFL.txt`. Both files are variable fonts (weights 100 to 900), 68 KB and 70 KB.

## Files

- `sample.html`: the prototype, with component styles, icons, and the mascot inline.
- `tokens.css`: the primitive scales, both themes' semantic tiers, and the font faces.
- `fonts/`: the two woff2 files and `OFL.txt`.
- `contrast.mjs` and `contrast.md`: the two-theme contrast check and its table.
- `capture.mjs`: the screenshot script.
- `screenshots/` (dark, the primary set) and `screenshots/light/` (the same views in light): `loops-1440`, `loops-390`, `editor-1440`, `editor-1440-tall` (the whole property panel), `editor-768`, `editor-768-sheet-collapsed`, `nav-1440`, `nav-390`, `nav-390-menu-open`, `inspector-1440`, `inspector-768`, and `components-1440`. The real app before the change: `before-{loops,editor,inspector}-{1024,1440}`, `before-nav-{1024,1440}` (header crops), and `before-loops-390`, `before-editor-768`, and `before-inspector-768`.

## Not verified

- Screenshots are from Edge (Chromium) only, taken with reduced motion so the pulses are still; Firefox and Safari were not checked.
- Forced-colours mode and 200% zoom were not checked on the sample; they stay on the cutover's QA plan.
- Stacked tables use `display: block` on table elements, which some screen readers treat as losing table semantics; the cutover should keep the semantics explicitly.
- The contrast table covers solid token pairs in both themes. Glows, the header hairline gradient, shadows, and disabled controls are not measured: the first three are decorative, and WCAG exempts disabled controls.
- System mode was exercised only through the control; the screenshots show explicit Dark and Light.
