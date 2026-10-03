import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@graphgoblin/contracts';
import { FIXTURE_IDS, FIXTURE_TS, sampleThread } from '@graphgoblin/contracts/testing';
import { replayStateAt, replayThread, summarizeRun } from './replay.js';

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

  it('applies a repeated record of the same completion once', () => {
    const add = ev(4, 'node.finished', {
      nodeId: 'prep',
      patch: [
        {
          op: 'add',
          path: '/messages/-',
          value: {
            id: 'm',
            role: 'user',
            content: 'once',
            nodeId: 'prep',
            ts: FIXTURE_TS,
            tags: [],
          },
        },
      ],
      route: 'out',
      durationMs: 1,
    });
    const twice = [...events.slice(0, 3), add, { ...add, seq: 5 }];
    const base = sampleThread();
    expect(replayThread(base, twice).messages).toHaveLength(base.messages.length + 1);
  });

  it('applies a delayed duplicate completion once, and carries the open visit across a checkpoint', () => {
    const base = sampleThread();
    const finished = (seq: number) =>
      ev(seq, 'node.finished', {
        nodeId: 'prep',
        patch: [{ op: 'add', path: '/messages/-', value: base.messages[0]! as never }],
        route: 'out',
        durationMs: 1,
      });
    const log = [
      ev(1, 'node.started', { nodeId: 'prep', kind: 'mutate', attempt: 1, configHash: 'h' }),
      finished(2),
      ev(3, 'node.started', { nodeId: 'next', kind: 'mutate', attempt: 1, configHash: 'h' }),
      finished(4), // a delayed duplicate of seq 2: no open visit of prep
    ];
    expect(replayThread(base, log).messages).toHaveLength(base.messages.length + 1);
    // A checkpoint after seq 1 (prep open) and one after seq 2 (nothing open).
    expect(replayStateAt(log, 1)).toEqual({ openNodeId: 'prep', strict: true });
    expect(replayStateAt(log, 2)).toEqual({ openNodeId: undefined, strict: true });
    expect(replayStateAt(log.slice(1), 2)).toEqual({ openNodeId: undefined, strict: false });
    const atTwo = replayThread(base, log, 2);
    const suffix = log.filter((e) => e.seq > 2);
    expect(replayThread(atTwo, suffix, undefined, replayStateAt(log, 2))).toEqual(
      replayThread(base, log),
    );
    const atOne = replayThread(base, log, 1);
    expect(
      replayThread(
        atOne,
        log.filter((e) => e.seq > 1),
        undefined,
        replayStateAt(log, 1),
      ),
    ).toEqual(replayThread(base, log));
    // A log without node.started (a hand-built fixture) applies every completion.
    expect(replayThread(base, [finished(2), finished(4)]).messages).toHaveLength(
      base.messages.length + 2,
    );
  });

  it('stops at a sequence number', () => {
    const thread = replayThread(sampleThread(), events, 4);
    expect(thread.vars['x']).toBe(1);
    expect(thread.counters.nodeVisits).toEqual({ start: 1, prep: 1 });
    expect(thread.run.iteration).toBe(1);
  });
});

describe('summarizeRun', () => {
  it('resumes a run paused while parked to waiting, and any other paused run to running', () => {
    const parked = events.slice(0, 6); // ends with run.waiting
    const actor = { kind: 'user' as const, id: 'u' };
    expect(
      summarizeRun([...parked, ev(7, 'run.paused', { actor }), ev(8, 'run.resumed', { actor })])
        .status,
    ).toBe('waiting');
    expect(
      summarizeRun([
        ...events.slice(0, 3),
        ev(4, 'run.paused', { actor }),
        ev(5, 'run.resumed', { actor }),
      ]).status,
    ).toBe('running');
  });

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
