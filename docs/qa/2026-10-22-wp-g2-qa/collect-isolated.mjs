import { readFile, writeFile } from 'node:fs/promises';
const dir = 'docs/qa/2026-10-22-wp-g2-qa';
const cases = JSON.parse(await readFile(dir + '/triage-cases.json', 'utf8'));
const originals = new Map();
for (const pkg of ['infrastructure', 'web']) {
  const text = await readFile(dir + '/suite-' + pkg + '.txt', 'utf8');
  const pos = text.indexOf('Failed Tests');
  let active = [];
  for (const line of text.slice(Math.max(0, pos)).split('\n')) {
    const m = /^\s*FAIL\s+(\S+)\s*>\s*(.+)/.exec(line);
    if (m) active.push(m[1] + '>' + m[2].trim());
    else if (
      active.length &&
      /^(Error:|AssertionError:|TestingLibraryElementError:)/.test(line.trim())
    ) {
      for (const key of active) {
        const lookup = pkg + ':' + key;
        originals.set(lookup, [...(originals.get(lookup) ?? []), line.trim()]);
      }
      active = [];
    }
  }
}
const rows = [];
for (let i = 0; i < cases.length; i++) {
  const name = 'triage-' + String(i + 1).padStart(2, '0') + '.txt';
  let text;
  try {
    text = await readFile(dir + '/' + name, 'utf8');
  } catch {
    continue;
  }
  const exit = /^EXIT:\s*(\d+)/m.exec(text);
  if (!exit) continue;
  const summary = /^\s*Tests\s+(.+)$/m.exec(text)?.[1]?.trim() ?? 'missing summary';
  const passed = Number(/(\d+) passed/.exec(summary)?.[1] ?? 0),
    failed = Number(/(\d+) failed/.exec(summary)?.[1] ?? 0);
  const selected = passed + failed,
    result = selected !== 1 ? 'INVALID_SELECTION' : exit[1] === '0' ? 'PASS' : 'FAIL';
  const errors = text
    .split('\n')
    .filter(
      (x) =>
        /^(Error:|AssertionError:|TypeError:|TestingLibraryElementError:)/.test(x.trim()) &&
        !x.includes('ERR_PNPM'),
    )
    .map((x) => x.trim())
    .slice(0, 3);
  const originalErrors =
    originals.get(cases[i].package + ':' + cases[i].file + '>' + cases[i].name) ?? [];
  const category =
    cases[i].package === 'infrastructure' && !cases[i].file.includes('/sqlite/')
      ? 'D-015 native-process fixture'
      : result === 'PASS'
        ? originalErrors.some((x) => x.includes('timed out'))
          ? 'Full-run load/deadline timeout; isolated PASS'
          : 'Full-run assertion not reproduced alone; timing/order class'
        : 'Persistent isolated failure';
  rows.push({
    index: i + 1,
    ...cases[i],
    steps:
      'Run this case alone in its original package/file with the recorded title-word regex, one worker, unchanged test timeout.',
    expected: 'One selected test passes.',
    result,
    selected,
    summary,
    category,
    originalErrors,
    errors,
    evidence: name,
  });
}
await writeFile(dir + '/triage-results.json', JSON.stringify(rows, null, 2));
const esc = (s) => String(s).replaceAll('|', '/').replaceAll('\n', ' ');
let md =
  '# Isolated failure triage\n\nEach full-run failure was selected alone after all full suites finished. Default test timeouts and assertions were retained. All selected-test counts are checked; zero-execution selector misses are excluded and preserved separately. Isolated passes do not make the failed full suite green.\n\n| # | Package/file and case | Steps / expected | Full-run actual | Isolated actual | Result / class | Evidence |\n| --- | --- | --- | --- | --- | --- | --- |\n';
for (const r of rows)
  md +=
    '| ' +
    [
      r.index,
      r.package + '/' + r.file + ' - ' + r.name,
      'Run recorded single-case command; expect one test to pass.',
      r.originalErrors.join(' ').slice(0, 220) || 'FAIL; full details in package log',
      'Selected ' + r.selected + '; ' + r.summary + '; ' + r.errors.join(' ').slice(0, 260),
      r.result + '; ' + r.category,
      '[' + r.evidence + '](' + r.evidence + ')',
    ]
      .map(esc)
      .join(' | ') +
    ' |\n';
await writeFile(dir + '/triage.md', md);
if (rows.length !== cases.length || rows.some((x) => x.selected !== 1))
  throw Error('Isolated selection audit incomplete');
console.log(
  JSON.stringify({
    completed: rows.length,
    pass: rows.filter((x) => x.result === 'PASS').length,
    fail: rows.filter((x) => x.result === 'FAIL').length,
    invalid: rows.filter((x) => x.result === 'INVALID_SELECTION').length,
  }),
);
