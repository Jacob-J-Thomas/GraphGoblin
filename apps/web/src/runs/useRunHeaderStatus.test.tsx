import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import { useApiKeyStore } from '../api/api-key.js';
import { createAppClient } from '../api/context.js';
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
  useApiKeyStore.setState({ rejected: false });
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
