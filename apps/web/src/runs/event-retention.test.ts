import { afterEach, expect, it, vi } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import { MAX_HISTORY_BYTES, timelineEvents, useRunEventStore } from './event-store.js';

afterEach(() => {
  useRunEventStore.setState({ runs: {} });
  vi.restoreAllMocks();
});
const events = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => event('long', from + i, 'run.started', { attempt: 1 }));
it('bounds one long run in memory and the persisted cache while retaining its resume cursor', () => {
  for (let offset = 0; offset < 5_000; offset += 100)
    useRunEventStore.getState().append('long', ...events(offset + 1, 100));
  const log = useRunEventStore.getState().runs['long']!;
  expect(log.events.length).toBeLessThanOrEqual(512);
  expect(log.lastSeq).toBe(5_000);
  expect(JSON.stringify(log).length * 2).toBeLessThan(1_100_000);
  expect(log.events[0]?.seq).toBe(4489);
});
it('enforces the byte budget independently of count and retains an oversized event identity', () => {
  for (let seq = 1; seq <= 50; seq++)
    useRunEventStore.getState().append(
      'long',
      event('long', seq, 'run.woken', {
        nodeId: 'wait',
        reason: 'manual',
        payload: 'x'.repeat(50_000),
      }),
    );
  const log = useRunEventStore.getState().runs['long']!;
  expect(log.bytes).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
  expect(log.events.length).toBeLessThan(50);
  useRunEventStore.getState().append(
    'long',
    event('long', 51, 'run.woken', {
      nodeId: 'wait',
      reason: 'manual',
      payload: 'x'.repeat(MAX_HISTORY_BYTES),
    }),
  );
  // The row keeps a short outline for labels; the oversized payload itself stays on the server.
  const [marker] = useRunEventStore.getState().runs['long']!.uncached;
  expect(marker).toMatchObject({
    seq: 51,
    type: 'run.woken',
    uncached: true,
    description: 'wait woken by manual',
    outline: { type: 'run.woken', nodeId: 'wait', reason: 'manual', payload: 'x'.repeat(256) },
  });
  // An outline that would itself be large is not kept: the row keeps its recorded description.
  useRunEventStore.getState().append(
    'long',
    event('long', 52, 'run.woken', {
      nodeId: 'wait',
      reason: 'manual',
      payload: Array.from({ length: 200_000 }, (_, i) => i),
    }),
  );
  const crowded = useRunEventStore.getState().runs['long']!.uncached.find((row) => row.seq === 52);
  expect(crowded).toEqual({
    seq: 52,
    type: 'run.woken',
    uncached: true,
    description: 'wait woken by manual',
  });
  expect(useRunEventStore.getState().runs['long']!.bytes).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
});
it('merges older and newer pages at an identical timestamp boundary without gaps or duplicates while live advances', async () => {
  const store = useRunEventStore.getState();
  store.append('long', ...events(1, 1000));
  store.window('long', { items: events(361, 128), olderCursor: 'opaque-old' }, 'older');
  let log = useRunEventStore.getState().runs['long']!;
  expect(timelineEvents(log).map((e) => e.seq)).toEqual(
    Array.from({ length: 512 }, (_, i) => i + 361),
  );
  store.append('long', ...events(1001, 300));
  log = useRunEventStore.getState().runs['long']!;
  expect(log.lastSeq).toBe(1300);
  expect(log.events.at(-1)?.seq).toBe(872);
  // Hydration restores both the browsed window and the independent live acknowledgement.
  useRunEventStore.setState({ runs: {} });
  // setState persists, so retain the persisted bytes first for a real hydration.
  store.append('reload', ...events(1, 700));
  const saved = sessionStorage.getItem('graphgoblin-run-events-v4')!;
  useRunEventStore.setState({ runs: {} });
  sessionStorage.setItem('graphgoblin-run-events-v4', saved);
  await useRunEventStore.persist.rehydrate();
  expect(useRunEventStore.getState().runs['reload']?.lastSeq).toBe(700);
  expect(useRunEventStore.getState().runs['reload']?.events).toHaveLength(512);
  store.window('reload', { items: events(701, 128), newerCursor: 'opaque-next' }, 'newer');
  expect(timelineEvents(useRunEventStore.getState().runs['reload']!).map((e) => e.seq)).toEqual(
    Array.from({ length: 512 }, (_, i) => i + 317),
  );
});
it('storage denial including failed cleanup remains nonfatal', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('denied');
  });
  expect(() => useRunEventStore.getState().append('long', ...events(1, 600))).not.toThrow();
  expect(useRunEventStore.getState().runs['long']?.lastSeq).toBe(600);
});
