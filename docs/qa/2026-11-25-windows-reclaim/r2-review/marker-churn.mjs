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
assert.ok([
  '0af9b8a41367f4e90152333e02c687f4b7ba1185',
  '3f80820ff2982614a750cd6bd8dce488714a3752',
  'da01ebc7575b9b05f87d4b89993e6c46b8de194b',
].includes(revision));
const sourcePath = join(reviewDir, revision + '.ts');
const sourceURL = pathToFileURL(sourcePath).href;
const source = execFileSync('git', ['show', revision + ':apps/api/src/data-dir-lock.ts'], { cwd: repo });
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
    assert.equal(await lease.release(), 'removed');
  }
  assert.equal(published, 8);
  process.send({ stage: 'retired', count: 8 });
  process.disconnect();
  clearTimeout(timeout);
} else {
  assert.ok(mode === 'acquire' || mode === 'observe');
  const dir = await fs.mkdtemp(join(reviewDir, 'two-process-fixture-'));
  const guard = join(dir, 'graphgoblin.lock.reclaim');
  const child = fork(script, [revision, 'worker', dir], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const closed = once(child, 'exit');
  const log = [];
  try {
    assert.deepEqual((await once(child, 'message'))[0], { stage: 'published', count: 1 });
    let reads = 0;
    fs.readFile = async (path, ...args) => {
      if (dirname(String(path)) !== guard || reads === 8) return realRead(path, ...args);
      const response = once(child, 'message');
      child.send('resume');
      const observed = (await response)[0];
      reads++;
      assert.deepEqual(observed, reads < 8 ? { stage: 'published', count: reads + 1 } : { stage: 'retired', count: 8 });
      if (reads === 8) {
        assert.deepEqual(await closed, [0, null]);
      }
      try {
        return await realRead(path, ...args);
      } catch (err) {
        log.push({ read: reads, worker: observed, markerReadCode: err.code });
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
      workerExitBeforeFinalRead: await closed, log, result, entriesAfter,
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
