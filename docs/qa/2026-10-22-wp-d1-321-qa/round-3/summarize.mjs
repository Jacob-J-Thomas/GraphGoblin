import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = new URL('.', import.meta.url);
const parse = (text) => JSON.parse(text.replace(/^\uFEFF/, ''));
const rows = (await fs.readFile(new URL('results.jsonl', out), 'utf8'))
  .replace(/^\uFEFF/, '')
  .trim()
  .split(/\r?\n/)
  .map(JSON.parse);
const results = [];
for (const row of rows) {
  const log = await fs.readFile(new URL(`${row.name}.log`, out), 'utf8');
  const tests = log.split(/\r?\n/).find((line) => /^\s*Tests\s+/.test(line));
  const count = (kind) =>
    tests ? Number(new RegExp(`(\\d+) ${kind}`).exec(tests)?.[1] ?? 0) : null;
  results.push({
    ...row,
    expected: 'Exit 0; all selected cases pass; no EADDRINUSE.',
    tests: { passed: count('passed'), failed: count('failed'), skipped: count('skipped') },
    summary: tests?.trim() ?? null,
    eaddrinuseMentions: (log.match(/EADDRINUSE/g) ?? []).length,
    failures: log
      .split(/\r?\n/)
      .filter((line) => /^\s*FAIL\s+|^Error: |^AssertionError/.test(line)),
    cleanupHookTimeout: /Hook timed out in 60000ms/.test(log),
    evidence: `${row.name}.log`,
  });
}
const coverageLog = rows.some((r) => r.name === 'coverage-two-workers')
  ? 'coverage-two-workers.log'
  : 'coverage-requested.log';
let coverage = null;
try {
  const artifact = new URL('../../../../apps/api/coverage/coverage-summary.json', import.meta.url);
  const metricStat = await fs.stat(artifact),
    logStat = await fs.stat(new URL(coverageLog, out));
  if (metricStat.mtimeMs >= logStat.birthtimeMs)
    coverage = {
      fresh: true,
      command: coverageLog,
      total: parse(await fs.readFile(artifact, 'utf8')).total,
    };
  else
    coverage = {
      fresh: false,
      note: 'Existing coverage summary predates this invocation; not used as current evidence.',
    };
} catch (error) {
  coverage = {
    fresh: false,
    note:
      error.code === 'ENOENT' ? 'No coverage summary emitted.' : 'Coverage summary unavailable.',
  };
}
await fs.writeFile(
  new URL('summary.json', out),
  JSON.stringify(
    { head: 'a44744f11d5c37000fe8354754fb3d8a82e3a4fa', commands: results, coverage },
    null,
    2,
  ) + '\n',
);
process.stdout.write(
  JSON.stringify({
    commands: results.map((r) => ({
      name: r.name,
      ...r.tests,
      exit: r.exitCode,
      eaddrinuse: r.eaddrinuseMentions,
    })),
    coverageFresh: coverage.fresh,
  }) + '\n',
);
