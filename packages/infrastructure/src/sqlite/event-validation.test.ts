import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeUlid, FIXTURE_IDS, FIXTURE_TS, samplePin } from '@graphgoblin/contracts/testing';
import { FakeClock } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';

let handle: DatabaseHandle;
const runId = fakeUlid('invalid-event');
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
