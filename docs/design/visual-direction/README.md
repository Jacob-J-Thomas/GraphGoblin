# Visual direction sample (#7)

Status: awaiting the owner's approval. This is the design checkpoint that comes before the token cutover in #7. It changes no app code; the cutover follows the approved plan on issue #7 once this direction is approved.

## Open it

- Open `sample.html` in a browser straight from disk. Each view has a hash: `#loops`, `#editor`, `#nav`, `#inspector`, and `#components`. Without a hash the page shows an index followed by every view. Resize the window to see the narrow layouts (breakpoints at 1024 px and 640 px). The menu button (390 px) and the sheet chevron (768 px) work; nothing else is wired.
- `node docs/design/visual-direction/capture.mjs sample` regenerates the sample screenshots. `node docs/design/visual-direction/capture.mjs before` (after `pnpm build`) starts `apps/web/e2e/server.ts`, seeds six loops and four runs through the API, and photographs the real screens. Both use Playwright from `apps/web` with the installed Edge.
- `node docs/design/visual-direction/contrast.mjs` regenerates `contrast.md` from `tokens.css` and exits 1 when a pair falls short; `--check` fails when the committed table is stale.

## Rationale

Goblin green is a bright lime (`--green-400`), not a forest green: it is the loudest thing on screen and it reads as the goblin. Lime cannot carry white text, so it carries ink (`--text-on-accent`, 8.6:1) and a darker green edge (`--accent-strong`) that gives every lime surface a 3:1 boundary. Lime means "go" or "on": the primary button, the active nav item, a switch or checkbox that is on. The fun comes from small physical cues rather than decoration: primary buttons sit on a 2 px ledge and press down into it, bordered buttons have a 1 px ledge, the switch thumb springs, palette items lift on hover, and a placeholder goblin-node mark sits in the header.

The neutrals are warm. Grey is tinted towards the brown, the dark header is a warm near-black, and the sunken surface (table headers, the palette rail, code previews, segmented tracks) is a pale cream from the brown scale. Brown also draws the canvas grid, the dashed loop-back edge, the mutate kind, and Liquid delimiters. Magenta is kept for a handful of highlight moments.

Meaning stays where it was. Run status keeps blue for success and orange for failure, always with a glyph; amber is waiting and paused, violet is running. Each of the nine node kinds takes one hue from the palette and an icon, so kinds never depend on colour alone. Every colour is a token: components in the sample use semantic tokens only, the semantic tier points at the primitive scales, and a dark theme (#11) redefines the semantic tier and nothing else.

Geist and Geist Mono set the type: 28 px bold page titles with tight tracking, 14 px body, 12 to 13 px labels, mono for ids, ports, event types, and code.

## Palette

Primitive scales (only the semantic tier references these):

| Scale     | 0       | 25      | 50      | 100     | 200     | 300     | 400     | 500     | 600     | 700     | 800     | 900     | 950     |
| --------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| `green`   |         |         | #f1f9e9 | #e0f2cc | #c3e69e | #a2d76b | #84c743 | #6aaf2a | #528e1e | #3f701a | #315717 | #264414 | #142808 |
| `brown`   |         |         | #f8f3ec | #f0e5d6 | #e2cfb4 | #cdb089 | #b48e5e | #9a7142 | #7d5932 | #634627 | #4b361f | #352718 |         |
| `grey`    | #ffffff | #fbfaf8 | #f6f5f2 | #edebe6 | #e0ddd6 | #cbc6bd | #a8a298 | #847d72 | #6a645a | #524c44 | #33302b | #26231f | #1a1815 |
| `magenta` |         |         | #fdf0fa | #fadcf2 | #f5b5e4 | #ee85d0 | #e254ba | #cc2e9f | #ad1e85 | #8c186c | #6d1555 | #4f1140 |         |
| `blue`    |         |         | #eff5ff | #dce8fe | #bdd4fc | #8fb6f8 | #5e92f0 | #3b73e0 | #2a5bc4 | #22489e | #1e3b7e | #1b3163 |         |
| `orange`  |         |         | #fff4ec | #ffe4d0 | #fec7a0 | #fba068 | #f57b36 | #e35f14 | #c24a0c | #9c3b0d | #7c3110 | #632a10 |         |
| `amber`   |         |         | #fff9e8 | #fef0c3 | #fde08a | #fbcb4e | #f5b420 | #dc9908 | #b57a04 | #8e5e08 | #74490d | #5f3c10 |         |
| `violet`  |         |         | #f5f2ff | #eae4fe | #d6cbfd | #b8a5fa | #9a7df4 | #7f5ae8 | #6a42d2 | #5833b0 | #482b8e | #3b2672 |         |
| `red`     |         |         | #fef2f2 | #fde1e0 | #fbc5c3 | #f69b97 | #ee6a64 | #de4039 | #c42d27 | #a2241f | #841f1c | #6c1d1b |         |

Semantic tokens (light values; tokens marked \* are additions to the plan's table, see Proposals):

| Token                         | Primitive       | Value   |
| ----------------------------- | --------------- | ------- |
| `--surface-app`               | `--grey-50`     | #f6f5f2 |
| `--surface-raised`            | `--grey-0`      | #ffffff |
| `--surface-sunken`            | `--brown-50`    | #f8f3ec |
| `--surface-overlay`           | `--grey-0`      | #ffffff |
| `--surface-hover`\*           | `--grey-100`    | #edebe6 |
| `--surface-inverse`           | `--grey-950`    | #1a1815 |
| `--surface-inverse-raised`\*  | `--grey-800`    | #33302b |
| `--text-default`              | `--grey-900`    | #26231f |
| `--text-muted`                | `--grey-700`    | #524c44 |
| `--text-subtle`               | `--grey-600`    | #6a645a |
| `--text-inverse`              | `--grey-0`      | #ffffff |
| `--text-inverse-muted`\*      | `--grey-300`    | #cbc6bd |
| `--text-link`                 | `--green-700`   | #3f701a |
| `--text-on-accent`            | `--grey-950`    | #1a1815 |
| `--text-on-danger`\*          | `--grey-0`      | #ffffff |
| `--border-default`            | `--grey-200`    | #e0ddd6 |
| `--border-strong`             | `--grey-500`    | #847d72 |
| `--border-subtle`             | `--grey-100`    | #edebe6 |
| `--border-inverse`\*          | `--grey-800`    | #33302b |
| `--accent`                    | `--green-400`   | #84c743 |
| `--accent-hover`              | `--green-300`   | #a2d76b |
| `--accent-active`             | `--green-500`   | #6aaf2a |
| `--accent-subtle`             | `--green-100`   | #e0f2cc |
| `--accent-on-subtle`          | `--green-800`   | #315717 |
| `--accent-strong`\*           | `--green-700`   | #3f701a |
| `--accent-highlight`\*        | `--magenta-600` | #ad1e85 |
| `--accent-highlight-subtle`\* | `--magenta-50`  | #fdf0fa |
| `--danger`                    | `--red-600`     | #c42d27 |
| `--danger-hover`              | `--red-700`     | #a2241f |
| `--danger-subtle`             | `--red-50`      | #fef2f2 |
| `--danger-on-subtle`          | `--red-800`     | #841f1c |
| `--status-neutral-bg`         | `--grey-100`    | #edebe6 |
| `--status-neutral-fg`         | `--grey-800`    | #33302b |
| `--status-neutral-border`     | `--grey-500`    | #847d72 |
| `--status-good-bg`            | `--blue-100`    | #dce8fe |
| `--status-good-fg`            | `--blue-800`    | #1e3b7e |
| `--status-good-border`        | `--blue-600`    | #2a5bc4 |
| `--status-bad-bg`             | `--orange-100`  | #ffe4d0 |
| `--status-bad-fg`             | `--orange-800`  | #7c3110 |
| `--status-bad-border`         | `--orange-600`  | #c24a0c |
| `--status-warn-bg`            | `--amber-100`   | #fef0c3 |
| `--status-warn-fg`            | `--amber-800`   | #74490d |
| `--status-warn-border`        | `--amber-600`   | #b57a04 |
| `--status-info-bg`            | `--violet-100`  | #eae4fe |
| `--status-info-fg`            | `--violet-800`  | #482b8e |
| `--status-info-border`        | `--violet-600`  | #6a42d2 |
| `--kind-trigger`              | `--green-600`   | #528e1e |
| `--kind-trigger-subtle`       | `--green-50`    | #f1f9e9 |
| `--kind-decision`             | `--blue-600`    | #2a5bc4 |
| `--kind-decision-subtle`      | `--blue-50`     | #eff5ff |
| `--kind-inference`            | `--violet-600`  | #6a42d2 |
| `--kind-inference-subtle`     | `--violet-50`   | #f5f2ff |
| `--kind-script`               | `--grey-700`    | #524c44 |
| `--kind-script-subtle`        | `--grey-100`    | #edebe6 |
| `--kind-mutate`               | `--brown-600`   | #7d5932 |
| `--kind-mutate-subtle`        | `--brown-50`    | #f8f3ec |
| `--kind-subloop`              | `--orange-600`  | #c24a0c |
| `--kind-subloop-subtle`       | `--orange-50`   | #fff4ec |
| `--kind-wait`                 | `--amber-600`   | #b57a04 |
| `--kind-wait-subtle`          | `--amber-50`    | #fff9e8 |
| `--kind-heartbeat`            | `--magenta-600` | #ad1e85 |
| `--kind-heartbeat-subtle`     | `--magenta-50`  | #fdf0fa |
| `--kind-exit`                 | `--red-600`     | #c42d27 |
| `--kind-exit-subtle`          | `--red-50`      | #fef2f2 |
| `--focus-ring`                | `--green-600`   | #528e1e |
| `--code-bg`                   | `--grey-25`     | #fbfaf8 |
| `--code-active-line`\*        | `--green-50`    | #f1f9e9 |
| `--code-fg`                   | `--grey-900`    | #26231f |
| `--code-gutter`               | `--grey-600`    | #6a645a |
| `--code-keyword`              | `--violet-700`  | #5833b0 |
| `--code-string`               | `--green-700`   | #3f701a |
| `--code-number`               | `--blue-700`    | #22489e |
| `--code-comment`              | `--grey-600`    | #6a645a |
| `--code-operator`             | `--brown-600`   | #7d5932 |
| `--canvas-bg`                 | `--grey-25`     | #fbfaf8 |
| `--canvas-grid`               | `--brown-200`   | #e2cfb4 |
| `--canvas-edge`               | `--grey-500`    | #847d72 |
| `--canvas-edge-selected`      | `--green-700`   | #3f701a |
| `--canvas-edge-loop`\*        | `--brown-500`   | #9a7142 |
| `--canvas-handle`             | `--grey-700`    | #524c44 |
| `--canvas-node-selected`\*    | `--magenta-500` | #cc2e9f |

The other scales live in `tokens.css`: `--font-sans`, `--font-mono`, `--font-ui`, `--font-code`, `--font-size-2xs` (10 px) to `--font-size-2xl` (28 px), line heights, weights, letter spacing, `--space-1` to `--space-12` with `--space-field`, `--space-stack`, `--space-section`, and `--space-page`, `--radius-sm` (4) to `--radius-xl` (16) and `--radius-full`, `--shadow-0` to `--shadow-3` tinted with a warm `--shadow-color`, and `--duration-*` and `--ease-*`, which drop to 0 ms under `prefers-reduced-motion`.

## Where brown, dark grey, and magenta appear

- **Brown**: the sunken surface (table headers, the palette rail, secondary buttons, code previews, segmented tracks, diff headers), the mutate kind, the canvas dot grid, the dashed loop-back edge and its label, Liquid and JSONata operators, and the warm shadow tint.
- **Dark warm grey**: the header and its narrow-width menu, the script kind, body text, and the ink on every lime surface.
- **Magenta**: the heartbeat kind, the ring around the selected node on the canvas, the dot on the "A new version is available" toast, and a "New" badge on the component sheet. It is never a surface, a button, or a status.

## Proposals

Everything below is my addition, flagged for the owner; none of it is decided.

- **Proposal: lime primary with ink text and a pressable ledge**, instead of white text on a deep green.
- **Proposal: added semantic tokens** (marked \* above): `--surface-hover`, `--surface-inverse-raised`, `--text-inverse-muted`, `--text-on-danger`, `--border-inverse`, `--accent-strong`, `--accent-highlight`, `--accent-highlight-subtle`, `--code-active-line`, `--canvas-edge-loop`, `--canvas-node-selected`, plus `--focus-ring-width`, `--font-code`, and `--radius-xl`. Type sizes are named `--font-size-*` rather than `--text-*`, because Tailwind v4's `@theme` uses `--text-*` for font sizes; the cutover maps them across.
- **Proposal: the kind colours and kind icons** (trigger green with a bolt, decision blue with a diamond, inference violet with a sparkle, script grey with a prompt, mutate brown with a pencil, subloop orange with nested squares, wait amber with an hourglass, heartbeat magenta with a pulse, exit red with a flag). The icons are original SVG drawn for this sample.
- **Proposal: SVG status icons in place of text glyphs.** In the real app the waiting glyph (⏸) renders as a colour emoji on Windows (see `before-loops-1440.png`). Waiting uses an hourglass, matching the wait kind and telling it apart from paused (two bars); the other seven keep their current shapes.
- **Proposal: magenta for the selected node on the canvas.**
- **Proposal: row actions for #6**: Edit, Export, and Delete as one group of bordered small buttons with icons; Delete uses a soft destructive style (red text and border) and Confirm delete the solid destructive style.
- **Proposal: canvas styling**: orthogonal edges with rounded corners, port labels as pills, the loop-back edge dashed in brown with a loop icon, a tinted header band and kind chip on every node card, and restyled zoom controls.
- **Proposal: editor details**: kind descriptions shown in the palette (today a tooltip), a validation pill in the editor toolbar that stays visible ("1 error"), node id and label side by side, compact route rows, and a language tag on code fields.
- **Proposal: controls for #8**: a switch for booleans with a default, a three-way segmented control for optional booleans (not set, yes, no), segmented controls for small enums and union variants, toggle chips for arrays of enums, and a styled file picker.
- **Proposal: narrow-width patterns for #41**: at 640 px and below the navigation collapses into a Menu button with a full-width panel, and tables become stacked cards labelled from `data-label`; at 1024 px and below the palette becomes an icon rail, the property panel becomes a bottom sheet that collapses to its header, and the run inspector becomes one column.
- **Proposal: inspector details**: kind chips beside node events in the timeline, a "live" pill, the selected event marked with a green bar, and the wait form's fields in one row on wide screens.
- **Proposal: a placeholder goblin-node mark** (the favicon's node with ears, eyes, and a grin) until #10 picks the mascot.
- **Proposal: page width** capped at 1240 px for list pages; the inspector and editor stay full width. `theme-color` becomes `--surface-inverse` (#1a1815).

## Open decisions for the owner

1. Primary action: lime with ink text (shown) or deep green with white text.
2. Active navigation item: lime pill (shown) or a quieter underline.
3. Magenta for the selected node (shown), or green selection and magenta only for the heartbeat kind and "new" moments.
4. The kind palette and icons, in particular subloop in orange (the failure hue) and exit in red (the destructive hue); both always carry an icon and a label.
5. SVG status icons and the hourglass for waiting.
6. The cream sunken surface, or a neutral grey one.
7. Keep the placeholder mark until #10, or show the wordmark alone.
8. The narrow-width patterns, and whether 768 px is the floor for editing (the open question on #41).
9. The font licence: SIL OFL 1.1 is not on the package allowlist, which governs npm packages only. The plan proposes allowing OFL for font assets; this sample records it in `docs/research/licenses.md` without changing the allowlist.

## Fonts

Geist and Geist Mono 1.7.2, SIL Open Font License 1.1, copyright Vercel in collaboration with basement.studio. Taken from the `geist` npm package (`https://registry.npmjs.org/geist/-/geist-1.7.2.tgz`, `dist/fonts/geist-sans/Geist-Variable.woff2` and `dist/fonts/geist-mono/GeistMono-Variable.woff2`); the licence text is `fonts/OFL.txt`. Both files are variable fonts (weights 100 to 900), 68 KB and 70 KB.

## Files

- `sample.html`: the prototype, with component styles inline.
- `tokens.css`: both token tiers, the font faces, and the reserved dark-theme block.
- `fonts/`: the two woff2 files and `OFL.txt`.
- `contrast.mjs` and `contrast.md`: the contrast check and its table.
- `capture.mjs`: the screenshot script.
- `screenshots/`: `loops-1440`, `loops-390`, `editor-1440`, `editor-1440-tall` (the whole property panel), `editor-768`, `editor-768-sheet-collapsed`, `nav-1440`, `nav-390`, `nav-390-menu-open`, `inspector-1440`, `inspector-768`, and `components-1440`; the real app before the change in `before-{loops,editor,inspector}-{1024,1440}`, `before-nav-{1024,1440}` (header crops), and, for the narrow layouts, `before-loops-390`, `before-editor-768`, and `before-inspector-768`.

## Not verified

- Screenshots are from Edge (Chromium) only; Firefox and Safari were not checked.
- Forced-colours mode and 200% zoom were not checked on the sample; they stay on the cutover's QA plan.
- Stacked tables use `display: block` on table elements, which some screen readers treat as losing table semantics; the cutover should keep the semantics explicitly.
- The contrast table covers solid token pairs. The selected node's soft glow, shadows, and disabled controls are not measured: the glow and shadows are decorative, and WCAG exempts disabled controls.
