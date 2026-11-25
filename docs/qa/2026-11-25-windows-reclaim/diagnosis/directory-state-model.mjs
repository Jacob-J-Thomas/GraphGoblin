import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the repository's source with a synthetic filesystem operation boundary.
// Each fixture and its one live helper belong exclusively to this diagnostic.
const identity = '134388256826197770';
const source = new URL('../../inspector-repair/apps/api/src/data-dir-lock.ts', import.meta.url).href;
const nativePlatform = process.platform;
assert.equal(nativePlatform, 'darwin');
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === source && specifier === './windows-process-identity.js') {
      const stub = `export const ownWindowsProcessIdentity=async()=>'${identity}';
        export const windowsProcessIdentity=async()=>({identity:'${identity}'});`;
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stub) };
    }
    if (context.parentURL === source && specifier === './canonical-path.js')
      return next('./canonical-path.ts', context);
    return next(specifier, context);
  },
});
const { acquireDataDirLock, dataDirLockState } = await import(source);
const helper = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'ignore', 'ignore'] });
const exited = once(helper, 'exit');
const originalRmdir = fs.rmdir;
const outcomes = [];
const base = await fs.mkdtemp(fileURLToPath(new URL('fixture-', import.meta.url)));
try {
  for (const scenario of ['directory-gone', 'successor-published', 'same-empty-directory']) {
    const directory = join(base, scenario);
    const guard = join(directory, 'graphgoblin.lock.reclaim');
    const oldToken = randomUUID();
    const newToken = randomUUID();
    const successorBytes = JSON.stringify({ pid: helper.pid, token: newToken, windowsCreationTime: identity });
    const successorMarker = join(guard, newToken + '.json');
    await fs.mkdir(guard, { recursive: true });
    await fs.writeFile(join(guard, oldToken + '.json'), JSON.stringify({ pid: process.pid, token: oldToken }));
    let injected = false;
    fs.rmdir = async (target, ...args) => {
      if (target !== guard || injected) return originalRmdir(target, ...args);
      assert.deepEqual(await fs.readdir(guard), []);
      injected = true;
      if (scenario !== 'same-empty-directory') await originalRmdir(guard);
      if (scenario === 'successor-published') {
        const staged = join(directory, 'publish');
        await fs.mkdir(staged);
        await fs.writeFile(join(staged, newToken + '.json'), successorBytes);
        await fs.rename(staged, guard);
      }
      throw Object.assign(new Error('injected Windows directory-removal EPERM'), { code: 'EPERM' });
    };
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    let outcome;
    try {
      const lock = await acquireDataDirLock(directory);
      outcome = { status: 'acquired', release: await lock.release() };
    } catch (error) {
      outcome = { status: 'refused', operation: error.operation, code: error.code };
    }
    assert.equal(injected, true);
    const after = await dataDirLockState(directory);
    const successorIntact = scenario === 'successor-published' ? await fs.readFile(successorMarker, 'utf8') === successorBytes : null;
    const entries = await fs.readdir(directory);
    outcomes.push({ scenario, ...outcome, independentlyObserved: after.state, successorIntact, entries });
    if (scenario === 'directory-gone') {
      assert.deepEqual(outcome, { status: 'acquired', release: 'removed' });
      assert.deepEqual(entries, []);
    } else {
      assert.deepEqual(outcome, { status: 'refused', operation: 'recovery-directory-remove', code: 'EPERM' });
      assert.deepEqual(entries, ['graphgoblin.lock.reclaim']);
    }
    if (scenario === 'successor-published') {
      assert.equal(successorIntact, true);
      assert.equal(after.state, 'held');
      assert.match(after.detail, /another GraphGoblin process/);
    }
    Object.defineProperty(process, 'platform', { value: nativePlatform });
  }
  console.log(JSON.stringify({ nativePlatform, node: process.version, mode: 'injected-error-and-WMI-model', outcomes }, null, 2));
} finally {
  Object.defineProperty(process, 'platform', { value: nativePlatform });
  fs.rmdir = originalRmdir;
  syncBuiltinESMExports();
  helper.stdin.end();
  await exited;
  await fs.rm(base, { recursive: true });
}
