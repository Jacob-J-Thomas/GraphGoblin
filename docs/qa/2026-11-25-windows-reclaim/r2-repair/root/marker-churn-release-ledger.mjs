import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const reviewDir = dirname(script);
const repo = join(reviewDir, '../../windows-reclaim');
const [revision, mode, workerDir] = process.argv.slice(2);
assert.equal(revision, 'working-tree');
const sourcePath = join(reviewDir, revision + '.ts');
const sourceURL = pathToFileURL(sourcePath).href;
const source = await fs.readFile(join(repo, 'apps/api/src/data-dir-lock.ts'));
if (mode !== 'worker') await fs.writeFile(sourcePath, source);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === sourceURL && ['./canonical-path.js', './windows-process-identity.js'].includes(specifier)) {
      return next(pathToFileURL(join(repo, 'apps/api/src', basename(specifier, '.js') + '.ts')).href, context);
    }
    return next(specifier, context);
  },
});
const { acquireDataDirLock, dataDirLockState } = await import(sourceURL);
const realRename = fs.rename;
const realRead = fs.readFile;
const timeout = setTimeout(() => {
  console.error('Private fixture timed out');
  process.exit(2);
}, 20_000);

// Only pauses public calls after a successful native publish. All ownership file operations,
// including every marker removal, come from the unmodified public entry points.
if (mode === 'worker') {
  let published = 0;
  const releases = [];
  fs.rename = async (from, to) => {
    const result = await realRename(from, to);
    if (to === join(workerDir, 'graphgoblin.lock.reclaim')) {
      const permission = once(process, 'message');
      process.send({ stage: 'published', count: ++published });
      await permission;
    }
    return result;
  };
  syncBuiltinESMExports();
  for (let i = 0; i < 8; i++) {
    const lease = await acquireDataDirLock(workerDir);
    const outcome = await lease.release();
    assert.equal(outcome, 'removed');
    releases.push({ cycle: i + 1, outcome });
  }
  assert.equal(published, 8);
  process.send({ stage: 'retired', count: 8, releases });
  process.disconnect();
  clearTimeout(timeout);
} else {
  assert.ok(mode === 'acquire' || mode === 'observe');
  const dir = await fs.mkdtemp(join(reviewDir, 'two-process-fixture-'));
  const guard = join(dir, 'graphgoblin.lock.reclaim');
  const child = fork(script, [revision, 'worker', dir], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const closed = once(child, 'exit');
  const log = [];
  let finalRemoval;
  try {
    assert.deepEqual((await once(child, 'message'))[0], { stage: 'published', count: 1 });
    let reads = 0;
    fs.readFile = async (path, ...args) => {
      if (dirname(String(path)) !== guard || reads === 8) return realRead(path, ...args);
      const response = once(child, 'message');
      child.send('resume');
      const observed = (await response)[0];
      reads++;
      assert.deepEqual({ stage: observed.stage, count: observed.count }, reads < 8 ? { stage: 'published', count: reads + 1 } : { stage: 'retired', count: 8 });
      if (reads === 8) {
        assert.deepEqual(await closed, [0, null]);
        const presence = async (path) => fs.lstat(path).then(
          () => 'present', error => { assert.equal(error.code, 'ENOENT'); return 'absent'; },
        );
        finalRemoval = {
          releases: observed.releases,
          workerExit: await closed,
          main: await presence(join(dir, 'graphgoblin.lock')),
          guard: await presence(guard),
          entriesBeforeFinalRead: (await fs.readdir(dir)).map(
            (name) => /^graphgoblin\.lock\.reclaim\.[-.0-9a-f]+\.tmp$/.test(name) ? '<own-private-staging>' : name,
          ),
        };
      }
      try {
        return await realRead(path, ...args);
      } catch (err) {
        log.push({ read: reads, worker: { stage: observed.stage, count: observed.count }, markerReadCode: err.code });
        throw err;
      }
    };
    syncBuiltinESMExports();
    let result;
    if (mode === 'observe') {
      result = await dataDirLockState(dir);
      if (result.path) result.path = result.path.replace(dir, '<fixture>');
    } else {
      try {
        const lease = await acquireDataDirLock(dir);
        result = { state: 'acquired', reclaimed: lease.reclaimed, release: await lease.release() };
      } catch (error) {
        result = { state: 'refused', name: error.name, message: error.message.replace(dir, '<fixture>') };
      }
    }
    Object.assign(fs, { readFile: realRead });
    syncBuiltinESMExports();
    const entriesAfter = await fs.readdir(dir);
    assert.equal(log.length, 8);
    assert.ok(log.every(v => v.markerReadCode === 'ENOENT'));
    assert.deepEqual(entriesAfter, []);
    console.log(JSON.stringify({
      revision, sourceSha256: createHash('sha256').update(source).digest('hex'),
      mode, node: process.version, platform: process.platform, arch: process.arch,
      workerExitBeforeFinalRead: await closed, finalRemoval, log, result, entriesAfter,
      immediatelyAfter: await dataDirLockState(dir),
    }, null, 2));
  } finally {
    Object.assign(fs, { readFile: realRead });
    syncBuiltinESMExports();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
    await fs.rm(dir, { recursive: true });
    clearTimeout(timeout);
  }
}
