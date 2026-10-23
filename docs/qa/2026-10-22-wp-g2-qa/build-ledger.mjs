import { readFile, writeFile } from 'node:fs/promises';
const dir = 'docs/qa/2026-10-22-wp-g2-qa';
const files = [
  'functional.jsonl',
  'lookahead-retest.jsonl',
  'adjacent.jsonl',
  'two-tabs-retest.jsonl',
  'boundary-browser.jsonl',
  'inspector-retest.jsonl',
];
const groups = [];
for (const file of files) {
  const a = (await readFile(dir + '/' + file, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
  groups.push({ file, checks: a });
}
const esc = (s) =>
  String(s ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
let md =
  '# Independent check ledger\n\nEach row includes its steps, expected behavior, actual result and evidence pointer. Full response bodies and measurements remain in the linked JSONL files. Initial QA harness failures are preserved; only their corrected targeted reruns supersede them.\n\n';
for (const group of groups) {
  md +=
    '## ' +
    group.file +
    '\n\n| Check | Steps | Expected | Actual | Result | Evidence |\n| --- | --- | --- | --- | --- | --- |\n';
  for (let i = 0; i < group.checks.length; i++) {
    const x = group.checks[i],
      actual = typeof x.actual === 'string' ? x.actual : JSON.stringify(x.actual);
    md +=
      '| ' +
      [
        x.id,
        x.steps,
        x.expected,
        actual.length > 230 ? actual.slice(0, 230) + ' (full details in evidence)' : actual,
        x.result,
        '[' + group.file + ':' + (i + 1) + '](' + group.file + ')',
      ]
        .map(esc)
        .join(' | ') +
      ' |\n';
  }
  md += '\n';
}
md +=
  '## Interpretation limits\n\n- Real malformed requested inbound-event pages fail with a typed500 error and no cursor. They cannot be skipped in the current contract. The successful-empty-page continuation check changes only an HTTP response, retains the real cursor, and is controlled-response evidence.\n- The original MCP error parser wrongly assumed every tool response was JSON. REST assertions had passed. lookahead-retest.jsonl corrects the parser and reruns only the two corruption variants, with no product change.\n- The simultaneous inactive-tab click timed out in Playwright. The targeted follow-up activates each actual tab before actions and uses the same timeouts. Both tabs then reach105 unique runs. The initial timeout is retained as a browser automation limitation.\n- Native API and MCP claims use built processes and real file-backed SQLite. Edge history specs use the repository fake-harness test composition with real SQLite and the built web app; they establish no paid-provider behavior.\n';
await writeFile(dir + '/checks.md', md);
console.log(
  'Wrote ledger for',
  groups.reduce((n, g) => n + g.checks.length, 0),
  'observations',
);
