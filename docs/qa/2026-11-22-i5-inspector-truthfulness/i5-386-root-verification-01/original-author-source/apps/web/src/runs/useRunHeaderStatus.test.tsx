import type { RunEvent } from '@graphgoblin/contracts';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import { useRunHeaderStatus } from './useRunHeaderStatus.js';

const A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const B = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const finished = (runId: string, seq: number) =>
  event(runId, seq, 'run.finished', { status: 'succeeded', outcome: 'success' });
const resumed = (runId: string, seq: number) =>
  event(runId, seq, 'run.resumed', { actor: { kind: 'user', id: 'local' } });
const running = (lastEventSeq: number) => ({ status: 'running' as const, lastEventSeq });

function mount(runId: string, lifecycle?: RunEvent) {
  return renderHook(
    (props: { runId: string; lifecycle: RunEvent | undefined }) =>
      useRunHeaderStatus(props.runId, props.lifecycle),
    { initialProps: { runId, lifecycle } },
  );
}

describe('useRunHeaderStatus (#386)', () => {
  it('keeps the evidence for the run shown and starts over for another run', () => {
    const { result, rerender } = mount(A);
    act(() => result.current.observe(A, [finished(A, 3)]));
    expect(result.current.status(running(3))).toEqual({
      kind: 'event',
      status: 'succeeded',
      seq: 3,
    });
    // A batch streamed for another run is not this run's evidence.
    act(() => result.current.observe(B, [finished(B, 9)]));
    expect(result.current.status(running(9))).toEqual({ kind: 'updating' });

    rerender({ runId: B, lifecycle: undefined });
    expect(result.current.status(running(3))).toEqual({ kind: 'record', status: 'running' });
    // A late batch from the previous run's stream changes nothing.
    act(() => result.current.observe(A, [finished(A, 4)]));
    expect(result.current.status(running(4))).toEqual({ kind: 'record', status: 'running' });
    act(() => result.current.observe(B, [finished(B, 2)]));
    expect(result.current.status(running(2))).toMatchObject({ kind: 'event', seq: 2 });
  });

  it('merges the observation lifecycle by run and order', () => {
    const { result, rerender } = mount(A, event(A, 2, 'run.started', { attempt: 1 }));
    expect(result.current.status(running(2))).toEqual({ kind: 'record', status: 'running' });
    act(() => result.current.observe(A, [finished(A, 3)]));
    // A delayed observation of the earlier start does not undo the observed outcome.
    rerender({ runId: A, lifecycle: event(A, 2, 'run.started', { attempt: 1 }) });
    expect(result.current.status(running(3))).toMatchObject({ kind: 'event', seq: 3 });
    // Another run's observation is ignored.
    rerender({ runId: A, lifecycle: resumed(B, 7) });
    expect(result.current.status(running(3))).toMatchObject({ kind: 'event', seq: 3 });
    // A newer observed resume supersedes the outcome until the record catches up.
    rerender({ runId: A, lifecycle: resumed(A, 5) });
    expect(result.current.status(running(3))).toEqual({ kind: 'updating' });
    expect(result.current.status({ status: 'waiting', lastEventSeq: 5 })).toEqual({
      kind: 'record',
      status: 'waiting',
    });
  });
});
