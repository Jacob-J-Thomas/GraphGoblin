// Bounds ownership of every suite temporary file. Normal harness cleanup only; no global cleanup.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = new URL('.', import.meta.url);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const base = tmpdir();
const name = process.argv[2];
assert.match(name, /^[a-z0-9-]+$/);
const pnpmArguments = JSON.parse(process.argv[3] ?? process.env.QA_STAGE_ARGS);
assert.ok(Array.isArray(pnpmArguments) && pnpmArguments.every((a) => typeof a === 'string'));
const stage = await mkdtemp(join(base, 'gg-qa-320-r2-' + name + '-'));
const startedAt = new Date().toISOString();
const child = spawn(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    fileURLToPath(new URL('run-command.ps1', here)),
    '-Name',
    name,
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      TEMP: stage,
      TMP: stage,
      QA_PNPM_ARGUMENTS: JSON.stringify(pnpmArguments),
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});
const result = await new Promise((resolveChild, reject) => {
  child.on('error', reject);
  child.on('close', (code, signal) => resolveChild({ code, signal }));
});
assert.ok(resolve(stage).startsWith(resolve(base) + sep));
assert.ok(
  stage
    .split(sep)
    .at(-1)
    .startsWith('gg-qa-320-r2-' + name + '-'),
);
let cleanup;
try {
  await rm(stage, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  cleanup = { removed: true };
} catch (error) {
  // Retain a bounded manifest rather than touching another process or directory.
  const entries = [];
  async function inventory(path, relative = '') {
    for (const e of await readdir(path, { withFileTypes: true })) {
      const rel = relative ? relative + '/' + e.name : e.name;
      entries.push({ name: rel, directory: e.isDirectory() });
      if (e.isDirectory() && !e.isSymbolicLink()) await inventory(join(path, e.name), rel);
    }
  }
  await inventory(stage);
  cleanup = { removed: false, code: error.code, entries };
}
const record = {
  name,
  startedAt,
  finishedAt: new Date().toISOString(),
  command: ['pnpm.cmd', ...pnpmArguments],
  process: result,
  stage: stage.split(sep).at(-1),
  cleanup,
};
await writeFile(new URL(name + '-stage.json', here), JSON.stringify(record, null, 2) + '\n');
console.log(
  JSON.stringify({
    name,
    ...result,
    cleanupRemoved: cleanup.removed,
    residualEntries: cleanup.entries?.length ?? 0,
  }),
);
process.exitCode = result.code ?? 1;
