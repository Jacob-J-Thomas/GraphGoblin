import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { bounded, spawnOwned, windowsEnv } from './resources.mjs';

const ownedNames = ['graphgoblin.db', 'graphgoblin.db-wal', 'graphgoblin.db-shm', 'script-executions.ndjson'];
const program = Buffer.from(String.raw`
$ErrorActionPreference = 'Stop'
$qaHandles = [Collections.Generic.List[IO.FileStream]]::new()
try {
  while ($null -ne ($qaLine = [Console]::In.ReadLine())) {
    $qaFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($qaLine))
    $qaAttributes = [IO.File]::GetAttributes($qaFile)
    if ($qaAttributes -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)) {
      throw "Exclusive-open target must be a regular file: $qaFile"
    }
    $qaHandles.Add([IO.File]::Open($qaFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None))
  }
} finally {
  foreach ($qaHandle in $qaHandles) { $qaHandle.Dispose() }
}
[Console]::Out.WriteLine('qa-exclusive-open-ok ' + $qaHandles.Count)
`, 'utf16le').toString('base64');

async function inventory(evidenceDir, storeDir) {
  assert.equal(await realpath(evidenceDir), evidenceDir);
  assert.equal(await realpath(storeDir), storeDir);
  assert.equal(dirname(storeDir), evidenceDir);
  const paths = [];
  for (const name of (await readdir(storeDir)).sort()) {
    assert.ok(ownedNames.includes(name), 'unexpected owned-store entry: ' + name);
    const path = join(storeDir, name);
    const stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(await realpath(path), path);
    paths.push(path);
  }
  return paths;
}

export async function collectSQLiteHandles() {
  globalThis.gc();
  await setImmediate();
  globalThis.gc();
  await setImmediate();
}

// Only the private copy is writable. Process exit releases the native SQLite handles.
const normalizeSeed = String.raw`
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sqliteFile, sqliteHash, parentId, childId] = process.argv.slice(1);
assert.equal(process.argv.length, 5);
assert.equal(await realpath(sqliteFile), sqliteFile);
assert.equal(createHash('sha256').update(await readFile(sqliteFile)).digest('hex'), sqliteHash);
const stage = process.cwd();
assert.equal(basename(stage), 'history-seed-staging');
assert.equal(await realpath(stage), stage);
const database = join(stage, 'graphgoblin.db');
assert.equal(await realpath(database), database);
const { openDatabase, openReadOnlyDatabaseClient } = await import(pathToFileURL(sqliteFile).href);
const writable = openDatabase({ url: pathToFileURL(database).href });
let checkpoint;
let journalMode;
try {
  const before = await writable.client.execute('PRAGMA main.journal_mode');
  assert.equal(before.rows[0]?.[0], 'wal');
  const result = await writable.client.execute('PRAGMA main.wal_checkpoint(TRUNCATE)');
  assert.equal(result.rows.length, 1);
  const [busy, log, checkpointed] = [result.rows[0][0], result.rows[0][1], result.rows[0][2]];
  checkpoint = { busy, log, checkpointed };
  assert.equal(busy, 0);
  assert.ok(Number.isInteger(log) && log >= 0);
  assert.equal(checkpointed, log);
  const mode = await writable.client.execute('PRAGMA main.journal_mode = DELETE');
  journalMode = mode.rows[0]?.[0];
  assert.equal(journalMode, 'delete');
} finally {
  writable.close();
}
const observer = openReadOnlyDatabaseClient(database);
const witness = [];
try {
  for (const id of [parentId, childId]) {
    const row = await observer.execute({ sql: 'SELECT * FROM runs WHERE id = ?', args: [id] });
    assert.equal(row.rows.length, 1);
    const events = await observer.execute({
      sql: 'SELECT * FROM run_events WHERE run_id = ? ORDER BY seq', args: [id],
    });
    witness.push({ row: { ...row.rows[0] }, events: events.rows.map((event) => ({ ...event })) });
  }
} finally {
  observer.close();
}
process.stdout.write(JSON.stringify({ database, checkpoint, journalMode, witness }) + '\n');
`;

async function hashFile(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function deriveStandaloneSeed(evidenceDir, db, history, receipt, ownChild) {
  const stage = join(evidenceDir, 'history-seed-staging');
  const stagedDb = join(stage, 'graphgoblin.db');
  const bundle = [db, db + '-wal', db + '-shm'];
  const derivation = { stage, inputs: [] };
  receipt.seedDerivation = derivation;
  await mkdir(stage);
  assert.equal(await realpath(stage), stage);
  for (const source of bundle) {
    const copy = join(stage, basename(source));
    const sha256 = await hashFile(source);
    const input = { source, copy, sha256 };
    derivation.inputs.push(input);
    await copyFile(source, copy, constants.COPYFILE_EXCL);
    input.copySha256 = await hashFile(copy);
    assert.equal(input.copySha256, sha256);
  }
  assert.deepEqual(await inventory(evidenceDir, stage), bundle.map((source) => join(stage, basename(source))).sort());

  const [parent, child] = history.witness;
  const processRecords = [];
  const handle = spawnOwned('history-seed-normalization', [
    '--input-type=module', '--eval', normalizeSeed, history.sqliteBinding.file,
    history.sqliteBinding.sha256, parent.row.id, child.row.id,
  ], { cwd: stage, stdio: ['ignore', 'pipe', 'pipe'], env: windowsEnv() }, processRecords);
  derivation.helper = handle.identity;
  ownChild(handle.child);
  handle.child.once('close', () => ownChild(undefined));
  try {
    await bounded('history seed normalization and pipe close', handle.closed, 8000);
  } catch (error) {
    if (handle.child.pid && handle.child.exitCode === null && handle.child.signalCode === null) handle.child.kill();
    try {
      await bounded('history seed helper exit', handle.closed, 2000);
    } catch (cleanupError) {
      derivation.helper.cleanupError = cleanupError;
    }
    throw error;
  }
  assert.equal(handle.identity.error, undefined);
  assert.deepEqual(handle.identity.exit, { code: 0, signal: null });
  assert.deepEqual(handle.identity.close, handle.identity.exit);
  assert.equal(handle.identity.stderr, '');
  const normalized = JSON.parse(handle.identity.stdout);
  assert.equal(normalized.database, stagedDb);
  derivation.checkpoint = normalized.checkpoint;
  derivation.journalMode = normalized.journalMode;
  assert.deepEqual(normalized.witness, history.witness);
  derivation.exactRawWitness = true;
  assert.deepEqual(await inventory(evidenceDir, stage), [stagedDb]);
  for (const { source, sha256 } of derivation.inputs) assert.equal(await hashFile(source), sha256);
  return stagedDb;
}

export async function cleanOwnedStore(evidenceDir, storeDir, receipt, ownChild, history) {
  // Mirror the reviewed #381 cleanup. No sharing-check retry or force-remove.
  await collectSQLiteHandles();
  receipt.collectionPasses = 2;
  const files = await inventory(evidenceDir, storeDir);
  const db = join(storeDir, 'graphgoblin.db');
  assert.ok(files.includes(db));
  receipt.files = files;
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  assert.ok(isAbsolute(systemRoot));
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const requestedAt = new Date().toISOString();
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', program], {
    cwd: storeDir, env: { SystemRoot: systemRoot }, shell: false, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = Promise.withResolvers();
  ownChild(child);
  const probe = { pid: child.pid, requestedAt, executable, stdout: '', stderr: '' };
  receipt.probe = probe;
  child.once('error', (error) => { probe.error = error; });
  child.once('exit', (code, signal) => { probe.exit = { code, signal }; });
  child.once('close', (code, signal) => {
    probe.close = { code, signal };
    ownChild(undefined);
    closed.resolve();
  });
  child.stdout.setEncoding('utf8').on('data', (data) => { probe.stdout = (probe.stdout + data).slice(0, 4096); });
  child.stderr.setEncoding('utf8').on('data', (data) => { probe.stderr = (probe.stderr + data).slice(0, 4096); });
  child.stdin.on('error', (error) => { probe.stdinError = error; });
  child.stdin.end(files.map((file) => Buffer.from(file, 'utf8').toString('base64')).join('\n') + '\n', 'ascii');
  try {
    await bounded('exclusive Windows SQLite open', closed.promise, 8_000);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    try {
      await bounded('exclusive-open helper exit', closed.promise, 2_000);
    } catch (cleanupError) {
      probe.cleanupError = cleanupError;
    }
    throw error;
  }
  assert.deepEqual(probe.exit, { code: 0, signal: null });
  assert.deepEqual(probe.close, probe.exit);
  assert.equal(probe.error, undefined);
  assert.equal(probe.stdinError, undefined);
  assert.equal(probe.stderr, '');
  assert.equal(probe.stdout.trim(), 'qa-exclusive-open-ok ' + files.length);
  assert.deepEqual(await inventory(evidenceDir, storeDir), files);
  if (history) {
    const historySeedDir = history.directory;
    assert.equal(historySeedDir, join(evidenceDir, 'private-history-seed'));
    assert.equal(await realpath(historySeedDir), historySeedDir);
    assert.deepEqual(await readdir(historySeedDir), []);
    const hasWal = files.includes(db + '-wal');
    const hasShm = files.includes(db + '-shm');
    assert.equal(hasWal, hasShm, 'Historical seed requires a standalone database or a complete WAL bundle');
    const source = hasWal ? await deriveStandaloneSeed(evidenceDir, db, history, receipt, ownChild) : db;
    const target = join(historySeedDir, 'graphgoblin.db');
    await copyFile(source, target, constants.COPYFILE_EXCL);
    const hash = await hashFile(source);
    assert.equal(await hashFile(target), hash);
    assert.deepEqual(await readdir(historySeedDir), ['graphgoblin.db']);
    if (hasWal) {
      const derivation = receipt.seedDerivation;
      derivation.normalizedSha256 = hash;
      await unlink(source);
      assert.deepEqual(await readdir(derivation.stage), []);
      derivation.stageEmpty = true;
    }
    receipt.seed = { database: target, sha256: hash, sidecars: [] };
  }
  for (const file of files) await unlink(file);
  assert.deepEqual(await readdir(storeDir), []);
  receipt.empty = true;
}
