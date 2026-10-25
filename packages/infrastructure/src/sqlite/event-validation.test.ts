import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeUlid, FIXTURE_IDS, FIXTURE_TS, samplePin } from '@graphgoblin/contracts/testing';
import { FakeClock } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';

let handle: DatabaseHandle;
const runId = fakeUlid('invalid-event');

it('finds the latest gate past ungated decisions in one read model and reports malformed history', async () => {
  const store = new SqliteEventStore(handle.db, new FakeClock());
  const decision = {
    type: 'decision.made' as const,
    nodeId: 'gate',
    portId: 'done',
    provenance: {
      kind: 'expression' as const,
      provider: null,
      model: null,
      effort: null,
      classifierId: null,
    },
    diagnostics: [],
    observation: { kind: 'route' as const, routeId: 'done', confidence: null, reasoning: null },
  };
  const events = await store.append(runId, [
    {
      ...decision,
      gate: {
        previousPasses: 1,
        passes: 1,
        maxPasses: 3,
        repeatRouteId: 'repeat',
        elapsedSeconds: 0,
        limit: null,
      },
    },
    decision,
    decision,
  ]);
  expect(await store.latestGate(runId)).toEqual(events[0]);
  expect(await store.latestGate('absent')).toBeUndefined();
  await handle.client.execute({
    sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = ?',
    args: ['{invalid', runId, 3],
  });
  await expect(store.latestGate(runId)).rejects.toMatchObject({
    code: 'HISTORY_UNREADABLE',
    seq: 3,
  });
});
beforeEach(async () => {
  handle = await openMemoryDatabase();
});
afterEach(() => {
  handle.close();
});

describe('strict stored event reads', () => {
  it.each([
    { type: 'decision.made', payload: JSON.stringify({ strategy: 'expression', route: 'yes' }) },
    {
      type: 'decision.made',
      payload: JSON.stringify({
        strategy: 'expression',
        route: 'yes',
        skipped: [],
        private: 'secret-marker',
      }),
    },
    { type: 'unknown.event', payload: '{}' },
    { type: 'run.queued', payload: '{secret-marker' },
    { type: 'run.queued', payload: 'null' },
    { type: 'run.queued', payload: '[]' },
    { type: 'run.queued', payload: '7' },
    { type: 'run.queued', payload: '{}', nodeId: '' },
  ])(
    'rejects a whole page for invalid $type / $payload without revealing data',
    async ({ type, payload, nodeId }) => {
      const store = new SqliteEventStore(handle.db, new FakeClock());
      await store.append(runId, [
        { type: 'run.queued', versionId: FIXTURE_IDS.version, pinned: samplePin() },
      ]);
      await handle.client.execute({
        sql: 'INSERT INTO run_events (run_id, seq, ts, type, node_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
        args: [
          runId,
          2,
          FIXTURE_TS,
          type,
          nodeId ?? (type === 'decision.made' ? 'choose' : null),
          payload,
        ],
      });
      await store.append(runId, [{ type: 'run.cancelled' }]);
      await expect(store.read(runId)).rejects.toMatchObject({
        name: 'InvalidStoredRunEventError',
        runId,
        seq: 2,
        eventType: type,
        message: `Stored run event does not conform: run ${runId}, seq 2, type ${type}`,
      });
      await expect(store.read(runId, 0, 2)).rejects.toThrow(`seq 2, type ${type}`);
      expect(await store.read(runId, 0, 1)).toMatchObject([{ type: 'run.queued', seq: 1 }]);
      expect(await store.read(runId, 2)).toMatchObject([{ type: 'run.cancelled', seq: 3 }]);
      expect(await store.page(runId, 0, 1)).toMatchObject({
        items: [{ type: 'run.queued', seq: 1 }],
        nextAfter: 1,
        hasMore: true,
      });
      await expect(store.page(runId, 1, 1)).rejects.toThrow(`seq 2, type ${type}`);
      await expect(store.page(runId, 0, 3)).rejects.toThrow(`seq 2, type ${type}`);
      expect(await store.page(runId, 2, 1)).toMatchObject({
        items: [{ type: 'run.cancelled', seq: 3 }],
        nextAfter: 3,
        hasMore: false,
      });
      expect(await store.page(runId, 3, 1)).toEqual({ items: [], nextAfter: 3, hasMore: false });
    },
  );
});

it('reads bounded history windows in both directions and latest evidence without decoding unrelated rows', async () => {
  const store = new SqliteEventStore(handle.db, new FakeClock());
  const all = await store.append(runId, [
    { type: 'run.queued', versionId: FIXTURE_IDS.version, pinned: samplePin() },
    { type: 'run.started', attempt: 1 },
    { type: 'run.cancelled' },
    { type: 'run.started', attempt: 2 },
    { type: 'run.cancelled' },
  ]);
  expect(await store.window(runId, 5, 'older', 2)).toEqual({
    items: all.slice(2, 4),
    hasOlder: true,
    hasNewer: true,
    olderThan: 3,
    newerThan: 4,
  });
  expect(await store.window(runId, 0, 'newer', 2)).toEqual({
    items: all.slice(0, 2),
    hasOlder: false,
    hasNewer: true,
    olderThan: 1,
    newerThan: 2,
  });
  expect(await store.window(runId, 4, 'newer', 2)).toEqual({
    items: all.slice(4),
    hasOlder: true,
    hasNewer: false,
    olderThan: 5,
    newerThan: 5,
  });
  expect(await store.window('absent', 0, 'newer', 2)).toEqual({
    items: [],
    hasOlder: false,
    hasNewer: false,
    olderThan: 1,
    newerThan: 0,
  });
  // An empty page still bounds both sides at its seek position, so the event there stays
  // reachable: before the first event, and past the last.
  expect(await store.window(runId, 1, 'older', 2)).toEqual({
    items: [],
    hasOlder: false,
    hasNewer: true,
    olderThan: 1,
    newerThan: 0,
  });
  expect(await store.window(runId, 5, 'newer', 2)).toEqual({
    items: [],
    hasOlder: true,
    hasNewer: false,
    olderThan: 6,
    newerThan: 5,
  });
  // Past the tail, the older side ends at the last event, not one past the seek position.
  expect(await store.window(runId, Number.MAX_SAFE_INTEGER, 'newer', 2)).toEqual({
    items: [],
    hasOlder: true,
    hasNewer: false,
    olderThan: 6,
    newerThan: Number.MAX_SAFE_INTEGER,
  });
  const choice = {
    type: 'run.resumed' as const,
    actor: { kind: 'user' as const, id: 'local' },
    freshSession: {
      visitId: `${runId}:work:1`,
      harness: 'claude' as const,
      origin: 'resume-own' as const,
      model: 'sonnet',
      effort: 'low' as const,
      nodeId: 'work',
      failureSeq: 2,
      priorContextCarried: false as const,
    },
  };
  const resumes = await store.append(runId, [
    choice,
    { type: 'run.resumed', actor: { kind: 'user', id: 'local' } },
    choice,
  ]);
  expect(await store.freshSessionChoices(runId, 5)).toEqual([resumes[0], resumes[2]]);
  expect(await store.freshSessionChoices(runId, 1)).toEqual([resumes[2]]);
  expect(await store.latest(runId, 'run.cancelled')).toEqual(all[4]);
  expect(await store.latest(runId, 'run.cancelled', 5)).toEqual(all[2]);
  expect(await store.latest(runId, 'run.failed')).toBeUndefined();
});
