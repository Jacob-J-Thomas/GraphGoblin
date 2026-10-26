// Additional reset and refusal probes beyond the ten numbered checks: interruption (the reset
// process killed while reading the store, while planning under the lock, and while removing),
// two concurrent confirmed resets, a long manifest, a workspaces/ junction, a database path that
// spells the data directory in another letter case, and starting GraphGoblin on a current-format
// store whose reset stopped part of the way.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Log,
  MAIN,
  ROOT,
  TMP,
  call,
  cli,
  createLoopAndRuns,
  environment,
  fakeCodex,
  fileHash,
  listDir,
  logCli,
  makeBase,
  sameTree,
  seedDataDir,
  seedStore,
  snapshot,
  startApi,
  stopApi,
  writeMany,
} from './lib.mjs';

const log = new Log('c11-extras');
const scenarios = [];
const scenario = (name, fn) => scenarios.push([name, fn]);
const readerCopies = () => readdirSync(TMP).filter((n) => n.startsWith('gg-reset-store-'));

/** Spawn the CLI, kill it (TerminateProcess) when `when()` turns true; returns what happened. */
async function killWhen(args, dataDir, when, extra = {}) {
  const child = spawn(process.execPath, [MAIN, ...args], { cwd: ROOT, env: environment(dataDir, extra), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  const exited = once(child, 'exit');
  const started = Date.now();
  let killedAt;
  while (child.exitCode === null && Date.now() - started < 120_000) {
    if (when(out)) {
      spawnSync('taskkill', ['/F', '/PID', String(child.pid)], { windowsHide: true });
      killedAt = Date.now() - started;
      break;
    }
    await delay(5);
  }
  const [code] = await exited;
  return { code, out, killedAt };
}

scenario('E1: killed while the dry run reads the store (private copy in the temp directory)', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const before = await snapshot(base);
  const existing = new Set(readerCopies());
  const result = await killWhen(['--reset'], data, () => readerCopies().some((n) => !existing.has(n)));
  log.line(`killed at ${result.killedAt} ms; exit ${result.code}; output so far: ${JSON.stringify(result.out)}`);
  sameTree(log, 'E1: the data directory is unchanged', before, await snapshot(base));
  await delay(15_000); // let the orphaned reader process finish
  const left = readerCopies().filter((n) => !existing.has(n));
  log.line(`E1: reader copies left in the temp directory 15 s later: ${JSON.stringify(left)}`);
  for (const name of left) log.line(`  ${name}: ${JSON.stringify(listDir(join(TMP, name)))} (store.db sha256 ${fileHash(join(TMP, name, 'store.db'))}, original ${fileHash(join(data, 'graphgoblin.db'))})`);
  log.check(left.length === 0, 'E1: no copy of the store is left in the temp directory after the reset process is killed', left);
  for (const name of left) rmSync(join(TMP, name), { recursive: true, force: true });
});

scenario('E2: killed while removing; the rerun takes over the dead reset\'s lock and finishes', async (base) => {
  const data = join(base, 'data');
  const run = await seedDataDir(data, { files: 4000 });
  const result = await killWhen(['--reset', '--yes', '--data-dir', data], data, (out) => out.includes('Removing:'));
  log.line(`killed at ${result.killedAt} ms; exit ${result.code}`);
  const lock = existsSync(join(data, 'graphgoblin.lock')) ? readFileSync(join(data, 'graphgoblin.lock'), 'utf8') : '(none)';
  log.line(`E2: after the kill: ${JSON.stringify(listDir(data))}; run workspace files left: ${listDir(join(data, 'workspaces', run)).length}; lock ${lock}`);
  const start = await cli([], data, { GG_PORT: '6346' }, { timeoutMs: 60_000 });
  logCli(log, 'E2: start after the killed reset', [], start);
  log.check(start.code === 1 && start.stderr.includes('GraphGoblin did not start'), 'E2: a start is still refused (the format-3 database is still there)', start.code);
  const rerun = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'E2: rerun', ['--reset', '--yes', '--data-dir', data], rerun);
  log.check(rerun.code === 0 && rerun.stdout.includes('Reset complete.'), 'E2: the rerun takes over the stale lock and completes', rerun.code);
  log.check(JSON.stringify(listDir(data)) === JSON.stringify(['master.key', 'workspaces']), 'E2: only kept entries remain', listDir(data));
});

scenario('E3: killed after taking the lock, before removing (planning under the lock)', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const before = (await snapshot(base)).filter((r) => !r.startsWith('D data/ '));
  const existing = new Set(readerCopies());
  const result = await killWhen(['--reset', '--yes', '--data-dir', data], data, () => existsSync(join(data, 'graphgoblin.lock')));
  log.line(`killed at ${result.killedAt} ms; exit ${result.code}; output ${JSON.stringify(result.out)}`);
  await delay(15_000); // let an orphaned reader process finish
  const left = readerCopies().filter((n) => !existing.has(n));
  log.line(`E3: reader copies left in the temp directory 15 s later: ${JSON.stringify(left)}`);
  log.check(left.length === 0, 'E3: no copy of the store is left in the temp directory after the reset process is killed', left);
  for (const name of left) rmSync(join(TMP, name), { recursive: true, force: true });
  const after = (await snapshot(base)).filter((r) => !r.startsWith('D data/ ') && !/graphgoblin\.lock/.test(r));
  sameTree(log, 'E3: nothing but the lock file changed', before, after);
  log.line(`E3: lock left: ${existsSync(join(data, 'graphgoblin.lock'))}; guard left: ${existsSync(join(data, 'graphgoblin.lock.reclaim'))}`);
  const dry = await cli(['--reset'], data);
  logCli(log, 'E3: dry run with the dead reset\'s lock', ['--reset'], dry);
  log.check(dry.code === 0, 'E3: the dry run treats the dead reset\'s lock as stale', dry.code);
  const rerun = await cli(['--reset', '--yes', '--data-dir', data], data);
  log.check(rerun.code === 0, 'E3: the rerun completes', rerun.code);
});

scenario('E4: two confirmed resets at once', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { files: 3000 });
  const args = ['--reset', '--yes', '--data-dir', data];
  const [first, second] = await Promise.all([cli(args, data), cli(args, data)]);
  logCli(log, 'E4: first', args, first);
  logCli(log, 'E4: second', args, second);
  const codes = [first.code, second.code].sort();
  log.check(JSON.stringify(codes) === '[0,1]', 'E4: exactly one completes and the other refuses', codes);
  const loser = first.code === 1 ? first : second;
  log.check(/reset refused: .*another GraphGoblin process holds .*graphgoblin\.lock(\.reclaim)?/.test(loser.stderr) && loser.stderr.includes('Nothing was changed.'), 'E4: the refusal names the held lock and says nothing was changed');
  log.check(JSON.stringify(listDir(data)) === JSON.stringify(['master.key', 'workspaces']), 'E4: the directory is fully reset once', listDir(data));
});

scenario('E5: a long manifest (25 run workspaces, 22 kept entries) is bounded with full totals', async (base) => {
  const data = join(base, 'data');
  const ids = Array.from({ length: 25 }, (_, i) => `01JQAB3INTRUN${String(i).padStart(13, '0')}`);
  mkdirSync(data, { recursive: true });
  await seedStore(join(data, 'graphgoblin.db'), { runIds: ids, format: 3 });
  for (const id of ids) writeMany(join(data, 'workspaces', id), 2);
  for (let i = 0; i < 22; i += 1) writeFileSync(join(data, `user-${String(i).padStart(2, '0')}.txt`), 'user file');
  const dry = await cli(['--reset'], data);
  logCli(log, 'E5: dry run', ['--reset'], dry);
  // 28 targets: 25 workspaces (2 files each), the database, its WAL and SHM; 22 kept user files.
  const lines = (from, to) =>
    dry.stdout.slice(dry.stdout.indexOf(from), dry.stdout.indexOf(to)).split(/\r?\n/).filter((l) => l.startsWith('  '));
  const removes = lines('Removes:', 'Keeps:');
  const keeps = lines('Keeps:', 'Total removed');
  log.check(removes.length === 22 && /^  \.\.\. and 8 more: 13 files, 5 directories, /.test(removes[20]), 'E5: Removes shows 20 rows, then "... and 8 more" with their counts, then the lock', removes[20]);
  log.check(keeps.length === 22 && keeps[20] === '  ... and 2 more entries', 'E5: Keeps shows 20 rows then "... and 2 more entries"', keeps[20]);
  log.check(/Total removed: 53 files, 25 directories, .* in 28 items\./.test(dry.stdout), 'E5: totals cover every target', /Total removed: .*/.exec(dry.stdout)?.[0]);
});

scenario('E6: workspaces/ is itself a junction at the root', async (base) => {
  const data = join(base, 'data');
  const outside = join(base, 'outside-workspaces');
  const run = await seedDataDir(data);
  rmSync(join(data, 'workspaces'), { recursive: true });
  mkdirSync(join(outside, run), { recursive: true });
  writeFileSync(join(outside, run, 'precious.txt'), 'outside: never removed');
  symlinkSync(outside, join(data, 'workspaces'), 'junction');
  const outsideBefore = await snapshot(outside);
  const confirmed = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'E6: confirmed', ['--reset', '--yes', '--data-dir', data], confirmed);
  log.check(confirmed.code === 0 && /\n  workspaces\s+a link; a reset never follows links/.test(confirmed.stdout), 'E6: the workspaces junction is kept as a link', confirmed.code);
  sameTree(log, 'E6: the junction target is untouched', outsideBefore, await snapshot(outside));
});

scenario('E7: GG_DB_URL spells the data directory in another letter case', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const before = await snapshot(base);
  const dbUrl = `file:${join(base, 'DATA', 'graphgoblin.db').replaceAll('\\', '/')}`;
  const dry = await cli(['--reset'], data, { GG_DB_URL: dbUrl });
  logCli(log, 'E7: dry run', ['--reset'], dry, `GG_DB_URL=${dbUrl}`);
  log.line(`E7: observed exit ${dry.code}`);
  log.check(dry.code === 1 && /is outside the data directory/.test(dry.stderr), 'E7: refused as outside (ADR-0042 compares the data-directory spelling exactly; over-refusal)', dry.code);
  sameTree(log, 'E7: nothing changed', before, await snapshot(base));
});

scenario('E8: starting GraphGoblin on a current-format store whose reset stopped part of the way', async (base) => {
  const data = join(base, 'data');
  const codex = await fakeCodex();
  const api = await startApi(data, 6346, { GG_CODEX_BINARY: codex });
  const { runIds } = await createLoopAndRuns(log, api, 1);
  await stopApi(api);
  // Hold the database readable but not deletable, so the reset stops after workspaces and artifacts.
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$f = [System.IO.File]::Open('${join(data, 'graphgoblin.db')}', 'Open', 'Read', 'ReadWrite'); [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $f.Close()`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let held = '';
  holder.stdout.on('data', (c) => (held += c));
  while (!held.includes('HELD')) await delay(50);
  const failed = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'E8: reset with a held database', ['--reset', '--yes', '--data-dir', data], failed);
  holder.stdin.write('\n');
  await once(holder, 'exit');
  log.line(`E8: after the stopped reset: ${JSON.stringify(listDir(data))}`);
  const started = await startApi(data, 6346, { GG_CODEX_BINARY: codex });
  log.line(`E8: start after the stopped reset: ${started.failed ? `refused (exit ${started.code}) ${started.stderr}` : 'started'}`);
  if (!started.failed) {
    const runs = await call(started, 'GET', '/runs');
    const thread = await call(started, 'GET', `/runs/${runIds[0]}/thread`);
    const artifact = thread.body?.artifacts?.[0];
    const download = artifact ? await call(started, 'GET', `/runs/${runIds[0]}/artifacts/${encodeURIComponent(artifact.id ?? artifact.ref ?? '')}`) : undefined;
    log.line(`E8: runs listed: ${runs.body.items?.length}; artifact download after the reset removed artifacts/: ${download?.status} ${JSON.stringify(download?.body).slice(0, 300)}`);
    await stopApi(started);
  }
  log.line('E8: observation only; the reset tells the operator not to start GraphGoblin until the reset finishes');
});

const only = process.argv[2];
for (const [name, fn] of scenarios) {
  if (only && !name.startsWith(only)) continue;
  log.section(name);
  const base = await makeBase('c11');
  log.line(`base: ${base}`);
  try {
    await fn(base);
  } catch (error) {
    log.check(false, `${name}: script error`, error.stack);
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
log.save();
