import { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import { API_KEY_STORAGE, syncApiKeyAcrossTabs, useApiKeyStore } from '../api/api-key.js';
import { createAppClient } from '../api/context.js';
import {
  MAX_HEADER_RUNS,
  RunHeaderProvider,
  RunHeaderRegistry,
  useRunHeaderRegistry,
} from './run-header-store.js';

const run = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G${String(n).padStart(4, '0')}`;
const A = run(1);
const B = run(2);
const finished = (runId: string, seq: number) =>
  event(runId, seq, 'run.finished', { status: 'succeeded', outcome: 'success' });
const position = (lastEventSeq: number) => ({ status: 'running' as const, lastEventSeq });

function registry(capacity?: number) {
  return new RunHeaderRegistry(
    { client: createAppClient('http://graphgoblin.test'), queryClient: new QueryClient() },
    capacity,
  );
}

afterEach(() => {
  useApiKeyStore.getState().forget();
});

describe('run header registry (#386)', () => {
  it('keeps at most twenty runs, least recently used out, and never recreates an evicted one', () => {
    const headers = registry();
    expect(MAX_HEADER_RUNS).toBe(20);
    const first = headers.lease(A);
    headers.events(first, [finished(A, 3)]);
    const evicted = vi.fn();
    headers.subscribe(A, evicted);
    for (let n = 2; n <= MAX_HEADER_RUNS; n += 1) headers.lease(run(n));
    // Reading again makes A the most recent: B goes first.
    headers.lease(A);
    headers.lease(run(MAX_HEADER_RUNS + 1));
    expect(headers.snapshot(B)).toBeUndefined();
    expect(headers.snapshot(A)?.evidence.marker).toEqual({ seq: 3, terminal: 'succeeded' });
    for (let n = 3; n <= MAX_HEADER_RUNS + 2; n += 1) headers.lease(run(n + 100));
    expect(headers.snapshot(A)).toBeUndefined();
    expect(evicted).toHaveBeenCalled();
    // A late callback of the evicted lease writes nothing, and recreates nothing.
    headers.events(first, [finished(A, 9)]);
    headers.receipt(first, position(9));
    headers.lifecycle(first, finished(A, 9));
    expect(headers.snapshot(A)).toBeUndefined();
    // A new lease starts empty.
    headers.lease(A);
    expect(headers.snapshot(A)).toEqual({ evidence: { runId: A, through: 0 }, receipts: [] });
  });

  it('starts an empty scope for new credentials and refuses leases and writes while rejected', () => {
    useApiKeyStore.getState().save('k');
    const headers = registry();
    const old = headers.lease(A);
    headers.receipt(old, position(2));
    expect(headers.snapshot(A)?.receipts).toEqual([position(2)]);
    useApiKeyStore.getState().markRejected();
    expect(headers.snapshot(A)).toBeUndefined();
    expect(headers.lease(A)).toBeUndefined();
    headers.events(old, [finished(A, 3)]);
    // The same key accepted again is a new generation: the old lease stays retired.
    useApiKeyStore.getState().save('k');
    expect(headers.snapshot(A)).toBeUndefined();
    headers.receipt(old, position(3));
    const current = headers.lease(A);
    expect(headers.snapshot(A)).toEqual({ evidence: { runId: A, through: 0 }, receipts: [] });
    headers.receipt(current, position(4));
    expect(headers.snapshot(A)?.receipts).toEqual([position(4)]);
    // Another tab replacing the key retires it too.
    const stop = syncApiKeyAcrossTabs();
    localStorage.setItem(API_KEY_STORAGE, 'other-tab');
    window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
    stop();
    expect(useApiKeyStore.getState().key).toBe('other-tab');
    headers.receipt(current, position(5));
    expect(headers.snapshot(A)).toBeUndefined();
  });

  it('keeps only recent positions, and only their status and sequence', () => {
    const headers = registry();
    const lease = headers.lease(A);
    const row = { ...position(1), currentNodeId: 'n' };
    headers.receipt(lease, row);
    expect(headers.snapshot(A)?.receipts).toEqual([position(1)]);
    for (const seq of [2, 3, 4, 5, 3, 3]) headers.receipt(lease, position(seq));
    expect(headers.snapshot(A)?.receipts).toEqual([2, 4, 5, 3].map(position));
  });

  it('drops a run that is definitively missing, and ignores another run’s events', () => {
    const headers = registry();
    const lease = headers.lease(A);
    headers.events(lease, [finished(B, 3)]);
    expect(headers.snapshot(A)?.evidence).toEqual({ runId: A, through: 0 });
    const listener = vi.fn();
    const stop = headers.subscribe(A, listener);
    headers.forget(lease);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(headers.snapshot(A)).toBeUndefined();
    headers.forget(lease);
    headers.forget(undefined);
    headers.events(undefined, [finished(A, 3)]);
    stop();
    headers.lease(A);
    headers.events(headers.lease(A), [finished(A, 3)]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is shared through the app providers', () => {
    const headers = registry(2);
    const { result } = renderHook(() => useRunHeaderRegistry(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <RunHeaderProvider registry={headers}>{children}</RunHeaderProvider>
      ),
    });
    expect(result.current).toBe(headers);
    expect(renderHook(() => useRunHeaderRegistry()).result.current).toBeUndefined();
  });
});
