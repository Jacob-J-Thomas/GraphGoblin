import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { ApiProvider, createAppClient } from '../api/context.js';
import { keys, useRun } from '../api/queries.js';
import {
  getInspectorRead,
  trackInspectorRead,
  useInspectorRead,
} from './inspector-read-provenance.js';
import { RunHeaderProvider, RunHeaderRegistry } from './run-header-store.js';

// Independent B1 delta only. Assertions express the corrected contract and should fail on the
// unchanged 308209 helper where cancellation reverts a qualified revision without a live GET.
// Public synthetic state controls below do not establish a universal cache-forgery defense.
const clients = new Set<QueryClient>();
const key = ['independent-b1', 'observed'] as const;
const body = { id: 'observed', result: 'previously accepted GET' };
const offline = () => GraphGoblinApiError.network(new TypeError('controlled transport outage'));

function source(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } },
  }),
) {
  clients.add(client);
  const api = new FakeApi();
  const http = createAppClient('http://independent-b1.invalid', api.fetch);
  return {
    cache: client,
    api,
    http,
    owner: new RunHeaderRegistry({ client: http, queryClient: client }),
  };
}
type Source = ReturnType<typeof source>;
function checkpoint() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function read(current: Source, request = () => Promise.resolve(body)) {
  return current.cache.fetchQuery({
    queryKey: key,
    queryFn: (context) =>
      trackInspectorRead(current.owner, context, request, (value) => value.id === body.id),
  });
}
async function pauseThenCancel(current: Source) {
  const physical = current.cache.getQueryCache().find({ queryKey: key, exact: true })!;
  const before = current.cache.getQueryState<typeof body>(key)!;
  onlineManager.setOnline(false);
  const request = vi.fn(() => Promise.resolve(body));
  const pending = read(current, request).catch((error: unknown) => error);
  expect(current.cache.getQueryState(key)?.fetchStatus).toBe('paused');
  expect(request).not.toHaveBeenCalled();
  const paused = getInspectorRead(current.owner, key);
  expect(paused.pending).toBe(0);
  await current.cache.cancelQueries({ queryKey: key, exact: true });
  await pending;
  expect(current.cache.getQueryCache().find({ queryKey: key, exact: true })).toBe(physical);
  expect(current.cache.getQueryState(key)?.fetchStatus).toBe('idle');
  expect(current.cache.getQueryData(key)).toBe(before.data);
  expect(current.cache.getQueryState(key)?.dataUpdateCount).toBe(before.dataUpdateCount);
  expect(request).not.toHaveBeenCalled();
  return { paused, reverted: getInspectorRead(current.owner, key) };
}

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('independent B1 cancellation retention', () => {
  it('keeps the exact accepted revision when a not-yet-started paused GET is cancelled', async () => {
    const current = source();
    await read(current);
    const previous = getInspectorRead(current.owner, key).committed;
    expect(previous).toBeGreaterThan(0);
    const { paused, reverted } = await pauseThenCancel(current);
    expect(paused.committed).toBe(previous);
    expect(paused.loss).toBeGreaterThan(previous);
    expect(reverted.loss).toBe(paused.loss);
    expect(reverted.committed).toBe(previous);
    expect(reverted.committed).toBeLessThan(reverted.loss);
  });

  it('keeps the accepted revision when cancellation lands in the public retry-delay window', async () => {
    const current = source();
    await read(current);
    const physical = current.cache.getQueryCache().find({ queryKey: key, exact: true })!;
    const previousState = current.cache.getQueryState<typeof body>(key)!;
    const previous = getInspectorRead(current.owner, key).committed;
    const scheduled = checkpoint();
    const request = vi.fn(() => Promise.reject(offline()));
    const pending = current.cache
      .fetchQuery({
        queryKey: key,
        retry: 1,
        // First production retry delay; the callback is an observable scheduling checkpoint.
        retryDelay: () => {
          scheduled.resolve();
          return 1000;
        },
        queryFn: (context) => trackInspectorRead(current.owner, context, request, () => true),
      })
      .catch((error: unknown) => error);
    await scheduled.promise;
    expect(request).toHaveBeenCalledOnce();
    expect(current.cache.getQueryState(key)?.fetchFailureCount).toBe(1);
    const failed = getInspectorRead(current.owner, key);
    expect(failed).toMatchObject({ committed: previous, pending: 0 });
    expect(failed.loss).toBeGreaterThan(previous);
    await current.cache.cancelQueries({ queryKey: key, exact: true });
    await pending;
    expect(current.cache.getQueryCache().find({ queryKey: key, exact: true })).toBe(physical);
    expect(current.cache.getQueryData(key)).toBe(previousState.data);
    expect(current.cache.getQueryState(key)?.dataUpdateCount).toBe(previousState.dataUpdateCount);
    const reverted = getInspectorRead(current.owner, key);
    expect(reverted.committed).toBe(previous);
    expect(reverted.loss).toBe(failed.loss);
    expect(reverted.committed).toBeLessThan(reverted.loss);
    expect(request).toHaveBeenCalledOnce();
  });

  it('retains real useRun provenance through last-observer removal in retry delay and offline remount', async () => {
    const scheduled = checkpoint();
    const current = source(
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 0,
            gcTime: Infinity,
            retryDelay: () => {
              scheduled.resolve();
              return 1000;
            },
          },
        },
      }),
    );
    const record = current.api.addRun({ status: 'running', result: 'observed by actual useRun' });
    const runKey = keys.run(record.id);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider client={current.http}>
        <QueryClientProvider client={current.cache}>
          <RunHeaderProvider registry={current.owner}>{children}</RunHeaderProvider>
        </QueryClientProvider>
      </ApiProvider>
    );
    const mount = () =>
      renderHook(
        () => {
          const query = useRun(record.id);
          return { query, status: query.status, receipt: useInspectorRead(current.owner, runKey) };
        },
        { wrapper },
      );
    const first = mount();
    await waitFor(() => expect(first.result.current.receipt.committed).toBeGreaterThan(0));
    const original = first.result.current.query.data;
    const state = current.cache.getQueryState(runKey)!;
    const previous = first.result.current.receipt.committed;
    const physical = current.cache.getQueryCache().find({ queryKey: runKey, exact: true })!;
    const reverts: number[] = [];
    const stop = current.cache.getQueryCache().subscribe((event) => {
      if (event.query === physical && event.type === 'updated' && event.action.type === 'setState')
        reverts.push(event.query.state.dataUpdateCount);
    });
    current.api.override('GET /runs/:id', () => {
      throw new TypeError('controlled useRun transport loss');
    });
    let pending: Promise<unknown> | undefined;
    let firstMounted = true;
    try {
      await act(async () => {
        pending = first.result.current.query.refetch();
        await scheduled.promise;
      });
      const loss = getInspectorRead(current.owner, runKey).loss;
      expect(loss).toBeGreaterThan(previous);
      expect(getInspectorRead(current.owner, runKey).pending).toBe(0);
      await act(async () => {
        first.unmount();
        firstMounted = false;
        await pending;
      });
      // This is an actual observer-driven revert, not an injected setState or cancelQueries.
      expect(reverts.length).toBeGreaterThan(0);
      expect(current.cache.getQueryData(runKey)).toBe(original);
      expect(current.cache.getQueryState(runKey)?.dataUpdateCount).toBe(state.dataUpdateCount);
      const afterUnmount = getInspectorRead(current.owner, runKey);
      onlineManager.setOnline(false);
      const beforeRemountReads = current.api.callsTo('GET', '/runs/' + record.id).length;
      const returned = mount();
      await waitFor(() => expect(returned.result.current.query.fetchStatus).toBe('paused'));
      expect(returned.result.current.query.data).toBe(original);
      expect(afterUnmount.committed).toBe(previous);
      expect(returned.result.current.receipt.committed).toBe(previous);
      expect(returned.result.current.receipt.committed).toBeLessThan(loss);
      expect(current.api.callsTo('GET', '/runs/' + record.id)).toHaveLength(beforeRemountReads);
    } finally {
      stop();
      if (firstMounted) first.unmount();
      await pending;
    }
  });

  it.each(['manual', 'refused'] as const)(
    'does not restore an already %s-retired receipt by paused cancellation or old-state restoration',
    async (retirement) => {
      const current = source();
      await read(current);
      const physical = current.cache.getQueryCache().find({ queryKey: key, exact: true })!;
      const acceptedState = current.cache.getQueryState<typeof body>(key)!;
      expect(getInspectorRead(current.owner, key).committed).toBeGreaterThan(0);
      if (retirement === 'manual') current.cache.setQueryData(key, body);
      else
        await expect(
          read(current, () =>
            Promise.reject(new GraphGoblinApiError({ status: 403, code: 'FORBIDDEN' })),
          ),
        ).rejects.toThrow();
      expect(getInspectorRead(current.owner, key).committed).toBe(0);
      const { reverted } = await pauseThenCancel(current);
      expect(reverted.committed).toBe(0);
      physical.setState({ ...acceptedState, fetchStatus: 'idle' });
      expect(getInspectorRead(current.owner, key).committed).toBe(0);
    },
  );

  it.each(['object', 'count'] as const)(
    'refuses a different %s revision and cannot regain proof through cancellation or restoring the old state',
    async (mismatch) => {
      const current = source();
      await read(current);
      const physical = current.cache.getQueryCache().find({ queryKey: key, exact: true })!;
      const acceptedState = current.cache.getQueryState<typeof body>(key)!;
      expect(getInspectorRead(current.owner, key).committed).toBeGreaterThan(0);
      physical.setState({
        ...acceptedState,
        data: mismatch === 'object' ? { ...body } : acceptedState.data,
        dataUpdateCount: acceptedState.dataUpdateCount + (mismatch === 'count' ? 1 : 0),
        fetchStatus: 'idle',
      });
      expect(getInspectorRead(current.owner, key).committed).toBe(0);
      const { reverted } = await pauseThenCancel(current);
      expect(reverted.committed).toBe(0);
      physical.setState({ ...acceptedState, fetchStatus: 'idle' });
      expect(getInspectorRead(current.owner, key).committed).toBe(0);
    },
  );
});
