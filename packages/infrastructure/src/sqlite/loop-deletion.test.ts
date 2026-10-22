import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, type RunRecord, type RunStatus } from '@graphgoblin/contracts';
import {
  fakeUlid,
  FIXTURE_TS,
  minimalLoop,
  samplePin,
  sampleThread,
} from '@graphgoblin/contracts/testing';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { LoopInUseError, SqliteLoopRepository } from './loops.js';
import { SqliteRunRepository } from './runs.js';
import {
  harnessSessions,
  inboundEvents,
  runEvents,
  runs,
  schedules,
  timers,
  webhookEndpoints,
  webhookReceipts,
} from './schema.js';

let handle: DatabaseHandle;
let loops: SqliteLoopRepository;
let repo: SqliteRunRepository;
beforeEach(async () => {
  handle = await openMemoryDatabase();
  loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
  repo = new SqliteRunRepository(handle.db);
});
afterEach(() => handle.close());

async function published(name: string) {
  const created = await loops.create(
    'local',
    LoopDefinitionSchema.parse({ ...minimalLoop(), name }),
  );
  const version = (await loops.publish(created.loop.id))!;
  return { loopId: created.loop.id, versionId: version.id };
}

async function storedRun(
  seed: string,
  identity: { loopId: string; versionId: string },
  status: RunStatus = 'succeeded',
  parentRunId?: string,
) {
  const run: RunRecord = {
    id: fakeUlid(seed),
    ownerId: 'local',
    ...identity,
    pinned: samplePin(),
    invocationId: fakeUlid(seed + ':inv'),
    status,
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 1,
    ...(parentRunId ? { parentRunId } : {}),
  };
  const thread = sampleThread();
  thread.artifacts.push({
    id: 'artifact',
    nodeId: 'start',
    kind: 'text',
    ref: 'artifact:text/' + 'a'.repeat(64),
  });
  await repo.create(run, thread);
  await repo.saveThread(run.id, thread, 1);
  await handle.db.insert(runEvents).values({
    runId: run.id,
    seq: 1,
    ts: FIXTURE_TS,
    type: 'run.queued',
    payload: { initialThread: thread },
  });
  await handle.db.insert(harnessSessions).values({
    runId: run.id,
    nodeId: 'start',
    attempt: 1,
    harness: 'codex',
    status: 'done',
    sessionId: 'session',
    updatedAt: FIXTURE_TS,
  });
  await handle.db.insert(timers).values({ runId: run.id, key: 'deadline', at: FIXTURE_TS });
  return run;
}

async function triggers(
  identity: { loopId: string; versionId: string },
  seed: string,
  run: RunRecord,
) {
  await handle.db.insert(schedules).values({
    id: seed + ':schedule',
    ownerId: 'local',
    ...identity,
    triggerNodeId: 'start',
    expression: '* * * * *',
    timezone: 'UTC',
    missedFirePolicy: 'skip',
    enabled: true,
    createdAt: FIXTURE_TS,
  });
  await handle.db.insert(webhookEndpoints).values({
    id: seed + ':hook',
    ownerId: 'local',
    ...identity,
    triggerNodeId: 'start',
    token: seed,
    secretRef: 'key',
    signatureHeader: 'signature',
    authType: 'hmac-sha256',
    signatureMessage: 'body',
    enabled: true,
    createdAt: FIXTURE_TS,
  });
  await handle.db.insert(webhookReceipts).values({
    id: seed + ':receipt',
    ownerId: 'local',
    loopId: identity.loopId,
    triggerNodeId: 'start',
    contentHash: seed,
    inboundId: seed + ':inbound',
    status: 'admitted',
    intent: {
      run,
      initialThread: sampleThread(),
      queued: {
        type: 'run.queued',
        versionId: run.versionId,
        pinned: run.pinned,
        initialThread: sampleThread(),
      },
      pinnedLoopIds: [identity.loopId],
    },
  });
  await handle.db.insert(inboundEvents).values({
    id: seed + ':inbound',
    ownerId: 'local',
    type: 'test',
    payload: 'null',
    source: 'webhook:' + seed + ':hook',
    receivedAt: FIXTURE_TS,
    runIds: [run.id],
  });
}

async function snapshot() {
  const tables = await handle.client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return Promise.all(
    tables.rows.map(async (row) => {
      const name = row['name'] as string;
      return [
        name,
        (
          await handle.client.execute(
            'SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid',
          )
        ).rows,
      ];
    }),
  );
}

describe('loop deletion', () => {
  it('deletes terminal runs and every dependent table, leaving no orphan run (D5)', async () => {
    const identity = await published('delete');
    const sibling = await published('unrelated');
    await loops.saveDraft(identity.loopId, LoopDefinitionSchema.parse(minimalLoop()));
    const terminal = await Promise.all(
      (['succeeded', 'failed', 'cancelled', 'exhausted'] as const).map((status) =>
        storedRun(status, identity, status),
      ),
    );
    await triggers(identity, 'delete', terminal[0]!);
    expect(await loops.delete(identity.loopId)).toBe(true);
    expect(await loops.getLoop(identity.loopId)).toBeUndefined();
    expect(await loops.listVersions(identity.loopId)).toEqual([]);
    expect(await loops.getLoop(sibling.loopId)).toBeDefined();
    expect(await loops.getVersion(sibling.versionId)).toBeDefined();
    for (const table of [
      runs,
      runEvents,
      harnessSessions,
      timers,
      schedules,
      webhookEndpoints,
      webhookReceipts,
    ]) {
      expect(await handle.db.select().from(table)).toEqual([]);
    }
    expect(await handle.db.select().from(inboundEvents)).toMatchObject([{ runIds: [] }]);
    expect(await repo.getThread(terminal[0]!.id)).toBeUndefined();
    expect(await repo.getThreadCheckpoint(terminal[0]!.id)).toBeUndefined();
    expect(await repo.deleteOrphans()).toBe(0);
  });

  it('prunes only the deleted loop run from a shared inbound event', async () => {
    const removedLoop = await published('removed');
    const otherLoop = await published('other');
    const removed = await storedRun('removed', removedLoop);
    const retained = await storedRun('retained', otherLoop);
    await handle.db.insert(inboundEvents).values({
      id: 'shared',
      ownerId: 'local',
      type: 'shared',
      payload: 'null',
      source: 'api',
      receivedAt: FIXTURE_TS,
      runIds: [removed.id, retained.id],
    });

    expect(await loops.delete(removedLoop.loopId)).toBe(true);
    expect(await handle.db.select().from(inboundEvents)).toMatchObject([
      { id: 'shared', runIds: [retained.id] },
    ]);
    expect(await repo.get(removed.id)).toBeUndefined();
    expect(await repo.get(retained.id)).toEqual(retained);
  });

  it('deletes a loop without runs and returns false for a missing loop', async () => {
    const identity = await published('empty');
    expect(await loops.delete(identity.loopId)).toBe(true);
    expect(await loops.delete(identity.loopId)).toBe(false);
    expect(await loops.listVersions(identity.loopId)).toEqual([]);
  });

  it.each(['queued', 'running', 'waiting', 'paused'] as const)(
    'refuses a %s run without changing any table',
    async (status) => {
      const identity = await published('busy');
      const run = await storedRun('active', identity, status);
      await triggers(identity, 'busy', run);
      const before = await snapshot();
      await expect(loops.delete(identity.loopId)).rejects.toThrow(LoopInUseError);
      expect(await snapshot()).toEqual(before);
    },
  );

  it('rolls back every deletion and link update when deleting the loop row fails', async () => {
    const identity = await published('rollback');
    const run = await storedRun('rollback', identity);
    await triggers(identity, 'rollback', run);
    await handle.client.execute(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON loops BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    const before = await snapshot();
    await expect(loops.delete(identity.loopId)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it('preserves another loop and its parent/child history, detaching surviving children only', async () => {
    const removed = await published('removed');
    const other = await published('other');
    const parent = await storedRun('parent', other);
    const child = await storedRun('child', removed, 'succeeded', parent.id);
    const survivor = await storedRun('survivor', other, 'succeeded', child.id);
    await triggers(other, 'other', parent);
    await handle.db.insert(inboundEvents).values({
      id: 'shared',
      ownerId: 'local',
      type: 'shared',
      payload: 'null',
      source: 'api',
      receivedAt: FIXTURE_TS,
      runIds: [child.id, parent.id, survivor.id],
    });
    await handle.db.insert(runEvents).values({
      runId: parent.id,
      seq: 2,
      ts: FIXTURE_TS,
      type: 'child_run.started',
      nodeId: 'sub',
      payload: { childRunId: child.id },
    });
    const parentThread = await repo.getThread(parent.id);
    expect(await loops.delete(removed.loopId)).toBe(true);
    expect(await repo.get(child.id)).toBeUndefined();
    expect(await repo.get(parent.id)).toEqual(parent);
    expect(await repo.getThread(parent.id)).toEqual(parentThread);
    expect(await repo.get(survivor.id)).toEqual({ ...survivor, parentRunId: undefined });
    expect(await handle.db.select().from(runEvents)).toHaveLength(3);
    expect(await handle.db.select().from(harnessSessions)).toHaveLength(2);
    expect(await handle.db.select().from(timers)).toHaveLength(2);
    expect(await handle.db.select().from(schedules)).toMatchObject([
      { loopId: other.loopId, enabled: true },
    ]);
    expect(await handle.db.select().from(webhookEndpoints)).toMatchObject([
      { loopId: other.loopId, enabled: true },
    ]);
    expect(await handle.db.select().from(webhookReceipts)).toHaveLength(1);
    expect(await handle.db.select().from(inboundEvents)).toMatchObject([
      { runIds: [parent.id] },
      { runIds: [parent.id, survivor.id] },
    ]);
  });

  it('deletes only orphan runs and their dependents, including active historical orphans', async () => {
    const healthy = await published('healthy');
    const keep = await storedRun('keep', healthy);
    const missingVersion = await storedRun('missing-version', {
      loopId: healthy.loopId,
      versionId: fakeUlid('gone-version'),
    });
    const missingLoop = await storedRun(
      'missing-loop',
      { loopId: fakeUlid('gone-loop'), versionId: healthy.versionId },
      'paused',
    );
    await triggers(healthy, 'healthy', keep);
    // An admitted orphan receipt also contains a frozen run/version, so it must disappear.
    await triggers(
      { loopId: missingLoop.loopId, versionId: missingLoop.versionId },
      'orphan',
      missingLoop,
    );
    const healthyThread = await repo.getThread(keep.id);
    expect(await repo.deleteOrphans()).toBe(2);
    expect(await repo.get(missingVersion.id)).toBeUndefined();
    expect(await repo.get(missingLoop.id)).toBeUndefined();
    expect(await repo.get(keep.id)).toEqual(keep);
    expect(await repo.getThread(keep.id)).toEqual(healthyThread);
    for (const table of [runs, runEvents, harnessSessions, timers]) {
      expect(await handle.db.select().from(table)).toHaveLength(1);
    }
    expect(await handle.db.select().from(webhookReceipts)).toMatchObject([
      { id: 'healthy:receipt' },
    ]);
    // This function repairs runs only; it does not sweep unrelated loop/trigger rows.
    expect(await handle.db.select().from(schedules)).toHaveLength(2);
    expect(await handle.db.select().from(webhookEndpoints)).toHaveLength(2);
    expect(await loops.getVersion(healthy.versionId)).toBeDefined();
    expect(await loops.getLoop(healthy.loopId)).toBeDefined();
    expect(await repo.deleteOrphans()).toBe(0);
  });

  it('rolls back orphan cleanup when a dependent delete fails', async () => {
    await storedRun('orphan', {
      loopId: fakeUlid('gone-loop'),
      versionId: fakeUlid('gone-version'),
    });
    await handle.client.execute(
      "CREATE TRIGGER fail_run BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    const before = await snapshot();
    await expect(repo.deleteOrphans()).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
});
