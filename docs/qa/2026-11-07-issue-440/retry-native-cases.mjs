// One V8-instrumented diagnostic of unchanged restart tests; never retries or cleans fixtures.
// Read only lock metadata in newly created diagnostic fixtures. No credential, key or DB reads.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const root = resolve(output, '../../..');
const prefixes = ['gg-wp-d1-int-script-', 'gg-440-native-retry-'];
async function directories() {
  return (await readdir(tmpdir(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && prefixes.some((prefix) => entry.name.startsWith(prefix)))
    .map((entry) => entry.name);
}
const before = new Set(await directories());
const observations = new Map();
let finished = false;
async function scan() {
  for (const name of await directories()) {
    if (before.has(name)) continue;
    const directory = join(tmpdir(), name);
    if ((await lstat(directory).catch(() => undefined))?.isSymbolicLink()) continue;
    for (const filename of ['graphgoblin.lock', 'graphgoblin.lock.reclaim', 'graphgoblin.db.graphgoblin.lock']) {
      const path = join(directory, filename);
      if (!(await lstat(path).catch(() => undefined))?.isFile()) continue;
      try {
        const bytes = await readFile(path);
        const owner = JSON.parse(bytes.toString('utf8'));
        const recordSha256 = createHash('sha256').update(bytes).digest('hex');
        const key = `${path}\0${recordSha256}`;
        const now = new Date().toISOString();
        const previous = observations.get(key);
        let ownerAlive;
        try {
          process.kill(owner.pid, 0);
          ownerAlive = true;
        } catch (error) {
          ownerAlive = error.code === 'ESRCH' ? false : 'unproven';
        }
        observations.set(key, {
          path,
          pid: owner.pid,
          startedAt: owner.startedAt,
          recordSha256,
          firstObservedAt: previous?.firstObservedAt ?? now,
          lastObservedAt: now,
          ownerAliveAtLastObservation: ownerAlive,
        });
      } catch {
        // A lock may be between exclusive creation and its single write, or gone after lstat.
      }
    }
  }
}
const monitor = (async () => {
  while (!finished) {
    await scan();
    await new Promise((done) => setTimeout(done, 300));
  }
})();
const argv = [
  join(root, 'apps/api/node_modules/vitest/vitest.mjs'),
  'run',
  'src/script-restart.test.ts',
  'src/subloop-restart.test.ts',
  '--coverage',
  '--maxWorkers=1',
];
const log = createWriteStream(join(output, 'native-cases-retry.log.txt'));
const child = spawn(process.execPath, argv, {
  cwd: join(root, 'apps/api'),
  env: process.env,
  windowsHide: true,
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (bytes) => log.write(bytes));
child.stderr.on('data', (bytes) => log.write(bytes));
const result = await new Promise((done) => {
  child.once('close', (code, signal) => done({ code, signal }));
  child.once('error', (error) => done({ code: null, error: error.message }));
});
finished = true;
await monitor;
await new Promise((done) => log.end(done));
await writeFile(join(output, 'native-cases-retry-locks.json'), JSON.stringify({
  checkedAt: new Date().toISOString(),
  method: 'Read-only 300ms observations of exact lock files in newly created retry fixture directories; token bytes omitted and represented only by the whole-record SHA-256. No cleanup or process termination.',
  nodeVersion: process.version,
  workingDirectory: join(root, 'apps/api'),
  argv,
  fixturePrefixes: prefixes,
  result,
  observations: [...observations.values()],
}, null, 2) + '\n');
console.log(JSON.stringify({ result, observedLockRecords: observations.size }));
process.exitCode = result.code ?? 1;
