import type { RunEvent } from '@graphgoblin/contracts';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { describe, expect, it, vi } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import { quotaSafeSessionStorage, useRunEventStore } from './event-store.js';
import {
  describeEvent,
  initialThreadFrom,
  nodeActivity,
  patchDiff,
  threadAt,
  tryThreadAt,
} from './projections.js';

const R = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const actor = { kind: 'user' as const, id: 'local' };
const channel = { kind: 'log' as const };
const usage = { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, reasoningOutputTokens: 0 };

const ALL: RunEvent[] = [
  event(R, 1, 'run.queued', {}),
  event(R, 2, 'run.started', { attempt: 1 }),
  event(R, 3, 'run.paused', { actor }),
  event(R, 4, 'run.resumed', { actor }),
  event(R, 5, 'run.cancel_requested', { actor }),
  event(R, 6, 'run.waiting', { nodeId: 'w', wait: { nodeId: 'w', kind: 'input' } }),
  event(R, 7, 'run.woken', { nodeId: 'w', reason: 'input' }),
  event(R, 8, 'iteration.incremented', { from: 1, to: 2, targetNodeId: 'a' }),
  event(R, 9, 'node.started', { nodeId: 'a', kind: 'mutate', attempt: 1, configHash: 'h' }),
  event(R, 10, 'node.finished', {
    nodeId: 'a',
    patch: [{ op: 'replace', path: '/vars/topic', value: 'x' }],
    durationMs: 3,
    route: 'good',
  }),
  event(R, 11, 'node.progress', { nodeId: 'i', progress: 'p' }),
  event(R, 12, 'harness.session', { nodeId: 'i', harness: 'codex', sessionId: 's', mode: 'fresh' }),
  event(R, 13, 'harness.usage', { nodeId: 'i', usage }),
  event(R, 14, 'decision.made', { nodeId: 'd', strategy: 'jev', route: 'good' }),
  event(R, 15, 'signal.received', { name: 'go' }),
  event(R, 16, 'input.received', { nodeId: 'w', payload: 1 }),
  event(R, 17, 'heartbeat.beat', { nodeId: 'h', beat: 1 }),
  event(R, 18, 'child_run.started', { nodeId: 's', childRunId: R }),
  event(R, 19, 'child_run.finished', { nodeId: 's', childRunId: R, status: 'succeeded' }),
  event(R, 20, 'return.delivered', { channel }),
  event(R, 21, 'return.failed', { channel, error: 'e' }),
  event(R, 22, 'run.failed', {
    failure: { code: 'INTERNAL_ERROR', message: 'boom', resumable: true },
  }),
  event(R, 23, 'run.cancelled', {}),
  event(R, 24, 'run.finished', { status: 'succeeded', outcome: 'success' }),
  event(R, 25, 'node.finished', {
    nodeId: 'b',
    patch: [{ op: 'remove', path: '/vars/count' }],
    durationMs: 1,
  }),
];

describe('run projections', () => {
  it('describes every event type', () => {
    const lines = ALL.map(describeEvent);
    expect(lines).toContain('attempt 1');
    expect(lines).toContain('by user local');
    expect(lines).toContain('w waits for input');
    expect(lines).toContain('w woken by input');
    expect(lines).toContain('iteration 1 → 2 at a');
    expect(lines).toContain('a (mutate) attempt 1');
    expect(lines).toContain('a → good, 1 change, 3 ms');
    expect(lines).toContain('go');
    expect(lines).toContain('log');
    expect(lines).toContain('INTERNAL_ERROR: boom');
    expect(lines).toContain('succeeded (success)');
    expect(lines).toContain('b, 1 change, 1 ms');
    expect(lines[0]).toBe('');
  });

  it('reconstructs the thread at any event and diffs a patch', () => {
    const current = sampleThread({ run: { ...sampleThread().run, iteration: 2 } });
    const initial = initialThreadFrom(current);
    expect(initial).toMatchObject({ messages: [], vars: {}, run: { iteration: 1 } });
    const at9 = threadAt(initial, ALL, 9);
    expect(at9.run.iteration).toBe(2);
    expect(at9.counters.nodeVisits).toEqual({ a: 1 });
    const withTopic = { ...initial, vars: { topic: 'old', count: 1 } };
    const before = threadAt(withTopic, ALL, 9);
    const after = threadAt(withTopic, ALL, 10);
    expect(after.vars['topic']).toBe('x');
    const finished = ALL[9] as Extract<RunEvent, { type: 'node.finished' }>;
    expect(patchDiff(before, after, finished.patch)).toEqual([
      { op: 'replace', path: '/vars/topic', before: 'old', after: 'x' },
    ]);
    expect(
      patchDiff(before, after, [{ op: 'move', from: '/vars/a', path: '/vars/b' }])[0],
    ).toMatchObject({ from: '/vars/a', before: undefined });
  });

  it('groups node activity for the progress drawer', () => {
    const activity = nodeActivity(ALL);
    expect([...activity.keys()]).toEqual(['i', 'd', 'h']);
    expect(activity.get('i')).toHaveLength(3);
  });

  it('keeps per-run logs, ignores replays, and evicts old runs', () => {
    const { append, clear } = useRunEventStore.getState();
    append('r1', ALL[0]!);
    append('r1', ALL[0]!);
    expect(useRunEventStore.getState().runs['r1']?.events).toHaveLength(1);
    for (let i = 0; i < 21; i += 1) append(`bulk${i}`, ALL[0]!);
    expect(Object.keys(useRunEventStore.getState().runs)).toHaveLength(20);
    expect(useRunEventStore.getState().runs['r1']).toBeUndefined();
    clear('bulk20');
    expect(useRunEventStore.getState().runs['bulk20']).toBeUndefined();
    expect(sessionStorage.getItem('graphgoblin-run-events')).toContain('bulk19');
  });
});

describe('initial thread and replay failures', () => {
  it('starts from the thread recorded on run.queued, seed included', () => {
    const seeded = sampleThread();
    const events = [event(R, 1, 'run.queued', { initialThread: seeded }), ...ALL.slice(1)];
    expect(initialThreadFrom(sampleThread({ messages: [] }), events)).toBe(seeded);
    // Without the field (older logs) it falls back to empty collections.
    expect(initialThreadFrom(seeded, ALL).messages).toEqual([]);
  });

  it('reports a patch that does not apply instead of throwing', () => {
    const current = sampleThread();
    const bad = [
      event(R, 1, 'run.queued', {}),
      event(R, 2, 'node.finished', {
        nodeId: 'a',
        patch: [{ op: 'replace', path: '/outputs/missing', value: 1 }],
        durationMs: 1,
      }),
    ];
    const result = tryThreadAt(initialThreadFrom(current, bad), bad, 2);
    expect(result.ok).toBe(false);
    expect(tryThreadAt(initialThreadFrom(current, bad), bad, 1).ok).toBe(true);
  });

  it('appends batches in order and drops a full session storage copy instead of throwing', () => {
    const { append } = useRunEventStore.getState();
    append('batch', ALL[0]!, ALL[1]!, ALL[1]!, ALL[2]!);
    expect(useRunEventStore.getState().runs['batch']?.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    append('batch', ALL[0]!);
    expect(useRunEventStore.getState().runs['batch']?.lastSeq).toBe(3);

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    expect(() => quotaSafeSessionStorage.setItem('k', 'v')).not.toThrow();
    expect(removeItem).toHaveBeenCalledWith('k');
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});
