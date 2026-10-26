// Copy of ../recheck-dca4272b/r1-d1-sockets.mjs for the 3acb79c4 re-check. The only change: refusals now end "Nothing in the data directory was changed."
// Re-check of D1 on dca4272b: a Windows AF_UNIX socket file (which Node's lstat cannot inspect)
// in a run workspace, inside artifacts/, at the data-directory root, or as the configured database
// must refuse the dry run and the confirmed reset with its path and guidance and change nothing;
// one swapped in after planning must stop the removal without being removed.
import { mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  Log,
  cli,
  cliWithHook,
  listDir,
  logCli,
  makeBase,
  sameTree,
  seedDataDir,
  seedStore,
  snapshot,
  socketFile,
  writeMany,
} from './lib.mjs';

const log = new Log('r1-d1-sockets');
const url = (path) => `file:${path.replaceAll('\\', '/')}`;
const guidance = (path) =>
  `reset refused: ${path} cannot be inspected without following it on this system. Stop the program using it, check its permissions, and move or remove that entry yourself, then run the reset again\nNothing in the data directory was changed.\n`;

async function bothRefuse(label, base, data, socket, env = {}) {
  for (const [mode, args] of [
    ['dry run', ['--reset']],
    ['confirmed', ['--reset', '--yes', '--data-dir', data]],
  ]) {
    const before = await snapshot(base);
    const result = await cli(args, data, env, { timeoutMs: 60_000 });
    logCli(log, `${label} (${mode})`, args, result, Object.keys(env).length ? JSON.stringify(env) : '');
    log.check(result.code === 1 && !result.timedOut, `${label} (${mode}): exit 1, no blocking (${result.ms} ms)`, result.code);
    log.check(result.stderr === guidance(socket), `${label} (${mode}): stderr is exactly the documented refusal naming the absolute path`);
    log.check(result.stdout === '', `${label} (${mode}): nothing on stdout (no manifest, no removal)`);
    sameTree(log, `${label} (${mode}): no byte changed (socket recorded as present)`, before, await snapshot(base));
  }
  log.check(listDir(join(socket, '..')).includes(socket.split('\\').pop()), `${label}: the socket file still exists`);
}

const scenarios = [];
const scenario = (name, fn) => scenarios.push([name, fn]);

scenario('1: socket inside a run workspace', async (base) => {
  const data = join(base, 'data');
  const run = await seedDataDir(data);
  const socket = join(data, 'workspaces', run, 'tool.sock');
  log.line(await socketFile(socket));
  await bothRefuse('socket in a run workspace', base, data, socket);
  unlinkSync(socket);
  const after = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'confirmed after unlinking the socket by hand', ['--reset', '--yes', '--data-dir', data], after);
  log.check(after.code === 0 && after.stdout.includes('Reset complete.'), 'with the socket removed by hand the reset completes', after.code);
});

scenario('2: socket at the data-directory root', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const socket = join(data, 'agent.sock');
  log.line(await socketFile(socket));
  await bothRefuse('socket at the root', base, data, socket);
});

scenario('3: socket inside artifacts/', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  const socket = join(data, 'artifacts', 'text', 'a.sock');
  log.line(await socketFile(socket));
  await bothRefuse('socket inside artifacts', base, data, socket);
});

scenario('4: socket as the configured database', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { database: 'store/graphgoblin.db' });
  const socket = join(data, 'graphgoblin.db');
  log.line(await socketFile(socket));
  await bothRefuse('socket as the database', base, data, socket, { GG_DB_URL: url(socket) });
  // The default GG_DB_URL also points at data/graphgoblin.db; check it without GG_DB_URL too.
  await bothRefuse('socket as the default database path', base, data, socket);
});

scenario('5: a planned file replaced by a socket after planning', async (base) => {
  const data = join(base, 'data');
  const runA = '01JQAB3INTRUNAAAAAAAAAAAAA';
  const runB = '01JQAB3INTRUNBBBBBBBBBBBBB';
  mkdirSync(data, { recursive: true });
  await seedStore(join(data, 'graphgoblin.db'), { runIds: [runA, runB], format: 3 });
  writeMany(join(data, 'workspaces', runA), 3000);
  writeMany(join(data, 'workspaces', runB), 5);
  const target = join(data, 'workspaces', runB, 'f00002.txt');
  let made;
  const confirm = ['--reset', '--yes', '--data-dir', data];
  const result = await cliWithHook(confirm, data, {}, () => {
    unlinkSync(target);
    made = socketFile(target);
    return `unlinked workspaces/${runB}/f00002.txt; creating a socket with that name`;
  });
  log.line(await made);
  logCli(log, 'socket swapped in at Removing:', confirm, result);
  log.block('timeline', result.timeline.join('\n'));
  log.check(result.code === 1, 'exit 1', result.code);
  log.check(result.stderr.startsWith(`Reset stopped: could not remove workspaces/${runB}/f00002.txt: ${target} cannot be inspected without following it on this system.`), 'the incomplete-reset report names the uninspectable entry and its path');
  log.check(result.stderr.includes(`  Removed:        workspaces/${runA}`) && result.stderr.includes(`  Partly removed: workspaces/${runB} (2 of 6 entries)`) && result.stderr.includes('  Not removed:    graphgoblin.db, graphgoblin.db-wal, graphgoblin.db-shm'), 'removed / partly removed / not removed');
  log.check(listDir(join(data, 'workspaces', runB)).includes('f00002.txt'), 'the socket is still there');
  const rerun = await cli(['--reset'], data);
  logCli(log, 'rerun (dry run) with the socket still there', ['--reset'], rerun);
  log.check(rerun.code === 1 && rerun.stderr === guidance(target), 'the rerun refuses with the same guidance');
  unlinkSync(target);
  const done = await cli(confirm, data);
  logCli(log, 'rerun after unlinking the socket', confirm, done);
  log.check(done.code === 0 && done.stdout.includes('Reset complete.'), 'the rerun completes', done.code);
});

const only = process.argv[2];
for (const [name, fn] of scenarios) {
  if (only && !name.startsWith(only)) continue;
  log.section(name);
  const base = await makeBase('r1');
  log.line(`base: ${base}`);
  try {
    await fn(base);
  } catch (error) {
    log.check(false, `${name}: script error`, error.stack);
  } finally {
    // rmSync cannot lstat a socket either; unlink any socket left, then remove the rest.
    for (const dir of [join(base, 'data'), join(base, 'data', 'artifacts', 'text')])
      for (const name of listDir(dir)) if (/\.sock$|^graphgoblin\.db$/.test(name)) try { unlinkSync(join(dir, name)); } catch { /* not a socket */ }
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
log.save();
