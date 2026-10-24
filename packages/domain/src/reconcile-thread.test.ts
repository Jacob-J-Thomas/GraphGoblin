import { expect, it } from 'vitest';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { reconcileThread } from './reconcile-thread.js';
import type { ThreadReplayEvent } from './replay.js';

it('reconciles only durable completions and carries visits across every verified checkpoint', () => {
  const initial = sampleThread({ vars: {} });
  const events: ThreadReplayEvent[] = [
    { seq: 1, type: 'node.started', nodeId: 'a' },
    {
      seq: 2,
      type: 'node.finished',
      nodeId: 'a',
      patch: [{ op: 'add', path: '/vars/items', value: [] }],
    },
    { seq: 3, type: 'node.started', nodeId: 'b' },
    { seq: 4, type: 'run.failed' },
    { seq: 5, type: 'run.resumed' },
    { seq: 6, type: 'node.started', nodeId: 'b' },
    {
      seq: 7,
      type: 'node.finished',
      nodeId: 'b',
      patch: [{ op: 'add', path: '/vars/items/-', value: 'once' }],
    },
    {
      seq: 8,
      type: 'node.finished',
      nodeId: 'b',
      patch: [{ op: 'add', path: '/vars/items/-', value: 'duplicate' }],
    },
    { seq: 9, type: 'run.finished' },
  ];
  const before = JSON.stringify({ initial, events });
  for (const boundary of events) {
    const expected = reconcileThread(initial, events, undefined, boundary.seq);
    for (const checkpointEvent of events) {
      const checkpoint = {
        seq: checkpointEvent.seq,
        thread: reconcileThread(initial, events, undefined, checkpointEvent.seq),
      };
      expect(reconcileThread(initial, events, checkpoint, boundary.seq)).toEqual(expected);
    }
  }
  expect(reconcileThread(initial, events).vars).toEqual({ items: ['once'] });
  expect(reconcileThread(initial, events, undefined, 6).vars).toEqual({ items: [] });
  expect(reconcileThread(initial, events, undefined, 6).counters.nodeVisits.b).toBe(2);
  expect(JSON.stringify({ initial, events })).toBe(before);
  expect(reconcileThread(initial, events, { seq: 99, thread: sampleThread() })).toEqual(
    reconcileThread(initial, events),
  );
  expect(reconcileThread(initial, [], { seq: 1, thread: sampleThread() })).toBe(initial);
});

it('uses a proven checkpoint state with only its boundary event and tail', () => {
  const initial = sampleThread({ vars: {} });
  const history: ThreadReplayEvent[] = [
    { seq: 1, type: 'node.started', nodeId: 'a' },
    {
      seq: 2,
      type: 'node.finished',
      nodeId: 'a',
      patch: [{ op: 'add', path: '/vars/items', value: [] }],
    },
    {
      seq: 3,
      type: 'node.finished',
      nodeId: 'a',
      patch: [{ op: 'add', path: '/vars/items/-', value: 'duplicate' }],
    },
    { seq: 4, type: 'node.started', nodeId: 'b' },
  ];
  const checkpoint = {
    seq: 2,
    thread: reconcileThread(initial, history, undefined, 2),
    replayState: { strict: true },
  };
  expect(reconcileThread(checkpoint.thread, history.slice(1), checkpoint)).toEqual(
    reconcileThread(initial, history),
  );
  expect(reconcileThread(initial, history, checkpoint, 1)).toEqual(
    reconcileThread(initial, history, undefined, 1),
  );
});
