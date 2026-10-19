import { afterEach, expect, it } from 'vitest';
import { RunFailureSchema } from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { FakeClock } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';

let handle: DatabaseHandle | undefined;
afterEach(() => handle?.close());

it('rejects the entire generated append before insert, sequence changes or publication', async () => {
  handle = await openMemoryDatabase();
  const store = new SqliteEventStore(handle.db, new FakeClock());
  const id = fakeUlid('atomic-validation');
  const first = await store.append(id, [{ type: 'run.queued' }]);
  const notifications: unknown[] = [];
  store.subscribe(id, (event) => notifications.push(event));
  await expect(
    store.append(id, [
      { type: 'run.cancelled' },
      {
        type: 'run.failed',
        failure: {
          code: 'INTERNAL_ERROR',
          message: 'x'.repeat(RunFailureSchema.shape.message.maxLength! + 1),
          resumable: false,
        },
      },
    ]),
  ).rejects.toMatchObject({ code: 'EVENT_INVALID' });
  expect(await store.read(id)).toEqual(first);
  expect(notifications).toEqual([]);
  expect(await store.append(id, [{ type: 'run.cancelled' }])).toMatchObject([{ seq: 2 }]);
  expect(notifications).toHaveLength(1);
});
