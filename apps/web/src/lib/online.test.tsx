import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createAppClient } from '../api/context.js';
import { OfflineBanner } from '../components/layout/AppShell.js';
import { useConnectionStatus } from './online.js';
import { startReachability, useReachability } from './reachability.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const stop of cleanups.splice(0)) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([true, false])(
  'suppresses the browser reconnect flash until the refetch settles (recovered=%s)',
  async (recovered) => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const read = vi.fn((): Promise<string> =>
      Promise.reject(GraphGoblinApiError.network('refused')),
    );
    const observer = new QueryObserver(queryClient, { queryKey: ['loops'], queryFn: read });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    cleanups.push(
      startReachability(queryClient, createAppClient('http://api.test')),
      unsubscribe,
      () => queryClient.clear(),
    );
    const view = renderHook(useConnectionStatus);
    expect(view.result.current).toBe('offline');
    let finish!: () => void;
    read.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            recovered ? resolve('back') : reject(GraphGoblinApiError.network('refused'));
        }),
    );
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(view.result.current).toBe('online');
    expect(useReachability.getState().reconnecting).toBe(true);
    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(view.result.current).toBe(recovered ? 'online' : 'api-unreachable');
    expect(useReachability.getState().reconnecting).toBe(false);
  },
);

it('names API recovery in the API-unreachable banner', () => {
  const view = render(<OfflineBanner apiUnreachable />);
  expect(view.getByRole('status')).toHaveTextContent('resume when the API is reachable again.');
});

it.each(['refetch cycle', 'five-second cap'])(
  'bounds reconnect grace by the %s even while an unrelated read is slow',
  async (limit) => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const refused = () => GraphGoblinApiError.network('refused');
    const read = vi.fn((): Promise<string> => Promise.reject(refused()));
    const loops = new QueryObserver(queryClient, { queryKey: ['loops'], queryFn: read });
    const unsubscribe = loops.subscribe(() => undefined);
    await loops.refetch();
    let finishHarness!: () => void;
    const harness = new QueryObserver(queryClient, {
      queryKey: ['harness'],
      queryFn: () =>
        new Promise<string>((resolve) => {
          finishHarness = () => resolve('ok');
        }),
    });
    cleanups.push(
      startReachability(
        queryClient,
        createAppClient('http://api.test', () => Promise.reject(refused())),
      ),
      unsubscribe,
      harness.subscribe(() => undefined),
      () => queryClient.clear(),
    );
    const view = renderHook(useConnectionStatus);
    let finishRead: () => void = () => undefined;
    if (limit === 'five-second cap') {
      read.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            finishRead = () => reject(refused());
          }),
      );
    }
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(view.result.current).toBe('online');
    if (limit === 'five-second cap') {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_999);
      });
      expect(view.result.current).toBe('online');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
    } else {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
    }
    expect(harness.getCurrentResult().fetchStatus).toBe('fetching');
    expect(view.result.current).toBe('api-unreachable');
    expect(useReachability.getState().reconnecting).toBe(false);
    await act(async () => {
      finishRead();
      finishHarness();
      await vi.advanceTimersByTimeAsync(20);
    });
  },
);
