import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shouldScanTokens,
  maskComments,
  colourLiterals,
  isRawColourClass,
  scanDesignTokens,
} from './design-tokens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const file = 'apps/web/src/example.tsx';
const scan = (source, path = file, exceptions = []) => scanDesignTokens(source, path, exceptions);

test('scan scope includes source and the two configs, with precise exclusions', () => {
  for (const path of [
    file,
    'apps/web/src/file.ts',
    'apps/web/src/file.css',
    'apps/web/index.html',
    'apps/web/vite.config.ts',
  ]) {
    assert.equal(shouldScanTokens(path), true, path);
  }
  assert.equal(shouldScanTokens('apps\\web\\src\\file.ts'), true);
  for (const path of [
    'apps/web/src/styles/tokens.css',
    'apps/web/src/__fixtures__/file.ts',
    'apps/web/src/file.test.tsx',
    'apps/web/src/file.test.css',
    'apps/web/src/file.json',
    'apps/web/src/styles-other/file.css',
    'apps/web/e2e/test.ts',
  ]) {
    assert.equal(shouldScanTokens(path), path.includes('styles-other'), path);
  }
  assert.deepEqual(scan("color: '#fff'", 'apps/web/src/styles/tokens.css'), []);
});

test('comments preserve line offsets and quoted strings, not suppressions', () => {
  const source = `// bg-red-500\n/* #fff\n white */\n<!-- bg-black -->\nconst url = 'https://example.test';\nconst value = "escaped \\" quote";\nconst template = \`bg-white\`;`;
  const masked = maskComments(source);
  assert.equal(masked.length, source.length);
  assert.equal(masked.split('\n').length, source.split('\n').length);
  assert.match(masked, /https:\/\/example.test/);
  assert.match(masked, /escaped/);
  assert.deepEqual(scan(source), [{ file, line: 7, text: 'bg-white' }]);
  assert.equal(scan('// token-ignore\nconst x = "text-red-500";')[0].line, 2);
});

test('complete colour utilities cover variants, opacity, important and all colour families', () => {
  for (const candidate of [
    'bg-slate-100',
    'hover:text-emerald-700',
    'dark:border-red-500',
    'ring-offset-white',
    'from-blue-500',
    'via-black',
    'to-white',
    'sm:dark:hover:!bg-red-500/50',
    '[&:nth-child(2)]:text-white!',
    'group-hover/item:divide-x-zinc-100',
    'border-t-rose-950',
    'fill-black',
    'stroke-gray-300',
    'shadow-black/20',
    'accent-cyan-400',
    'caret-fuchsia-500',
    'decoration-yellow-600',
    'placeholder-stone-300',
    'outline-neutral-500',
    'text-lightBlue-500',
    'ring-warmGray-500',
  ]) {
    assert.equal(isRawColourClass(candidate), true, candidate);
  }
  for (const candidate of [
    'white',
    'white-paper',
    'blackBox',
    'bg-transparent',
    'text-current',
    'fill-currentColor',
    'text-text-default',
    'bg-surface-app',
    'text-[10px]',
    'border-[var(--x)]',
    'bg-[url(#abc)]',
    '[width:10px]',
    'ring-2',
    'bg-red-500oops',
    'custom-bg-red-500',
    'text-[length:var(--size)]',
    'bg-[position:center]',
    'bg-[',
  ]) {
    assert.equal(isRawColourClass(candidate), false, candidate);
  }
});

test('arbitrary colours reject literals and literal fallbacks but permit token references', () => {
  for (const candidate of [
    'bg-[#abc]',
    'hover:text-[rgb(1, 2, 3)]',
    'border-[color:var(--x,#ff00aa)]',
    '[color:rebeccapurple]',
    '[background-color:#12345678]',
    'shadow-[0_0_2px_black]',
    'text-[oklch(50%_0.1_40)]',
    '[--local:#abc]',
  ]) {
    assert.equal(isRawColourClass(candidate), true, candidate);
  }
  assert.deepEqual(
    scan('<div className="hover:text-[rgb(1, 2, 3)] bg-[#abc]" />').map((v) => v.text),
    ['hover:text-[rgb(1, 2, 3)]', 'bg-[#abc]'],
  );
});

test('classes in arrays and variant maps are checked, while CSS URLs and strings are not classes', () => {
  assert.deepEqual(
    scan(
      "const classes = ['bg-white', 'hover:text-black']; const variants = { good: 'bg-blue-500' };",
    ).map((v) => v.text),
    ['bg-white', 'hover:text-black', 'bg-blue-500'],
  );
  assert.deepEqual(
    scan(".x { background: url('bg-white'); content: 'text-black'; }", 'apps/web/src/page.css'),
    [],
  );
});

test('colour literal tokenizer handles all required functions and hex lengths', () => {
  const functions = ['rgb', 'rgba', 'hsl', 'hsla', 'oklch', 'oklab', 'lab', 'lch', 'color'];
  for (const name of functions) {
    assert.equal(colourLiterals(`${name}(calc(1 + 2) 0 0)`)[0].text, `${name}(calc(1 + 2) 0 0)`);
  }
  assert.deepEqual(
    colourLiterals('#abc #abcdef #12345678').map((v) => v.text),
    ['#abc', '#abcdef', '#12345678'],
  );
  assert.deepEqual(
    colourLiterals('WHITE rebeccapurple').map((v) => v.text),
    ['WHITE', 'rebeccapurple'],
  );
  assert.deepEqual(
    colourLiterals(
      'var(--red) currentColor transparent current url(#abc) "white" #abcd #abcdefghi',
    ),
    [],
  );
  assert.equal(colourLiterals('rgb(0 0 0')[0].text, 'rgb(0 0 0');
});

test('CSS declarations, shorthands and @apply distinguish colours from ordinary values', () => {
  const source = `.white {\n color: white; background: #123456; border: 1px solid red;\n box-shadow: 0 0 1px rgba(0, 0, 0, 0.1); --local: #abc;\n content: 'black'; font-family: white; background-image: url('#fff');\n @apply dark:bg-slate-900 text-white;\n}\n#abc { padding: 1px; }`;
  assert.deepEqual(
    scan(source, 'apps/web/src/page.css').map((v) => v.text),
    ['white', '#123456', 'red', 'rgba(0, 0, 0, 0.1)', '#abc', 'dark:bg-slate-900', 'text-white'],
  );
});

test('JS style properties, JSX attributes, inline CSS and tagged CSS report exact offsets', () => {
  const source = `const id = '#abc'; const whitePaper = 'white';\nconst style = { color: '#abcdef', 'border-color': 'blue', backgroundColor: 'hsl(0 0% 0%)' };\nconst strokeColor = '#12345678';\n<div fill={'white'} style="background: #abc; color: var(--text-default)" />;\nconst cssText = css\`color: black;\`;`;
  assert.deepEqual(
    scan(source).map((v) => [v.line, v.text]),
    [
      [2, '#abcdef'],
      [2, 'blue'],
      [2, 'hsl(0 0% 0%)'],
      [3, '#12345678'],
      [4, 'white'],
      [4, '#abc'],
      [5, 'black'],
    ],
  );
  assert.deepEqual(
    scan(
      "const ids = ['#abc', '#abcdef']; const prose = 'black and white'; const color = 'var(--text-default)';",
    ),
    [],
  );
});

test('HTML theme metadata is checked regardless of attribute order', () => {
  const source =
    '<meta content="#abc" name="theme-color"><meta name="description" content="white"><meta name="theme-color"><!-- <meta name="theme-color" content="#fff"> -->';
  assert.deepEqual(scan(source, 'apps/web/index.html'), [
    { file: 'apps/web/index.html', line: 1, text: '#abc' },
  ]);
  assert.deepEqual(
    scan(
      "const manifest = { background_color: '#abc', theme_color: 'black' };",
      'apps/web/vite.config.ts',
    ).map((v) => v.text),
    ['#abc', 'black'],
  );
});

test('config exceptions are named exact declarations, never entire files or values', () => {
  const path = 'apps/web/vite.config.ts';
  const declaration = "const themeColor = '#abc';";
  const exception = { file: path, name: 'themeColor', declaration };
  assert.deepEqual(scan(declaration, path, [exception]), []);
  assert.equal(
    scan(`${declaration}\nconst manifest = { theme_color: '#abc' };`, path, [exception]).length,
    1,
  );
  assert.equal(scan("const themeColor = '#fff';", path, [exception]).length, 1);
  assert.equal(scan(declaration, path, [{ ...exception, file }]).length, 1);
  assert.throws(() => scan(declaration, path, [exception, exception]), /one named/);
  assert.throws(() => scan(declaration, path, [{ ...exception, name: '' }]), /one named/);
  assert.throws(() => scan(declaration, path, [{ ...exception, declaration: '' }]), /one named/);
  assert.throws(
    () => scan(declaration, path, [{ ...exception, declaration: '#abc' }]),
    /one named/,
  );
  assert.throws(() => scan(declaration, file, [{ ...exception, file }]), /one named/);
  assert.throws(() => scan(`${declaration}\n${declaration}`, path, [exception]), /more than once/);
  const html = '<meta name="theme-color" content="#abc">';
  assert.deepEqual(
    scan(html, 'apps/web/index.html', [
      { file: 'apps/web/index.html', name: 'surface-inverse', declaration: html },
    ]),
    [],
  );
});

test('CLI deliberate violation fixture fails; clean fixture passes', () => {
  const run = (args) =>
    spawnSync(process.execPath, [join(here, 'check-design-tokens.mjs'), ...args], {
      encoding: 'utf8',
    });
  const clean = run(['--root', join(here, '__fixtures__/design-tokens/clean')]);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stderr, /Design tokens: OK \(4 files checked\)/);
  const bad = run(['--root', join(here, '__fixtures__/design-tokens/violations')]);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /Design token violations \(10\)/);
  assert.match(bad.stderr, /apps\/web\/src\/page.tsx:2: hover:dark:text-emerald-700/);
  assert.match(bad.stderr, /apps\/web\/index.html:4: #123456/);
  const missing = run(['--root', join(here, '__fixtures__/design-tokens/missing')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /Design token check failed/);
  const invalid = run(['--unknown']);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Usage:/);
});
