function progress(value) {
  process.stdout.write(String(value) + '\n');
}
import process from 'node:process';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run after pnpm build. Every turn is injected through public ports/SDK factories.
const out = await mkdtemp(join(tmpdir(), 'gg-wp-f4-evidence-'));
const scripts = [
  'classification-storage',
  'classification-storage-followups',
  'storage-outages',
  'engine-pinned-followups',
  'sdk-pinned-followups',
  'sdk-sequences',
];
async function freePort() {
  for (let port = 5650; port <= 5659; port += 1) {
    const available = await new Promise((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No free WP-F4 test port in 5650–5659');
}
const results = [];
for (const name of scripts) {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [join('apps/api/scripts/failure-evidence', name + '.mjs')],
    {
      env: { ...process.env, GG_WPF4_EVIDENCE_DIR: out, GG_WPF4_TEST_PORT: String(port) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  child.stdout.on('data', (data) => {
    log += data.toString();
  });
  child.stderr.on('data', (data) => {
    log += data.toString();
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await writeFile(join(out, name + '.log.txt'), log);
  const report = JSON.parse(await readFile(join(out, name + '.json'), 'utf8'));
  const passed = report.checks.filter((check) => check.pass).length;
  results.push({ name, port, code, passed, total: report.checks.length });
  progress(`${name}: ${passed}/${report.checks.length}, exit ${code}`);
}
await writeFile(join(out, 'summary.json'), JSON.stringify(results, null, 2));
progress(`Evidence retained at ${out}`);
assert.ok(
  results.every((result) => result.code === 0 && result.passed === result.total),
  'Failure evidence regression matrix failed; see retained logs',
);
