import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const reviewDir = dirname(fileURLToPath(import.meta.url));
const repo = join(reviewDir, '../../windows-reclaim');
const revision = process.argv[2];
assert.ok(['3f80820ff2982614a750cd6bd8dce488714a3752', 'da01ebc7575b9b05f87d4b89993e6c46b8de194b'].includes(revision));
const reviewedSource = pathToFileURL(join(reviewDir, revision + '.ts')).href;
const resetUrl = pathToFileURL(join(repo, 'apps/api/dist/reset/reset.js')).href;
registerHooks({
  resolve(specifier, ctx, next) {
    if (ctx.parentURL === resetUrl && specifier === '../data-dir-lock.js') return next(reviewedSource, ctx);
    if (ctx.parentURL === reviewedSource && ['./canonical-path.js', './windows-process-identity.js'].includes(specifier))
      return next(pathToFileURL(join(repo, 'apps/api/src', basename(specifier, '.js') + '.ts')).href, ctx);
    return next(specifier, ctx);
  },
});
const { resetDataDirectory } = await import(resetUrl);
const dir = await fs.mkdtemp(join(reviewDir, 'empty-store-fixture-'));
const guard = join(dir, 'graphgoblin.lock.reclaim');
const token = randomUUID();
const marker = join(guard, token + '.json');
const unrelated = join(dir, 'fixture-note');
const original = { readFile: fs.readFile, rename: fs.rename };
let scheduled = false;
const facts = [];
let output = '';
try {
  await fs.mkdir(guard);
  await fs.writeFile(marker, JSON.stringify({ pid: process.pid, token }));
  await fs.writeFile(unrelated, 'preserve these fixture bytes');
  const guardInode = (await fs.stat(guard, { bigint: true })).ino;
  fs.readFile = async (target, ...args) => {
    if (target === marker && !scheduled) {
      // A caller-owned staging directory proves that the read-only preview has already finished.
      const acquisitionStarted = (await fs.readdir(dir)).some(name => /^graphgoblin\.lock\.reclaim\..+\.tmp$/.test(name));
      facts.push({ markerRead: acquisitionStarted ? 'acquisition' : 'preview' });
      if (acquisitionStarted) {
        await fs.unlink(marker);
        scheduled = true;
      }
    }
    return original.readFile(target, ...args);
  };
  fs.rename = async (from, to) => {
    if (to === guard) {
      const earlier = await fs.stat(guard, { bigint: true }).catch(e => {
        if (e.code !== 'ENOENT') throw e;
        return null;
      });
      facts.push({ originalGuardAtRename: earlier?.ino === guardInode });
    }
    return original.rename(from, to);
  };
  syncBuiltinESMExports();
  const exit = await resetDataDirectory(
    { dataDir: dir, dbUrl: pathToFileURL(join(dir, 'graphgoblin.db')).href },
    { confirmed: true, dataDir: dir },
    { write: text => { output += text; }, readStore: () => { throw new Error('fixture has no database'); } },
  );
  assert.ok(scheduled);
  assert.equal(exit, 0);
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'preserve these fixture bytes');
  const entriesAfter = await fs.readdir(dir);
  assert.deepEqual(entriesAfter, ['fixture-note']);
  console.log(JSON.stringify({ revision, platform: process.platform, node: process.version, facts, exit,
    manifest: output.split(dir).join('<empty-private-fixture>'), entriesAfter }, null, 2));
} finally {
  Object.assign(fs, original);
  syncBuiltinESMExports();
  await fs.rm(dir, { recursive: true });
}
