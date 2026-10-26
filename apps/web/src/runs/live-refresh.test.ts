import type { RunEvent } from '@graphgoblin/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cyclePass, event } from '../__fixtures__/fake-api.js';
import {
  createLiveRefresh,
  LIVE_REFRESH_MS,
  liveChanges,
  type LiveChanges,
} from './live-refresh.js';

const runId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const THREAD = { run: true, observation: false, thread: true };
const EVIDENCE = { run: true, observation: true, thread: false };
const RUN_ONLY = { run: true, observation: false, thread: false };
const ALL = { run: true, observation: true, thread: true };
const THREAD_ONLY = { run: false, observation: false, thread: true };

describe('liveChanges', () => {
  it('refreshes the thread after thread events and the evidence after evidence events only', () => {
    const progress = event(runId, 1, 'node.progress', {
      nodeId: 'ask',
      progress: { item: { id: 'i', type: 'reasoning', summary: 'thinking' } },
    });
    const usage = event(runId, 2, 'harness.usage', {
      nodeId: 'ask',
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0 },
    });
    const started = event(runId, 3, 'node.started', {
      nodeId: 'ask',
      kind: 'inference',
      attempt: 1,
      configHash: 'h',
    });
    const exit = event(runId, 4, 'exit.evaluated', { nodeId: 'end', outcome: 'success' });
    const decision = cyclePass(runId, 5, 1)[3]!;
    expect(liveChanges([progress, usage])).toEqual(RUN_ONLY);
    expect(liveChanges([progress, started])).toEqual(THREAD);
    expect(liveChanges([usage, exit])).toEqual(EVIDENCE);
    expect(liveChanges([decision])).toEqual(ALL);
    expect(liveChanges([])).toEqual(RUN_ONLY);
    // A change observed without events can have changed anything.
    expect(liveChanges()).toEqual(ALL);
  });
});

describe('createLiveRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A refresh that records its changes and stays in flight until released. */
  function recorder() {
    const calls: LiveChanges[] = [];
    const releases: (() => void)[] = [];
    const refresh = (changes: LiveChanges) => {
      calls.push(changes);
      return new Promise<void>((resolve) => releases.push(resolve));
    };
    const release = async () => {
      releases.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    };
    return { calls, refresh, release };
  }

  it('refreshes at once after a quiet interval and merges a burst into one trailing refresh', async () => {
    const { calls, refresh, release } = recorder();
    const live = createLiveRefresh(refresh);
    live.request(RUN_ONLY);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([RUN_ONLY]);
    await release();
    // One hundred batches within the interval become one refresh carrying every change.
    for (let i = 0; i < 100; i++) live.request(i === 40 ? THREAD : i === 70 ? EVIDENCE : RUN_ONLY);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([RUN_ONLY, ALL]);
    await release();
    // Nothing pending: no further refresh, however long the reader waits.
    await vi.advanceTimersByTimeAsync(10 * LIVE_REFRESH_MS);
    expect(calls).toHaveLength(2);
    live.request(THREAD);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);
  });

  it('never overlaps refreshes: changes during a slow refresh wait for it to finish', async () => {
    const { calls, refresh, release } = recorder();
    const live = createLiveRefresh(refresh);
    live.request(RUN_ONLY);
    await vi.advanceTimersByTimeAsync(0);
    for (let tick = 0; tick < 20; tick++) {
      live.request(THREAD);
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS);
    }
    // Ten intervals passed with the first refresh still in flight.
    expect(calls).toHaveLength(1);
    await release();
    expect(calls).toEqual([RUN_ONLY, THREAD]);
  });

  it('keeps changes a refresh could not read for the next requested refresh, without retrying alone', async () => {
    const calls: LiveChanges[] = [];
    const outcomes: (() => Promise<LiveChanges | void>)[] = [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve({ run: false, observation: true, thread: false }),
      () => Promise.resolve(),
    ];
    const live = createLiveRefresh((changes) => {
      calls.push(changes);
      return outcomes.shift()!();
    });
    live.request(THREAD);
    await vi.advanceTimersByTimeAsync(0);
    // A failed refresh does not start another by itself.
    await vi.advanceTimersByTimeAsync(10 * LIVE_REFRESH_MS);
    expect(calls).toEqual([THREAD]);
    // The next change carries the unread one; a partly failed read keeps only what failed.
    live.request(THREAD_ONLY);
    await vi.advanceTimersByTimeAsync(0);
    live.request({ run: false, observation: false, thread: false });
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS);
    expect(calls).toEqual([THREAD, THREAD, { run: false, observation: true, thread: false }]);
    live.request(RUN_ONLY);
    live.dispose();
    live.request(THREAD);
    await vi.advanceTimersByTimeAsync(10 * LIVE_REFRESH_MS);
    expect(calls).toHaveLength(3);
  });

  it('bounds refreshes by elapsed time, not by the event rate', async () => {
    const { calls, refresh, release } = recorder();
    const live = createLiveRefresh(refresh);
    const batches: RunEvent[][] = [];
    // A run appending 1,000 events a second, delivered in 100 ms batches for ten seconds.
    for (let batch = 0; batch < 100; batch++)
      batches.push(
        Array.from({ length: 100 }, (_, i) =>
          event(runId, batch * 100 + i + 1, 'node.started', {
            nodeId: 'grow',
            kind: 'mutate',
            attempt: 1,
            configHash: 'h',
          }),
        ),
      );
    for (const batch of batches) {
      live.request(liveChanges(batch));
      await vi.advanceTimersByTimeAsync(100);
      if (calls.length > 0) await release();
    }
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS);
    await release();
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(10_000 / LIVE_REFRESH_MS) + 1);
    expect(calls.length).toBeGreaterThanOrEqual(10_000 / LIVE_REFRESH_MS - 1);
  });
});
