import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  link,
  lstat,
  readdir,
  rename,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { RESOURCE_OWNERSHIP_REWIND_SQL } from './testing/resource-ownership.js';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeUlid, FIXTURE_TS, samplePin, sampleThread } from '@graphgoblin/contracts/testing';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { drizzle } from 'drizzle-orm/libsql';
import { schema, runs as runRows, runResourceUses } from './schema.js';
import { SqliteLoopRepository } from './loops.js';
import { FakeIds } from '@graphgoblin/engine/testing';
import type { LoopVersionRecord, RunRecord } from '@graphgoblin/contracts';
import { OwnedRunResources } from '../fs/owned-resources.js';
import { openDatabase, type DatabaseHandle } from './db.js';
import { SqliteRunResources } from './run-resources.js';
import { runInsert, SqliteRunRepository } from './runs.js';
import { SqliteDeletionEligibility } from './deletion-eligibility.js';
import { SqliteHistoryCleanup } from './history-cleanup.js';
import { FsArtifactStore } from '../fs/artifacts.js';
import { FsStorageCapacity } from '../fs/capacity.js';
import { FakeClock } from '@graphgoblin/engine/testing';
import { SqliteTriggerAdmission } from './admission.js';
import { SqliteEventStore } from './events.js';

let directory: string,
  handle: DatabaseHandle,
  repo: SqliteRunRepository,
  resources: OwnedRunResources,
  store: SqliteHistoryCleanup;
const approval = {
  confirmedAt: FIXTURE_TS,
  confirmedBy: { ownerId: 'local', kind: 'user', id: 'owner' },
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gg-wp-e3-'));
  handle = openDatabase({ url: `file:${join(directory, 'history.db').replaceAll('\\', '/')}` });
  await handle.migrate();
  repo = new SqliteRunRepository(handle.db);
  resources = new OwnedRunResources(directory, new SqliteRunResources(handle.db));
  store = new SqliteHistoryCleanup(handle.db, resources);
});
afterEach(async () => {
  handle.close();
  globalThis.gc?.();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function seed(name: string, parentRunId?: string, version?: LoopVersionRecord) {
  const record: RunRecord = {
    id: fakeUlid(name),
    ownerId: 'local',
    loopId: version?.loopId ?? fakeUlid('loop'),
    versionId: version?.id ?? fakeUlid('version'),
    invocationId: fakeUlid(name + '-inv'),
    pinned: samplePin(),
    status: 'succeeded',
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
    ...(parentRunId ? { parentRunId } : {}),
  };
  await repo.create(record, sampleThread());
  await repo.markFinalized(record.id);
  return record.id;
}
async function mark(runIds: string[]) {
  const consent = new SqliteDeletionEligibility(handle.db);
  const preview = await consent.preview('local', runIds);
  expect(
    (
      await consent.confirm(
        'local',
        { runIds, token: preview.token, action: 'mark', confirmed: true },
        approval,
      )
    ).conflict,
  ).toBeNull();
}

it.each(['succeeded', 'failed', 'cancelled', 'exhausted'] as const)(
  'reclaims approved workspaces beside a retained %s template run that never used a directory',
  async (status) => {
    const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
    const loop = await loops.create(
      'local',
      LoopDefinitionSchema.parse({
        ...minimalLoop(),
        settings: { workingDirectory: { kind: 'template', template: '{{trigger.payload.dir}}' } },
      }),
    );
    const version = (await loops.publish(loop.loop.id))!;
    const retained = await seed('unused-template', undefined, version);
    await repo.update(retained, { status });
    const owner = await seed('ordinary-workspace');
    const workspace = await resources.workspace.resolve({ kind: 'temp' }, {}, owner);
    await writeFile(join(workspace, 'owned'), 'reclaim');
    await mark([owner]);
    expect(await store.prepareBatch('local')).toBe(1);
    expect(await store.reapBatch()).toMatchObject({ bytes: 7, pending: 0 });
    await expect(lstat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await repo.get(retained))?.status).toBe(status);
  },
);

it('backfills only live unused template obligations and restores them on Resume', async () => {
  const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
  const loop = await loops.create(
    'local',
    LoopDefinitionSchema.parse({
      ...minimalLoop(),
      settings: { workingDirectory: { kind: 'template', template: '{{trigger.payload.dir}}' } },
    }),
  );
  const version = (await loops.publish(loop.loop.id))!;
  const terminal = await seed('historical-terminal', undefined, version);
  const active = await seed('historical-live', undefined, version);
  await repo.transition(active, ['succeeded'], { status: 'waiting' });
  for (const statement of RESOURCE_OWNERSHIP_REWIND_SQL) await handle.client.execute(statement);
  const migration = readMigrationFiles({
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  }).find((entry) =>
    entry.sql.some((statement) => statement.includes('CREATE TABLE `workspace_references`')),
  )!;
  for (const statement of migration.sql) await handle.client.execute(statement);
  const pending = async () =>
    (
      await handle.client.execute(
        'SELECT run_id FROM workspace_references WHERE path IS NULL ORDER BY run_id',
      )
    ).rows.map((row) => row['run_id']);
  expect(await pending()).toEqual([active]);
  await repo.transition(active, ['waiting'], { status: 'failed' });
  expect(await pending()).toEqual([]);
  await repo.transition(terminal, ['succeeded'], { status: 'queued' });
  expect(await pending()).toEqual([terminal]);
  for (const status of ['running', 'waiting', 'paused'] as const) {
    await repo.update(terminal, { status });
    expect(await pending()).toEqual([terminal]);
  }
  const path = await resources.workspace.resolve(
    { kind: 'fixed', path: join(directory, 'user') },
    {},
    terminal,
  );
  expect(await pending()).toEqual([]);
  await repo.update(terminal, { status: 'succeeded' });
  await repo.transition(terminal, ['succeeded'], { status: 'queued' });
  expect(await pending()).toEqual([]);
  const use = await handle.client.execute(
    'SELECT path FROM workspace_references WHERE run_id = ?',
    [terminal],
  );
  expect(use.rows).toHaveLength(1);
  expect((await lstat(path)).isDirectory()).toBe(true);
});

it('protects live dynamic templates until termination, and bounds literal templates to their known path', async () => {
  const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
  const user = join(directory, 'literal-user-directory');
  await mkdir(user);
  await writeFile(join(user, 'keep'), 'retained');
  const create = async (name: string, template: string) => {
    const loop = await loops.create(
      'local',
      LoopDefinitionSchema.parse({
        ...minimalLoop(),
        settings: { workingDirectory: { kind: 'template', template } },
      }),
    );
    const version = await loops.publish(loop.loop.id);
    expect(version).toBeDefined();
    const id = await seed(name, undefined, version);
    await repo.transition(id, ['succeeded'], { status: 'waiting' });
    return id;
  };
  const dynamic = await create('live-dynamic-template', '{{trigger.payload.dir}}');
  const sharedOwner = await seed('literal-shared-owner');
  const shared = await resources.workspace.resolve({ kind: 'temp' }, {}, sharedOwner);
  await writeFile(join(shared, 'keep'), 'shared');
  const literal = await create('live-literal-template', `\t ${shared}\n`);
  const empty = await create('live-empty-template', '\t \n');
  const owner = await seed('template-owner');
  const workspace = await resources.workspace.resolve({ kind: 'temp' }, {}, owner);
  await writeFile(join(workspace, 'owned'), 'reclaim');
  await mark([owner, sharedOwner]);
  await store.prepareBatch('local');
  expect(await store.reapBatch()).toMatchObject({ bytes: 0, pending: 2 });
  expect(await readFile(join(workspace, 'owned'), 'utf8')).toBe('reclaim');
  await repo.transition(dynamic, ['waiting'], { status: 'failed' });
  expect(await store.reapBatch()).toMatchObject({ bytes: 7, pending: 1 });
  expect(await readFile(join(shared, 'keep'), 'utf8')).toBe('shared');
  expect((await repo.get(literal))?.status).toBe('waiting');
  expect((await repo.get(empty))?.status).toBe('waiting');
  expect(await readFile(join(user, 'keep'), 'utf8')).toBe('retained');
});

it.each(process.platform === 'win32' ? ['junction', 'short-name'] : ['junction'])(
  'publishes and reclaims owned workspaces/transcripts through a %s data directory',
  async (mode) => {
    const physical = join(directory, 'physical-data-root');
    await mkdir(physical);
    let dataDir: string;
    if (mode === 'short-name') {
      const short = spawnSync(
        'cmd',
        ['/d', '/s', '/c', `"for %I in ("${physical}") do @echo %~sI"`],
        { encoding: 'utf8', windowsVerbatimArguments: true },
      );
      expect(short.error).toBeUndefined();
      expect(short.status).toBe(0);
      dataDir = short.stdout.trim();
      expect(dataDir.toLowerCase()).not.toBe(physical.toLowerCase());
    } else {
      dataDir = join(directory, 'data-alias');
      await symlink(physical, dataDir, 'junction');
    }
    resources = new OwnedRunResources(dataDir, new SqliteRunResources(handle.db));
    store = new SqliteHistoryCleanup(handle.db, resources);
    const id = await seed('alias-data-owner');
    const workspace = await resources.workspace.resolve({ kind: 'temp' }, {}, id);
    await resources.workspace.writeFile(workspace, 'owned', 'workspace');
    const artifact = await resources.artifacts.put('transcript', 'transcript', id);
    expect(await resources.artifacts.get(artifact.ref)).toBe('transcript');
    if (mode === 'junction') {
      // Once admitted, retargeting the configured alias cannot redirect this instance's I/O.
      await rename(dataDir, dataDir + '-old');
      const other = join(directory, 'other-data');
      await mkdir(other);
      await symlink(other, dataDir, 'junction');
      expect(await resources.artifacts.get(artifact.ref)).toBe('transcript');
    }
    await mark([id]);
    expect(await store.prepareBatch('local')).toBe(1);
    expect(await store.reapBatch()).toMatchObject({ bytes: 19, pending: 0 });
    await expect(lstat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await resources.artifacts.get(artifact.ref)).toBeUndefined();
    const target = join(physical, 'user-owned');
    await mkdir(target);
    await symlink(target, join(physical, 'artifacts', 'redirect'), 'junction');
    await expect(resources.artifacts.put('redirect', 'must not publish', id)).rejects.toThrow(
      'Artifact directory is a link',
    );
    await rename(join(physical, 'workspaces'), join(physical, 'old-workspaces'));
    await symlink(target, join(physical, 'workspaces'), 'junction');
    await expect(
      resources.workspace.resolve({ kind: 'temp' }, {}, fakeUlid('refuse-link')),
    ).rejects.toThrow('Managed resource root is a link');
  },
);

it('deletes only approved whole components and their rows, leaving stable page cursors and reusable SQLite pages', async () => {
  const parent = await seed('parent'),
    child = await seed('child', parent),
    kept = await seed('kept');
  await repo.update(parent, { createdAt: '2026-10-03T00:00:00.000Z' });
  await repo.update(kept, { createdAt: '2026-10-01T00:00:00.000Z' });
  await mark([parent, child]);
  const before = await repo.page({ ownerId: 'local', limit: 1 });
  expect(before.items.map((run) => run.id)).toEqual([parent]);
  expect(await store.prepareBatch('local')).toBe(2);
  expect(await repo.get(parent)).toBeUndefined();
  expect(await repo.get(child)).toBeUndefined();
  expect(await repo.get(kept)).toBeDefined();
  const after = await repo.page({ ownerId: 'local', cursor: before.next! });
  expect(after.items.map((run) => run.id)).toEqual([kept]);
  expect(after.next).toBeNull();
  expect(await store.reusableBytes()).toBeGreaterThanOrEqual(0);
  expect(await store.prepareBatch('local')).toBe(0);
});

it('rechecks revocation and never deletes an active member or a foreign/missing dependency', async () => {
  const parent = await seed('parent'),
    child = await seed('child', parent);
  await mark([parent, child]);
  await repo.transition(child, ['succeeded'], { status: 'running' });
  expect(await store.prepareBatch('local')).toBe(0);
  expect(await repo.get(parent)).toBeDefined();
  const dangling = await seed('dangling', fakeUlid('missing'));
  // Real-storage corruption/old consent cannot bypass the cleanup-time dependency recheck.
  await handle.client.execute({
    sql: 'UPDATE runs SET deletion_approval=? WHERE id=?',
    args: [JSON.stringify(approval), dangling],
  });
  expect(await new SqliteHistoryCleanup(handle.db, resources).prepareBatch('local')).toBe(0);
  expect(await repo.get(dangling)).toBeDefined();
});

it('bounds each root batch and eventually covers approved history without broadening to retained rows', async () => {
  const ids = [];
  for (let i = 0; i < 45; i++) ids.push(await seed('batch' + i));
  const kept = await seed('kept');
  await mark(ids);
  expect(await store.prepareBatch('local')).toBe(20);
  expect(await store.prepareBatch('local')).toBe(20);
  expect(await store.prepareBatch('local')).toBe(5);
  expect((await repo.list()).map((run) => run.id)).toEqual([kept]);
});

it('reaps a positively owned workspace and artifact but preserves run-shaped, fixed and unrelated paths', async () => {
  const id = await seed('owned');
  const workspace = await resources.workspace.resolve({ kind: 'temp' }, {}, id);
  await resources.workspace.writeFile(workspace, 'result.txt', 'owned bytes');
  const artifact = await resources.artifacts.put('text', 'owned artifact', id);
  const fixed = join(directory, 'user-owned');
  await resources.workspace.resolve({ kind: 'fixed', path: fixed }, {}, id);
  await writeFile(join(fixed, 'keep'), 'user bytes');
  const shaped = join(directory, 'workspaces', fakeUlid('unproven'));
  await mkdir(shaped);
  await writeFile(join(shaped, 'keep'), 'unrelated');
  await mark([id]);
  expect(await store.prepareBatch('local')).toBe(1);
  expect(await store.reapBatch()).toEqual({
    bytes: 25,
    preserved: 0,
    pending: 0,
    remaining: false,
  });
  await expect(lstat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await resources.artifacts.get(artifact.ref)).toBeUndefined();
  expect(await readFile(join(fixed, 'keep'), 'utf8')).toBe('user bytes');
  expect(await readFile(join(shaped, 'keep'), 'utf8')).toBe('unrelated');
});

it('keeps an existing unproven workspace, shared directory, shared artifact and hard-linked content', async () => {
  const id = await seed('owned'),
    kept = await seed('kept'),
    unproven = await seed('unproven');
  const workspace = await resources.workspace.resolve({ kind: 'temp' }, {}, id);
  await writeFile(join(workspace, 'keep'), 'shared');
  await resources.workspace.resolve({ kind: 'fixed', path: workspace }, {}, kept);
  const file = await resources.artifacts.put('text', 'shared artifact', id);
  await resources.artifacts.put('text', 'shared artifact', kept);
  const unprovenPath = join(directory, 'workspaces', unproven);
  await mkdir(unprovenPath);
  await writeFile(join(unprovenPath, 'keep'), 'pre-existing');
  await resources.workspace.resolve({ kind: 'temp' }, {}, unproven);
  const linked = await resources.artifacts.put('text', 'hard-linked', id);
  const linkedPath = join(directory, 'artifacts', ...linked.ref.slice(9).split('/'));
  const outside = join(directory, 'unrelated-link');
  await link(linkedPath, outside);
  await mark([id, unproven]);
  expect(await store.prepareBatch('local')).toBe(2);
  expect((await store.reapBatch()).preserved).toBe(3);
  expect(await readFile(join(workspace, 'keep'), 'utf8')).toBe('shared');
  expect(await readFile(join(unprovenPath, 'keep'), 'utf8')).toBe('pre-existing');
  expect(await resources.artifacts.get(file.ref)).toBe('shared artifact');
  expect(await readFile(outside, 'utf8')).toBe('hard-linked');
});

it('protects retained artifact references in escaped JSON event tails without relying on the current snapshot', async () => {
  const id = await seed('owned'),
    kept = await seed('kept');
  const artifact = await resources.artifacts.put('text', 'retained tail', id);
  const escaped = JSON.stringify({ ref: artifact.ref }).replace('artifact:', '\\u0061rtifact:');
  await handle.client.execute({
    sql: "INSERT INTO run_events(run_id,seq,ts,type,payload) VALUES(?,1,?,'fixture',?)",
    args: [kept, FIXTURE_TS, escaped],
  });
  await mark([id]);
  expect(await store.prepareBatch('local')).toBe(1);
  expect(await store.reapBatch()).toMatchObject({ preserved: 1, pending: 1 });
  expect(await resources.artifacts.get(artifact.ref)).toBe('retained tail');
});

it('retains journal state when a transaction fails after file removal, then finishes after reopen', async () => {
  const id = await seed('owned');
  await resources.artifacts.put('text', 'interrupted', id);
  await mark([id]);
  expect(await store.prepareBatch('local')).toBe(1);
  const consent = await handle.client.execute(
    'SELECT approval FROM run_resources WHERE pending = 1',
  );
  const storedApproval = consent.rows[0]?.approval;
  if (typeof storedApproval !== 'string') throw new Error('pending resource has no approval text');
  expect(JSON.parse(storedApproval)).toEqual(approval);
  await handle.client.execute(
    "CREATE TRIGGER fail_reap BEFORE DELETE ON run_resources BEGIN SELECT RAISE(ABORT, 'injected stop after unlink'); END",
  );
  expect(await store.reapBatch()).toEqual({ bytes: 0, preserved: 1, pending: 1, remaining: false });
  handle.close();
  globalThis.gc?.();
  handle = openDatabase({ url: `file:${join(directory, 'history.db').replaceAll('\\', '/')}` });
  await handle.client.execute('DROP TRIGGER fail_reap');
  resources = new OwnedRunResources(directory, new SqliteRunResources(handle.db));
  store = new SqliteHistoryCleanup(handle.db, resources);
  expect(await store.reapBatch()).toEqual({ bytes: 0, preserved: 0, pending: 0, remaining: false });
  expect(await readdir(join(directory, 'cleanup-pending'))).toEqual([]);
});

it('does not infer ownership of old artifact bytes and refuses a replaced workspace identity', async () => {
  const id = await seed('owned');
  const legacy = await new FsArtifactStore(directory).put('text', 'old bytes');
  await resources.artifacts.put('text', 'old bytes', id);
  const path = await resources.workspace.resolve({ kind: 'temp' }, {}, id);
  await writeFile(join(path, 'owned'), 'old workspace');
  await rename(path, join(directory, 'moved'));
  await mkdir(path);
  await writeFile(join(path, 'unrelated'), 'new occupant');
  await mark([id]);
  expect(await store.prepareBatch('local')).toBe(1);
  expect(await store.reapBatch()).toMatchObject({ pending: 1, preserved: 1, bytes: 0 });
  expect(await resources.artifacts.get(legacy.ref)).toBe('old bytes');
  expect(await readFile(join(path, 'unrelated'), 'utf8')).toBe('new occupant');
});

it('preserves an entire workspace containing a hard link and bounds oversized inventories before removing files', async () => {
  const linked = await seed('linked'),
    large = await seed('large');
  const linkedPath = await resources.workspace.resolve({ kind: 'temp' }, {}, linked);
  const target = join(directory, 'outside');
  await writeFile(target, 'keep linked bytes');
  await link(target, join(linkedPath, 'link'));
  const largePath = await resources.workspace.resolve({ kind: 'temp' }, {}, large);
  for (let i = 0; i < 2000; i += 32)
    await Promise.all(
      Array.from({ length: Math.min(32, 2000 - i) }, (_, offset) =>
        writeFile(join(largePath, String(i + offset)), ''),
      ),
    );
  await mark([linked, large]);
  expect(await store.prepareBatch('local')).toBe(2);
  expect(await store.reapBatch()).toMatchObject({ preserved: 2, pending: 2, bytes: 0 });
  expect(await readFile(target, 'utf8')).toBe('keep linked bytes');
  expect(await readdir(largePath)).toHaveLength(2000);
}, 60_000);

it('rechecks newly retained usage before unlink, and reaps it only after that history is approved too', async () => {
  const owner = await seed('owner');
  const file = await resources.artifacts.put('text', 'later dependency', owner);
  await mark([owner]);
  expect(await store.prepareBatch('local')).toBe(1);
  const retained = await seed('later');
  await resources.artifacts.put('text', 'later dependency', retained);
  expect(await store.reapBatch()).toMatchObject({ preserved: 1, pending: 1 });
  expect(await resources.artifacts.get(file.ref)).toBe('later dependency');
  await mark([retained]);
  const next = new SqliteHistoryCleanup(handle.db, resources);
  expect(await next.prepareBatch('local')).toBe(1);
  expect(await next.reapBatch()).toMatchObject({ pending: 0, bytes: 16 });
});

it('fails closed for damaged retained snapshots and measures actual filesystem capacity through statfs', async () => {
  const owner = await seed('owner'),
    retained = await seed('retained');
  const artifact = await resources.artifacts.put('text', 'keep until known', owner);
  await handle.client.execute({
    sql: 'UPDATE runs SET thread_snapshot = ? WHERE id = ?',
    args: ['{damaged', retained],
  });
  await mark([owner]);
  expect(await store.prepareBatch('local')).toBe(1);
  expect(await store.reapBatch()).toMatchObject({ preserved: 1 });
  expect(await resources.artifacts.get(artifact.ref)).toBe('keep until known');
  const capacity = await new FsStorageCapacity().read(directory);
  expect(capacity.totalBytes).toBeGreaterThan(0);
  expect(capacity.availableBytes).toBeGreaterThanOrEqual(0);
  expect(capacity.availableBytes).toBeLessThanOrEqual(capacity.totalBytes);
});

it('refuses replay admission if cleanup removed its source before the fork transaction', async () => {
  const source = await seed('source');
  await mark([source]);
  expect(await store.prepareBatch('local')).toBe(1);
  const run: RunRecord = {
    id: fakeUlid('fork'),
    ownerId: 'local',
    loopId: fakeUlid('loop'),
    versionId: fakeUlid('version'),
    invocationId: fakeUlid('fork-inv'),
    pinned: samplePin(),
    status: 'queued',
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
  };
  const replayOf = { runId: source, nodeId: 'start' };
  const thread = sampleThread({
    run: { id: run.id, loopId: run.loopId, versionId: run.versionId, iteration: 1 },
    invocation: { ...sampleThread().invocation, id: run.invocationId, replayOf },
  });
  const admission = new SqliteTriggerAdmission(
    handle.db,
    new SqliteEventStore(handle.db, new FakeClock()),
  );
  await expect(
    admission.create({
      run,
      initialThread: thread,
      pinnedLoopIds: [run.loopId],
      queued: {
        type: 'run.queued',
        versionId: run.versionId,
        pinned: run.pinned,
        initialThread: thread,
        replayOf,
      },
    }),
  ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
  expect(await repo.get(run.id)).toBeUndefined();
});

it.each(['bytes', 'documents'] as const)(
  'preserves artifacts when the bounded reference proof exceeds its %s budget',
  async (bound) => {
    const owner = await seed('owner'),
      retained = await seed('retained');
    const artifact = await resources.artifacts.put('text', 'not proven unshared', owner);
    if (bound === 'bytes') {
      await handle.client.execute({
        sql: 'UPDATE runs SET thread_snapshot=? WHERE id=?',
        args: [
          JSON.stringify(sampleThread({ vars: { large: 'x'.repeat(2 * 1024 ** 2) } })),
          retained,
        ],
      });
    } else {
      await new SqliteEventStore(handle.db, new FakeClock()).append(
        retained,
        Array.from(
          { length: 2000 },
          () => ({ type: 'run.resumed', actor: { kind: 'user', id: 'owner' } }) as const,
        ),
      );
    }
    await mark([owner]);
    expect(await store.prepareBatch('local')).toBe(1);
    expect(await store.reapBatch()).toMatchObject({ bytes: 0, pending: 1, preserved: 1 });
    expect(await resources.artifacts.get(artifact.ref)).toBe('not proven unshared');
  },
);

it('protects artifact references in retained inbound input even after its producing run is removed', async () => {
  const owner = await seed('owner');
  const artifact = await resources.artifacts.put('text', 'retained input', owner);
  await handle.client.execute({
    sql: "INSERT INTO inbound_events(id,owner_id,type,payload,source,received_at,run_ids) VALUES(?,'local','ready',?,'api',?,'[]')",
    args: [fakeUlid('input'), JSON.stringify({ ref: artifact.ref }), FIXTURE_TS],
  });
  await mark([owner]);
  expect(await store.prepareBatch('local')).toBe(1);
  expect(await store.reapBatch()).toMatchObject({ bytes: 0, preserved: 1, pending: 1 });
  expect(await resources.artifacts.get(artifact.ref)).toBe('retained input');
});

it.each(['alias', 'missing-descendant', 'case', 'error', 'deep'] as const)(
  'keeps owned workspaces when a recorded retained use resolves through %s',
  async (mode) => {
    const owner = await seed('owner'),
      retained = await seed('retained');
    const workspace = await resources.workspace.resolve({ kind: 'temp' }, {}, owner);
    await writeFile(join(workspace, 'keep.txt'), 'retained bytes');
    const alias = join(directory, 'alias');
    await symlink(workspace, alias, 'junction');
    let path = alias;
    if (mode === 'missing-descendant') path = join(alias, 'missing', 'child');
    if (mode === 'case') path = process.platform === 'win32' ? alias.toUpperCase() : alias;
    if (mode === 'error') {
      const file = join(directory, 'not-a-directory');
      await writeFile(file, 'blocker');
      path = join(file, 'child');
    }
    if (mode === 'deep') path = join(directory, ...Array.from({ length: 65 }, () => 'x'));
    await new SqliteRunResources(handle.db).use(retained, `workspace:${path}`, path);
    await mark([owner]);
    expect(await store.prepareBatch('local')).toBe(1);
    expect(await store.reapBatch()).toMatchObject({ bytes: 0, pending: 1, preserved: 1 });
    expect(await readFile(join(workspace, 'keep.txt'), 'utf8')).toBe('retained bytes');
    expect(await repo.get(retained)).toBeDefined();
  },
);

it('wraps the root batch in the same pass after an older run is newly approved', async () => {
  const ids = [await seed('a'), await seed('z')].sort();
  await mark([ids[1]!]);
  expect(await store.prepareBatch('local')).toBe(1);
  await mark([ids[0]!]);
  expect(await store.prepareBatch('local')).toBe(1);
  expect(await store.hasApprovedCandidates('local')).toBe(false);
});

it('reports every preserved resource across repeated passes instead of alternating by cursor', async () => {
  const owner = await seed('owner'),
    retained = await seed('retained');
  for (let i = 0; i < 3; i++) {
    await resources.artifacts.put('text', 'shared-' + i, owner);
    await resources.artifacts.put('text', 'shared-' + i, retained);
  }
  await mark([owner]);
  await store.prepareBatch('local');
  for (let i = 0; i < 3; i++) expect((await store.reapBatch()).preserved).toBe(3);
});

it('defers workspaces until a bounded 2048-reference refresh completes, then reclaims them', async () => {
  const owner = await seed('owner'),
    retained = await seed('retained');
  const workspace = await resources.workspace.resolve({ kind: 'temp' }, {}, owner);
  await writeFile(join(workspace, 'keep.txt'), 'unproven bytes');
  const paths = Array.from({ length: 2050 }, (_, i) => join(directory, `missing-${i}`));
  await handle.client.execute({
    sql: `INSERT INTO run_resource_uses(run_id,key,path) VALUES ${paths.map(() => '(?,?,?)').join(',')}`,
    args: paths.flatMap((path) => [retained, `workspace:${path}`, path]),
  });
  await mark([owner]);
  expect(await store.hasApprovedCandidates('local')).toBe(true);
  expect(await store.prepareBatch('local')).toBe(1);
  expect(await store.reapBatch()).toMatchObject({
    bytes: 0,
    pending: 1,
    preserved: 1,
    remaining: true,
  });
  expect(await readFile(join(workspace, 'keep.txt'), 'utf8')).toBe('unproven bytes');
  expect((await store.reapBatch()).bytes).toBe(Buffer.byteLength('unproven bytes'));
  await expect(lstat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('serves a database read while quarantine removal is held through the public cleanup port', async () => {
  const owner = await seed('owner'),
    retained = await seed('retained');
  await resources.artifacts.put('text', 'owned', owner);
  await mark([owner]);
  await store.prepareBatch('local');
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cleanup = new SqliteHistoryCleanup(handle.db, {
    exclusive: (operation) => resources.exclusive(operation),
    inspect: (resource) => resources.inspect(resource),
    stage: (resource, plan) => resources.stage(resource, plan),
    remove: async (resource, plan, signal) => {
      enter();
      await released;
      return resources.remove(resource, plan, signal);
    },
  });
  const pass = cleanup.reapBatch();
  await entered;
  let readCompleted = false;
  const read = repo.get(retained).then(() => {
    readCompleted = true;
  });
  try {
    for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
    expect(readCompleted).toBe(true);
  } finally {
    release();
    await read;
    await pass;
  }
});

it('never deletes a newly published generation while an older quarantine generation is being removed', async () => {
  const owner = await seed('owner'),
    retained = await seed('retained');
  const artifact = await resources.artifacts.put('text', 'same bytes', owner);
  await mark([owner]);
  await store.prepareBatch('local');
  const cleanup = new SqliteHistoryCleanup(handle.db, {
    exclusive: (operation) => resources.exclusive(operation),
    inspect: (resource) => resources.inspect(resource),
    stage: (resource, plan) => resources.stage(resource, plan),
    remove: async (resource, plan, signal) => {
      const published = await resources.artifacts.put('text', 'same bytes', retained);
      expect(published.ref).toBe(artifact.ref);
      return resources.remove(resource, plan, signal);
    },
  });
  expect((await cleanup.reapBatch()).bytes).toBe(10);
  expect(await resources.artifacts.get(artifact.ref)).toBe('same bytes');
  expect((await new SqliteRunResources(handle.db).find(artifact.ref))?.ownerRunId).toBe(retained);
});

it('recovers rename-before-commit while a new publisher takes the original artifact key', async () => {
  const owner = await seed('owner'),
    retained = await seed('retained');
  const artifact = await resources.artifacts.put('text', 'same bytes', owner);
  await mark([owner]);
  await store.prepareBatch('local');
  await handle.client.execute(
    "CREATE TRIGGER fail_stage BEFORE UPDATE OF key ON run_resources BEGIN SELECT RAISE(ABORT, 'crash before commit'); END",
  );
  expect((await store.reapBatch()).pending).toBe(1);
  await handle.client.execute('DROP TRIGGER fail_stage');
  await resources.artifacts.put('text', 'same bytes', retained);
  expect((await new SqliteHistoryCleanup(handle.db, resources).reapBatch()).bytes).toBe(10);
  expect(await resources.artifacts.get(artifact.ref)).toBe('same bytes');
});

it('rechecks retained usage added after inventory before moving anything out of reach', async () => {
  const owner = await seed('owner'),
    retained = await seed('retained');
  const artifact = await resources.artifacts.put('text', 'retained bytes', owner);
  await mark([owner]);
  await store.prepareBatch('local');
  const cleanup = new SqliteHistoryCleanup(handle.db, {
    exclusive: (operation) => resources.exclusive(operation),
    inspect: async (resource) => {
      const plan = await resources.inspect(resource);
      await new SqliteRunResources(handle.db).use(retained, artifact.ref, resource.path);
      return plan;
    },
    stage: (resource, plan) => resources.stage(resource, plan),
    remove: (resource, plan, signal) => resources.remove(resource, plan, signal),
  });
  expect((await cleanup.reapBatch()).bytes).toBe(0);
  expect(await resources.artifacts.get(artifact.ref)).toBe('retained bytes');
});

it('refreshes a fixed alias created after publication before staging an owned workspace', async () => {
  const owner = await seed('late-alias-owner');
  const workspace = await resources.workspace.resolve({ kind: 'temp' }, {}, owner);
  await writeFile(join(workspace, 'keep'), 'later alias still protects');
  const alias = join(directory, 'later');
  const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
  const loop = await loops.create(
    'local',
    LoopDefinitionSchema.parse({
      ...minimalLoop(),
      settings: { workingDirectory: { kind: 'fixed', path: join(alias, 'not-created') } },
    }),
  );
  await loops.publish(loop.loop.id);
  await symlink(workspace, alias, 'junction');
  await mark([owner]);
  await store.prepareBatch('local');
  expect((await store.reapBatch()).bytes).toBe(0);
  expect(await readFile(join(workspace, 'keep'), 'utf8')).toBe('later alias still protects');
});

// Scale/query-plan checks use real SQLite in memory to avoid thousands of fixture fsyncs.
// Native and API large-store probes exercise file-backed SQLite; every resource here is real FS.
describe('large retained stores', () => {
  beforeEach(async () => {
    handle.close();
    globalThis.gc?.();
    handle = openDatabase({ url: ':memory:' });
    await handle.migrate();
    repo = new SqliteRunRepository(handle.db);
    resources = new OwnedRunResources(directory, new SqliteRunResources(handle.db));
    store = new SqliteHistoryCleanup(handle.db, resources);
  });
  it('does not let 61 budget-protected artifact jobs hide removable workspaces in a later window', async () => {
    await seed('retained');
    // Exceed the existing document proof budget without rereading a 2-MiB fixture for
    // every one of 61 artifacts. Byte-budget behavior is covered separately above.
    for (let offset = 0; offset < 2001; offset += 100) {
      const values = Array.from(
        { length: Math.min(100, 2001 - offset) },
        (_, i) =>
          `('${fakeUlid('proof-document-' + (offset + i))}', 'local', 'ready', '{}', 'api', '${FIXTURE_TS}', '[]')`,
      );
      await handle.client.execute(
        'INSERT INTO inbound_events(id,owner_id,type,payload,source,received_at,run_ids) VALUES ' +
          values.join(','),
      );
    }
    const ids: string[] = [];
    const workspacePaths: string[] = [];
    const artifacts: { ref: string; value: string }[] = [];
    for (let i = 0; i < 61; i++) {
      const id = await seed('window-' + i);
      ids.push(id);
      const path = await resources.workspace.resolve({ kind: 'temp' }, {}, id);
      workspacePaths.push(path);
      await writeFile(join(path, 'result'), 'owned');
      const value = 'protected-' + i;
      artifacts.push({ ...(await resources.artifacts.put('text', value, id)), value });
    }
    await mark(ids);
    while (await store.prepareBatch('local')) {
      /* Consume only the confirmed roots. */
    }
    const result = await store.reapBatch();
    expect(result.bytes).toBeGreaterThan(0);
    // Two bounded 32-inventory passes cover 61 unreferenced workspaces; no extra drain polls.
    expect((await store.reapBatch()).preserved).toBe(61);
    for (const path of workspacePaths)
      await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const { ref, value } of artifacts) expect(await resources.artifacts.get(ref)).toBe(value);
  });

  it('reclaims unshared approved workspaces among 1000 retained fixed/template runs with aliases', async () => {
    const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
    const logged: { query: string; params: unknown[] }[] = [];
    const measured = drizzle(handle.client, {
      schema,
      logger: {
        logQuery(query, params) {
          logged.push({ query, params });
        },
      },
    });
    const staging: { query: string; params: unknown[] }[][] = [];
    const cleanup = new SqliteHistoryCleanup(measured, {
      exclusive: (operation) =>
        resources.exclusive(async () => {
          const start = logged.length;
          try {
            return await operation();
          } finally {
            staging.push(logged.slice(start));
          }
        }),
      inspect: (r) => resources.inspect(r),
      stage: (r, p) => resources.stage(r, p),
      remove: (r, p, signal) => resources.remove(r, p, signal),
    });
    const small = await seed('small-owner');
    const smallPath = await resources.workspace.resolve({ kind: 'temp' }, {}, small);
    await writeFile(join(smallPath, 'result'), 'small');
    await mark([small]);
    await store.prepareBatch('local');
    await cleanup.reapBatch();
    const fixedRoot = join(directory, 'retained');
    await mkdir(fixedRoot);
    const template = await loops.create(
      'local',
      LoopDefinitionSchema.parse({
        ...minimalLoop(),
        settings: { workingDirectory: { kind: 'template', template: '{{vars.directory}}' } },
      }),
    );
    const templateVersion = (await loops.publish(template.loop.id))!;
    const owner = await seed('large-owner'),
      sharedOwner = await seed('large-shared');
    const free = await resources.workspace.resolve({ kind: 'temp' }, {}, owner);
    const shared = await resources.workspace.resolve({ kind: 'temp' }, {}, sharedOwner);
    await writeFile(join(free, 'result'), 'reclaim these bytes');
    await writeFile(join(shared, 'keep'), 'retained shared bytes');
    const alias = join(directory, 'shared-alias');
    await symlink(shared, alias, 'junction');
    const paths = Array.from({ length: 128 }, (_, i) => join(fixedRoot, String(i)));
    await Promise.all(paths.map((path) => mkdir(path)));
    const fixedVersions: LoopVersionRecord[] = [];
    for (const path of [...paths, alias]) {
      const created = await loops.create(
        'local',
        LoopDefinitionSchema.parse({
          ...minimalLoop(),
          settings: { workingDirectory: { kind: 'fixed', path } },
        }),
      );
      fixedVersions.push((await loops.publish(created.loop.id))!);
    }
    // Bulk-load valid finalized history through the public row mapper and SQLite API.
    // Native/API fixtures separately record all 1,000 uses through repositories/workspace ports.
    const histories: (typeof runRows.$inferInsert)[] = [];
    const uses: (typeof runResourceUses.$inferInsert)[] = [];
    for (let i = 0; i < 1000; i++) {
      const sharedUse = i % 100 === 0;
      const path = sharedUse ? shared : paths[i % paths.length]!;
      const version = sharedUse
        ? fixedVersions.at(-1)!
        : i % 2
          ? templateVersion
          : fixedVersions[i % paths.length]!;
      const id = fakeUlid('retained-' + i);
      histories.push({
        ...runInsert(
          {
            id,
            ownerId: 'local',
            loopId: version.loopId,
            versionId: version.id,
            invocationId: fakeUlid('retained-inv-' + i),
            pinned: samplePin(),
            status: 'succeeded',
            iteration: 1,
            createdAt: FIXTURE_TS,
            lastEventSeq: 0,
          },
          sampleThread({ vars: { directory: path } }),
        ),
        finalizedAt: FIXTURE_TS,
      });
      const canonical = process.platform === 'win32' ? path.toLowerCase() : path;
      uses.push({ runId: id, key: 'workspace:' + canonical, path: canonical });
    }
    for (let i = 0; i < histories.length; i += 100) {
      await handle.db.insert(runRows).values(histories.slice(i, i + 100));
      await handle.db.insert(runResourceUses).values(uses.slice(i, i + 100));
    }
    await mark([owner, sharedOwner]);
    expect(await store.prepareBatch('local')).toBe(2);
    const result = await cleanup.reapBatch();
    expect(result.bytes).toBe(Buffer.byteLength('reclaim these bytes'));
    await expect(lstat(free)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(shared, 'keep'), 'utf8')).toBe('retained shared bytes');
    let count = 0,
      cursor: { createdAt: string; id: string } | undefined;
    do {
      const page = await repo.page({ ownerId: 'local', limit: 500, ...(cursor ? { cursor } : {}) });
      count += page.items.length;
      cursor = page.next ?? undefined;
    } while (cursor);
    expect(count).toBe(1000);
    const refreshes = logged.filter((q) => q.query.includes('WITH observed'));
    expect(refreshes.every((q) => q.params.length <= 129)).toBe(true);
    expect(staging).toHaveLength(2);
    expect(staging[1]!.length).toBe(staging[0]!.length);
    expect(staging[1]!.length).toBeLessThanOrEqual(10);
    const plans: string[] = [];
    for (const { query, params } of staging[1]!.filter((q) =>
      q.query.includes('FROM workspace_references'),
    )) {
      const result = await handle.client.execute({
        sql: 'EXPLAIN QUERY PLAN ' + query,
        args: params.map((p) => (typeof p === 'string' || typeof p === 'number' ? p : null)),
      });
      for (const row of result.rows) {
        const detail = row['detail'];
        if (typeof detail !== 'string') throw new Error('Expected a query-plan detail string');
        plans.push(detail);
      }
    }
    expect(plans.length).toBeGreaterThan(0);
    expect(
      plans.every((plan) =>
        plan.includes(
          'SEARCH workspace_references USING COVERING INDEX workspace_references_physical_idx',
        ),
      ),
    ).toBe(true);
    process.stdout.write(
      JSON.stringify({
        retainedRuns: [0, 1000],
        stagingStatements: staging.map((s) => s.length),
        referencePlans: plans,
        maxRefreshParameters: Math.max(...refreshes.map((q) => q.params.length)),
      }) + '\n',
    );
  });
});
