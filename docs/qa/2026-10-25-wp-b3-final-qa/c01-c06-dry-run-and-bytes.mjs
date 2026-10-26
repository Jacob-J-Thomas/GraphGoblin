// Checks 1 and 6: a populated current store made by the built API (a loop, two runs through the
// disposable fake Codex CLI), then a dry run that must change no byte, then the confirmed reset,
// which must keep master.key and every non-run entry byte-identical and remove links as links.
import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Log,
  call,
  cli,
  createLoopAndRuns,
  fakeCodex,
  fileHash,
  inspectStore,
  isLink,
  listDir,
  logCli,
  logSnapshot,
  makeBase,
  readlinkOr,
  sameTree,
  snapshot,
  startApi,
  stopApi,
  treeHash,
} from './lib.mjs';

const log = new Log('c01-c06-dry-run-and-bytes');
const base = await makeBase('c01');
const data = join(base, 'data');
const outsideRepo = join(base, 'outside-repo');
const outsideNotes = join(base, 'outside-notes');
const outsideRun = join(base, 'outside-run2');
log.line(`base: ${base}`);

try {
  const codex = await fakeCodex();
  log.section('Populate a current store through the built API (port 6340)');
  const api = await startApi(data, 6340, { GG_CODEX_BINARY: codex });
  log.check(!api.failed, 'API starts on an empty data directory', api.stderr);
  const { runIds } = await createLoopAndRuns(log, api, 2);
  const runs = await call(api, 'GET', '/runs');
  log.line(`runs: ${JSON.stringify(runs.body.items?.map((r) => [r.id, r.status]) ?? runs.body)}`);
  const stopCode = await stopApi(api);
  log.check(stopCode === 0, 'API drains and exits 0', stopCode);
  log.line(`data directory after the API stopped: ${JSON.stringify(listDir(data))}`);
  log.line(`workspaces: ${JSON.stringify(listDir(join(data, 'workspaces')))}`);
  log.line(`artifacts: ${JSON.stringify(listDir(join(data, 'artifacts')))}`);
  const store = await inspectStore(join(data, 'graphgoblin.db'));
  log.line(`store marker: ${JSON.stringify(store.marker)}; runs ${store.runs}; loops ${store.loops}`);

  // Non-run entries and links the reset must keep or remove as links.
  log.section('Add non-run entries and links');
  mkdirSync(join(outsideRepo, 'src'), { recursive: true });
  writeFileSync(join(outsideRepo, 'src', 'precious.txt'), 'outside repository: never removed');
  mkdirSync(outsideNotes, { recursive: true });
  writeFileSync(join(outsideNotes, 'notes.md'), 'outside notes: never removed');
  mkdirSync(outsideRun, { recursive: true });
  writeFileSync(join(outsideRun, 'linked-run.txt'), 'outside run workspace target: never removed');
  const [run1, run2] = runIds;
  mkdirSync(join(data, 'workspaces', run1, 'src'), { recursive: true });
  writeFileSync(join(data, 'workspaces', run1, 'src', 'out.txt'), 'run output');
  symlinkSync(outsideRepo, join(data, 'workspaces', run1, 'repo'), 'junction');
  // Run 2's whole workspace is a junction named by the stored run ID.
  rmSync(join(data, 'workspaces', run2), { recursive: true, force: true });
  symlinkSync(outsideRun, join(data, 'workspaces', run2), 'junction');
  mkdirSync(join(data, 'workspaces', 'my-notes'), { recursive: true });
  writeFileSync(join(data, 'workspaces', 'my-notes', 'keep.txt'), 'user directory under workspaces');
  symlinkSync(outsideNotes, join(data, 'workspaces', 'linked-notes'), 'junction');
  writeFileSync(join(data, 'notes.txt'), 'a user file at the root');
  mkdirSync(join(data, 'user-folder'), { recursive: true });
  writeFileSync(join(data, 'user-folder', 'a.txt'), 'a user folder at the root');
  const masterKey = fileHash(join(data, 'master.key'));
  log.line(`master.key sha256 ${masterKey}`);

  const before = await snapshot(base);
  logSnapshot(log, 'tree before the dry run', before);

  log.section('Check 1: dry run without --data-dir, then with --data-dir');
  const dry = await cli(['--reset'], data);
  logCli(log, 'dry run', ['--reset'], dry, `GG_DATA_DIR=${data}`);
  log.check(dry.code === 0, 'dry run exits 0', dry.code);
  sameTree(log, 'dry run changes no byte (sha256, size, mtime, inode of every entry incl. directories)', before, await snapshot(base));
  const dry2 = await cli(['--reset', '--data-dir', data], data);
  logCli(log, 'dry run with --data-dir', ['--reset', '--data-dir', data], dry2);
  log.check(dry2.code === 0, 'dry run with --data-dir exits 0', dry2.code);
  const afterDry = await snapshot(base);
  sameTree(log, 'second dry run changes no byte', before, afterDry);
  log.line(`tree hash before ${treeHash(before)}; after ${treeHash(afterDry)}`);

  const out = dry.stdout;
  const removes = out.slice(out.indexOf('Removes:'), out.indexOf('Keeps:'));
  const keeps = out.slice(out.indexOf('Keeps:'), out.indexOf('Total removed'));
  for (const id of runIds)
    log.check(new RegExp(`workspaces/${id}\\s+run workspace`).test(removes), `manifest removes run workspace ${id}`);
  log.check(/workspaces\/[^\n]*run workspace\s+0 files, 1 link/.test(removes), 'the junction run workspace is listed as one link');
  log.check(/\n\s+artifacts\s+artifacts/.test(removes), 'manifest removes artifacts');
  log.check(/graphgoblin\.db\s+database/.test(removes), 'manifest removes the database');
  for (const [suffix, what] of [['-wal', 'SQLite write-ahead log'], ['-shm', 'SQLite shared memory'], ['-journal', 'SQLite rollback journal']]) {
    const exists = listDir(data).includes(`graphgoblin.db${suffix}`);
    log.check(new RegExp(`graphgoblin\\.db${suffix}\\s+${what}`).test(removes) === exists, `manifest lists graphgoblin.db${suffix} exactly when it exists`, { exists });
  }
  const removeLines = removes.split('\n').filter((l) => l.startsWith('  '));
  log.check(/graphgoblin\.lock\s+the reset's own lock\s+removed last, on release/.test(removeLines.at(-1) ?? ''), 'the lock is the last Removes line', removeLines.at(-1));
  for (const kept of ['master.key', 'notes.txt', 'user-folder', 'workspaces/my-notes', 'workspaces/linked-notes'])
    log.check(new RegExp(`\\n  ${kept.replace('.', '\\.')}\\s`).test(keeps), `manifest keeps ${kept}`);
  log.check(/master\.key\s+secret-store key/.test(keeps), 'master.key is kept as the secret-store key');
  log.check(!/workspaces\/(01|[0-9A-Z]{26})\s/.test(keeps.replace(/workspaces\/my-notes|workspaces\/linked-notes/g, '')), 'no run workspace is under Keeps');
  log.check(dry.stdout.includes(`node apps/api/dist/main.js --reset --yes --data-dir "${data}"`), 'dry run prints the confirmed command naming the data directory');

  log.section('Check 6: confirmed reset, then byte preservation');
  const confirmed = await cli(['--reset', '--yes', '--data-dir', data], data);
  logCli(log, 'confirmed reset', ['--reset', '--yes', '--data-dir', data], confirmed);
  log.check(confirmed.code === 0, 'confirmed reset exits 0', confirmed.code);
  log.check(confirmed.stdout.includes('Reset complete.'), 'prints Reset complete.');
  const after = await snapshot(base);
  logSnapshot(log, 'tree after the confirmed reset', after);
  log.check(fileHash(join(data, 'master.key')) === masterKey, 'master.key is byte-identical');
  // Every entry that is not part of the store keeps its record (content, size, mtime, inode).
  const keptPrefixes = ['data/master.key', 'data/notes.txt', 'data/user-folder', 'data/workspaces/my-notes', 'data/workspaces/linked-notes', 'outside-'];
  const keptBefore = before.filter((r) => keptPrefixes.some((p) => r.slice(2).startsWith(p)));
  const keptAfter = after.filter((r) => keptPrefixes.some((p) => r.slice(2).startsWith(p)));
  sameTree(log, 'every kept entry and every link target is byte-identical (records incl. mtime and inode)', keptBefore, keptAfter);
  log.check(isLink(join(data, 'workspaces', 'linked-notes')) && readlinkOr(join(data, 'workspaces', 'linked-notes')).includes('outside-notes'), 'kept junction workspaces/linked-notes still points at its target');
  log.check(!listDir(join(data, 'workspaces')).includes(run1) && !listDir(join(data, 'workspaces')).includes(run2), 'both run workspaces are gone (the junction one as a link)');
  log.check(fileHash(join(outsideRepo, 'src', 'precious.txt')) !== 'missing' && fileHash(join(outsideRun, 'linked-run.txt')) !== 'missing', 'the junction targets still hold their files');
  log.line(`data directory after reset: ${JSON.stringify(listDir(data))}`);
  log.check(JSON.stringify(listDir(data)) === JSON.stringify(['master.key', 'notes.txt', 'user-folder', 'workspaces']), 'only kept entries remain at the root');

  log.section('Fresh start after the reset (port 6340)');
  const fresh = await startApi(data, 6340, { GG_CODEX_BINARY: codex });
  log.check(!fresh.failed, 'API starts on the reset directory', fresh.stderr);
  const loops = await call(fresh, 'GET', '/loops');
  log.line(`GET /loops -> ${loops.status} ${JSON.stringify(loops.body).slice(0, 200)}`);
  log.check(loops.status === 200 && (loops.body.items ?? loops.body).length === 0, 'fresh store has no loops');
  log.check((await stopApi(fresh)) === 0, 'fresh API drains and exits 0');
  log.check(fileHash(join(data, 'master.key')) === masterKey, 'master.key reused unchanged by the fresh store');
  const freshStore = await inspectStore(join(data, 'graphgoblin.db'));
  log.line(`fresh store marker: ${JSON.stringify(freshStore.marker)}; runs ${freshStore.runs}; loops ${freshStore.loops}`);
} catch (error) {
  log.check(false, 'script error', error.stack);
} finally {
  log.save();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
