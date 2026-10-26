// Check 3: a running API makes the dry run and the confirmed reset refuse with nothing removed; a
// stale lock left by a killed API is not deleted by any refused reset (only a confirmed reset takes
// it over); an API started while a confirmed reset runs is refused by the reset's lock.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  Log,
  call,
  cli,
  cliWithHook,
  createLoopAndRuns,
  environment,
  fakeCodex,
  fileHash,
  killApi,
  listDir,
  logCli,
  makeBase,
  MAIN,
  ROOT,
  sameTree,
  snapshot,
  startApi,
  writeMany,
} from './lib.mjs';
import { spawn } from 'node:child_process';

const log = new Log('c03-live-and-stale-lock');
const base = await makeBase('c03');
const data = join(base, 'data');
const lock = join(data, 'graphgoblin.lock');
log.line(`base: ${base}`);
const notDatabase = (records) => records.filter((r) => !/^. data\/graphgoblin\.db/.test(r) && !/^D data\/ /.test(r));

try {
  const codex = await fakeCodex();
  log.section('Live lock: a running API (port 6341)');
  const api = await startApi(data, 6341, { GG_CODEX_BINARY: codex });
  log.check(!api.failed, 'API starts', api.stderr);
  const { runIds } = await createLoopAndRuns(log, api, 1);
  const lockBytes = readFileSync(lock, 'utf8');
  log.line(`lock while running: ${lockBytes}`);
  const before = notDatabase(await snapshot(base));
  for (const [label, args] of [
    ['dry run while running', ['--reset']],
    ['confirmed reset while running', ['--reset', '--yes', '--data-dir', data]],
  ]) {
    const result = await cli(args, data);
    logCli(log, label, args, result);
    log.check(result.code === 1, `${label}: exit 1`, result.code);
    log.check(result.stderr.includes(`reset refused: another GraphGoblin process holds ${lock}; stop it before resetting`), `${label}: names the held lock`);
    sameTree(log, `${label}: nothing outside the live database files changed`, before, notDatabase(await snapshot(base)));
    log.check(existsSync(join(data, 'graphgoblin.db')) && listDir(join(data, 'workspaces')).includes(runIds[0]), `${label}: database and run workspace still present`);
    log.check(readFileSync(lock, 'utf8') === lockBytes, `${label}: the live lock is unchanged`);
  }
  const health = await call(api, 'GET', '/healthz');
  log.check(health.status === 200, 'the running API is still healthy after the refused resets', health.status);

  log.section('Stale lock: kill the API hard (taskkill /F)');
  await killApi(api);
  const stale = readFileSync(lock, 'utf8');
  const stalePid = JSON.parse(stale).pid;
  let alive = true;
  try {
    process.kill(stalePid, 0);
  } catch (error) {
    alive = error.code !== 'ESRCH';
  }
  log.line(`stale lock: ${stale}; pid ${stalePid} alive: ${alive}`);
  log.check(!alive, 'the lock names a dead process');
  writeFileSync(join(data, 'graphgoblin.lock.reclaim'), JSON.stringify({ pid: stalePid, startedAt: '2026-10-25T00:00:00.000Z', token: 'stale-guard' }));
  const staleTree = await snapshot(base);
  const refusals = [
    ['wrong --data-dir', ['--reset', '--yes', '--data-dir', base], {}],
    ['usage error (--yes alone)', ['--reset', '--yes'], {}, 2],
    ['database named artifacts', ['--reset', '--yes', '--data-dir', data], { GG_DB_URL: `file:${join(data, 'artifacts').replaceAll('\\', '/')}` }],
    ['database outside the data directory', ['--reset', '--yes', '--data-dir', data], { GG_DB_URL: `file:${join(base, 'outside.db').replaceAll('\\', '/')}` }],
    ['database :memory:', ['--reset', '--yes', '--data-dir', data], { GG_DB_URL: ':memory:' }],
    ['database inside workspaces/ (the run workspace directory)', ['--reset', '--yes', '--data-dir', data], { GG_DB_URL: `file:${join(data, 'workspaces', runIds[0]).replaceAll('\\', '/')}` }],
    ['dry run (not a refusal; must also leave the stale lock)', ['--reset'], {}, 0],
  ];
  for (const [label, args, env, expected = 1] of refusals) {
    const result = await cli(args, data, env);
    logCli(log, label, args, result, Object.keys(env).length ? JSON.stringify(env) : '');
    log.check(result.code === expected, `${label}: exit ${expected}`, result.code);
    sameTree(log, `${label}: the stale lock, its guard and every other byte are unchanged`, staleTree, await snapshot(base));
  }

  log.section('A malformed lock record counts as held');
  writeFileSync(lock, 'not json');
  const malformed = await cli(['--reset'], data);
  logCli(log, 'dry run with a malformed lock', ['--reset'], malformed);
  log.check(malformed.code === 1 && malformed.stderr.includes('another GraphGoblin process holds'), 'refused as held', malformed.code);
  log.check(readFileSync(lock, 'utf8') === 'not json', 'malformed lock left in place');
  writeFileSync(lock, stale);

  log.section('A lock naming a live process that is not GraphGoblin counts as held');
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: '2026-10-25T00:00:00.000Z', token: 'live-other' }));
  const liveOther = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'confirmed with a live foreign pid', ['--reset', '--yes', '--data-dir', data], liveOther);
  log.check(liveOther.code === 1 && liveOther.stderr.includes('another GraphGoblin process holds'), 'refused as held', liveOther.code);
  writeFileSync(lock, stale);

  log.section('Confirmed reset takes over the stale lock');
  const takeover = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'confirmed with a stale lock', ['--reset', '--yes', '--data-dir', data], takeover);
  log.check(takeover.code === 0 && takeover.stdout.includes('Reset complete.'), 'completes', takeover.code);
  log.check(!existsSync(lock) && !existsSync(join(data, 'graphgoblin.lock.reclaim')), 'no lock or guard file remains', listDir(data));
  log.line(`data directory after: ${JSON.stringify(listDir(data))}`);

  log.section('An API started while a confirmed reset is removing is refused by the reset lock');
  // A second store with a large run workspace so the removal takes long enough to start an API.
  const api2 = await startApi(data, 6341, { GG_CODEX_BINARY: codex });
  const { runIds: ids2 } = await createLoopAndRuns(log, api2, 1);
  await killApi(api2);
  writeMany(join(data, 'workspaces', ids2[0], 'bulk'), 3000);
  let started;
  const result = await cliWithHook(['--reset', '--yes', '--data-dir', data], data, {}, () => {
    started = spawn(process.execPath, [MAIN], {
      cwd: ROOT,
      env: environment(data, { GG_PORT: '6341', GG_HOST: '127.0.0.1', GG_CODEX_BINARY: codex }),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    started.out = '';
    started.stdout.on('data', (c) => (started.out += c));
    started.stderr.on('data', (c) => (started.out += c));
    started.done = new Promise((resolve) => started.on('exit', resolve));
    return `started API pid ${started.pid}`;
  });
  logCli(log, 'confirmed reset racing an API start', ['--reset', '--yes', '--data-dir', data], result);
  log.block('timeline', result.timeline.join('\n'));
  const apiCode = await Promise.race([started.done, new Promise((r) => setTimeout(() => r('still running'), 60_000))]);
  log.block('API started during the reset', `exit ${apiCode}\n${started.out}`);
  log.check(apiCode === 1 && /another GraphGoblin process holds/.test(started.out), 'the API refuses to start while the reset holds the lock', apiCode);
  log.check(result.code === 0 && result.stdout.includes('Reset complete.'), 'the reset completes', result.code);
  if (apiCode === 'still running') started.kill();
  log.line(`data directory after: ${JSON.stringify(listDir(data))}`);
  log.check(fileHash(join(data, 'graphgoblin.db')) === 'missing', 'no database was created by the refused API');
} catch (error) {
  log.check(false, 'script error', error.stack);
} finally {
  log.save();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
