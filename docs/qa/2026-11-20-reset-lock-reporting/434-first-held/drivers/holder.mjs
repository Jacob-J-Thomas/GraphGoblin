// QA helper for GraphGoblin #434 (disposable fixtures only). Holds or leaves ownership state with
// the product's own built lock code, so "held" and "stale" fixtures carry genuine owner records.
//
// Usage: node holder.mjs <mode> <checkout> <arg>
//   dir-lock <dataDir>      acquireDataDirLock(dataDir) via apps/api/dist/data-dir-lock.js
//   db-lock  <dbFile>       acquireDatabaseLock(dbFile)
//   both     <dataDir>|<dbFile>   both, data-directory lock first (as the API does)
//   guard    <guardDir>     publish a live-owner marker in a `.reclaim` guard directory, as an
//                           acquisition in progress does (record shape from data-dir-lock.ts)
//   exfile   <file>         open <file> with an exclusive Windows share mode (libuv UV_FS_O_EXLOCK)
//   exfile-wait <file>      poll until <file> exists, then hold it exclusively
// Prints one JSON line {"ready":true,...} (or {"held":true,...}) and then waits until killed.
// The driver kills this process to turn a held record into a stale one.
import { randomUUID } from 'node:crypto';
import { closeSync, constants, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const UV_FS_O_EXLOCK = 0x10000000; // libuv uv/win.h; not exported by node:fs constants
const [mode, checkout, arg] = process.argv.slice(2);
if (!mode || !checkout || !arg) {
  process.stderr.write('usage: holder.mjs <mode> <checkout> <arg>\n');
  process.exit(2);
}
const dist = (rel) => pathToFileURL(join(checkout, 'apps', 'api', 'dist', rel)).href;
const say = (obj) => process.stdout.write(JSON.stringify({ pid: process.pid, ...obj }) + '\n');
const forever = () => setInterval(() => undefined, 1 << 30);

try {
  if (mode === 'dir-lock' || mode === 'db-lock' || mode === 'both') {
    const locks = await import(dist('data-dir-lock.js'));
    const held = [];
    if (mode === 'dir-lock') held.push(await locks.acquireDataDirLock(arg));
    else if (mode === 'db-lock') held.push(await locks.acquireDatabaseLock(arg));
    else {
      const [dataDir, dbFile] = arg.split('|');
      held.push(await locks.acquireDataDirLock(dataDir));
      held.push(await locks.acquireDatabaseLock(dbFile));
    }
    say({ ready: true, mode });
    forever();
  } else if (mode === 'guard') {
    const { ownWindowsProcessIdentity } = await import(dist('windows-process-identity.js'));
    const token = randomUUID();
    const record = JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      windowsCreationTime: await ownWindowsProcessIdentity(),
      token,
    });
    mkdirSync(arg);
    writeFileSync(join(arg, `${token}.json`), record, { flag: 'wx' });
    say({ ready: true, mode, marker: `${token}.json` });
    forever();
  } else if (mode === 'exfile') {
    const fd = openSync(arg, constants.O_RDONLY | UV_FS_O_EXLOCK);
    say({ ready: true, mode });
    process.on('SIGTERM', () => {
      closeSync(fd);
      process.exit(0);
    });
    forever();
  } else if (mode === 'exfile-wait') {
    say({ ready: true, mode, waiting: true });
    const deadline = Date.now() + 120_000;
    const poll = () => {
      try {
        openSync(arg, constants.O_RDONLY | UV_FS_O_EXLOCK);
        say({ held: true, mode, at: Date.now() });
        forever();
        return;
      } catch {
        if (Date.now() > deadline) {
          say({ held: false, mode, timeout: true });
          process.exit(3);
        }
        setTimeout(poll, 1);
      }
    };
    poll();
  } else {
    process.stderr.write(`unknown mode ${mode}\n`);
    process.exit(2);
  }
} catch (error) {
  say({ ready: false, error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
