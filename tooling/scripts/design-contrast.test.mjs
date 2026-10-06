import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readThemes,
  resolveToken,
  luminance,
  contrastRatio,
  validatePairs,
  contrastReport,
} from './contrast.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// The approved sample, and the shipped tokens the pairs are enforced against: the sample's values
// plus what integration added (for example the code search-match tokens).
const samplePath = resolve(here, '../../docs/design/visual-direction/tokens.css');
const sample = readFileSync(samplePath, 'utf8');
const shippedPath = resolve(here, '../../apps/web/src/styles/tokens.css');
const shipped = readFileSync(shippedPath, 'utf8');
const pairs = JSON.parse(readFileSync(join(here, 'design-contrast.pairs.json'), 'utf8'));

test('theme parsing resolves root defaults and independent explicit overrides', () => {
  const themes = readThemes(`/* ignored */ @import 'fonts.css';
    :root { --base: #fff; --fg: #000; --bg: var(--base); }
    [data-theme="light"] { --fg: #111 }
    :root[data-theme='dark'], [data-theme='dark'] { --base: #000; --fg: #fff; }
    @media (max-width: 1px) { :root { --base: #abc; } }
    html[data-theme=dark] { --extra: var(--fg); }
    .unrelated { --fg: #f00; }
    /* trailing comment */`);
  assert.equal(resolveToken(themes.light, '--bg'), '#fff');
  assert.equal(resolveToken(themes.light, '--fg'), '#111');
  assert.equal(resolveToken(themes.dark, '--bg'), '#000');
  assert.equal(resolveToken(themes.dark, '--fg'), '#fff');
  assert.equal(resolveToken(themes.dark, '--extra'), '#fff');
  assert.equal(themes.light['--extra'], undefined);
  assert.deepEqual(readThemes('/* empty */'), { dark: {}, light: {} });
  assert.throws(() => readThemes(':root { --fg: #fff;'), /Unclosed CSS rule/);
});

test('alias resolution catches missing and circular tokens, and supports fallbacks', () => {
  const tokens = { '--a': 'var( --b )', '--b': '#fff', '--fallback': 'var(--absent, var(--b))' };
  assert.equal(resolveToken(tokens, '--a'), '#fff');
  assert.equal(resolveToken(tokens, '--fallback'), '#fff');
  assert.equal(resolveToken({ '--a': 'var(--missing, #abc)' }, '--a'), '#abc');
  assert.throws(() => resolveToken(tokens, '--missing'), /Unknown token/);
  assert.throws(() => resolveToken({ '--a': 'var(--missing)' }, '--a'), /Unknown token/);
  assert.throws(
    () => resolveToken({ '--a': 'var(--b)', '--b': 'var(--a)' }, '--a'),
    /Circular token/,
  );
});

test('WCAG reference results, symmetry and both channel transfer branches', () => {
  assert.equal(luminance('#000'), 0);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(luminance('#ABC'), luminance('#aabbcc'));
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.equal(contrastRatio('#fff', '#000'), 21);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
  assert.ok(Math.abs(contrastRatio('#767676', '#ffffff') - 4.542224959605253) < 1e-10);
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.5);
  assert.ok(luminance('#010a0b') > 0);
  for (const colour of ['#ffff', '#12345678', 'rgba(0,0,0,.5)', 'red']) {
    assert.throws(() => luminance(colour), /opaque/);
  }
});

test('pair data validates all groups and preserves the sample with focus on every surface', () => {
  validatePairs(pairs);
  assert.equal(pairs.text.length, 109);
  assert.equal(pairs.nonText.length, 132);
  assert.equal(pairs.decorative.length, 18);
  // The editor's issue badges (#15): their edge, for errors and warnings, and the focus ring hold
  // 3:1 on every node kind's header band, and the popover's severity chips on the overlay.
  const has = (group, fg, bg) => group.some(([f, b]) => f === fg && b === bg);
  for (const surface of ['--surface-raised', '--surface-overlay', '--surface-sunken']) {
    assert.ok(has(pairs.text, '--status-warn-fg', surface), `Field warning on ${surface}`);
  }
  const bands = Object.keys(readThemes(shipped).light).filter((name) =>
    /^--kind-[a-z]+-subtle$/.test(name),
  );
  assert.equal(bands.length, 9);
  for (const band of bands) {
    for (const fg of ['--status-bad-border', '--status-warn-border', '--focus-ring']) {
      assert.ok(has(pairs.nonText, fg, band), `${fg} on ${band}`);
    }
  }
  for (const fg of ['--status-bad-border', '--status-warn-border']) {
    assert.ok(has(pairs.nonText, fg, '--surface-overlay'), `${fg} on --surface-overlay`);
  }
  assert.ok(has(pairs.decorative, '--surface-overlay', '--canvas-bg'));
  for (const fg of ['--text-default', '--text-muted']) {
    assert.ok(has(pairs.text, fg, '--surface-raised'), `${fg} label on pill (#18)`);
  }
  for (const fg of [
    '--canvas-edge',
    '--canvas-edge-loop',
    '--canvas-edge-selected',
    '--focus-ring',
  ]) {
    assert.ok(has(pairs.nonText, fg, '--canvas-bg'), `${fg} stroke on canvas (#18)`);
  }
  // The shipped tokens keep every value of the approved sample in both themes. Values are compared
  // with their var() references expanded, so a shipped token may route a sample value through a
  // new alias (the header hairline's stops) without changing what it resolves to. The light
  // surfaces, borders, and warn edge below were retuned on the owner's feedback (#11, 2026-10-04:
  // a white page with warm tinted surfaces and dark-brown accents); they, and only they, may differ
  // from the sample, and each must still differ, so the list stays exact.
  const lightTuned = [
    '--surface-app',
    '--surface-raised',
    '--surface-sunken',
    '--surface-hover',
    '--surface-control',
    '--border-default',
    '--border-strong',
    '--border-subtle',
    '--status-warn-border',
  ];
  const approved = readThemes(sample);
  const actual = readThemes(shipped);
  const expand = (tokens, value) =>
    value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => expand(tokens, tokens[name] ?? ''));
  for (const theme of ['dark', 'light']) {
    for (const [name, value] of Object.entries(approved[theme])) {
      assert.ok(actual[theme][name] !== undefined, `${theme} ${name} is missing`);
      const shippedValue = expand(actual[theme], actual[theme][name]);
      if (theme === 'light' && lightTuned.includes(name)) {
        assert.notEqual(shippedValue, expand(approved[theme], value), `light ${name} is tuned`);
        continue;
      }
      assert.equal(shippedValue, expand(approved[theme], value), `${theme} ${name}`);
    }
  }
  for (const name of lightTuned) assert.ok(approved.light[name] !== undefined, name);
  for (const name of Object.keys(readThemes(shipped).light).filter((name) =>
    name.startsWith('--surface-'),
  )) {
    assert.ok(
      pairs.nonText.some(([fg, bg]) => fg === '--focus-ring' && bg === name),
      name,
    );
  }
  for (const invalid of [
    null,
    'bad',
    {},
    { ...pairs, text: [] },
    { ...pairs, text: 'bad' },
    { ...pairs, text: ['bad'] },
    { ...pairs, text: [['--a', '--b']] },
    { ...pairs, text: [['--a', '--b', '']] },
    { ...pairs, text: [['--a', '--b', 1]] },
    { ...pairs, text: [['a', '--b', 'label']] },
    { ...pairs, text: [['--a', 'b', 'label']] },
  ]) {
    assert.throws(() => validatePairs(invalid), /Contrast pairs|Invalid text pair/);
  }
});

test('report measures both themes, enforcing unrounded ratios and listing decorative pairs', () => {
  const result = contrastReport(shipped, pairs);
  assert.equal(result.failures.length, 0);
  assert.match(
    result.markdown,
    /109 text pairs \(0 below 4.5:1\), 132 non-text pairs \(0 below 3:1\)/,
  );
  // The issue badge rows (#15) are measured and pass in both themes: 18 band edges per theme.
  const badgeRows = result.markdown
    .split('\n')
    .filter((line) => line.includes('issue badge edge on its band'));
  assert.equal(badgeRows.length, 36);
  for (const row of badgeRows) assert.match(row, /\| [\d.]+:1 \| pass \|/);
  assert.match(result.markdown, /## Dark theme/);
  assert.match(result.markdown, /## Light theme/);
  assert.match(result.markdown, /decorative/);
  const bad = contrastReport(
    ':root { --fg: #777777; --bg: #fff; --edge: #fff; }',
    {
      text: [['--fg', '--bg', 'A | B\nC']],
      nonText: [['--edge', '--bg', 'Boundary']],
      decorative: [['--bg', '--bg', 'Decoration']],
    },
    'fixture.css',
  );
  assert.equal(bad.failures.length, 4);
  assert.match(bad.markdown, /\*\*FAIL\*\*/);
  assert.match(bad.markdown, /A \\\| B C/);
  assert.match(bad.markdown, /from `fixture.css`/);
  assert.throws(() => contrastReport(':root {}', pairs), /Unknown token/);
  assert.throws(
    () => contrastReport(`${shipped}\n:root { --surface-new: #fff; }`, pairs),
    /Missing non-text focus-ring pair for --surface-new/,
  );
});

test('CLI writes a formatted temporary table, checks freshness and reports missing inputs', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'graphgoblin-contrast-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const output = join(temporary, 'nested/table.md');
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [join(here, 'design-contrast.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, GG_DESIGN_TOKENS: shippedPath, ...env },
    });
  const write = run(['--output', output]);
  assert.equal(write.status, 0, write.stderr);
  assert.match(write.stderr, /0 failing enforced pair/);
  const check = run(['--tokens', shippedPath, '--output', output, '--check']);
  assert.equal(check.status, 0, check.stderr);
  const table = readFileSync(output, 'utf8');
  writeFileSync(output, table.replace(/\n/g, '\r\n'));
  assert.equal(run(['--check', '--output', output]).status, 0);
  writeFileSync(output, 'stale');
  const stale = run(['--check', '--output', output]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /table stale/);
  const absent = run(['--check', '--output', join(temporary, 'absent.md')]);
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /missing or stale/);
  // The committed table is checked read-only against the shipped tokens.
  const repositoryCheck = run(['--check']);
  assert.equal(repositoryCheck.status, 0, repositoryCheck.stderr);
  assert.match(repositoryCheck.stderr, /0 failing enforced pair/);
  const directoryOutput = join(temporary, 'directory.md');
  mkdirSync(directoryOutput);
  const unreadable = run(['--check', '--output', directoryOutput]);
  assert.equal(unreadable.status, 2);
  assert.match(unreadable.stderr, /Design contrast failed/);
  const missing = run(['--check'], { GG_DESIGN_TOKENS: join(temporary, 'absent.css') });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Cannot read design tokens.*supply --tokens/);
  const invalid = run(['--bad']);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Usage:/);
  assert.equal(run(['--tokens']).status, 2);
  const badTokens = join(temporary, 'bad.css');
  writeFileSync(
    badTokens,
    shipped.replace(/--text-default:\s*[^;]+;/g, '--text-default: #ffffff;'),
  );
  const failingWrite = run(['--tokens', badTokens, '--output', output]);
  assert.equal(failingWrite.status, 1);
  assert.match(failingWrite.stderr, /FAIL light --text-default/);
  const failingCheck = run(['--tokens', badTokens, '--output', output, '--check']);
  assert.equal(failingCheck.status, 1);
  assert.doesNotMatch(failingCheck.stderr, /table stale/);
  const unparseable = join(temporary, 'empty.css');
  writeFileSync(unparseable, ':root {}');
  assert.equal(run(['--tokens', unparseable, '--output', output]).status, 2);
});
