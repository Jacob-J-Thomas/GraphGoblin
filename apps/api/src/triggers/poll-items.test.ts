import { describe, expect, it, vi } from 'vitest';
import { PollItemsSchema, type JsonValue, type RunRecord } from '@graphgoblin/contracts';
import { admitPollItems } from './poll-items.js';
const config = PollItemsSchema.parse({ select: 'probe', dedupeKey: '$string(item)' });
const view = (probe: JsonValue) => ({ now: '2026-10-02T12:00:00.000Z', probe });
const run = (key: string): RunRecord => ({
  id: key,
  ownerId: 'local',
  loopId: 'loop',
  versionId: 'version',
  invocationId: key,
  status: 'queued',
  iteration: 1,
  createdAt: '2026-10-02T12:00:00.000Z',
  lastEventSeq: 1,
});

describe('bounded poll item admission', () => {
  it('validates every key before the single lookup and admits unseen candidates sequentially up to the default cap', async () => {
    const calls: string[] = [];
    const findSeen = vi.fn((keys: readonly string[]) => {
      calls.push('lookup');
      expect(keys).toEqual(Array.from({ length: 12 }, (_, i) => String(i)));
      return Promise.resolve(new Set(['0', '2', '4', '6', '8']));
    });
    const result = await admitPollItems(config, view(Array.from({ length: 12 }, (_, i) => i)), {
      findSeen,
      start: (item) => {
        calls.push(item.dedupeKey);
        return Promise.resolve(run(item.dedupeKey));
      },
    });
    expect(calls).toEqual(['lookup', '1', '3', '5', '7', '9']);
    expect(findSeen).toHaveBeenCalledOnce();
    expect(result.runs.map((r) => r.id)).toEqual(['1', '3', '5', '7', '9']);
    expect(result.failedItemIndex).toBeUndefined();
  });
  it('does no I/O for an empty set or any invalid key beyond the dispatch cap', async () => {
    const findSeen = vi.fn(() => Promise.resolve(new Set<string>()));
    const start = vi.fn(() => Promise.resolve(run('never')));
    expect(await admitPollItems(config, view([]), { findSeen, start })).toEqual({ runs: [] });
    await expect(
      admitPollItems(
        { ...config, dedupeKey: 'index = 6 ? "" : $string(item)' },
        view([0, 1, 2, 3, 4, 5, 6]),
        { findSeen, start },
      ),
    ).rejects.toMatchObject({ code: 'POLL_ITEMS_INVALID', itemIndex: 6 });
    expect(findSeen).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it('stops at the first admission failure while preserving prior runs and leaves the tail for a later poll', async () => {
    const started: string[] = [];
    const deps = {
      findSeen: () => Promise.resolve(new Set(started)),
      start: (item: { dedupeKey: string }) => {
        if (item.dedupeKey === '2')
          return Promise.reject(new Error('credential-bearing-process-detail'));
        started.push(item.dedupeKey);
        return Promise.resolve(run(item.dedupeKey));
      },
    };
    const first = await admitPollItems(config, view([1, 2, 3]), deps);
    expect(first.runs.map((r) => r.id)).toEqual(['1']);
    expect(first.failedItemIndex).toBe(1);
    expect(started).toEqual(['1']);
    expect(JSON.stringify(first)).not.toContain('credential-bearing');
    const second = await admitPollItems(config, view([1, 2, 3]), {
      ...deps,
      start: (item) => {
        started.push(item.dedupeKey);
        return Promise.resolve(run(item.dedupeKey));
      },
    });
    expect(second.runs.map((r) => r.id)).toEqual(['2', '3']);
  });
  it('does not consume the dispatch cap for an atomic key reservation found after lookup', async () => {
    const start = vi.fn((item: { dedupeKey: string }) =>
      Promise.resolve(item.dedupeKey === '1' ? undefined : run(item.dedupeKey)),
    );
    const result = await admitPollItems({ ...config, maxRunsPerPoll: 1 }, view([1, 2, 3]), {
      findSeen: () => Promise.resolve(new Set<string>()),
      start,
    });
    expect(start.mock.calls.map(([item]) => item.dedupeKey)).toEqual(['1', '2']);
    expect(result.runs.map((r) => r.id)).toEqual(['2']);
    expect(result.failedItemIndex).toBeUndefined();
  });
  it('reports safe lookup failure without starting a run and skips fully seen sets', async () => {
    const start = vi.fn(() => Promise.resolve(run('never')));
    await expect(
      admitPollItems(config, view([1]), {
        findSeen: () => {
          return Promise.reject(new Error('private-url-secret'));
        },
        start,
      }),
    ).rejects.toThrow('POLL_DEDUPE_LOOKUP_FAILED');
    expect(start).not.toHaveBeenCalled();
    expect(
      await admitPollItems(config, view([1]), {
        findSeen: () => Promise.resolve(new Set(['1'])),
        start,
      }),
    ).toEqual({ runs: [] });
    expect(start).not.toHaveBeenCalled();
  });
});
