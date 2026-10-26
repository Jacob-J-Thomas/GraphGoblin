// Re-check of D3 on 3acb79c4: a confirmed reset whose read-only preview read the store, but whose
// read under the data-directory lock fails (or would keep a workspace the preview selected), must
// refuse before removing anything, release its lock, leave every data-directory byte unchanged, and
// let a rerun complete. A store unreadable in both reads must still reset as documented.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
  environment,
  listDir,
  logCli,
  makeBase,
  marker,
  readerProcesses,
  sameTree,
  seedDataDir,
  seedStore,
  snapshot,
} from './lib.mjs';

const log = new Log('r3-d3-locked-read');
const RUN = '01JQAB3INTRUNAAAAAAAAAAAAA';
const OTHER_RUN = '01JQAB3INTOTHERRUNAAAAAAAA';
const baselineCopies = new Set(copies());
const newCopies = () => copies().filter((name) => !baselineCopies.has(name));
const kill = (pid) => spawnSync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, encoding: 'utf8' }).stdout.trim();
const NOT_CHANGED = 'Nothing in the data directory was changed.\n';
const lockGone = (data) => !existsSync(join(data, 'graphgoblin.lock')) && !existsSync(join(data, 'graphgoblin.lock.reclaim'));
// The data directory's own mtime moves when the lock file is created and released.
// The lock file exists only while the reset holds it; its absence afterwards is checked separately.
const stable = async (base) => (await snapshot(base)).filter((r) => !r.startsWith('D data/ ') && !/^F data\/graphgoblin\.lock/.test(r));
/** Retry a rename while the reset briefly holds a handle below it. */
function retry(fn) {
  const end = Date.now() + 15_000;
  for (;;) {
    try {
      return fn();
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || Date.now() > end) throw error;
    }
  }
}

/** Run a confirmed reset; `act(state)` is polled every 5 ms until it returns a description. */
async function confirmedWith(data, act, extra = {}) {
  const args = ['--reset', '--yes', '--data-dir', data];
  const child = spawn(process.execPath, [MAIN, ...args], { cwd: ROOT, env: environment(data, extra), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => (stdout += c));
  child.stderr.on('data', (c) => (stderr += c));
  const exited = once(child, 'exit');
  const started = Date.now();
  const seen = [];
  let action;
  while (child.exitCode === null && Date.now() - started < 180_000 && !action) {
    for (const name of newCopies()) if (!seen.includes(name)) seen.push(name);
    action = await act({ seen, locked: existsSync(join(data, 'graphgoblin.lock')) });
    if (action) action = { at: Date.now() - started, ...action };
    else await delay(5);
  }
  const [code] = await exited;
  return { code, stdout, stderr, action, seen, ms: Date.now() - started, args };
}

function report(label, result) {
  logCli(log, label, result.args, { ...result, timedOut: false });
  log.line(`action: ${JSON.stringify(result.action)}; copies seen: ${JSON.stringify(result.seen)}`);
}

/** The refusal checks shared by every locked-read failure. */
async function refusedUnchanged(label, base, data, result, before, pattern) {
  log.check(result.code === 1, `${label}: exit 1`, result.code);
  log.check(result.stdout === '', `${label}: nothing on stdout (no manifest, no "Removing:")`, result.stdout.slice(0, 120));
  log.check(pattern.test(result.stderr) && result.stderr.endsWith(NOT_CHANGED) && !result.stderr.includes('Reset stopped'), `${label}: the refusal text`, result.stderr.split('\n')[0]);
  log.check(lockGone(data), `${label}: the lock and its guard are released`, listDir(data));
  sameTree(log, `${label}: every data-directory byte unchanged (all records but the data directory's own mtime)`, before, await stable(base));
}

async function rerunCompletes(label, data, runWorkspace = RUN) {
  const rerun = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, `${label}: rerun`, ['--reset', '--yes', '--data-dir', data], rerun);
  log.check(rerun.code === 0 && rerun.stdout.includes('Reset complete.'), `${label}: the rerun completes`, rerun.code);
  log.check(!listDir(join(data, 'workspaces')).includes(runWorkspace), `${label}: the rerun removed the run workspace ${runWorkspace}`, listDir(join(data, 'workspaces')));
  log.check(JSON.stringify(listDir(data)) === JSON.stringify(['master.key', 'workspaces']), `${label}: only kept entries remain`, listDir(data));
}

async function quiet(label) {
  await delay(500);
  const left = readerProcesses();
  log.check(left.length === 0, `${label}: no store reader or SQLite worker process left`, left.map((p) => `${p.role} ${p.pid}`));
}

const scenarios = [];
const scenario = (name, fn) => scenarios.push([name, fn]);

scenario('S1 (D3 reproduction): the copy owner killed during the read under the lock', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { runId: RUN });
  const before = await stable(base);
  const result = await confirmedWith(data, ({ seen, locked }) => {
    if (seen.length < 2 || !locked) return undefined;
    const owner = marker(seen[1]);
    return owner?.workerPid ? { what: `killed locked-read copy owner ${owner.pid} (worker ${owner.workerPid})`, result: kill(owner.pid) } : undefined;
  });
  report('S1', result);
  await refusedUnchanged('S1', base, data, result, before, /^reset refused: the store was readable in the preview but could not be read under the data-directory lock \(store reader exited with 1\); run the reset again before removing the database or run workspaces\n/);
  log.line(`S1: the killed owner's copy ${result.seen[1]} is still there: ${existsSync(join(TEMP_ROOT, result.seen[1]))}`);
  await rerunCompletes('S1', data);
  log.check(!existsSync(join(TEMP_ROOT, result.seen[1])), 'S1: the rerun reaped the killed owner\'s copy');
  await quiet('S1');
});

scenario('S2: the SQLite worker killed during the read under the lock', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { runId: RUN });
  const before = await stable(base);
  const result = await confirmedWith(data, ({ seen, locked }) => {
    if (seen.length < 2 || !locked) return undefined;
    const owner = marker(seen[1]);
    return owner?.workerPid ? { what: `killed locked-read SQLite worker ${owner.workerPid} (owner ${owner.pid})`, result: kill(owner.workerPid), owner } : undefined;
  });
  report('S2', result);
  await refusedUnchanged('S2', base, data, result, before, /^reset refused: the store was readable in the preview but could not be read under the data-directory lock \(.+\); run the reset again before removing the database or run workspaces\n/);
  log.check(!existsSync(join(TEMP_ROOT, result.seen[1] ?? 'x')), 'S2: the surviving owner removed its copy');
  await rerunCompletes('S2', data);
  await quiet('S2');
});

scenario('S3: the database held open by another program (FileShare.None) from the moment the lock is taken', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { runId: RUN });
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[void][Console]::In.ReadLine(); $f = [System.IO.File]::Open('${join(data, 'graphgoblin.db')}', 'Open', 'Read', 'None'); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $f.Close()`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let held = '';
  holder.stdout.on('data', (c) => (held += c));
  await delay(1500); // let PowerShell start and wait on its first line
  const before = await stable(base);
  const result = await confirmedWith(data, async ({ locked }) => {
    if (!locked) return undefined;
    holder.stdin.write('\n');
    while (!held.includes('HELD')) await delay(2);
    return { what: 'opened graphgoblin.db with FileShare.None as soon as the lock file appeared' };
  });
  report('S3', result);
  // Release the holder first: the snapshot must read the database bytes.
  holder.stdin.write('\n');
  await once(holder, 'exit');
  await refusedUnchanged('S3', base, data, result, before, /^reset refused: the store was readable in the preview but could not be read under the data-directory lock \(.*(EBUSY|resource busy|being used by another process).*\); run the reset again/);
  await rerunCompletes('S3', data);
  await quiet('S3');
});

scenario('S4: the database replaced by a valid store with other run IDs between preview and lock', async (base) => {
  const data = join(base, 'data');
  const alt = join(base, 'alt');
  await seedDataDir(data, { runId: RUN });
  mkdirSync(alt);
  await seedStore(join(alt, 'graphgoblin.db'), { runIds: [OTHER_RUN], format: 3 });
  let after;
  const result = await confirmedWith(data, async ({ locked }) => {
    if (!locked) return undefined;
    renameSync(join(alt, 'graphgoblin.db'), join(data, 'graphgoblin.db'));
    renameSync(join(alt, 'graphgoblin.db-wal'), join(data, 'graphgoblin.db-wal'));
    after = await stable(base);
    return { what: `renamed a store holding only run ${OTHER_RUN} over graphgoblin.db and its WAL` };
  });
  report('S4', result);
  await refusedUnchanged('S4', base, data, result, after, new RegExp(`^reset refused: workspaces/${RUN} was a run workspace in the preview but would be kept by the plan under the data-directory lock; run the reset again before removing its database\\n`));
  const rerun = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'S4: rerun (plans afresh against the replaced store)', ['--reset', '--yes', '--data-dir', data], rerun);
  log.check(rerun.code === 0 && new RegExp(`workspaces/${RUN}\\s+not a stored run ID`).test(rerun.stdout), 'S4: the rerun plans afresh against the store now present and completes, keeping the workspace it no longer matches', rerun.code);
  await quiet('S4');
});

scenario('S5: workspaces/ turned into a junction between preview and lock (a kept parent)', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { runId: RUN });
  let after;
  const result = await confirmedWith(data, async ({ locked }) => {
    if (!locked) return undefined;
    retry(() => renameSync(join(data, 'workspaces'), join(base, 'workspaces-real')));
    symlinkSync(join(base, 'workspaces-real'), join(data, 'workspaces'), 'junction');
    after = await stable(base);
    return { what: 'moved workspaces/ out and put a junction to it in its place' };
  });
  report('S5', result);
  await refusedUnchanged('S5', base, data, result, after, new RegExp(`^reset refused: workspaces/${RUN} was a run workspace in the preview but would be kept by the plan under the data-directory lock`));
  unlinkSync(join(data, 'workspaces'));
  renameSync(join(base, 'workspaces-real'), join(data, 'workspaces'));
  await rerunCompletes('S5', data);
  await quiet('S5');
});

scenario('S6: the database corrupted between preview and lock', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { runId: RUN });
  let after;
  let original;
  const result = await confirmedWith(data, async ({ locked }) => {
    if (!locked) return undefined;
    original = join(base, 'original');
    mkdirSync(original);
    for (const suffix of ['', '-wal', '-shm']) renameSync(join(data, `graphgoblin.db${suffix}`), join(original, `graphgoblin.db${suffix}`));
    writeFileSync(join(data, 'graphgoblin.db'), 'this is not an SQLite database, written after the preview');
    after = await stable(base);
    return { what: 'moved the store away and wrote a non-SQLite graphgoblin.db' };
  });
  report('S6', result);
  await refusedUnchanged('S6', base, data, result, after, /^reset refused: the store was readable in the preview but could not be read under the data-directory lock \(.+\); run the reset again/);
  rmSync(join(data, 'graphgoblin.db'));
  for (const suffix of ['', '-wal', '-shm']) renameSync(join(original, `graphgoblin.db${suffix}`), join(data, `graphgoblin.db${suffix}`));
  await rerunCompletes('S6', data);
  await quiet('S6');
});

scenario('Control: a store unreadable in both reads resets as documented', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { runId: RUN });
  for (const suffix of ['', '-wal', '-shm']) rmSync(join(data, `graphgoblin.db${suffix}`), { force: true });
  writeFileSync(join(data, 'graphgoblin.db'), 'this is not an SQLite database');
  const before = await snapshot(base);
  const dry = await cli(['--reset'], data);
  logCli(log, 'control dry run', ['--reset'], dry);
  log.check(dry.code === 0 && /graphgoblin\.db \(unreadable: /.test(dry.stdout), 'control: the dry run reports the store as unreadable', dry.code);
  log.check(new RegExp(`workspaces/${RUN}\\s+the store could not be read to match run IDs`).test(dry.stdout), 'control: the dry run keeps the run workspace (no run IDs)');
  sameTree(log, 'control: the dry run changed no byte', before, await snapshot(base));
  const confirmed = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'control confirmed reset', ['--reset', '--yes', '--data-dir', data], confirmed);
  log.check(confirmed.code === 0 && confirmed.stdout.includes('Reset complete.'), 'control: the confirmed reset completes (exit 0)', confirmed.code);
  log.check(/removed artifacts/.test(confirmed.stdout) && /removed graphgoblin\.db /.test(confirmed.stdout), 'control: it removes artifacts and the unreadable database');
  log.check(listDir(join(data, 'workspaces')).includes(RUN) && listDir(join(data, 'workspaces')).includes('my-notes'), 'control: it keeps every workspace, as documented', listDir(join(data, 'workspaces')));
  log.check(JSON.stringify(listDir(data)) === JSON.stringify(['master.key', 'workspaces']), 'control: only kept entries remain', listDir(data));
  await quiet('control');
});

const only = process.argv[2];
for (const [name, fn] of scenarios) {
  if (only && !name.startsWith(only)) continue;
  log.section(name);
  const base = await makeBase('r3');
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
await quiet('end of script');
log.line(`gg-reset-store-* entries left that were not there at the start: ${JSON.stringify(newCopies())}`);
log.check(newCopies().length === 0, 'no new private copy is left in the temp directory');
log.check(!readerProcesses().some((p) => alive(p.pid)), 'no reader process alive');
log.save();
