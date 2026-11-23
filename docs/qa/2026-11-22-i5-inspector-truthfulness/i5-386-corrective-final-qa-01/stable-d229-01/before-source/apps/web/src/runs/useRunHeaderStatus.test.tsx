import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import { useApiKeyStore } from '../api/api-key.js';
import { createAppClient } from '../api/context.js';
import { useRunEventStore } from './event-store.js';
import { RunHeaderProvider, RunHeaderRegistry } from './run-header-store.js';
import { useRunHeaderStatus } from './useRunHeaderStatus.js';

const A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const B = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const finished = (runId: string, seq: number) =>
  event(runId, seq, 'run.finished', { status: 'succeeded', outcome: 'success' });
const resumed = (runId: string, seq: number) =>
  event(runId, seq, 'run.resumed', { actor: { kind: 'user', id: 'local' } });
const running = (lastEventSeq: number) => ({ status: 'running' as const, lastEventSeq });

function mount(runId: string) {
  const registry = new RunHeaderRegistry({
    client: createAppClient('http://graphgoblin.test'),
    queryClient: new QueryClient(),
  });
  const view = renderHook((props: { runId: string }) => useRunHeaderStatus(props.runId), {
    initialProps: { runId },
    wrapper: ({ children }: { children: ReactNode }) => (
      <RunHeaderProvider registry={registry}>{children}</RunHeaderProvider>
    ),
  });
  return { ...view, registry };
}

afterEach(() => {
  useApiKeyStore.getState().forget();
  useRunEventStore.getState().clear(A);
});

describe('useRunHeaderStatus (#386)', () => {
  it('shows the registry evidence of the run shown, and only rows its own reads returned', () => {
    const { result, rerender, registry } = mount(A);
    // No read of this record yet: it names no status.
    expect(result.current.status(running(2))).toEqual({ kind: 'updating' });
    const a = registry.lease(A);
    act(() => registry.receipt(a, running(2)));
    expect(result.current.status(running(2))).toEqual({ kind: 'record', status: 'running' });
    act(() => registry.events(a, [finished(A, 3)]));
    expect(result.current.status(running(2))).toEqual({
      kind: 'event',
      status: 'succeeded',
      seq: 3,
    });
    // Another run's entry is its own.
    const b = registry.lease(B);
    act(() => registry.receipt(b, running(3)));
    rerender({ runId: B });
    expect(result.current.status(running(3))).toEqual({ kind: 'record', status: 'running' });
    // Back to A: its retained resume still holds, so the old outcome is not shown again.
    act(() => registry.lifecycle(a, resumed(A, 4)));
    rerender({ runId: A });
    expect(result.current.status(running(2))).toEqual({ kind: 'updating' });
  });

  it('keeps a cold acknowledged resume neutral despite an older fresh outcome observation (C1)', () => {
    useRunEventStore.getState().append(A, finished(A, 3), resumed(A, 4));
    const { result, registry } = mount(A);
    const lease = registry.lease(A);
    act(() => registry.lifecycle(lease, finished(A, 3)));
    expect(result.current.status(running(2))).toEqual({ kind: 'updating' });
    // Even a fresh read of the earlier running position cannot establish the old outcome.
    act(() => registry.receipt(lease, running(2)));
    expect(result.current.status(running(2))).toEqual({ kind: 'updating' });
    const parked = { status: 'waiting' as const, lastEventSeq: 4 };
    act(() => {
      registry.lifecycle(lease, resumed(A, 4));
      registry.receipt(lease, parked);
    });
    expect(result.current.status(parked)).toEqual({ kind: 'record', status: 'waiting' });
  });

  it('settles a fresh matching terminal receipt beyond the cold hint without new streamed events (C1)', () => {
    useRunEventStore
      .getState()
      .append(
        A,
        finished(A, 3),
        event(A, 4, 'return.delivered', { channel: { kind: 'log' } }),
        event(A, 5, 'return.delivered', { channel: { kind: 'log' } }),
      );
    const { result, registry } = mount(A);
    const lease = registry.lease(A);
    const terminal = { status: 'succeeded' as const, lastEventSeq: 5 };
    act(() => registry.lifecycle(lease, finished(A, 3)));
    expect(result.current.status(terminal)).toEqual({ kind: 'updating' });
    // An unrelated position is not a receipt for the cached terminal row.
    act(() => registry.receipt(lease, running(5)));
    expect(result.current.status(terminal)).toEqual({ kind: 'updating' });
    act(() => registry.receipt(lease, terminal));
    expect(result.current.status(terminal)).toEqual({ kind: 'record', status: 'succeeded' });
  });

  it('withholds everything while the key is rejected and after the credentials change', () => {
    const { result, registry } = mount(A);
    const lease = registry.lease(A);
    act(() => {
      registry.receipt(lease, running(2));
      registry.events(lease, [finished(A, 3)]);
    });
    expect(result.current.status(running(2))).toMatchObject({ kind: 'event' });
    act(() => useApiKeyStore.getState().markRejected());
    expect(result.current.status(running(2))).toEqual({ kind: 'updating' });
    act(() => useApiKeyStore.getState().save('replacement'));
    expect(result.current.status(running(2))).toEqual({ kind: 'updating' });
    useApiKeyStore.getState().forget();
  });
});
