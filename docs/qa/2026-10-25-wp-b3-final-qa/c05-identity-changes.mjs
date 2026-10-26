// Check 5: identity changes after planning, through the public CLI. A driver spawns the built
// binary and changes the tree as soon as stdout shows `Removing:` (written immediately before the
// first removal). A large first run workspace keeps the reset busy so the change lands before the
// later targets are reached. Expected: the reset stops, names what changed, exits 1, leaves the
// replacement and unrelated data byte-identical, and a rerun plans afresh.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  Log,
  cli,
  cliWithHook,
  fileHash,
  listDir,
  logCli,
  makeBase,
  sameTree,
  seedStore,
  snapshot,
  writeMany,
} from './lib.mjs';

const log = new Log('c05-identity-changes');
const RUN_A = '01JQAB3INTRUNAAAAAAAAAAAAA';
const RUN_B = '01JQAB3INTRUNBBBBBBBBBBBBB';
const BULK = 3000;

/** Retry a synchronous rename/link while the reset briefly holds handles below it. */
function retry(fn, ms = 15_000) {
  const end = Date.now() + ms;
  let attempts = 0;
  for (;;) {
    try {
      fn();
      return attempts;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code) || Date.now() > end) throw error;
      attempts += 1;
    }
  }
}

/** A format-3 store with two runs: run A has BULK files (slow to remove), run B a few. */
async function seed(dataDir, database = 'graphgoblin.db') {
  mkdirSync(join(dataDir, database, '..'), { recursive: true });
  await seedStore(join(dataDir, database), { runIds: [RUN_A, RUN_B], format: 3 });
  mkdirSync(join(dataDir, 'artifacts', 'text'), { recursive: true });
  writeFileSync(join(dataDir, 'artifacts', 'text', 'a1'), 'artifact one');
  writeFileSync(join(dataDir, 'artifacts', 'text', 'a2'), 'artifact two');
  writeMany(join(dataDir, 'workspaces', RUN_A), BULK);
  writeMany(join(dataDir, 'workspaces', RUN_B), 20);
  writeFileSync(join(dataDir, 'master.key'), Buffer.alloc(32, 9).toString('base64'));
}

/** An unrelated directory: a same-named database and same-named workspace files (decoys). */
function unrelated(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'graphgoblin.db'), 'UNRELATED DATABASE BYTES');
  writeMany(join(dir, 'workspaces', RUN_A), BULK, 'f', (i) => `decoy ${i}\n`);
  writeMany(join(dir, 'workspaces', RUN_B), 20, 'f', (i) => `decoy ${i}\n`);
  mkdirSync(join(dir, 'artifacts', 'text'), { recursive: true });
  writeFileSync(join(dir, 'artifacts', 'text', 'a1'), 'unrelated artifact');
}

const scenarios = [];
const scenario = (name, fn) => scenarios.push([name, fn]);

scenario('5a: the database file replaced by a different file', async (base) => {
  const data = join(base, 'data');
  await seed(data);
  const confirm = ['--reset', '--yes', '--data-dir', data];
  const result = await cliWithHook(confirm, data, {}, () => {
    writeFileSync(join(data, 'replacement.tmp'), 'REPLACEMENT DATABASE BYTES');
    renameSync(join(data, 'replacement.tmp'), join(data, 'graphgoblin.db'));
    return 'renamed a new file over graphgoblin.db';
  });
  logCli(log, '5a', confirm, result);
  log.block('5a timeline', result.timeline.join('\n'));
  log.check(result.code === 1, '5a: exit 1', result.code);
  log.check(result.stderr.includes('Reset stopped: could not remove graphgoblin.db: graphgoblin.db was replaced during the reset'), '5a: names the replaced database');
  log.check(result.stderr.includes(`  Removed:        workspaces/${RUN_A}, workspaces/${RUN_B}, artifacts`) && result.stderr.includes('  Partly removed: graphgoblin.db (0 of 1 entries)') && /Not removed:    graphgoblin\.db-wal, graphgoblin\.db-shm/.test(result.stderr), '5a: removed / partly removed / not removed');
  log.check(readFileSync(join(data, 'graphgoblin.db'), 'utf8') === 'REPLACEMENT DATABASE BYTES', '5a: the replacement is byte-identical');
  log.check(!existsSync(join(data, 'graphgoblin.lock')), '5a: lock released');
  const dry = await cli(['--reset'], data);
  logCli(log, '5a rerun (dry run)', ['--reset'], dry);
  // The leftover WAL still holds page 1 of the old store, so SQLite reads the copy as format 3.
  log.check(dry.code === 0 && /graphgoblin\.db\s+database\s+1 file, 26 B/.test(dry.stdout), '5a: a rerun plans afresh: it lists the 26-byte replacement as the database');
  const rerun = await cli(confirm, data);
  logCli(log, '5a rerun (confirmed)', confirm, rerun);
  log.check(rerun.code === 0 && rerun.stdout.includes('Reset complete.'), '5a: confirmed rerun completes', rerun.code);
});

scenario('5b: the data directory renamed away and a junction to an unrelated store put in its place', async (base) => {
  const data = join(base, 'data');
  const moved = join(base, 'data-moved');
  const other = join(base, 'unrelated');
  await seed(data);
  unrelated(other);
  const otherBefore = await snapshot(other);
  const confirm = ['--reset', '--yes', '--data-dir', data];
  const result = await cliWithHook(confirm, data, {}, () => {
    const attempts = retry(() => renameSync(data, moved));
    symlinkSync(other, data, 'junction');
    return `renamed data -> data-moved after ${attempts} retries; junction data -> unrelated`;
  });
  logCli(log, '5b', confirm, result);
  log.block('5b timeline', result.timeline.join('\n'));
  log.check(result.code === 1, '5b: exit 1', result.code);
  // Depending on where the swap lands in the check sequence, the first failing check is the root
  // (now a link), or a deeper ancestor or entry (missing in the gap between rename and junction,
  // or a different identity when resolved through the junction).
  log.check(/Reset stopped: could not remove .*: (data-directory root|ancestor \S+|\S+) (is now a link during the reset|was moved or removed during the reset|was replaced during the reset|changed from a \w+ to a \w+ during the reset)/.test(result.stderr), '5b: names a changed path on the route (root, ancestor or entry)');
  sameTree(log, '5b: the unrelated store (database and same-named decoy files) is byte-identical', otherBefore, await snapshot(other));
  log.check(fileHash(join(moved, 'graphgoblin.db')) !== 'missing', '5b: the original database (moved away) still exists');
  log.line(`5b: moved-away workspaces: ${JSON.stringify(listDir(join(moved, 'workspaces')))}; files left in run A: ${listDir(join(moved, 'workspaces', RUN_A)).length}`);
  unlinkSync(data);
  renameSync(moved, data);
  const rerun = await cli(confirm, data);
  logCli(log, '5b rerun after restoring the directory', confirm, rerun);
  log.check(rerun.code === 0 && rerun.stdout.includes('Reset complete.'), '5b: rerun plans afresh and completes', rerun.code);
  sameTree(log, '5b: the unrelated store is still byte-identical after the rerun', otherBefore, await snapshot(other));
});

scenario('5c: the kept folder of a database configured in a subfolder replaced by another folder', async (base) => {
  const data = join(base, 'data');
  await seed(data, 'db/graphgoblin.db');
  const env = { GG_DB_URL: `file:${join(data, 'db', 'graphgoblin.db').replaceAll('\\', '/')}` };
  const confirm = ['--reset', '--yes', '--data-dir', data];
  const result = await cliWithHook(confirm, data, env, () => {
    renameSync(join(data, 'db'), join(data, 'db-moved'));
    mkdirSync(join(data, 'db'));
    writeFileSync(join(data, 'db', 'graphgoblin.db'), 'REPLACEMENT IN A NEW FOLDER');
    writeFileSync(join(data, 'db', 'graphgoblin.db-wal'), 'REPLACEMENT WAL');
    return 'renamed db -> db-moved; new db/ with a same-named database and WAL';
  });
  logCli(log, '5c', confirm, result, 'GG_DB_URL=<data>/db/graphgoblin.db');
  log.block('5c timeline', result.timeline.join('\n'));
  log.check(result.code === 1, '5c: exit 1', result.code);
  log.check(result.stderr.includes('Reset stopped: could not remove db/graphgoblin.db: db/graphgoblin.db: ancestor db was replaced during the reset'), '5c: names the replaced ancestor');
  log.check(readFileSync(join(data, 'db', 'graphgoblin.db'), 'utf8') === 'REPLACEMENT IN A NEW FOLDER' && readFileSync(join(data, 'db', 'graphgoblin.db-wal'), 'utf8') === 'REPLACEMENT WAL', '5c: the replacement database and WAL are byte-identical');
  log.check(fileHash(join(data, 'db-moved', 'graphgoblin.db')) !== 'missing', '5c: the original database in the moved folder is untouched');
  const dry = await cli(['--reset'], data, env);
  logCli(log, '5c rerun (dry run)', ['--reset'], dry);
  log.check(dry.code === 0 && /db\/graphgoblin\.db\s+database\s+1 file, 27 B/.test(dry.stdout) && /\n  db-moved\s+not part of the store/.test(dry.stdout), '5c: a rerun plans afresh (lists the replacement; keeps db-moved)');
  rmSync(join(data, 'db'), { recursive: true });
  renameSync(join(data, 'db-moved'), join(data, 'db'));
  const rerun = await cli(confirm, data, env);
  logCli(log, '5c rerun after restoring the folder', confirm, rerun);
  log.check(rerun.code === 0 && rerun.stdout.includes('Reset complete.') && !existsSync(join(data, 'db', 'graphgoblin.db')), '5c: rerun completes and removes the original database', rerun.code);
  log.check(existsSync(join(data, 'db')), '5c: the kept db folder itself stays');
});

scenario('5d: the kept database folder replaced by a junction to an unrelated folder with a same-named database', async (base) => {
  const data = join(base, 'data');
  const other = join(base, 'unrelated-db');
  await seed(data, 'db/graphgoblin.db');
  mkdirSync(other);
  writeFileSync(join(other, 'graphgoblin.db'), 'UNRELATED DATABASE BYTES');
  writeFileSync(join(other, 'graphgoblin.db-wal'), 'UNRELATED WAL');
  const otherBefore = await snapshot(other);
  const env = { GG_DB_URL: `file:${join(data, 'db', 'graphgoblin.db').replaceAll('\\', '/')}` };
  const confirm = ['--reset', '--yes', '--data-dir', data];
  const result = await cliWithHook(confirm, data, env, () => {
    renameSync(join(data, 'db'), join(data, 'db-moved'));
    symlinkSync(other, join(data, 'db'), 'junction');
    return 'renamed db -> db-moved; junction db -> unrelated-db';
  });
  logCli(log, '5d', confirm, result, 'GG_DB_URL=<data>/db/graphgoblin.db');
  log.block('5d timeline', result.timeline.join('\n'));
  log.check(result.code === 1, '5d: exit 1', result.code);
  log.check(result.stderr.includes('db/graphgoblin.db: ancestor db is now a link during the reset; no longer a physical directory'), '5d: names the ancestor that became a link');
  sameTree(log, '5d: the unrelated folder is byte-identical', otherBefore, await snapshot(other));
});

scenario('5e: a later run workspace replaced by a junction to an unrelated folder with same-named files', async (base) => {
  const data = join(base, 'data');
  const other = join(base, 'unrelated');
  await seed(data);
  unrelated(other);
  const otherBefore = await snapshot(other);
  const confirm = ['--reset', '--yes', '--data-dir', data];
  const result = await cliWithHook(confirm, data, {}, () => {
    renameSync(join(data, 'workspaces', RUN_B), join(data, 'workspaces', `${RUN_B}-moved`));
    symlinkSync(join(other, 'workspaces', RUN_B), join(data, 'workspaces', RUN_B), 'junction');
    return `renamed workspaces/${RUN_B} away; junction to the unrelated decoys`;
  });
  logCli(log, '5e', confirm, result);
  log.block('5e timeline', result.timeline.join('\n'));
  log.check(result.code === 1, '5e: exit 1', result.code);
  log.check(result.stderr.includes(`workspaces/${RUN_B}/f00000.txt: ancestor workspaces/${RUN_B} is now a link during the reset`), '5e: names the run workspace that became a link');
  log.check(result.stderr.includes(`  Removed:        workspaces/${RUN_A}`) && result.stderr.includes(`  Partly removed: workspaces/${RUN_B} (0 of 21 entries)`), '5e: removed / partly removed');
  sameTree(log, '5e: the unrelated decoys are byte-identical', otherBefore, await snapshot(other));
  unlinkSync(join(data, 'workspaces', RUN_B));
  renameSync(join(data, 'workspaces', `${RUN_B}-moved`), join(data, 'workspaces', RUN_B));
  const rerun = await cli(confirm, data);
  logCli(log, '5e rerun after restoring', confirm, rerun);
  log.check(rerun.code === 0 && rerun.stdout.includes('Reset complete.'), '5e: rerun completes', rerun.code);
});

const only = process.argv[2];
for (const [name, fn] of scenarios) {
  if (only && !name.startsWith(only)) continue;
  log.section(name);
  const base = await makeBase('c05');
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
