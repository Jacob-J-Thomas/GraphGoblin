import { readFile, writeFile } from 'node:fs/promises';
const dir = 'docs/qa/2026-10-22-wp-g2-qa',
  packages = ['infrastructure', 'api', 'api-client', 'mcp', 'web'],
  suites = [],
  failures = [];
for (const name of packages) {
  let s;
  try {
    s = await readFile(dir + '/suite-' + name + '.txt', 'utf8');
  } catch {
    continue;
  }
  const exit = /EXIT:\s*(\d+); ELAPSED_SECONDS:\s*([\d.]+)/.exec(s);
  const pick = (re) => re.exec(s)?.[1]?.trim() ?? null;
  const failed = [...s.matchAll(/^\s*FAIL\s+(\S+\.test\.tsx?)\s*>\s*(.+)\r?$/gm)].map((m) => ({
    package: name,
    file: m[1],
    name: m[2].trim(),
  }));
  const unique = [...new Map(failed.map((x) => [x.file + x.name, x])).values()];
  suites.push({
    package: name,
    command:
      'pnpm.cmd --filter @graphgoblin/' +
      name +
      ' test:coverage --maxWorkers=1 --coverage.reportOnFailure --reporter=verbose',
    result: exit ? (exit[1] === '0' ? 'PASS' : 'FAIL') : 'RUNNING',
    exitCode: exit ? Number(exit[1]) : null,
    elapsedSeconds: exit ? Number(exit[2]) : null,
    tests: pick(/^\s*Tests\s+(.+)$/m),
    files: pick(/^\s*Test Files\s+(.+)$/m),
    lines: pick(/^Lines\s*:\s*(.+)$/m),
    branches: pick(/^Branches\s*:\s*(.+)$/m),
    failures: unique,
    evidence: 'suite-' + name + '.txt',
  });
  if (exit) failures.push(...unique);
}
await writeFile(dir + '/suites.json', JSON.stringify(suites, null, 2));
await writeFile(dir + '/triage-cases.json', JSON.stringify(failures, null, 2));
console.log(
  suites.map((x) => [x.package, x.result, x.tests, x.lines, x.branches].join(' | ')).join('\n'),
);
console.log('Unique triage cases', failures.length);
