import { writeFile, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.argv[2];
const base = process.argv[3] ?? 'http://127.0.0.1:5630';
const cases = [
  {
    name: 'explicit auth status with incidental network advice',
    stdout: '',
    stderr: 'API Error: 401 Authentication failed; check network settings.',
    exit: 1,
    expected: 'auth',
  },
  {
    name: 'explicit quota status with incidental network text',
    stdout: '',
    stderr: 'HTTP 429 Too Many Requests; network request failed.',
    exit: 1,
    expected: 'quota',
  },
  {
    name: 'quota on stdout with unrelated stderr warning',
    stdout: 'API Error: 429 Too Many Requests',
    stderr: 'Warning: setting is deprecated',
    exit: 1,
    expected: 'quota',
  },
  { name: 'empty successful login status', stdout: '', stderr: '', exit: 0, expected: 'unknown' },
  {
    name: 'unrecognized successful login status',
    stdout: '{}',
    stderr: '',
    exit: 0,
    expected: 'unknown',
  },
];
const evidence = [];
try {
  for (const test of cases) {
    for (const h of ['claude', 'codex'])
      await writeFile(
        join(root, h, 'auth.txt'),
        [
          test.exit,
          0,
          Buffer.from(test.stdout).toString('base64'),
          Buffer.from(test.stderr).toString('base64'),
          0,
        ].join('\n'),
      );
    const r = await fetch(base + '/harness/preflight');
    const result = await r.json();
    evidence.push({
      ...test,
      http: r.status,
      actual: result.items.map((x) => ({
        harness: x.harness,
        state: x.state,
        authenticated: x.authenticated,
        problems: x.problems,
      })),
    });
  }
} finally {
  for (const h of ['claude', 'codex']) await unlink(join(root, h, 'auth.txt')).catch(() => {});
}
await writeFile(join(root, 'classification-repro.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
