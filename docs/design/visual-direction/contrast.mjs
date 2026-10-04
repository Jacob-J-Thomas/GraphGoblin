#!/usr/bin/env node
/**
 * Contrast table for the visual-direction sample (#7).
 *
 *   node docs/design/visual-direction/contrast.mjs          # writes contrast.md, exits 1 on a failure
 *   node docs/design/visual-direction/contrast.mjs --check  # compares with the committed contrast.md
 *
 * Reads the light semantic tokens from tokens.css (resolving var() to the primitive scale), then
 * checks every foreground and background pair the sample uses with the WCAG 2.x relative-luminance
 * formula. Text needs 4.5:1 and required non-text (control boundaries, focus rings, state
 * indicators, meaningful graphics) needs 3:1 (WCAG 1.4.3 and 1.4.11). Decorative pairs (card edges,
 * dividers, the canvas grid) are listed for information and not enforced.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(here, 'tokens.css');
const OUTPUT = join(here, 'contrast.md');

/** Custom properties declared in top-level `:root { }` blocks (not inside @media or themes). */
export function readTokens(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = {};
  let depth = 0;
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open < 0) break;
    const selector = source.slice(index, open).trim().split(/[;}]/).pop().trim();
    let close = open + 1;
    let nested = 1;
    while (nested > 0 && close < source.length) {
      if (source[close] === '{') nested += 1;
      if (source[close] === '}') nested -= 1;
      close += 1;
    }
    if (depth === 0 && selector === ':root') {
      const body = source.slice(open + 1, close - 1);
      for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        tokens[match[1]] = match[2].trim();
      }
    }
    index = close;
  }
  return tokens;
}

export function resolve(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`circular token ${name}`);
  const value = tokens[name];
  if (value === undefined) throw new Error(`unknown token ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref ? resolve(tokens, ref[1], new Set([...seen, name])) : value;
}

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(match[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------------------------
// The pairs the sample uses: [foreground, background, where].
// ---------------------------------------------------------------------------------------------

const KINDS = [
  'trigger',
  'decision',
  'inference',
  'script',
  'mutate',
  'subloop',
  'wait',
  'heartbeat',
  'exit',
];
const TONES = ['neutral', 'good', 'bad', 'warn', 'info'];
const LIGHT_SURFACES = [
  '--surface-app',
  '--surface-raised',
  '--surface-sunken',
  '--surface-overlay',
];
const CODE_TOKENS = [
  '--code-fg',
  '--code-gutter',
  '--code-keyword',
  '--code-string',
  '--code-number',
  '--code-comment',
  '--code-operator',
];

const TEXT = [
  ...LIGHT_SURFACES.flatMap((s) => [
    ['--text-default', s, 'Body text, headings, table cells, form values'],
    ['--text-muted', s, 'Labels, descriptions, secondary meta'],
    ['--text-subtle', s, 'Placeholders, timestamps, sequence numbers'],
  ]),
  ['--text-default', '--surface-hover', 'Hovered row, ghost button, palette item'],
  ['--text-muted', '--surface-hover', 'Meta text in a hovered row'],
  ['--text-link', '--surface-app', 'Links on the page background'],
  ['--text-link', '--surface-raised', 'Links in cards and tables'],
  ['--text-link', '--surface-sunken', 'Links in sunken panels'],
  ['--text-default', '--surface-sunken', 'Secondary buttons, code previews'],
  ['--text-default', '--accent-subtle', 'Selected timeline row'],
  ['--text-muted', '--accent-subtle', 'Event description in a selected row'],
  ['--text-subtle', '--accent-subtle', 'Sequence number in a selected row'],
  ['--accent-on-subtle', '--accent-subtle', 'Selected segment, checked toggle chip, "live" pill'],
  ['--text-on-accent', '--accent', 'Primary button, active nav item'],
  ['--text-on-accent', '--accent-hover', 'Primary button, hover'],
  ['--text-on-accent', '--accent-active', 'Primary button, pressed'],
  ['--text-on-danger', '--danger', 'Destructive button'],
  ['--text-on-danger', '--danger-hover', 'Destructive button, hover'],
  ['--danger', '--surface-raised', 'Soft destructive button label'],
  ['--danger-on-subtle', '--danger-subtle', 'Soft destructive button, hover'],
  ['--accent-highlight', '--accent-highlight-subtle', '"New" highlight badge'],
  ['--accent-highlight', '--surface-raised', 'Highlight text on cards'],
  ...TONES.flatMap((t) => [
    [`--status-${t}-fg`, `--status-${t}-bg`, `${t} badge and alert title, with its glyph`],
    ['--text-default', `--status-${t}-bg`, `${t} alert body`],
  ]),
  ['--status-bad-fg', '--surface-raised', 'Validation error line, field error'],
  ['--status-warn-fg', '--surface-raised', 'Validation warning line'],
  ['--status-good-fg', '--surface-raised', '"All changes saved" check, "Ready to publish"'],
  ['--text-inverse', '--surface-inverse', 'Header wordmark and active text'],
  ['--text-inverse-muted', '--surface-inverse', 'Header nav items'],
  ['--text-inverse', '--surface-inverse-raised', 'Narrow menu, hovered nav item'],
  ['--text-inverse-muted', '--surface-inverse-raised', 'Narrow menu, secondary text'],
  ['--accent', '--surface-inverse', 'Wordmark accent ("Goblin")'],
  ...CODE_TOKENS.flatMap((f) => [
    [f, '--code-bg', 'Code field'],
    [f, '--code-active-line', 'Code field, active line'],
  ]),
  ...KINDS.map((k) => ['--text-muted', `--kind-${k}-subtle`, `${k} node: kind label on its band`]),
  ...KINDS.map((k) => ['--text-default', `--kind-${k}-subtle`, `${k} palette item, hover`]),
];

const FOCUS_SURFACES = [
  ...LIGHT_SURFACES,
  '--surface-inverse',
  '--surface-inverse-raised',
  '--accent-subtle',
  '--danger-subtle',
  ...TONES.map((t) => `--status-${t}-bg`),
  '--code-bg',
  '--canvas-bg',
];

const NON_TEXT = [
  ...FOCUS_SURFACES.map((s) => ['--focus-ring', s, 'Focus ring (2px, offset 2px)']),
  ['--border-strong', '--surface-raised', 'Input, select, textarea, checkbox, outline button'],
  ['--border-strong', '--surface-app', 'Controls on the page background'],
  ['--border-strong', '--surface-sunken', 'Segmented control track, controls in sunken panels'],
  ['--border-strong', '--surface-overlay', 'Controls in the bottom sheet'],
  [
    '--accent-strong',
    '--surface-raised',
    'Primary button edge, switch-on and checkbox edge, tab underline, focused input border',
  ],
  ['--accent-strong', '--surface-app', 'Primary button edge on the page background'],
  ['--accent-strong', '--surface-sunken', 'Selected segment outline on its track'],
  ['--accent-strong', '--accent-subtle', 'Selected timeline row bar'],
  ['--text-on-accent', '--accent', 'Switch thumb (on) and checkbox tick'],
  ['--text-muted', '--surface-sunken', 'Switch thumb (off) on its track'],
  ['--accent', '--surface-inverse', 'Active nav pill against the header'],
  ['--accent', '--surface-inverse-raised', 'Active item bar in the narrow menu'],
  ['--danger', '--surface-raised', 'Soft destructive button edge, destructive button fill'],
  ['--status-bad-border', '--surface-raised', 'Invalid input border'],
  ...TONES.flatMap((t) => [
    [`--status-${t}-border`, '--surface-raised', `${t} alert accent bar in a card`],
    [`--status-${t}-border`, '--surface-app', `${t} alert accent bar on the page, banner rule`],
    [`--status-${t}-border`, `--status-${t}-bg`, `${t} alert accent bar against its fill`],
  ]),
  ...KINDS.flatMap((k) => [
    [`--kind-${k}`, '--surface-raised', `${k} chip on a node card or palette item`],
    [`--kind-${k}`, '--surface-sunken', `${k} chip on the palette rail`],
    ['--text-inverse', `--kind-${k}`, `${k} icon inside its chip`],
  ]),
  ['--canvas-edge', '--canvas-bg', 'Edge'],
  ['--canvas-edge-selected', '--canvas-bg', 'Selected edge'],
  ['--canvas-edge-loop', '--canvas-bg', 'Loop-back edge (dashed)'],
  ['--canvas-edge-loop', '--surface-raised', 'Loop-back label border and icon'],
  ['--kind-decision', '--accent-subtle', 'Kind chip in the selected timeline row'],
  ['--canvas-node-selected', '--canvas-bg', 'Selected node ring'],
  ['--canvas-handle', '--surface-raised', 'Port handle on the card edge'],
  ['--canvas-handle', '--canvas-bg', 'Port handle against the canvas'],
];

const DECORATIVE = [
  [
    '--border-default',
    '--surface-raised',
    'Card and table edges (not needed to identify anything)',
  ],
  ['--border-default', '--surface-app', 'Card edges on the page'],
  ['--border-subtle', '--surface-raised', 'Row dividers'],
  ['--canvas-grid', '--canvas-bg', 'Canvas dot grid'],
  ['--surface-raised', '--surface-app', 'Cards on the page (also carry a border and shadow)'],
  ['--surface-sunken', '--surface-raised', 'Sunken panels inside cards'],
  ['--border-inverse', '--surface-inverse', 'Menu button outline (its icon and label identify it)'],
  ['--accent-highlight', '--surface-raised', 'Update toast dot (the text says it)'],
  [
    '--kind-trigger-subtle',
    '--surface-raised',
    'Node card header band (the chip carries the kind)',
  ],
];

function rows(pairs, tokens, minimum) {
  return pairs.map(([fg, bg, where]) => {
    const a = resolve(tokens, fg);
    const b = resolve(tokens, bg);
    const r = ratio(a, b);
    return { fg, bg, a, b, r, where, pass: minimum === undefined || r >= minimum };
  });
}

function table(list, minimum) {
  const head =
    '| Foreground | Background | Ratio | Result | Where |\n| --- | --- | ---: | --- | --- |';
  const body = list.map(
    (row) =>
      `| \`${row.fg}\` ${row.a} | \`${row.bg}\` ${row.b} | ${row.r.toFixed(2)}:1 | ${
        minimum === undefined ? 'decorative' : row.pass ? 'pass' : `**FAIL** (< ${minimum}:1)`
      } | ${row.where} |`,
  );
  return [head, ...body].join('\n');
}

export function report(css) {
  const tokens = readTokens(css);
  const text = rows(TEXT, tokens, 4.5);
  const nonText = rows(NON_TEXT, tokens, 3);
  const decorative = rows(DECORATIVE, tokens);
  const failures = [...text, ...nonText].filter((r) => !r.pass);
  const markdown = `# Contrast: visual-direction sample (light theme)

Generated by \`node docs/design/visual-direction/contrast.mjs\` from \`tokens.css\`; do not edit by hand. Ratios use the WCAG 2.x relative-luminance formula.

- Text pairs: ${text.length} checked, minimum 4.5:1 (WCAG 1.4.3), ${text.filter((r) => !r.pass).length} below.
- Non-text pairs: ${nonText.length} checked, minimum 3:1 (WCAG 1.4.11: control boundaries, focus rings, state indicators, meaningful graphics), ${nonText.filter((r) => !r.pass).length} below.
- Decorative pairs: ${decorative.length} listed for information; they identify nothing on their own, so 1.4.11 does not apply.

Lowest text ratio: ${Math.min(...text.map((r) => r.r)).toFixed(2)}:1. Lowest non-text ratio: ${Math.min(...nonText.map((r) => r.r)).toFixed(2)}:1.

## Text (4.5:1)

${table(text, 4.5)}

## Non-text (3:1)

${table(nonText, 3)}

## Decorative (not enforced)

${table(decorative)}
`;
  return { markdown, failures };
}

/** Format with the repository's Prettier config so `format:check` agrees with the output. */
async function formatted(markdown) {
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(OUTPUT)) ?? {};
  return prettier.format(markdown, { ...options, filepath: OUTPUT });
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = report(readFileSync(TOKENS, 'utf8'));
  const { failures } = result;
  const markdown = await formatted(result.markdown);
  if (process.argv.includes('--check')) {
    const committed = readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n');
    if (committed !== markdown) {
      console.error(
        'contrast.md is out of date; run node docs/design/visual-direction/contrast.mjs',
      );
      process.exit(1);
    }
  } else {
    writeFileSync(OUTPUT, markdown, 'utf8');
  }
  for (const f of failures) console.error(`FAIL ${f.fg} on ${f.bg}: ${f.r.toFixed(2)}:1`);
  console.error(`${failures.length} failing pair(s)`);
  process.exit(failures.length > 0 ? 1 : 0);
}
