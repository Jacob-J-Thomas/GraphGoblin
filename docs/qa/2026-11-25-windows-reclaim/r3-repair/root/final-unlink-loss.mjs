import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const here = dirname(script);
const repo = join(here, '../../windows-reclaim');
const [revision, role = 'caller', fixture] = process.argv.slice(2);
assert.equal(revision, 'working-tree');
assert.equal(process.platform, 'darwin');
const sourceFile = join(here, revision + '.ts');
const sourceURL = pathToFileURL(sourceFile).href;
const serveURL = pathToFileURL(join(repo, 'apps/api/dist/serve.js')).href;
const source = await fs.readFile(sourceFile);
assert.deepEqual(source, await fs.readFile(join(repo, 'apps/api/src/data-dir-lock.ts')));
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === serveURL && specifier === './data-dir-lock.js') return next(sourceURL, context);
    if (context.parentURL === sourceURL && ['./canonical-path.js', './windows-process-identity.js'].includes(specifier))
      return next(pathToFileURL(join(repo, 'apps/api/src', basename(specifier, '.js') + '.ts')).href, context);
    return next(specifier, context);
  },
});
const { acquireDataDirLock, dataDirLockState } = await import(sourceURL);
const guardFor = dir => join(dir, 'graphgoblin.lock.reclaim');
const bounded = setTimeout(() => { console.error('fixture deadline'); process.exit(3); }, 25_000);
if (role === 'cycling-owner') {
  const ledger = [];
  const rename = fs.rename;
  let published = 0;
  fs.rename = async (from, to) => {
    const result = await rename(from, to);
    if (to !== guardFor(fixture)) return result;
    published++;
    if (published === 8) {
      // Ordinary interrupted startup: the child exits immediately after its own successful
      // publication, before it can create a main lock. The stale marker is production generated.
      await new Promise((done, reject) => process.send({ published, ledger }, error => error ? reject(error) : done()));
      process.exit(23);
    }
    const resume = once(process, 'message');
    process.send({ published });
    await resume;
    return result;
  };
  syncBuiltinESMExports();
  for (let i = 1; i <= 8; i++) {
    const lease = await acquireDataDirLock(fixture);
    const release = await lease.release();
    assert.equal(release, 'removed');
    ledger.push({ cycle: i, release });
  }
  assert.fail('eighth startup must exit after successful guard publication');
} else if (role === 'reclaimer') {
  const lease = await acquireDataDirLock(fixture);
  assert.deepEqual(lease.reclaimed, { file: false, guard: true });
  const release = await lease.release();
  assert.equal(release, 'removed');
  process.send({ reclaimed: lease.reclaimed, release, entries: await fs.readdir(fixture) });
  process.disconnect();
  clearTimeout(bounded);
} else {
  assert.equal(role, 'caller');
  const dir = await fs.mkdtemp(join(here, 'private-mixed-'));
  const guard = guardFor(dir);
  const children = [];
  const spawn = (role) => {
    const child = fork(script, [revision, role, dir], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const closed = once(child, 'exit');
    children.push({ child, closed });
    return { child, closed };
  };
  const original = { readFile: fs.readFile, unlink: fs.unlink, rename: fs.rename };
  const { startupFailureCause, shellFailureOutput } = await import(serveURL);
  try {
    const cycling = spawn('cycling-owner');
    assert.deepEqual((await once(cycling.child, 'message'))[0], { published: 1 });
    const reads = [];
    const renames = [];
    const unlinks = [];
    let staleName, retired, reclaimer;
    fs.readFile = async (path, ...args) => {
      if (dirname(String(path)) !== guard || reads.length >= 8) return original.readFile(path, ...args);
      if (reads.length < 7) {
        const response = once(cycling.child, 'message');
        cycling.child.send('resume');
        const reached = (await response)[0];
        assert.equal(reached.published, reads.length + 2);
        if (reached.published === 8) {
          const exit = await cycling.closed;
          assert.deepEqual(exit, [23, null]);
          assert.equal(reached.ledger.length, 7);
          retired = { exit, completedReleases: reached.ledger };
        }
        try {
          return await original.readFile(path, ...args);
        } catch (error) {
          assert.equal(error.code, 'ENOENT');
          reads.push({ read: reads.length + 1, result: 'ENOENT' });
          throw error;
        }
      }
      const record = await original.readFile(path, ...args);
      const parsed = JSON.parse(record);
      assert.equal(parsed.pid, cycling.child.pid);
      assert.equal(basename(path), parsed.token + '.json');
      if (reads.length === 7) {
        staleName = String(path);
        reads.push({ read: 8, result: 'read genuine abandoned record', ownerExitedBeforeRead: true });
      }
      return record;
    };
    fs.unlink = async (path, ...args) => {
      if (path !== staleName) return original.unlink(path, ...args);
      const other = spawn('reclaimer');
      const outcome = (await once(other.child, 'message'))[0];
      const exit = await other.closed;
      assert.deepEqual(exit, [0, null]);
      assert.equal(outcome.entries.length, 1);
      assert.match(outcome.entries[0], /^graphgoblin\.lock\.reclaim\.[-.0-9a-f]+\.tmp$/);
      reclaimer = { reclaimed: outcome.reclaimed, release: outcome.release, exit, beforeCallersUnlink: ['<caller-private-stage>'] };
      try {
        return await original.unlink(path, ...args);
      } catch (error) {
        assert.equal(error.code, 'ENOENT');
        unlinks.push({ attempt: 8, operation: 'stale-marker-unlink', result: error.code });
        throw error;
      }
    };
    fs.rename = async (from, to, ...args) => {
      if (to !== guard) return original.rename(from, to, ...args);
      try {
        const result = await original.rename(from, to, ...args);
        renames.push('published');
        return result;
      } catch (error) {
        renames.push(error.code);
        throw error;
      }
    };
    syncBuiltinESMExports();
    let result;
    try {
      const lease = await acquireDataDirLock(dir);
      result = { state: 'acquired', reclaimed: lease.reclaimed, release: await lease.release() };
    } catch (error) {
      const operator = shellFailureOutput(error);
      assert.equal(typeof operator, 'string');
      result = { state: 'refused', type: error.name, message: operator.replace(dir, '<fixture>'), startupCause: startupFailureCause('store', error) };
    }
    assert.equal(reads.length, 8);
    assert.equal(unlinks.length, 1);
    const after = await fs.readdir(dir);
    assert.deepEqual(after, []);
    const state = await dataDirLockState(dir);
    assert.equal(state.state, 'free');
    console.log(JSON.stringify({ revision, sourceSha256: createHash('sha256').update(source).digest('hex'), node: process.version,
      platform: process.platform, arch: process.arch, reads, retired, reclaimer, unlinks, callerRenames: renames, result, after, immediateState: state }, null, 2));
  } finally {
    Object.assign(fs, original);
    syncBuiltinESMExports();
    for (const { child, closed } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await closed;
    }
    await fs.rm(dir, { recursive: true });
    clearTimeout(bounded);
  }
}
