// Check 4: a removal that fails part of the way (a file held open by another Windows process that
// denies deletion; a planned directory that gains an entry after planning) reports removed, partly
// removed and not removed targets, exits 1, releases the lock; a rerun after clearing the cause
// finishes, and the next start creates a fresh current store.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Log,
  call,
  cli,
  cliWithHook,
  fileHash,
  inspectStore,
  listDir,
  logCli,
  makeBase,
  seedDataDir,
  snapshot,
  startApi,
  stopApi,
} from './lib.mjs';

const log = new Log('c04-partial-failure');
const base = await makeBase('c04');
const data = join(base, 'data');
log.line(`base: ${base}`);

/** Hold `path` open in a separate PowerShell process with the given FileShare; returns release(). */
async function hold(path, share) {
  const script = `$f = [System.IO.File]::Open('${path.replaceAll("'", "''")}', 'Open', 'Read', '${share}'); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $f.Close(); [Console]::Out.WriteLine('RELEASED')`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  while (!out.includes('HELD')) {
    if (child.exitCode !== null) throw new Error(`hold failed: ${out}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    pid: child.pid,
    async release() {
      child.stdin.write('\n');
      await once(child, 'exit');
      return out;
    },
  };
}

const confirm = ['--reset', '--yes', '--data-dir', data];

async function freshStart(label) {
  const api = await startApi(data, 6342);
  log.check(!api.failed, `${label}: the next start succeeds`, api.stderr);
  if (api.failed) return;
  const loops = await call(api, 'GET', '/loops');
  log.check(loops.status === 200 && loops.body.items.length === 0, `${label}: fresh store has no loops`);
  log.check((await stopApi(api)) === 0, `${label}: API drains and exits 0`);
  const store = await inspectStore(join(data, 'graphgoblin.db'));
  log.line(`${label}: marker ${JSON.stringify(store.marker)}`);
  log.check(store.marker?.[0]?.format_version === 4 && store.marker?.[0]?.status === 'complete', `${label}: fresh store is complete format 4`);
}

try {
  log.section('4a: an artifact file held open with FileShare.None');
  const run = await seedDataDir(data);
  const held = await hold(join(data, 'artifacts', 'text', 'a2'), 'None');
  log.line(`holder pid ${held.pid} holds artifacts/text/a2 with FileShare.None`);
  const failed = await cli(confirm, data);
  logCli(log, 'confirmed reset with a held artifact', confirm, failed);
  log.check(failed.code === 1, 'exit 1', failed.code);
  log.check(failed.stderr.includes('Reset stopped: could not remove artifacts/text/a2'), 'names the entry that could not be removed');
  log.check(failed.stderr.includes(`  Removed:        workspaces/${run}`), 'lists the removed run workspace');
  log.check(failed.stderr.includes('  Partly removed: artifacts (1 of 4 entries)'), 'lists artifacts as partly removed with counts');
  log.check(/  Not removed:    graphgoblin\.db, graphgoblin\.db-wal, graphgoblin\.db-shm/.test(failed.stderr), 'lists the database and sidecars as not removed');
  log.check(failed.stderr.includes('Released graphgoblin.lock.') && failed.stderr.includes('Do not start GraphGoblin on this data directory until the reset finishes'), 'says the lock was released and to rerun before starting');
  log.check(!existsSync(join(data, 'graphgoblin.lock')), 'the lock file is gone');
  log.line(`after the failure: ${JSON.stringify(listDir(data))}; artifacts/text: ${JSON.stringify(listDir(join(data, 'artifacts', 'text')))}`);
  const early = await cli([], data, { GG_PORT: '6342' }, { timeoutMs: 60_000 });
  logCli(log, 'start before the rerun', [], early);
  log.check(early.code === 1 && early.stderr.includes('GraphGoblin did not start'), 'a start before the rerun is refused by the store guard (the database is still there)', early.code);
  log.line(`holder: ${(await held.release()).trim()}`);
  const rerun = await cli(confirm, data);
  logCli(log, 'rerun after release', confirm, rerun);
  log.check(rerun.code === 0 && rerun.stdout.includes('Reset complete.'), 'rerun completes', rerun.code);
  log.check(/\n  artifacts\s+artifacts\s+1 file, 2 directories/.test(rerun.stdout), 'rerun lists only what is left of artifacts');
  log.check(!rerun.stdout.includes(`workspaces/${run}`), 'rerun does not list the removed workspace');
  await freshStart('4a');

  log.section('4b: the database held open with FileShare.Read (readable, not deletable)');
  rmSync(data, { recursive: true, force: true });
  const run2 = await seedDataDir(data);
  const heldDb = await hold(join(data, 'graphgoblin.db'), 'Read');
  const dbFailed = await cli(confirm, data);
  logCli(log, 'confirmed reset with a held database', confirm, dbFailed);
  log.check(dbFailed.code === 1, 'exit 1', dbFailed.code);
  log.check(dbFailed.stderr.includes(`  Removed:        workspaces/${run2}, artifacts`), 'workspace and artifacts removed first');
  log.check(dbFailed.stderr.includes('  Partly removed: graphgoblin.db (0 of 1 entries)'), 'database partly removed (0 of 1)');
  log.check(/  Not removed:    graphgoblin\.db-wal, graphgoblin\.db-shm/.test(dbFailed.stderr), 'sidecars not removed');
  log.line(`holder: ${(await heldDb.release()).trim()}`);
  const dbRerun = await cli(confirm, data);
  logCli(log, 'rerun after release', confirm, dbRerun);
  log.check(dbRerun.code === 0 && dbRerun.stdout.includes('Reset complete.'), 'rerun completes', dbRerun.code);
  await freshStart('4b');

  log.section('4c: the database held with FileShare.None (cannot even be copied for reading)');
  rmSync(data, { recursive: true, force: true });
  const run3 = await seedDataDir(data);
  const heldNone = await hold(join(data, 'graphgoblin.db'), 'None');
  const dry = await cli(['--reset'], data);
  logCli(log, 'dry run with an unreadable database', ['--reset'], dry);
  log.check(dry.code === 0 && dry.stdout.includes('unreadable:'), 'the dry run reports the store as unreadable', dry.code);
  log.check(dry.stdout.includes(`workspaces/${run3}`) && /workspaces\/[0-9A-Z]{26}\s+the store could not be read to match run IDs/.test(dry.stdout), 'run workspaces are kept when run IDs cannot be read');
  const noneFailed = await cli(confirm, data);
  logCli(log, 'confirmed reset with an unreadable database', confirm, noneFailed);
  log.check(noneFailed.code === 1 && noneFailed.stderr.includes('  Partly removed: graphgoblin.db (0 of 1 entries)'), 'stops at the database', noneFailed.code);
  log.line(`holder: ${(await heldNone.release()).trim()}`);
  const noneRerun = await cli(confirm, data);
  logCli(log, 'rerun after release', confirm, noneRerun);
  log.check(noneRerun.code === 0, 'rerun completes', noneRerun.code);
  log.check(noneRerun.stdout.includes(`workspaces/${run3}`) && !listDir(join(data, 'workspaces')).includes(run3), `the rerun reads the still-present database and removes the run workspace it kept the first time: ${JSON.stringify(listDir(join(data, 'workspaces')))}`);

  log.section('4d: read-only files and a read-only directory inside a run workspace');
  rmSync(data, { recursive: true, force: true });
  const run4 = await seedDataDir(data);
  const roFile = join(data, 'workspaces', run4, 'f00000.txt');
  const roDir = join(data, 'workspaces', run4, 'ro-dir');
  writeFileSync(join(data, 'workspaces', run4, 'placeholder'), '');
  spawnSync('cmd.exe', ['/d', '/c', 'mkdir', roDir], { windowsHide: true });
  writeFileSync(join(roDir, 'inner.txt'), 'inner');
  spawnSync('attrib', ['+R', roFile], { windowsHide: true });
  spawnSync('attrib', ['+R', join(roDir, 'inner.txt')], { windowsHide: true });
  spawnSync('attrib', ['+R', roDir], { windowsHide: true });
  log.line(`attrib: ${spawnSync('attrib', [roFile], { encoding: 'utf8' }).stdout.trim()} | ${spawnSync('attrib', [roDir], { encoding: 'utf8' }).stdout.trim()}`);
  const ro = await cli(confirm, data);
  logCli(log, 'confirmed reset with read-only entries', confirm, ro);
  log.line(`observed: exit ${ro.code}; run workspace present afterwards: ${listDir(join(data, 'workspaces')).includes(run4)}`);
  log.check(ro.code === 0 || (ro.code === 1 && ro.stderr.includes('Partly removed')), 'either removed (Windows unlink clears the read-only attribute) or reported as a partial failure');
  if (ro.code === 1) {
    spawnSync('attrib', ['-R', '/S', '/D', join(data, 'workspaces', run4, '*')], { windowsHide: true });
    const roRerun = await cli(confirm, data);
    logCli(log, 'rerun after clearing read-only', confirm, roRerun);
    log.check(roRerun.code === 0, 'rerun completes', roRerun.code);
  }

  log.section('4e: a planned directory gains an entry after planning (rmdir fails: not empty)');
  rmSync(data, { recursive: true, force: true });
  const run5 = await seedDataDir(data, { files: 2000 });
  const late = join(data, 'artifacts', 'text', 'late-artifact');
  const notEmpty = await cliWithHook(confirm, data, {}, () => {
    writeFileSync(late, 'written after planning');
    return 'wrote artifacts/text/late-artifact';
  });
  logCli(log, 'confirmed reset, directory made non-empty', confirm, notEmpty);
  log.block('timeline', notEmpty.timeline.join('\n'));
  log.check(notEmpty.code === 1, 'exit 1', notEmpty.code);
  log.check(notEmpty.stderr.includes('Reset stopped: could not remove artifacts/text: ENOTEMPTY'), 'names the directory that is no longer empty');
  log.check(notEmpty.stderr.includes(`  Removed:        workspaces/${run5}`) && notEmpty.stderr.includes('  Partly removed: artifacts (2 of 4 entries)'), 'removed and partly removed with counts');
  log.check(fileHash(late) !== 'missing', 'the late file is kept');
  const lateRerun = await cli(confirm, data);
  logCli(log, 'rerun', confirm, lateRerun);
  log.check(lateRerun.code === 0 && lateRerun.stdout.includes('late-artifact') === false && /\n  artifacts\s+artifacts\s+1 file, 2 directories/.test(lateRerun.stdout), 'rerun plans afresh, listing the late file inside artifacts, and completes', lateRerun.code);
  await freshStart('4e');
  log.line(`final tree: ${(await snapshot(data)).length} entries`);
} catch (error) {
  log.check(false, 'script error', error.stack);
} finally {
  log.save();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
