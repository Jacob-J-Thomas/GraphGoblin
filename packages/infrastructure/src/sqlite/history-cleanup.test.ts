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
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fakeUlid, FIXTURE_TS, samplePin, sampleThread } from '@graphgoblin/contracts/testing';
import type { RunRecord } from '@graphgoblin/contracts';
import { OwnedRunResources } from '../fs/owned-resources.js';
import { openDatabase, type DatabaseHandle } from './db.js';
import { SqliteRunResources } from './run-resources.js';
import { SqliteRunRepository } from './runs.js';
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

async function seed(name: string, parentRunId?: string) {
  const record: RunRecord = {
    id: fakeUlid(name),
    ownerId: 'local',
    loopId: fakeUlid('loop'),
    versionId: fakeUlid('version'),
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
  expect(await store.reapBatch()).toEqual({ bytes: 25, preserved: 0, pending: 0 });
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
  expect(JSON.parse(String(consent.rows[0]?.approval))).toEqual(approval);
  await handle.client.execute(
    "CREATE TRIGGER fail_reap BEFORE DELETE ON run_resources BEGIN SELECT RAISE(ABORT, 'injected stop after unlink'); END",
  );
  expect(await store.reapBatch()).toEqual({ bytes: 0, preserved: 1, pending: 1 });
  handle.close();
  globalThis.gc?.();
  handle = openDatabase({ url: `file:${join(directory, 'history.db').replaceAll('\\', '/')}` });
  await handle.client.execute('DROP TRIGGER fail_reap');
  resources = new OwnedRunResources(directory, new SqliteRunResources(handle.db));
  store = new SqliteHistoryCleanup(handle.db, resources);
  expect(await store.reapBatch()).toEqual({ bytes: 0, preserved: 0, pending: 0 });
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
