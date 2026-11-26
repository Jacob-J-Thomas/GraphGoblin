// Controlled QA for #538 refusal branches that a real NTFS volume does not produce on demand. Drives
// the BUILT public `runResetCli` (apps/api/dist/reset/reset.js) in-process with the real default
// private-copy store reader, real disposable files and real hard links. Exactly one filesystem query
// is controlled per case and labelled: the native final path (fs.realpathSync.native) for one path,
// or an lstat alias for a simulated short name (no 8.3 support is assumed or changed).
// Usage: node qa-538-controlled.mjs <worktree> <runRoot> <seedFormat3Dir> <outJson>
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { release } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [worktree, runRoot, seedDir, outJson] = process.argv.slice(2).map((p) => resolve(p));
const { runResetCli } = await import(pathToFileURL(join(worktree, 'apps/api/dist/reset/reset.js')).href);
const { readStoreFacts } = await import(pathToFileURL(join(worktree, 'apps/api/dist/reset/store-facts.js')).href);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const SEED_DB = join(seedDir, 'graphgoblin.db');
const SEED_WAL = SEED_DB + '-wal';
const RUN = '01JRESETRUNAAAAAAAAAAAAAAA';
const UNCHANGED = 'Nothing in the data directory was changed.\n';
const DEAD = (token) => JSON.stringify({ pid: 2147483644, token });
const realNative = fs.realpathSync.native;
const realLstat = fs.promises.lstat;

function controlNative(path, answer) {
  fs.realpathSync.native = (queried, options) =>
    resolve(String(queried)) === path ? answer() : realNative(queried, options);
}
function controlLstat(map) {
  fs.promises.lstat = (p, o) => realLstat(map.get(resolve(String(p))) ?? p, o);
  syncBuiltinESMExports();
}
function restore() {
  fs.realpathSync.native = realNative;
  fs.promises.lstat = realLstat;
  syncBuiltinESMExports();
}

async function snapshot(root, prefix = '') {
  const out = {};
  for (const name of (await readdir(root)).sort()) {
    const full = join(root, name);
    const st = await lstat(full, { bigint: true });
    const rel = prefix + name;
    const id = `${st.dev}:${st.ino}`;
    if (st.isDirectory()) {
      out[rel] = { kind: 'dir', id };
      Object.assign(out, await snapshot(full, rel + '/'));
    } else out[rel] = { kind: st.isFile() ? 'file' : 'other', id, nlink: String(st.nlink), sha256: st.isFile() ? sha(await readFile(full)) : null };
  }
  return out;
}
async function cli(dataDir, dbFile, argv, readStore) {
  let out = '';
  let err = '';
  const code = await runResetCli({
    argv,
    env: { ...process.env, GG_DATA_DIR: dataDir, GG_DB_URL: pathToFileURL(dbFile).href },
    readStore,
    write: (t) => (out += t),
    writeError: (t) => (err += t),
  });
  return { argv, code, stdout: out, stderr: err };
}

async function spelledStore(dataDir, alias = '00-unrelated') {
  await mkdir(dataDir, { recursive: true });
  await copyFile(SEED_DB, join(dataDir, 'graphgoblin.db'));
  await copyFile(SEED_WAL, join(dataDir, 'GRAPHGOBLIN.DB-WAL'));
  await link(join(dataDir, 'GRAPHGOBLIN.DB-WAL'), join(dataDir, alias));
  await mkdir(join(dataDir, 'workspaces', RUN), { recursive: true });
  await writeFile(join(dataDir, 'workspaces', RUN, 'sentinel.txt'), 'owned run');
  await writeFile(join(dataDir, 'notes.txt'), 'owner notes');
  return join(dataDir, 'graphgoblin.db');
}

const results = [];
async function run(id, description, fn) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });
  const record = { id, description, calls: [] };
  try {
    await fn({ check, record });
  } catch (error) {
    check('case ran without throwing', false, String(error?.stack ?? error));
  } finally {
    restore();
  }
  results.push({ ...record, pass: checks.every((c) => c.ok), checks });
}
const counting = () => {
  const reads = [];
  return { reads, readStore: (file) => (reads.push(file), readStoreFacts(file)) };
};
const ambiguity = (detail) =>
  `reset refused: the data directory lists graphgoblin.db-wal under more than one name (00-unrelated, GRAPHGOBLIN.DB-WAL), and ${detail}; verify that no GraphGoblin process uses this store, then move the other names yourself\n`;

// C0: control. With the real native query the same fixture succeeds (dry run), naming the WAL.
await run('C0-native-control', 'same fixture as C1-C4, real native final path: dry run removes GRAPHGOBLIN.DB-WAL', async ({ check, record }) => {
  const dataDir = join(runRoot, 'C0');
  const db = await spelledStore(dataDir);
  const answers = [];
  fs.realpathSync.native = (q, o) => {
    const r = realNative(q, o);
    answers.push([String(q), r]);
    return r;
  };
  const before = await snapshot(dataDir);
  const dry = await cli(dataDir, db, ['--reset'], undefined);
  record.calls.push(dry);
  record.nativeAnswers = answers;
  check('dry exit 0', dry.code === 0 && dry.stderr === '', dry);
  check('Removes the listed WAL', /\n {2}GRAPHGOBLIN\.DB-WAL +SQLite write-ahead log/.test(dry.stdout), {});
  check('Keeps 00-unrelated as another name', dry.stdout.includes('another name for GRAPHGOBLIN.DB-WAL; the file stays under this name'), {});
  check('real native answer for graphgoblin.db-wal is GRAPHGOBLIN.DB-WAL', answers.some(([q, r]) => q === join(dataDir, 'graphgoblin.db-wal') && r === join(dataDir, 'GRAPHGOBLIN.DB-WAL')), answers);
  check('dry run changed nothing', JSON.stringify(before) === JSON.stringify(await snapshot(dataDir)), {});
});

// C1-C4: controlled native answers refuse before the store is read, in dry and confirmed runs.
for (const [id, label, answer, detail] of [
  ['C1-native-other-directory', 'another directory', (d) => () => join(d, '..', 'elsewhere', 'GRAPHGOBLIN.DB-WAL'), (d) => `the filesystem names ${join(d, '..', 'elsewhere', 'GRAPHGOBLIN.DB-WAL')}, which is not one of them`],
  ['C2-native-unlisted-name', 'an unlisted name', (d) => () => join(d, 'graphgoblin.db-wal'), (d) => `the filesystem names ${join(d, 'graphgoblin.db-wal')}, which is not one of them`],
  ['C3-native-EPERM', 'EPERM', () => () => { throw Object.assign(new Error('EPERM: operation not permitted, realpath'), { code: 'EPERM' }); }, () => 'the filesystem could not say which one SQLite opens (EPERM: operation not permitted, realpath)'],
  ['C4-native-ENOENT', 'ENOENT after presence', () => () => { throw Object.assign(new Error('ENOENT: no such file or directory, realpath'), { code: 'ENOENT' }); }, () => 'the filesystem could not say which one SQLite opens (ENOENT: no such file or directory, realpath)'],
])
  await run(id, `native final path answers ${label}: refuse, store not read, nothing changed`, async ({ check, record }) => {
    const dataDir = join(runRoot, id);
    const db = await spelledStore(dataDir);
    controlNative(join(dataDir, 'graphgoblin.db-wal'), answer(dataDir));
    const before = await snapshot(dataDir);
    const { reads, readStore } = counting();
    for (const argv of [['--reset'], ['--reset', '--yes', '--data-dir', dataDir]]) {
      const call = await cli(dataDir, db, argv, readStore);
      record.calls.push(call);
      const want = ambiguity(detail(dataDir)) + UNCHANGED;
      check(`${argv.length === 1 ? 'dry' : 'confirmed'} refusal exact`, call.code === 1 && call.stdout === '' && call.stderr === want, { got: call, want });
      check(`${argv.length === 1 ? 'dry' : 'confirmed'} changed nothing`, JSON.stringify(before) === JSON.stringify(await snapshot(dataDir)), {});
    }
    check('store never read', reads.length === 0, reads);
  });

// C5-C6: ambiguity first seen under the locks (after the preview read): refuse, release the locks.
for (const stale of [false, true])
  await run(`C${stale ? 6 : 5}-locked-replan-ambiguity${stale ? '-stale-locks' : ''}`, `native answer turns unusable after the preview's store read${stale ? '; stale dead-PID lock files present' : ''}`, async ({ check, record }) => {
    const dataDir = join(runRoot, `C${stale ? 6 : 5}`);
    const db = await spelledStore(dataDir);
    if (stale) {
      await writeFile(join(dataDir, 'graphgoblin.lock'), DEAD('qa stale dir'));
      await writeFile(join(dataDir, 'graphgoblin.db.graphgoblin.lock'), DEAD('qa stale db'));
    }
    const before = await snapshot(dataDir);
    const reads = [];
    const call = await cli(dataDir, db, ['--reset', '--yes', '--data-dir', dataDir], async (file) => {
      reads.push(file);
      const facts = await readStoreFacts(file);
      if (reads.length === 1) controlNative(join(dataDir, 'graphgoblin.db-wal'), () => join(dataDir, 'graphgoblin.db-wal'));
      return facts;
    });
    record.calls.push(call);
    const want =
      ambiguity(`the filesystem names ${join(dataDir, 'graphgoblin.db-wal')}, which is not one of them`) +
      (stale
        ? ['No store data was removed. Lock files and guards:', '  reclaimed stale graphgoblin.db.graphgoblin.lock (database lock)', '  reclaimed stale graphgoblin.lock (data-directory lock)', '  removed graphgoblin.db.graphgoblin.lock (database lock)', '  removed graphgoblin.lock (data-directory lock)', ''].join('\n')
        : UNCHANGED);
    check('refusal exact, no Removing marker', call.code === 1 && call.stdout === '' && call.stderr === want, { got: call, want });
    check('store read once (preview only)', reads.length === 1, reads);
    const after = await snapshot(dataDir);
    const expected = Object.fromEntries(Object.entries(before).filter(([p]) => !stale || !['graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock'].includes(p)));
    check('only the stale locks are gone; store bytes, ids and the other link unchanged', JSON.stringify(after) === JSON.stringify(expected), { before, after });
  });

// C7-C11: configured short-name spelling (controlled lstat alias) vs the listed name.
const SHORT = 'GRAPHG~1.DB';
async function shortStore(id, files, aliases = []) {
  const dataDir = join(runRoot, id);
  await mkdir(dataDir, { recursive: true });
  await copyFile(SEED_DB, join(dataDir, 'graphgoblin.db'));
  await writeFile(join(dataDir, 'notes.txt'), 'owner notes');
  for (const [name, content] of Object.entries(files)) {
    if (content.startsWith('@link:')) await link(join(dataDir, content.slice(6)), join(dataDir, name));
    else if (content === '@seedwal') await copyFile(SEED_WAL, join(dataDir, name));
    else await writeFile(join(dataDir, name), content);
  }
  controlLstat(new Map([[SHORT, 'graphgoblin.db'], ...aliases].map(([a, b]) => [join(dataDir, a), join(dataDir, b)])));
  return { dataDir, db: join(dataDir, SHORT) };
}
const shortRefusal = (writer, stored) =>
  `reset refused: the database is configured as ${SHORT} but listed as graphgoblin.db, and ${writer} while ${stored}; a reset cannot tell which SQLite write-ahead log belongs to this store, so configure GG_DB_URL with the name as the directory lists it\n${UNCHANGED}`;
for (const [id, files, writer, stored] of [
  ['C7-short-writer-only', { [`${SHORT}-wal`]: '@seedwal' }, `${SHORT}-wal names the listed entry ${SHORT}-wal`, 'graphgoblin.db-wal names no entry'],
  ['C8-short-reader-only', { 'graphgoblin.db-wal': '@seedwal' }, `${SHORT}-wal names no entry`, 'graphgoblin.db-wal names the listed entry graphgoblin.db-wal'],
  ['C9-short-two-files', { 'graphgoblin.db-wal': '@seedwal', [`${SHORT}-wal`]: 'writer bytes' }, `${SHORT}-wal names the listed entry ${SHORT}-wal`, 'graphgoblin.db-wal names the listed entry graphgoblin.db-wal'],
  ['C10-short-two-hard-links', { 'graphgoblin.db-wal': '@seedwal', [`${SHORT}-wal`]: '@link:graphgoblin.db-wal' }, `${SHORT}-wal names the listed entry ${SHORT}-wal`, 'graphgoblin.db-wal names the listed entry graphgoblin.db-wal'],
])
  await run(id, `configured ${SHORT} vs listed graphgoblin.db: refuse before the store read`, async ({ check, record }) => {
    const { dataDir, db } = await shortStore(id, files);
    const before = await snapshot(dataDir);
    const { reads, readStore } = counting();
    for (const argv of [['--reset'], ['--reset', '--yes', '--data-dir', dataDir]]) {
      const call = await cli(dataDir, db, argv, readStore);
      record.calls.push(call);
      const want = shortRefusal(writer, stored);
      check(`${argv.length === 1 ? 'dry' : 'confirmed'} refusal exact`, call.code === 1 && call.stdout === '' && call.stderr === want, { got: call, want });
      check(`${argv.length === 1 ? 'dry' : 'confirmed'} changed nothing`, JSON.stringify(before) === JSON.stringify(await snapshot(dataDir)), {});
    }
    check('store never read', reads.length === 0, reads);
  });
await run('C11-short-agree', `configured ${SHORT}-wal and listed graphgoblin.db-wal name one entry: proceeds, reads the stored spelling`, async ({ check, record }) => {
  const { dataDir, db } = await shortStore('C11-short-agree', { 'graphgoblin.db-wal': '@seedwal' }, [[`${SHORT}-wal`, 'graphgoblin.db-wal']]);
  const before = await snapshot(dataDir);
  const { reads, readStore } = counting();
  const dry = await cli(dataDir, db, ['--reset'], readStore);
  record.calls.push(dry);
  check('dry exit 0', dry.code === 0 && dry.stderr === '', dry);
  check('Removes the listed WAL', /\n {2}graphgoblin\.db-wal +SQLite write-ahead log/.test(dry.stdout), {});
  check('store read under the stored spelling', reads.length === 1 && reads[0] === join(dataDir, 'graphgoblin.db'), reads);
  check('read format 3', dry.stdout.includes('(format 3; this build requires format 4)'), {});
  check('dry run changed nothing', JSON.stringify(before) === JSON.stringify(await snapshot(dataDir)), {});
});

const evidence = { platform: process.platform, osRelease: release(), node: process.version, runRoot, summary: results.map((r) => ({ id: r.id, pass: r.pass, failed: r.checks.filter((c) => !c.ok).map((c) => c.name) })), results };
await writeFile(outJson, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
const failed = results.filter((r) => !r.pass);
process.stdout.write(JSON.stringify({ cases: results.length, passed: results.length - failed.length, failed: failed.map((r) => r.id) }) + '\n');
if (failed.length) process.exitCode = 1;
