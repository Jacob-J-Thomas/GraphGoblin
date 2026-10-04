# ADR-0017 - Two-tier design tokens and the web component structure

Date: 2026-10-04. Status: Accepted. Implements #7 to the visual direction the owner approved (`docs/design/visual-direction/`); #11 (theme control), #8 (form controls), #9 (interaction states), #40 (font choice), and #41 (responsive layout) build on it.

## Context

The web app styled every element with raw Tailwind palette classes (about 160 across 24 files), hex colours in `index.html` and the manifest, and the default looks of CodeMirror and xyflow. Changing the look, or adding the dark theme the owner asked for, would have meant editing every component. The owner approved a dark-first visual direction: goblin green accent, warm near-black neutrals, brown as a palette accent, magenta and purple for the most special moments only, Geist, a mascot mark, and SVG icons for node kinds and run statuses. Dark is the product's default theme; light is the alternate.

## Decision

1. **Two tiers of CSS custom properties** in `apps/web/src/styles/tokens.css`. The primitive tier holds the palette scales (green, brown, grey, magenta, violet, blue, orange, amber, red, teal, slate) and is referenced only by the semantic tier. The semantic tier (surfaces, text, borders, accent, danger, status tones, node kinds, focus ring, code, canvas, mascot, shadows) is declared once for light on `:root, [data-theme='light']` and once for dark on `[data-theme='dark']`, each with its `color-scheme`. Type, space, radius, and motion scales are theme independent; the motion durations drop to 0 ms under `prefers-reduced-motion`. A theme is a value swap: components never change.
2. **Tailwind maps onto the semantic tier only.** `styles/theme.css` declares `@theme inline reference`: Tailwind's colour, text-colour, border-colour, font, size, weight, leading, tracking, spacing, radius, shadow, and easing keys point at the tokens (`bg-surface-raised`, `text-muted`, `border-default`, `ring-focus`, `font-mono`, `rounded-md`, `shadow-2`, `p-page`), Tailwind declares no variables of its own, and the default scales are reset, so a raw palette class such as `bg-slate-100` produces no CSS at all. Node kinds read `--k` and `--k-subtle` (`bg-kind`, `bg-kind-subtle`), which `editor/KindChip.tsx` sets from `KIND_INFO[kind].color`, now a token name (`kind-trigger`). Effects that combine tokens (the glows of the reserved highlight moments, the pulse) are `@utility` definitions in `styles/utilities.css`.
3. **`apps/web/src/styles/` is the only place colour literals live.** Third-party theming sits there too: `code-theme.ts` (CodeMirror chrome and syntax colours as CSS variables, with a small highlighter keyed by lezer tag names) and `canvas.css` (xyflow's `--xy-*` variables, handles, edge labels, controls, focus). The colours that cannot be CSS variables, `theme-color` and the manifest's `theme_color` and `background_color`, are read from `tokens.css` at build time by `vite.config.ts` through `styles/palette.ts`.
4. **Self-hosted Geist and Geist Mono** (SIL OFL 1.1) under `apps/web/public/fonts` with the licence text, preloaded in `index.html` and precached with the app shell. Components never name a family: `--font-ui` and `--font-code` are the indirection #40 switches.
5. **Dark by default, statically, until #11.** `index.html` sets `data-theme="dark"` on `<html>`; #11 replaces it with the persisted control and the no-flash script.
6. **Component structure.** `components/ui/` holds one primitive per file (button, field, card, badge, alert, table) behind a barrel; `lib/variants.ts` is a typed variant helper over `clsx` in place of class-variance-authority; `components/icons/` holds the SVG glyphs, `KindIcon`, `StatusIcon`, and the goblin `Logo`; `components/layout/` holds `AppShell`, `MainNav`, `Page`, and `PageHeader`. Pages assemble feature components, feature components assemble primitives, and primitives take their look from tokens only. The large screens are split by concern behind unchanged exports: `EditorPage` (toolbar, side panel, load and conflict hooks), `RunInspectorPage` (`runs/inspector/`), `SettingsPage` (`settings/sections/`), and `forms/fields.tsx` (`forms/fields/`, one file per field family).

## Consequences

- #11 swaps or extends values in `tokens.css` and adds the control; no component changes. A new screen inherits both themes by using the utilities.
- Contrast is a property of token pairs: the committed table covers every text and non-text pair in both themes, and a component cannot introduce an unchecked colour without adding a token.
- The guard in `pnpm check` can reject palette classes and colour literals anywhere in `apps/web/src` outside `styles/`; the closed Tailwind theme makes such a class render as nothing even before the guard runs.
- Tailwind class names read differently from stock Tailwind (`text-md` is 14 px, `rounded-md` 8 px, no `text-base` or `shadow-lg`). The mapping in `theme.css` is the reference.
- CodeMirror's syntax colours depend on lezer tag names (`keyword`, `string`, `propertyName`, ...). A tag without a role falls back through its parents and otherwise renders in the code foreground.
- Forced-colours mode drops box shadows, so the selected node's ring and the current timeline row use outlines, badges keep a transparent border, and no glow carries meaning.

## Alternatives considered

- **Tailwind's default palette with `dark:` variants.** Every component would encode both themes, and a palette change would touch every file again.
- **CSS-in-JS or CSS modules per component.** More machinery than the app needs; Tailwind utilities over tokens keep styles beside the markup with no runtime.
- **shadcn/ui on Radix, or class-variance-authority.** New dependencies for what native elements and a 40-line helper cover today; #8 may revisit controls such as switches and segmented controls.
- **A direct `@lezer/highlight` dependency** for a standard `HighlightStyle`. Avoided: the tag-name highlighter needs only `@codemirror/language`, which the app already uses.
