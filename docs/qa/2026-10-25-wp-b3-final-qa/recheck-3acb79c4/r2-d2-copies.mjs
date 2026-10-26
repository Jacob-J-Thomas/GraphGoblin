// Copy of ../recheck-dca4272b/r2-d2-copies.mjs for the 3acb79c4 re-check, unchanged; ./lib.mjs saves its log into this folder.
// Re-check of D2 on dca4272b: the private store copy in the system temp directory is owned by a
// detached copy owner (store-facts-reader) with a separate SQLite worker (store-facts-worker).
// Killing the reset CLI during its store read (dry run and locked plan) must not leave the copy;
// killing the owner itself leaves a marked copy that the next reset reaps; the reaper must leave
// unmarked, live-owned, mismatched or unexpected directories alone; no reader process may linger.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Log,
  MAIN,
  ROOT,
  TEMP_ROOT,
  alive,
  cli,
  copies,
  deadPid,
  environment,
  fileHash,
  identityOf,
  listDir,
  logCli,
  makeBase,
  marker,
  readerProcesses,
  sameTree,
  seedDataDir,
  snapshot,
  socketFile,
} from './lib.mjs';

const log = new Log('r2-d2-copies');
const baselineCopies = new Set(copies());
log.line(`gg-reset-store-* entries in the temp directory before this script: ${JSON.stringify([...baselineCopies])}`);
log.line(`reader processes of this worktree before this script: ${JSON.stringify(readerProcesses())}`);
const newCopies = () => copies().filter((name) => !baselineCopies.has(name));
const kill = (pid) => spawnSync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, encoding: 'utf8' }).stdout.trim();

/** Wait up to `ms` for `check()` to be truthy; returns [value, elapsed ms]. */
async function until(check, ms = 20_000, step = 25) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const value = check();
    if (value) return [value, Date.now() - started];
    await delay(step);
  }
  return [undefined, Date.now() - started];
}

function noLingering(label) {
  const left = readerProcesses();
  log.check(left.length === 0, `${label}: no store reader or SQLite worker process of this worktree is left`, left.map((p) => `${p.role} ${p.pid}`));
}

/** Spawn the reset CLI; `whenKill(state)` is polled every 5 ms and returns a PID list to kill. */
async function resetUntil(args, dataDir, decide, extra = {}) {
  const child = spawn(process.execPath, [MAIN, ...args], { cwd: ROOT, env: environment(dataDir, extra), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  const exited = once(child, 'exit');
  const started = Date.now();
  const seen = [];
  let action;
  while (child.exitCode === null && Date.now() - started < 120_000) {
    for (const name of newCopies()) if (!seen.includes(name)) seen.push(name);
    const decision = decide({ cli: child.pid, seen, out });
    if (decision) {
      action = { at: Date.now() - started, ...decision, results: decision.kill.map((pid) => `${pid}: ${kill(pid)}`) };
      break;
    }
    await delay(5);
  }
  const [code] = await exited;
  return { code, out, err, action, seen, ms: Date.now() - started };
}

const scenarios = [];
const scenario = (name, fn) => scenarios.push([name, fn]);

scenario('A: normal dry run and confirmed reset leave no copy and no process', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  for (const args of [['--reset'], ['--reset', '--yes', '--data-dir', data]]) {
    const result = await cli(args, data);
    logCli(log, `normal ${args.length === 1 ? 'dry run' : 'confirmed reset'}`, args, result);
    log.check(result.code === 0, 'exit 0', result.code);
    log.check(newCopies().length === 0, 'no new gg-reset-store-* entry right after exit', newCopies());
    noLingering('right after exit');
  }
  log.check(/format 3/.test((await cli(['--reset'], join(base, 'missing'))).stdout) === false, 'sanity: a missing data directory reads no store');
});

scenario('B1: dry run, CLI killed as soon as its copy directory appears', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const before = await snapshot(base);
  const result = await resetUntil(['--reset'], data, ({ cli, seen }) => (seen.length ? { kill: [cli], why: `copy ${seen[0]} appeared` } : undefined));
  log.line(`action: ${JSON.stringify(result.action)}; exit ${result.code}`);
  const name = result.seen[0];
  const owner = name && marker(name);
  log.line(`copy ${name}: marker ${JSON.stringify(owner)}; files ${JSON.stringify(listDir(join(TEMP_ROOT, name ?? 'x')))}`);
  const [gone, ms] = await until(() => !existsSync(join(TEMP_ROOT, name)));
  log.check(Boolean(gone), `the copy owner removed the copy after the CLI died (${ms} ms after the kill)`);
  await delay(1000);
  noLingering('1 s later');
  sameTree(log, 'the data directory is unchanged', before, await snapshot(base));
});

scenario('B2: dry run, CLI killed while the SQLite worker is running', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const result = await resetUntil(['--reset'], data, ({ cli, seen }) => {
    const owner = seen.length ? marker(seen[0]) : undefined;
    return owner?.workerPid ? { kill: [cli], why: `worker ${owner.workerPid} recorded by owner ${owner.pid}`, owner } : undefined;
  });
  log.line(`action: ${JSON.stringify(result.action)}; exit ${result.code}`);
  const name = result.seen[0];
  const [gone, ms] = await until(() => !existsSync(join(TEMP_ROOT, name)));
  log.check(Boolean(gone), `the copy is removed after the CLI died (${ms} ms)`);
  const pids = result.action?.owner ? [result.action.owner.pid, result.action.owner.workerPid] : [];
  const [dead, ms2] = await until(() => pids.every((pid) => !alive(pid)), 10_000);
  log.check(Boolean(dead) && pids.length === 2, `owner and worker (${pids.join(', ')}) have exited (${ms2} ms)`);
  noLingering('after the killed dry run');
});

scenario('C: confirmed reset, CLI killed during the plan under the lock', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const before = (await snapshot(base)).filter((r) => !r.startsWith('D data/ '));
  // The first copy is the read-only preview's; the second is read under the lock.
  const result = await resetUntil(['--reset', '--yes', '--data-dir', data], data, ({ cli, seen }) =>
    seen.length >= 2 && existsSync(join(data, 'graphgoblin.lock')) ? { kill: [cli], why: `locked-plan copy ${seen[1]} appeared` } : undefined,
  );
  log.line(`action: ${JSON.stringify(result.action)}; exit ${result.code}; copies seen ${JSON.stringify(result.seen)}`);
  log.check(result.seen.length === 2, 'two copies were made (preview and locked plan)', result.seen);
  const [gone, ms] = await until(() => result.seen.every((name) => !existsSync(join(TEMP_ROOT, name))));
  log.check(Boolean(gone), `both copies are gone after the CLI died (${ms} ms)`);
  await delay(1000);
  noLingering('1 s later');
  const after = (await snapshot(base)).filter((r) => !r.startsWith('D data/ ') && !/graphgoblin\.lock/.test(r));
  sameTree(log, 'nothing in the data directory changed but the reset lock', before, after);
  log.line(`lock left by the killed reset: ${existsSync(join(data, 'graphgoblin.lock'))}`);
  const rerun = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'rerun', ['--reset', '--yes', '--data-dir', data], rerun);
  log.check(rerun.code === 0 && rerun.stdout.includes('Reset complete.'), 'the rerun takes over the stale lock and completes', rerun.code);
  noLingering('after the rerun');
});

scenario('D1: the copy owner itself killed during a dry run; the next reset reaps the copy', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const result = await resetUntil(['--reset'], data, ({ seen }) => {
    const owner = seen.length ? marker(seen[0]) : undefined;
    return owner?.workerPid ? { kill: [owner.pid], why: `killed owner ${owner.pid} (worker ${owner.workerPid})`, owner } : undefined;
  });
  logCli(log, 'dry run whose copy owner was killed', ['--reset'], { ...result, stdout: result.out, stderr: result.err, timedOut: false });
  log.line(`action: ${JSON.stringify(result.action)}`);
  const name = result.seen[0];
  const owner = result.action?.owner;
  const [workerDead, ms] = await until(() => owner && !alive(owner.workerPid), 10_000);
  log.check(Boolean(workerDead), `the SQLite worker exits once its owner is gone (${ms} ms)`);
  log.line(`stale copy after the CLI finished: ${name} exists ${existsSync(join(TEMP_ROOT, name))}; files ${JSON.stringify(listDir(join(TEMP_ROOT, name)))}; marker ${JSON.stringify(marker(name))}`);
  log.check(existsSync(join(TEMP_ROOT, name)), 'the copy is left behind (its owner was killed before cleanup)');
  noLingering('after the owner was killed');
  const next = await cli(['--reset'], data);
  logCli(log, 'next dry run', ['--reset'], next);
  log.check(next.code === 0 && /format 3/.test(next.stdout), 'the next dry run reads the store normally', next.code);
  log.check(!existsSync(join(TEMP_ROOT, name)), 'the next reset removed the stale marked copy');
  noLingering('after the next dry run');
});

scenario('D2: CLI, owner and worker all killed at once (taskkill /T); the next reset reaps the copy', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const result = await resetUntil(['--reset'], data, ({ cli, seen }) => {
    const owner = seen.length ? marker(seen[0]) : undefined;
    if (!owner?.workerPid) return undefined;
    const tree = spawnSync('taskkill', ['/F', '/T', '/PID', String(cli)], { windowsHide: true, encoding: 'utf8' }).stdout.trim();
    return { kill: [owner.pid, owner.workerPid], why: `taskkill /T on the CLI: ${tree}`, owner };
  });
  log.line(`action: ${JSON.stringify(result.action)}; exit ${result.code}`);
  const name = result.seen[0];
  const owner = result.action?.owner;
  log.check(Boolean(owner) && !alive(owner.pid) && !alive(owner.workerPid), 'owner and worker are dead');
  log.line(`stale copy: ${name} files ${JSON.stringify(listDir(join(TEMP_ROOT, name)))}`);
  log.check(existsSync(join(TEMP_ROOT, name, 'owner.json')), 'a marked copy is left behind');
  noLingering('after killing the whole tree');
  const next = await cli(['--reset', '--data-dir', join(base, 'elsewhere')], join(base, 'elsewhere'));
  logCli(log, 'next reset (a dry run on another, missing data directory)', ['--reset', '--data-dir', '<base>\\elsewhere'], next);
  log.check(!existsSync(join(TEMP_ROOT, name)), 'any next reset, even for another data directory, reaps the dead copy', listDir(join(TEMP_ROOT, name)));
});

scenario('D3: the copy owner killed during the plan under the lock (observation)', async (base) => {
  const data = join(base, 'data');
  const run = await seedDataDir(data);
  const result = await resetUntil(['--reset', '--yes', '--data-dir', data], data, ({ seen }) => {
    if (seen.length < 2 || !existsSync(join(data, 'graphgoblin.lock'))) return undefined;
    const owner = marker(seen[1]);
    return owner?.workerPid ? { kill: [owner.pid], why: `killed locked-plan owner ${owner.pid}`, owner } : undefined;
  });
  logCli(log, 'confirmed reset whose locked-plan copy owner was killed', ['--reset', '--yes', '--data-dir', data], { ...result, stdout: result.out, stderr: result.err, timedOut: false });
  log.line(`action: ${JSON.stringify(result.action)}`);
  log.line(`observed: exit ${result.code}; data directory now ${JSON.stringify(listDir(data))}; workspaces ${JSON.stringify(listDir(join(data, 'workspaces')))}; run workspace ${run} kept: ${listDir(join(data, 'workspaces')).includes(run)}`);
  await cli(['--reset'], join(base, 'reaper-trigger'));
  noLingering('after the observation and a reaping reset');
});

scenario('E: the reaper removes only provably dead, marked, unchanged copies', async (base) => {
  const dead = deadPid();
  const dead2 = deadPid();
  const fixtures = {};
  const make = (suffix, { owner, files = ['store.db'], extra } = {}) => {
    const name = `gg-reset-store-${suffix}`;
    const dir = join(TEMP_ROOT, name);
    mkdirSync(dir);
    for (const file of files) writeFileSync(join(dir, file), `${file} bytes for ${suffix}`);
    if (owner) writeFileSync(join(dir, 'owner.json'), typeof owner === 'function' ? owner(dir) : owner);
    if (extra) extra(dir);
    fixtures[name] = dir;
    return name;
  };
  const valid = (pid, workerPid) => (dir) => JSON.stringify({ kind: 'graphgoblin-reset-store', pid, ...(workerPid === undefined ? {} : { workerPid }), identity: identityOf(dir) });
  const outside = join(base, 'junction-target');
  mkdirSync(outside);
  writeFileSync(join(outside, 'store.db'), 'junction target bytes');
  writeFileSync(join(outside, 'owner.json'), JSON.stringify({ kind: 'graphgoblin-reset-store', pid: dead, identity: identityOf(outside) }));
  const keep = {
    unmarked: make('QAunm1'),
    liveOwner: make('QAliv1', { owner: valid(process.pid, dead) }),
    liveWorker: make('QAwkr1', { owner: valid(dead, process.pid) }),
    identityMismatch: make('QAidm1', { owner: JSON.stringify({ kind: 'graphgoblin-reset-store', pid: dead, identity: identityOf(outside) }) }),
    unexpectedFile: make('QAunx1', { owner: valid(dead, dead2), files: ['store.db', 'notes.txt'] }),
    malformedMarker: make('QAmal1', { owner: 'not json' }),
    extraMarkerKey: make('QAext1', { owner: (dir) => JSON.stringify({ kind: 'graphgoblin-reset-store', pid: dead, identity: identityOf(dir), note: 'x' }) }),
    subdirectory: make('QAsub1', { owner: valid(dead, dead2), extra: (dir) => mkdirSync(join(dir, 'x')) }),
    nameTooLong: make('QAlong12', { owner: valid(dead, dead2) }),
    nameWithDash: make('QA-ab1', { owner: valid(dead, dead2) }),
  };
  const junction = 'gg-reset-store-QAjnc1';
  symlinkSync(outside, join(TEMP_ROOT, junction), 'junction');
  fixtures[junction] = join(TEMP_ROOT, junction);
  keep.junction = junction;
  const file = 'gg-reset-store-QAfil1';
  writeFileSync(join(TEMP_ROOT, file), 'a file, not a directory');
  fixtures[file] = join(TEMP_ROOT, file);
  keep.plainFile = file;
  keep.socketInside = make('QAsks1', { owner: valid(dead, dead2), files: [] });
  log.line(await socketFile(join(TEMP_ROOT, keep.socketInside, 'store.db')));
  const socketName = 'gg-reset-store-QAsck1';
  log.line(await socketFile(join(TEMP_ROOT, socketName)));
  fixtures[socketName] = join(TEMP_ROOT, socketName);
  keep.socketNamedLikeACopy = socketName;
  const reap = {
    valid: make('QAvld1', { owner: valid(dead, dead2), files: ['store.db', 'store.db-wal', 'store.db-shm'] }),
    validNoWorker: make('QAvld2', { owner: valid(dead), files: ['store.db', 'owner.next'] }),
  };
  const beforeKeep = {};
  for (const [label, name] of Object.entries(keep))
    beforeKeep[label] = label.startsWith('socket') ? listDir(join(TEMP_ROOT, name)) : await snapshot(TEMP_ROOT, name).catch(() => [`<${name}>`]);
  log.line(`fixtures: keep ${JSON.stringify(keep)}; reap ${JSON.stringify(reap)}`);
  const data = join(base, 'data');
  mkdirSync(data);
  const result = await cli(['--reset'], data);
  logCli(log, 'dry run on an empty data directory (runs the reaper)', ['--reset'], result);
  log.check(result.code === 0, 'the reset runs normally next to all the fixtures', result.code);
  for (const [label, name] of Object.entries(reap)) log.check(!existsSync(join(TEMP_ROOT, name)), `reaped: ${label} (${name})`);
  for (const [label, name] of Object.entries(keep)) {
    const now = label.startsWith('socket') ? listDir(join(TEMP_ROOT, name)) : await snapshot(TEMP_ROOT, name).catch(() => [`<${name}>`]);
    log.check(JSON.stringify(now) === JSON.stringify(beforeKeep[label]) && (existsSync(join(TEMP_ROOT, name)) || label.startsWith('socket')), `kept byte-identical: ${label} (${name})`);
  }
  log.check(existsSync(join(outside, 'store.db')) && existsSync(join(outside, 'owner.json')), 'the junction target is untouched');

  log.section('E2: a dead marked copy whose file is held open makes the reset refuse; released, it is reaped');
  const held = make('QAhld1', { owner: valid(dead, dead2), files: ['store.db', 'store.db-wal'] });
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$f = [System.IO.File]::Open('${join(TEMP_ROOT, held, 'store.db-wal')}', 'Open', 'Read', 'None'); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $f.Close()`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let heldOut = '';
  holder.stdout.on('data', (c) => (heldOut += c));
  await until(() => heldOut.includes('HELD'));
  const dataBefore = await snapshot(data);
  const blocked = await cli(['--reset'], data);
  logCli(log, 'dry run while a dead copy file is held open', ['--reset'], blocked);
  log.line(`observed: exit ${blocked.code}; copy now ${JSON.stringify(listDir(join(TEMP_ROOT, held)))}`);
  log.check(blocked.code === 1 && blocked.stderr.includes(held), 'the reset refuses and names the copy it could not clean', blocked.code);
  log.check(existsSync(join(TEMP_ROOT, held, 'owner.json')), 'the ownership marker is kept while the payload is not fully removed');
  sameTree(log, 'the data directory is unchanged', dataBefore, await snapshot(data));
  holder.stdin.write('\n');
  await once(holder, 'exit');
  const freed = await cli(['--reset'], data);
  logCli(log, 'dry run after release', ['--reset'], freed);
  log.check(freed.code === 0 && !existsSync(join(TEMP_ROOT, held)), 'after release the next reset reaps it', freed.code);

  // Remove this scenario's own fixtures (never anything else in the temp directory).
  for (const name of [...Object.values(keep), ...Object.values(reap), held]) {
    const path = join(TEMP_ROOT, name);
    if (name === socketName) {
      try {
        unlinkSync(path);
      } catch {
        /* already gone */
      }
      continue;
    }
    if (name === keep.socketInside) {
      try {
        unlinkSync(join(path, 'store.db'));
      } catch {
        /* already gone */
      }
    }
    if (name === junction || name === file) {
      try {
        unlinkSync(path);
      } catch {
        rmSync(path, { force: true });
      }
      continue;
    }
    rmSync(path, { recursive: true, force: true });
  }
});

const only = process.argv[2];
for (const [name, fn] of scenarios) {
  if (only && !name.startsWith(only)) continue;
  log.section(name);
  const base = await makeBase('r2');
  log.line(`base: ${base}`);
  try {
    await fn(base);
  } catch (error) {
    log.check(false, `${name}: script error`, error.stack);
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
log.section('End');
noLingering('at the end of the script');
log.line(`gg-reset-store-* entries left that this script did not find at the start: ${JSON.stringify(newCopies())}`);
log.check(newCopies().length === 0, 'no new gg-reset-store-* entry is left in the temp directory');
log.save();
