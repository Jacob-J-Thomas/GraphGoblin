import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@graphgoblin/contracts';
import { FIXTURE_IDS, FIXTURE_TS, sampleThread } from '@graphgoblin/contracts/testing';
import { replayThread, summarizeRun } from './replay.js';

function ev<T extends RunEvent['type']>(
  seq: number,
  type: T,
  rest: Omit<Extract<RunEvent, { type: T }>, 'runId' | 'seq' | 'ts' | 'type'>,
): RunEvent {
  return { runId: FIXTURE_IDS.run, seq, ts: FIXTURE_TS, type, ...rest } as RunEvent;
}

const events: RunEvent[] = [
  ev(1, 'run.queued', {}),
  ev(2, 'run.started', { attempt: 1 }),
  ev(3, 'node.started', { nodeId: 'prep', kind: 'mutate', attempt: 1, configHash: 'h' }),
  ev(4, 'node.finished', {
    nodeId: 'prep',
    patch: [{ op: 'add', path: '/vars/x', value: 1 }],
    route: 'out',
    durationMs: 1,
  }),
  ev(5, 'node.started', { nodeId: 'approve', kind: 'wait', attempt: 1, configHash: 'h' }),
  ev(6, 'run.waiting', { nodeId: 'approve', wait: { nodeId: 'approve', kind: 'input' } }),
  ev(7, 'run.woken', { nodeId: 'approve', reason: 'input' }),
  ev(8, 'node.finished', {
    nodeId: 'approve',
    patch: [{ op: 'replace', path: '/vars/x', value: 2 }],
    route: 'out',
    durationMs: 1,
  }),
  ev(9, 'iteration.incremented', { from: 1, to: 2, targetNodeId: 'prep' }),
  ev(10, 'node.started', { nodeId: 'prep', kind: 'mutate', attempt: 1, configHash: 'h' }),
  ev(11, 'run.paused', { actor: { kind: 'user', id: 'u' } }),
  ev(12, 'run.resumed', { actor: { kind: 'user', id: 'u' } }),
  ev(13, 'run.finished', { status: 'succeeded', outcome: 'success' }),
];

describe('replayThread', () => {
  it('replays patches and iteration changes', () => {
    const thread = replayThread(sampleThread(), events);
    expect(thread.vars['x']).toBe(2);
    expect(thread.run.iteration).toBe(2);
    expect(thread.counters.nodeVisits).toEqual({ start: 1, prep: 2, approve: 1 });
  });

  it('stops at a sequence number', () => {
    const thread = replayThread(sampleThread(), events, 4);
    expect(thread.vars['x']).toBe(1);
    expect(thread.counters.nodeVisits).toEqual({ start: 1, prep: 1 });
    expect(thread.run.iteration).toBe(1);
  });
});

describe('summarizeRun', () => {
  it('derives status, position, and visits', () => {
    expect(summarizeRun(events)).toEqual({
      status: 'succeeded',
      currentNodeId: 'prep',
      iteration: 2,
      lastSeq: 13,
      nodeVisits: { prep: 2, approve: 1 },
    });
    expect(summarizeRun(events.slice(0, 6))).toMatchObject({
      status: 'waiting',
      currentNodeId: 'approve',
    });
    expect(summarizeRun(events.slice(0, 11))).toMatchObject({ status: 'paused' });
    expect(summarizeRun([])).toEqual({
      status: 'queued',
      iteration: 1,
      lastSeq: 0,
      nodeVisits: {},
    });
    expect(summarizeRun([ev(1, 'run.cancelled', {})]).status).toBe('cancelled');
    expect(
      summarizeRun([
        ev(1, 'run.failed', { failure: { code: 'INTERNAL_ERROR', message: 'x', resumable: true } }),
      ]).status,
    ).toBe('failed');
  });
});
