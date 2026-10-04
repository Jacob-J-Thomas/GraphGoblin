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
