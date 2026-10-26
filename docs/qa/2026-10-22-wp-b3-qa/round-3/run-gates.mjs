import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
const repo = process.cwd();
const evidence = resolve('docs/qa/2026-10-22-wp-b3-qa/round-3');
const parent = tmpdir();
const base = await mkdtemp(join(parent, 'gg-qa-266-r3-gates-'));
const clean = (s) =>
  s
    .split(repo)
    .join('<worktree>')
    .split(parent)
    .join('%TEMP%')
    .split(process.env.USERPROFILE)
    .join('%USERPROFILE%');
const results = [];
try {
  for (const [name, args] of [
    [
      'focused-tests',
      [
        '--filter',
        '@graphgoblin/api',
        'exec',
        'vitest',
        'run',
        'src/preflight.test.ts',
        'src/reset',
      ],
    ],
    ['native-reset', ['test:reset']],
  ]) {
    const command = `& ([scriptblock]::Create((Get-Content -Raw 'docs/qa/2026-10-22-wp-b3-qa/round-3/run-gate.ps1'))) -Name '${name}' -TaskArguments @(${args.map((a) => `'${a}'`).join(',')})`;
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      cwd: repo,
      env: { ...process.env, TEMP: base, TMP: base, QA_ORIGINAL_TEMP: parent },
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (b) => (output += b));
    child.stderr.on('data', (b) => (output += b));
    const code = await new Promise((res, rej) => {
      child.once('error', rej);
      child.once('close', res);
    });
    results.push({ name, code, processExited: true });
    console.log(clean(output));
  }
} finally {
  if (dirname(base) !== parent || !basename(base).startsWith('gg-qa-266-'))
    throw new Error('cleanup scope refused');
  const entriesBeforeCleanup = await readdir(base);
  await rm(base, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  await writeFile(
    join(evidence, 'gate-cleanup.json'),
    JSON.stringify(
      { directory: clean(base), results, entriesBeforeCleanup, removed: true },
      null,
      2,
    ),
  );
}
