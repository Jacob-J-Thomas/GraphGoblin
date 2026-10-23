// Public SQLite components, actual main SQL, persisted close/reopen, no provider or app.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  openDatabase,
  initializeFreshDatabase,
  SqliteLoopRepository,
  SqliteTriggerAdmission,
  SqliteEventStore,
} from '../../../packages/infrastructure/dist/sqlite/index.js';
import { LoopDefinitionSchema } from '../../../packages/contracts/dist/index.js';
import { fakeUlid, minimalLoop, FIXTURE_TS } from '../../../packages/contracts/dist/testing/index.js';
import { createInitialThread } from '../../../packages/engine/dist/index.js';
import { FakeClock, FakeIds } from '../../../packages/engine/dist/testing/index.js';

const repo = resolve(import.meta.dirname, '../../..');
const main = execFileSync('git', ['rev-parse', 'MERGE_HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const folder = await mkdtemp(join(tmpdir(), 'gg-wp-f3-round4-sql-'));
await mkdir(join(folder, 'meta'));
const databaseFile = join(tmpdir(), `gg-wp-f3-round4-${randomUUID()}.db`);
const url = 'file:' + databaseFile.replaceAll('\\', '/');
const fixtureFiles = [];
let database;
const result = { main, evidence: 'Real disk SQLite using public components and main SQL; not a main app build.', checks: [], cleanup: {} };
try {
  const journal = JSON.parse(execFileSync('git', ['show', 'MERGE_HEAD:packages/infrastructure/drizzle/meta/_journal.json'], { cwd: repo, encoding: 'utf8' }));
  assert.equal(journal.entries.at(-1).tag, '0016_loop_owner_history');
  for (const name of ['meta/_journal.json', ...journal.entries.map((entry) => entry.tag + '.sql')]) {
    const target = join(folder, name);
    await writeFile(target, execFileSync('git', ['show', 'MERGE_HEAD:packages/infrastructure/drizzle/' + name], { cwd: repo }));
    fixtureFiles.push(target);
  }
  database = openDatabase({ url });
  await initializeFreshDatabase(database.client, folder);
  const before = (await database.client.execute('SELECT * FROM __drizzle_migrations ORDER BY created_at')).rows;
  assert.equal(before.length, 17);
  assert.equal(await database.pendingMigrations(), 1);
  const clock = new FakeClock();
  const loops = new SqliteLoopRepository(database.db, clock, new FakeIds());
  const events = new SqliteEventStore(database.db, clock);
  const admission = new SqliteTriggerAdmission(database.db, events);
  const expected = [];
  for (const [label, visits, deadline] of [['omitted', undefined, undefined], ['finite', 4, 5], ['unlimited', null, null]]) {
    const definition = LoopDefinitionSchema.parse({ ...minimalLoop(), name: 'Round 4 ' + label });
    if (visits !== undefined) definition.settings.maxNodeVisits = visits;
    if (deadline !== undefined) definition.settings.runDeadlineSeconds = deadline;
    const { draft } = await loops.create('local', definition);
    const limits = { maxNodeVisits: visits === undefined ? 10 : visits, runDeadlineSeconds: deadline === undefined ? null : deadline };
    const pinned = { source: 'published', version: draft.version, name: definition.name, label: definition.name + ' v1', defaults: { owner: { byHarness: {} }, process: { byHarness: {} } }, classifiers: {}, limits };
    const run = { id: fakeUlid('r4-run-' + label), ownerId: 'local', loopId: draft.loopId, versionId: draft.id, pinned, invocationId: fakeUlid('r4-invocation-' + label), status: 'queued', iteration: 1, createdAt: FIXTURE_TS, lastEventSeq: 0 };
    const initialThread = createInitialThread({ runId: run.id, loopId: run.loopId, versionId: run.versionId, invocation: { id: run.invocationId, source: 'manual.api', trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS } } });
    const intent = { run, initialThread, pinnedLoopIds: [run.loopId], queued: { type: 'run.queued', versionId: run.versionId, pinned, initialThread } };
    const raw = structuredClone(definition);
    if (visits === undefined) delete raw.settings.maxNodeVisits;
    if (deadline === undefined) delete raw.settings.runDeadlineSeconds;
    await database.client.execute({ sql: "UPDATE loop_versions SET definition=?,status='published',published_at=? WHERE id=?", args: [JSON.stringify(raw), FIXTURE_TS, draft.id] });
    await admission.create(intent);
    await database.client.execute({ sql: "UPDATE runs SET pinned=json_remove(pinned,'$.limits') WHERE id=?", args: [run.id] });
    await database.client.execute({ sql: "UPDATE run_events SET payload=json_remove(payload,'$.pinned.limits') WHERE run_id=?", args: [run.id] });
    const oldIntent = { ...intent, run: { ...run, pinned: { ...pinned, limits: undefined } }, queued: { ...intent.queued, pinned: { ...pinned, limits: undefined } } };
    await database.client.execute({ sql: "INSERT INTO webhook_receipts (id,owner_id,loop_id,trigger_node_id,content_hash,inbound_id,status,intent,attempts) VALUES (?,'local',?,'start',?,?,'pending',?,0)", args: [fakeUlid('r4-receipt-' + label), draft.loopId, 'a'.repeat(64), fakeUlid('r4-inbound-' + label), JSON.stringify(oldIntent)] });
    expected.push({ label, runId: run.id, receiptId: fakeUlid('r4-receipt-' + label), limits });
  }
  database.close();
  database = openDatabase({ url });
  assert.equal(await database.pendingMigrations(), 1);
  await database.migrate();
  assert.equal(await database.pendingMigrations(), 0);
  const after = (await database.client.execute('SELECT * FROM __drizzle_migrations ORDER BY created_at')).rows;
  assert.equal(after.length, 18);
  assert.deepEqual(after.slice(0, 17), before);
  for (const row of expected) {
    const pin = JSON.parse((await database.client.execute({ sql: 'SELECT pinned FROM runs WHERE id=?', args: [row.runId] })).rows[0].pinned);
    const queued = JSON.parse((await database.client.execute({ sql: "SELECT payload FROM run_events WHERE run_id=? AND type='run.queued'", args: [row.runId] })).rows[0].payload);
    const saved = JSON.parse((await database.client.execute({ sql: 'SELECT intent FROM webhook_receipts WHERE id=?', args: [row.receiptId] })).rows[0].intent);
    for (const limits of [pin.limits, queued.pinned.limits, saved.run.pinned.limits, saved.queued.pinned.limits]) assert.deepEqual(limits, row.limits);
    result.checks.push({ name: row.label + ' run, queued event and both saved pins', limits: row.limits, pass: true });
  }
  database.close();
  database = openDatabase({ url });
  await database.migrate();
  assert.deepEqual((await database.client.execute('SELECT * FROM __drizzle_migrations ORDER BY created_at')).rows, after);
  result.checks.push({ name: 'main 0016 to candidate 0017 across disk close/reopen, then idempotent reopen', before: 17, after: 18, pass: true });
  database.close();
  database = openDatabase({ url: ':memory:' });
  assert.equal(await database.pendingMigrations(), 18);
  await database.migrate();
  assert.equal(await database.pendingMigrations(), 0);
  assert.equal((await database.client.execute('SELECT count(*) AS n FROM __drizzle_migrations')).rows[0].n, 18);
  result.checks.push({ name: 'fresh database migrates from zero through all 18 migrations', pass: true });
} catch (error) {
  result.failure = { name: error.name, message: error.message.replaceAll(repo, '<repo>').replaceAll(folder, '<fixture>') };
  process.exitCode = 1;
} finally {
  database?.close();
  const cleanupFailures = [];
  for (const file of [...fixtureFiles, databaseFile, databaseFile + '-wal', databaseFile + '-shm']) {
    for (let attempt = 0; ; attempt += 1) {
      try { await unlink(file); break; }
      catch (error) {
        if (error.code === 'ENOENT') break;
        if (['EBUSY', 'EPERM'].includes(error.code) && attempt < 30) { await delay(100); continue; }
        cleanupFailures.push({ file: basename(file), code: error.code });
        // Windows may retain a native file handle until this process exits; the parent cleans it.
        break;
      }
    }
  }
  const databaseFilesRemoved = await access(databaseFile).then(() => false, () => true);
  result.cleanup = { databaseFile: basename(databaseFile), databaseFilesRemoved, cleanupDeferredUntilProcessExit: !databaseFilesRemoved, fixtureFilesRemoved: !cleanupFailures.some((entry) => !entry.file.startsWith(basename(databaseFile))), cleanupFailures, emptyFixtureDirectory: basename(folder), emptyMetaDirectory: basename(folder) + '/meta', directoriesNotDeleted: true };
  const output = (JSON.stringify(result, null, 2) + '\n').replace(/[a-z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '<USERPROFILE>');
  await writeFile(new URL('./migration-proof-results.json', import.meta.url), output);
  console.log(output);
}
