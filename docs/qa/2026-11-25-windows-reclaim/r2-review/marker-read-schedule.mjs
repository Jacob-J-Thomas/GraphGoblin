import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const reviewDir = dirname(fileURLToPath(import.meta.url));
const repo = join(reviewDir, '../../windows-reclaim');
const rev = process.argv[2];
assert.ok(['0af9b8a41367f4e90152333e02c687f4b7ba1185'].includes(rev));
const source = execFileSync('git', ['show', rev + ':apps/api/src/data-dir-lock.ts'], { cwd: repo });
const savedSource = join(reviewDir, rev + '.ts');
await fs.writeFile(savedSource, source);
const sourceUrl = pathToFileURL(savedSource).href;
registerHooks({
  resolve(specifier, ctx, next) {
    if (ctx.parentURL === sourceUrl && ['./canonical-path.js', './windows-process-identity.js'].includes(specifier)) {
      return next(pathToFileURL(join(repo, 'apps/api/src', basename(specifier, '.js') + '.ts')).href, ctx);
    }
    return next(specifier, ctx);
  },
});
const { acquireDataDirLock } = await import(sourceUrl);
assert.equal(process.platform, 'darwin');
const original = { readFile: fs.readFile, rename: fs.rename, rmdir: fs.rmdir };
const fixture = await fs.mkdtemp(join(reviewDir, 'private-trials-'));
const cases = [];
try {
  for (const schedule of ['remove-only-marker', 'remove-marker-and-directory', 'preserve-marker']) {
    const dir = join(fixture, schedule);
    const guard = join(dir, 'graphgoblin.lock.reclaim');
    await fs.mkdir(guard, { recursive: true });
    const oldIno = (await fs.stat(guard, { bigint: true })).ino.toString();
    const token = randomUUID();
    const marker = join(guard, token + '.json');
    await fs.writeFile(marker, JSON.stringify({ pid: process.pid, token }));
    const events = [];
    let didSchedule = false;
    fs.readFile = async (target, ...args) => {
      if (target === marker && !didSchedule) {
        didSchedule = true;
        if (schedule !== 'preserve-marker') {
          await fs.unlink(marker);
          events.push('other contender removed only enumerated marker');
        }
        if (schedule === 'remove-marker-and-directory') {
          await original.rmdir(guard);
          events.push('other contender removed guard directory');
        }
      }
      return original.readFile(target, ...args);
    };
    fs.rmdir = async (target, ...args) => {
      const result = await original.rmdir(target, ...args);
      if (target === guard) events.push('caller rmdir succeeded');
      return result;
    };
    fs.rename = async (from, to) => {
      const prior = await fs.stat(to, { bigint: true }).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const entriesBefore = prior ? await fs.readdir(to) : [];
      const result = await original.rename(from, to);
      if (to === guard) events.push({
        action: 'caller published by real rename', replacedOriginal: prior?.ino.toString() === oldIno,
        priorEntries: entriesBefore, differentInode: (await fs.stat(to, { bigint: true })).ino.toString() !== oldIno,
      });
      return result;
    };
    syncBuiltinESMExports();
    const lock = await acquireDataDirLock(dir);
    const released = await lock.release();
    const entriesAfterRelease = await fs.readdir(dir);
    assert.equal(released, 'removed');
    assert.deepEqual(entriesAfterRelease, []);
    assert.ok(didSchedule);
    cases.push({ schedule, events, reclaimed: lock.reclaimed, released, entriesAfterRelease });
    Object.assign(fs, original);
    syncBuiltinESMExports();
  }
  console.log(JSON.stringify({ revision: rev, sourceSha256: createHash('sha256').update(source).digest('hex'),
    node: process.version, platform: process.platform, arch: process.arch, cases }, null, 2));
} finally {
  Object.assign(fs, original);
  syncBuiltinESMExports();
  await fs.rm(fixture, { recursive: true });
}
