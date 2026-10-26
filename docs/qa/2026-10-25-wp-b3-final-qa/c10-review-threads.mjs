// Check 10: the two open review threads on PR #355.
// (a) A database configured with a name exactly equal to `artifacts` or `workspaces` at the
//     data-directory root (any spelling) must be refused, not planned twice or reported as an
//     incomplete reset.
// (b) A configured database path that is not a regular file (a directory, a junction, a Windows
//     AF_UNIX socket file, a device name, a named pipe path, a stream) must be refused by the dry
//     run and the confirmed reset without blocking or removing it.
import { execFile } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  BIN_DIR,
  Log,
  QA_DIR,
  cli,
  fileHash,
  listDir,
  logCli,
  makeBase,
  sameTree,
  seedDataDir,
  seedStore,
  shortPath,
  snapshot,
} from './lib.mjs';

const log = new Log(process.argv[2] ? `c10-review-threads-${process.argv[2]}` : 'c10-review-threads');
const url = (path) => `file:${path.replaceAll('\\', '/')}`;

async function afUnixTool() {
  const exe = join(BIN_DIR, 'afunix.exe');
  if (existsSync(exe)) return exe;
  mkdirSync(BIN_DIR, { recursive: true });
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -Path '${join(QA_DIR, 'af-unix-socket.cs')}' -OutputAssembly '${exe}' -OutputType ConsoleApplication`], { windowsHide: true });
  return exe;
}
async function socketFile(path) {
  // sockaddr_un holds 108 bytes, so bind the leaf name from inside its directory.
  const { stdout } = await promisify(execFile)(await afUnixTool(), [basename(path)], { windowsHide: true, cwd: dirname(path) });
  return `${stdout.trim()} in ${dirname(path)}`;
}

/**
 * Dry run and confirmed reset with this GG_DB_URL: both must refuse (exit 1, "reset refused:",
 * "Nothing was changed.") quickly, never report "Reset stopped", and change no byte under base.
 */
async function bothRefuse(label, base, data, dbUrl, messagePattern) {
  for (const [mode, args] of [
    ['dry run', ['--reset']],
    ['confirmed', ['--reset', '--yes', '--data-dir', data]],
  ]) {
    const before = await snapshot(base);
    const result = await cli(args, data, { GG_DB_URL: dbUrl }, { timeoutMs: 60_000 });
    logCli(log, `${label} (${mode})`, args, result, `GG_DB_URL=${dbUrl}`);
    log.check(result.code === 1 && !result.timedOut, `${label} (${mode}): exit 1 without blocking (${result.ms} ms)`, result.code);
    log.check(/^reset refused: /.test(result.stderr) && result.stderr.endsWith('Nothing was changed.\n') && !result.stderr.includes('Reset stopped'), `${label} (${mode}): a refusal, not an incomplete reset`);
    if (messagePattern) log.check(messagePattern.test(result.stderr), `${label} (${mode}): message`, /reset refused: (.*)/.exec(result.stderr)?.[1]);
    sameTree(log, `${label} (${mode}): no byte changed`, before, await snapshot(base));
  }
}

const cases = [];
const scenario = (name, fn) => cases.push([name, fn]);

scenario('a1: database file named exactly artifacts / workspaces (and spellings) at the root', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  for (const name of ['artifacts', 'workspaces']) {
    // The reserved directory exists (a real store) and is named as the database.
    await bothRefuse(`database named ${name} while ${name}/ is a directory`, base, data, url(join(data, name)), new RegExp(`the database ${name} has the name of the ${name} directory, which a reset removes; rename it first|is a directory, not a database file`));
  }
  // Without the reserved directories: a regular SQLite file named exactly artifacts / workspaces.
  rmSync(join(data, 'artifacts'), { recursive: true });
  rmSync(join(data, 'workspaces'), { recursive: true });
  for (const name of ['artifacts', 'workspaces', 'Artifacts', 'WORKSPACES']) {
    await seedStore(join(data, name), { runIds: ['01JQAB3INTRUNAAAAAAAAAAAAA'], format: 3 });
    log.line(`data directory: ${JSON.stringify(listDir(data))}`);
    await bothRefuse(`regular database file named ${name}`, base, data, url(join(data, name)), new RegExp(`has the name of the (artifacts|workspaces) directory, which a reset removes; rename it first`));
    for (const suffix of ['', '-wal', '-shm']) rmSync(join(data, name + suffix), { force: true });
  }
  // Absent: nothing there yet, configured as the reserved name (any case).
  for (const name of ['artifacts', 'Workspaces']) await bothRefuse(`absent database named ${name}`, base, data, url(join(data, name)), /has the name of the (artifacts|workspaces) directory/);
  // Trailing dot, and the lock names.
  await bothRefuse('database named "artifacts." (trailing dot)', base, data, url(join(data, 'artifacts.')), /trailing dot or space/);
  for (const name of ['graphgoblin.lock', 'graphgoblin.lock.reclaim']) await bothRefuse(`database named ${name}`, base, data, url(join(data, name)), /has the name of the reset's lock file/);
  // Inside the reserved directories.
  await bothRefuse('database inside workspaces/', base, data, url(join(data, 'workspaces', 'graphgoblin.db')), /is inside workspaces\/, which a reset removes; move it first/);
});

scenario('a2: database named by the 8.3 short name of artifacts/ or workspaces/', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data);
  for (const name of ['artifacts', 'workspaces']) {
    // Only the leaf is spelled short: the data directory keeps its configured spelling.
    const short = shortPath(join(data, name));
    const leaf = short ? basename(short) : undefined;
    log.line(`short name of ${name}: ${leaf}`);
    if (leaf && leaf !== name) await bothRefuse(`database named ${leaf} (the 8.3 name of ${name}/)`, base, data, url(join(data, leaf)), new RegExp(`has the name of the ${name} directory`));
  }
  // The whole path in short form spells the data directory differently: refused as outside.
  const shortData = shortPath(join(data, 'workspaces'));
  if (shortData) await bothRefuse('database path with the data directory itself in 8.3 form', base, data, url(shortData), /is outside the data directory/);
});

scenario('b1: database path is a directory', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { database: 'store/graphgoblin.db' });
  mkdirSync(join(data, 'graphgoblin.db'));
  writeFileSync(join(data, 'graphgoblin.db', 'inside.txt'), 'a file inside a directory named like the database');
  await bothRefuse('database is a directory', base, data, url(join(data, 'graphgoblin.db')), /graphgoblin\.db is a directory, not a database file; a reset removes only regular database files/);
});

scenario('b2: database path is a junction to an outside folder', async (base) => {
  const data = join(base, 'data');
  const outside = join(base, 'outside');
  await seedDataDir(data, { database: 'store/graphgoblin.db' });
  mkdirSync(outside);
  writeFileSync(join(outside, 'precious.txt'), 'outside: never removed');
  symlinkSync(outside, join(data, 'graphgoblin.db'), 'junction');
  await bothRefuse('database is a junction', base, data, url(join(data, 'graphgoblin.db')), /graphgoblin\.db is a link, not a database file/);
});

scenario('b3: a sidecar is a directory or a junction', async (base) => {
  const data = join(base, 'data');
  const outside = join(base, 'outside');
  await seedDataDir(data);
  mkdirSync(outside);
  writeFileSync(join(outside, 'precious.txt'), 'outside: never removed');
  rmSync(join(data, 'graphgoblin.db-shm'), { force: true });
  symlinkSync(outside, join(data, 'graphgoblin.db-shm'), 'junction');
  await bothRefuse('-shm sidecar is a junction', base, data, url(join(data, 'graphgoblin.db')), /graphgoblin\.db-shm is a link, not a database file/);
  rmSync(join(data, 'graphgoblin.db-shm'));
  mkdirSync(join(data, 'graphgoblin.db-journal'));
  await bothRefuse('-journal sidecar is a directory', base, data, url(join(data, 'graphgoblin.db')), /graphgoblin\.db-journal is a directory, not a database file/);
});

scenario('b4: database path is a Windows AF_UNIX socket file', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { database: 'store/graphgoblin.db' });
  log.line(await socketFile(join(data, 'graphgoblin.db')));
  await bothRefuse('database is an AF_UNIX socket file', base, data, url(join(data, 'graphgoblin.db')));
  log.check(listDir(data).includes('graphgoblin.db'), 'the socket file still exists');
});

scenario('b5: an AF_UNIX socket file elsewhere in the data directory (not the database)', async (base) => {
  const data = join(base, 'data');
  const run = await seedDataDir(data);
  log.line(await socketFile(join(data, 'workspaces', run, 'tool.sock')));
  const dry = await cli(['--reset'], data, {}, { timeoutMs: 60_000 });
  logCli(log, 'socket inside a run workspace (dry run)', ['--reset'], dry);
  log.line(`observed: exit ${dry.code}`);
  const before = await snapshot(base);
  const confirmed = await cli(['--reset', '--yes', '--data-dir', data], data, {}, { timeoutMs: 60_000 });
  logCli(log, 'socket inside a run workspace (confirmed)', ['--reset', '--yes', '--data-dir', data], confirmed);
  log.line(`observed: exit ${confirmed.code}`);
  log.check(confirmed.code === 0, 'a socket file inside a run workspace is removed with the workspace, as ADR-0042 says for special files inside a removed directory', confirmed.code);
  if (confirmed.code !== 0) sameTree(log, 'the refused reset changed nothing', before, await snapshot(base));
  // Node's rmSync cannot lstat the socket either; unlink removes it.
  unlinkSync(join(data, 'workspaces', run, 'tool.sock'));
  log.line(await socketFile(join(data, 'agent.sock')));
  const kept = await cli(['--reset'], data, {}, { timeoutMs: 60_000 });
  logCli(log, 'socket as a kept root entry (dry run)', ['--reset'], kept);
  log.check(kept.code === 0, 'a socket file at the data-directory root is listed under Keeps', kept.code);
  unlinkSync(join(data, 'agent.sock'));
  const after = await cli(['--reset', '--yes', '--data-dir', data], data, {}, { timeoutMs: 60_000 });
  logCli(log, 'confirmed after unlinking the socket files by hand', ['--reset', '--yes', '--data-dir', data], after);
  log.check(after.code === 0, 'with the socket files unlinked by hand the reset completes', after.code);
});

scenario('b6: device names, a stream and a named pipe as the database path', async (base) => {
  const data = join(base, 'data');
  await seedDataDir(data, { database: 'store/graphgoblin.db' });
  await bothRefuse('database is a stream of a file (graphgoblin.db:x)', base, data, url(join(data, 'store', 'graphgoblin.db') + ':x'), /names a stream of a file/);
  const pipeName = `gg-qa-b3-int-pipe-${process.pid}`;
  let connections = 0;
  const server = createServer(() => (connections += 1));
  await new Promise((resolve) => server.listen(`\\\\.\\pipe\\${pipeName}`, resolve));
  for (const spelling of [`file:////./pipe/${pipeName}`, `file://localhost//./pipe/${pipeName}`]) await bothRefuse(`database is a live named pipe (${spelling})`, base, data, spelling, /outside the data directory|does not name a local database file/);
  log.check(connections === 0, 'the reset never connected to the named pipe', connections);
  server.close();
  // Device names: Node reports them as missing inside a directory; observe what the reset does.
  for (const device of ['NUL', 'CON', 'COM1']) {
    const before = await snapshot(base);
    const dry = await cli(['--reset'], data, { GG_DB_URL: url(join(data, device)) }, { timeoutMs: 60_000 });
    logCli(log, `database named ${device} (dry run)`, ['--reset'], dry, `GG_DB_URL=<data>/${device}`);
    log.check(!dry.timedOut, `${device}: the dry run does not block (${dry.ms} ms)`);
    log.check(dry.code === 1 || /no database file/.test(dry.stdout), `${device}: refused, or planned as "no database file" (the device is never opened or removed)`, dry.code);
    sameTree(log, `${device}: no byte changed`, before, await snapshot(base));
  }
});

scenario('b7: database is a hard link to a file outside the data directory (observation)', async (base) => {
  const data = join(base, 'data');
  const outside = join(base, 'outside.db');
  await seedDataDir(data, { database: 'store/graphgoblin.db' });
  await seedStore(outside, { runIds: [], format: 3 });
  linkSync(outside, join(data, 'graphgoblin.db'));
  const outsideHash = fileHash(outside);
  const dry = await cli(['--reset'], data, {}, { timeoutMs: 60_000 });
  logCli(log, 'hard-linked database (dry run)', ['--reset'], dry);
  const confirmed = await cli(['--reset', '--yes', '--data-dir', data], data, {}, { timeoutMs: 60_000 });
  logCli(log, 'hard-linked database (confirmed)', ['--reset', '--yes', '--data-dir', data], confirmed);
  log.line(`observed: exit ${confirmed.code}; data/graphgoblin.db exists: ${existsSync(join(data, 'graphgoblin.db'))}; outside link bytes unchanged: ${fileHash(outside) === outsideHash}`);
  log.check(fileHash(outside) === outsideHash, 'the other hard link (outside the data directory) keeps its bytes');
});

const only = process.argv[2];
for (const [name, fn] of cases) {
  if (only && !name.startsWith(only)) continue;
  log.section(name);
  const base = await makeBase('c10');
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
