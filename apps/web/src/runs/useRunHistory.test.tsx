import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import { ApiProvider, createAppClient } from '../api/context.js';
import { useRunEventLog, useRunEventStore } from './event-store.js';
import { useRunHistory } from './useRunHistory.js';

const items = (start: number, n: number) =>
  Array.from({ length: n }, (_, i) => event('history', start + i, 'run.started', { attempt: 1 }));
afterEach(() => {
  cleanup();
  useRunEventStore.setState({ runs: {} });
});
function mount(fetch: (request: Request) => Promise<Response>) {
  const client = createAppClient('http://test', fetch);
  return renderHook(() => useRunHistory('history', useRunEventLog('history')), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ApiProvider client={client}>{children}</ApiProvider>
    ),
  });
}
it('does not carry a pending read or its error into a different run', async () => {
  useRunEventStore.getState().append('history', ...items(1, 1000));
  const pending: ((response: Response) => void)[] = [];
  const client = createAppClient(
    'http://test',
    () => new Promise<Response>((resolve) => pending.push(resolve)),
  );
  const { result, rerender } = renderHook(
    ({ runId }) => useRunHistory(runId, useRunEventLog(runId)),
    {
      initialProps: { runId: 'history' },
      wrapper: ({ children }: { children: ReactNode }) => (
        <ApiProvider client={client}>{children}</ApiProvider>
      ),
    },
  );
  act(() => void result.current.older());
  await waitFor(() => expect(pending).toHaveLength(1));
  expect(result.current.busy).toBe(true);
  rerender({ runId: 'next' });
  expect(result.current.busy).toBe(false);
  await act(() =>
    Promise.resolve().then(() => pending[0]!(Response.json({ items: items(1, 128) }))),
  );
  expect(useRunEventStore.getState().runs['next']).toBeUndefined();
  rerender({ runId: 'history' });
  expect(result.current.busy).toBe(false);
  act(() => void result.current.older());
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(() =>
    Promise.resolve().then(() =>
      pending[1]!(Response.json({ detail: 'History unavailable' }, { status: 500 })),
    ),
  );
  await waitFor(() => expect(result.current.error).toBeDefined());
  rerender({ runId: 'next' });
  expect(result.current.error).toBeUndefined();
  expect(result.current.busy).toBe(false);
});
it('catches concurrent live acknowledgements before enabling live retention without a boundary gap', async () => {
  useRunEventStore.getState().append('history', ...items(1, 1000));
  const afters: number[] = [];
  const { result } = mount((request) => {
    const query = new URL(request.url).searchParams;
    if (query.has('around')) {
      useRunEventStore.getState().append('history', ...items(1001, 130));
      return Promise.resolve(
        Response.json({ items: items(873, 128), nextAfter: 1000, hasMore: true }),
      );
    }
    const after = Number(query.get('after'));
    afters.push(after);
    return Promise.resolve(
      Response.json({
        items: items(after + 1, Math.min(128, 1130 - after)),
        nextAfter: Math.min(1130, after + 128),
        hasMore: after + 128 < 1130,
      }),
    );
  });
  await act(async () => result.current.live());
  const log = useRunEventStore.getState().runs['history']!;
  expect(afters).toEqual([1000, 1128]);
  expect(log.mode).toBe('live');
  expect(log.lastSeq).toBe(1130);
  expect(log.events.map((e) => e.seq)).toEqual(Array.from({ length: 258 }, (_, i) => 873 + i));
});
it('ignores a superseded selection response and reports an unavailable sequence', async () => {
  useRunEventStore.getState().append('history', ...items(1, 1000));
  const pending: ((response: Response) => void)[] = [];
  const { result } = mount(() => new Promise<Response>((resolve) => pending.push(resolve)));
  act(() => result.current.select(1));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => result.current.select(2));
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(() =>
    Promise.resolve().then(() =>
      pending[1]!(Response.json({ items: items(2, 1), nextAfter: 2, hasMore: true })),
    ),
  );
  await waitFor(() => expect(result.current.selectedSeq).toBe(2));
  await act(() =>
    Promise.resolve().then(() =>
      pending[0]!(Response.json({ items: items(1, 1), nextAfter: 1, hasMore: true })),
    ),
  );
  expect(result.current.selectedSeq).toBe(2);
  act(() => result.current.select(9999));
  await waitFor(() => expect(pending).toHaveLength(3));
  await act(() =>
    Promise.resolve().then(() =>
      pending[2]!(Response.json({ items: [], nextAfter: 9999, hasMore: false })),
    ),
  );
  await waitFor(() => expect(result.current.error).toContain('not available'));
  expect(useRunEventStore.getState().runs['history']!.lastSeq).toBe(1000);
});
it.each(['empty', 'outpaced'] as const)(
  'reports %s live catch-up without silently enabling a gapped window',
  async (mode) => {
    useRunEventStore.getState().append('history', ...items(1, 1000));
    let calls = 0;
    const { result } = mount((request) => {
      calls++;
      const query = new URL(request.url).searchParams;
      const ack = useRunEventStore.getState().runs['history']!.lastSeq;
      useRunEventStore.getState().append('history', ...items(ack + 1, 1000));
      if (query.has('around')) return Promise.resolve(Response.json({ items: items(873, 128) }));
      const after = Number(query.get('after'));
      return Promise.resolve(
        Response.json({ items: mode === 'empty' ? [] : items(after + 1, 128) }),
      );
    });
    await act(async () => result.current.live());
    expect(result.current.error).toContain(
      mode === 'empty' ? 'did not advance' : 'Try Follow live again',
    );
    expect(useRunEventStore.getState().runs['history']!.mode).toBe('history');
    expect(calls).toBeLessThanOrEqual(9);
  },
);
