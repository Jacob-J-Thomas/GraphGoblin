import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { FakeClock } from '@graphgoblin/engine/testing';
import type { EventDraft } from '@graphgoblin/engine';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { InvalidStoredRunEventError, SqliteEventStore } from './events.js';

let handle: DatabaseHandle;
let events: SqliteEventStore;
const runId = fakeUlid('lifecycle-tail');
const finished = {
  type: 'run.finished',
  status: 'succeeded',
  outcome: 'success',
  result: 'done',
} as const;
const audit = {
  type: 'return.delivered',
  channel: { kind: 'caller' },
  target: 'run.result',
} as const;

beforeEach(async () => {
  handle = await openMemoryDatabase();
  events = new SqliteEventStore(handle.db, new FakeClock());
});
afterEach(() => handle.close());

describe('indexed lifecycle tail', () => {
  it('returns no marker for an empty or unrelated history, isolated by run', async () => {
    await events.append(fakeUlid('other-lifecycle-run'), [finished]);
    expect(await events.lastLifecycleEvent(runId)).toBeUndefined();
    await events.append(runId, [{ type: 'run.woken', nodeId: 'wait', reason: 'manual' }]);
    expect(await events.lastLifecycleEvent(runId)).toBeUndefined();
  });

  it('finds a terminal marker before thousands of delivery audits without decoding older rows', async () => {
    await events.append(runId, [{ type: 'run.woken', nodeId: 'wait', reason: 'manual' }]);
    const [terminal] = await events.append(runId, [finished]);
    for (let i = 0; i < 30; i++)
      await events.append(
        runId,
        Array.from({ length: 100 }, () => audit),
      );
    await handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 1',
      args: ['{', runId],
    });
    expect(await events.lastLifecycleEvent(runId)).toEqual(terminal);
  });

  it.each(['run.started', 'run.resumed'] as const)(
    'lets %s invalidate an old failure before a later outcome',
    async (type) => {
      const failed: EventDraft = {
        type: 'run.failed',
        failure: { code: 'HARNESS_TURN_FAILED', message: 'retry', resumable: true },
      };
      const reset: EventDraft =
        type === 'run.started'
          ? { type, attempt: 2 }
          : { type, actor: { kind: 'user', id: 'local' } };
      const [, marker] = await events.append(runId, [failed, reset]);
      expect(await events.lastLifecycleEvent(runId)).toEqual(marker);
      const [terminal] = await events.append(runId, [finished, audit]);
      expect(await events.lastLifecycleEvent(runId)).toEqual(terminal);
      const [cancelled] = await events.append(runId, [{ type: 'run.cancelled' }]);
      expect(await events.lastLifecycleEvent(runId)).toEqual(cancelled);
    },
  );

  it('rejects corrupt current lifecycle payloads with their stored row identity', async () => {
    await events.append(runId, [{ type: 'run.cancelled' }]);
    await handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 1',
      args: ['{', runId],
    });
    await expect(events.lastLifecycleEvent(runId)).rejects.toMatchObject({
      name: InvalidStoredRunEventError.name,
      runId,
      seq: 1,
      eventType: 'run.cancelled',
    });
  });
});
