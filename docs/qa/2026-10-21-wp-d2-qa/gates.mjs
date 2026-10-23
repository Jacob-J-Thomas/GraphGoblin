import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
const root = process.cwd();
const evidence = join(root, 'docs/qa/2026-10-21-wp-d2-qa');
function clean(s) {
  return s
    .replaceAll(root, '%WORKTREE%')
    .replaceAll(root.replaceAll('\\', '/'), '%WORKTREE%')
    .replaceAll(process.env.TEMP, '%TEMP%')
    .replaceAll(process.env.TEMP.replaceAll('\\', '/'), '%TEMP%')
    .replaceAll(process.env.USERPROFILE, '%USERPROFILE%')
    .replaceAll(process.env.USERPROFILE.replaceAll('\\', '/'), '%USERPROFILE%')
    .replace(/\u001b\[[0-9;]*m/g, '');
}
const groups = {
  suites: [
    [
      'engine',
      'pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=2 --coverage.reportOnFailure=true',
    ],
    [
      'infrastructure',
      'pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure=true',
    ],
    [
      'api',
      'pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure=true',
    ],
    ['webhook-retry', 'pnpm.cmd test:webhook-retry'],
    ['recovery-process', 'pnpm.cmd test:recovery-process'],
    ['wait-restart', 'pnpm.cmd test:wait-restart'],
    [
      'edge',
      "Set-Location apps/web; $env:GG_E2E_BROWSER_CHANNEL='msedge'; pnpm.cmd exec playwright test e2e/webhook-delivery.spec.ts e2e/webhook-receiver.spec.ts --retries=0",
    ],
  ],
  checks: [
    ['migrations', 'pnpm.cmd check:migrations'],
    ['typecheck', 'pnpm.cmd typecheck'],
    ['lint', 'pnpm.cmd lint'],
    ['format', 'pnpm.cmd format:check'],
    ['layers', 'pnpm.cmd check:layers'],
    ['deps', 'pnpm.cmd check:deps'],
    ['docs', 'pnpm.cmd check:docs'],
  ],
};
const group = process.argv[2] ?? 'suites';
const results = [];
for (const [name, command] of groups[group]) {
  const start = Date.now();
  console.log(new Date().toISOString(), 'START', name);
  let log = '';
  const p = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: root,
    windowsHide: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (b) => (log += b));
  p.stderr.on('data', (b) => (log += b));
  const code = await new Promise((ok, no) => {
    p.on('error', no);
    p.on('exit', ok);
  });
  await writeFile(join(evidence, name + '.log'), clean(log));
  results.push({ name, command, code, elapsedMs: Date.now() - start });
  await writeFile(join(evidence, group + '.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(new Date().toISOString(), 'END', name, code, Date.now() - start);
}
try {
  await writeFile(
    join(evidence, 'build.log'),
    clean(await readFile(join(evidence, 'build.raw.log'), 'utf8')),
  );
} catch {}
