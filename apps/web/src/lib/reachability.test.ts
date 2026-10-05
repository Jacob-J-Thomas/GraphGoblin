import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppClient } from '../api/context.js';
import {
  markApiUnreachable,
  startReachability,
  subscribeApiRecovery,
  useReachability,
} from './reachability.js';

const cleanups: (() => void)[] = [];
const networkError = () => GraphGoblinApiError.network(new TypeError('refused'));

async function setup(error: Error = networkError()) {
  vi.useFakeTimers();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let available = false;
  const read = vi.fn(() => (available ? Promise.resolve('back') : Promise.reject(error)));
  const observer = new QueryObserver(queryClient, { queryKey: ['loops'], queryFn: read });
  const unsubscribe = observer.subscribe(() => undefined);
  await observer.refetch();
  const fetch = vi.fn((_request: Request) =>
    available ? Promise.resolve(new Response('ok')) : Promise.reject(networkError()),
  );
  const client = createAppClient('http://api.test/prefix/', fetch);
  cleanups.push(startReachability(queryClient, client), unsubscribe, () => queryClient.clear());
  return {
    queryClient,
    observer,
    read,
    fetch,
    setAvailable: () => {
      available = true;
    },
    unsubscribe,
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('API reachability', () => {
  it('probes the client base URL and recovers active failures without a browser event', async () => {
    const view = await setup();
    const recovered = vi.fn();
    cleanups.push(subscribeApiRecovery(recovered));
    expect(useReachability.getState().apiReachable).toBe(false);
    view.setAvailable();
    await vi.advanceTimersByTimeAsync(2_000);
    const request = view.fetch.mock.calls[0]?.[0];
    expect(request?.url).toBe('http://api.test/prefix/healthz');
    expect(request?.cache).toBe('no-store');
    expect(view.observer.getCurrentResult().data).toBe('back');
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(useReachability.getState().apiReachable).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.fetch).toHaveBeenCalledTimes(1);
  });

  it('backs off a stuck transport route despite a healthy healthz without flapping or recovery', async () => {
    const view = await setup();
    view.fetch.mockResolvedValue(new Response('ok'));
    view.read.mockImplementation(() => Promise.reject(networkError()));
    const recovered = vi.fn();
    const states: boolean[] = [];
    cleanups.push(subscribeApiRecovery(recovered));
    cleanups.push(useReachability.subscribe((state) => states.push(state.apiReachable)));
    for (const [index, delay] of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(view.fetch).toHaveBeenCalledTimes(index);
      await vi.advanceTimersByTimeAsync(1);
      expect(view.fetch).toHaveBeenCalledTimes(index + 1);
    }
    await vi.advanceTimersByTimeAsync(210_000);
    expect(view.fetch).toHaveBeenCalledTimes(13);
    expect(recovered).not.toHaveBeenCalled();
    expect(states).not.toContain(true);
    view.read.mockResolvedValue('back');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(useReachability.getState().apiReachable).toBe(true);
  });

  it('clears an unreachable claim with no active demand without announcing recovery', async () => {
    const view = await setup();
    const recovered = vi.fn();
    cleanups.push(subscribeApiRecovery(recovered));
    view.unsubscribe();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(useReachability.getState().apiReachable).toBe(true);
    expect(recovered).not.toHaveBeenCalled();
    expect(view.fetch).not.toHaveBeenCalled();
  });

  it('keeps the unreachable claim when navigation swaps failed observers in one tick', async () => {
    const view = await setup();
    const next = new QueryObserver(view.queryClient, {
      queryKey: ['runs'],
      queryFn: () => Promise.reject(networkError()),
      retryOnMount: false,
    });
    await next.refetch();
    const states: boolean[] = [];
    cleanups.push(useReachability.subscribe((state) => states.push(state.apiReachable)));
    view.unsubscribe();
    cleanups.push(next.subscribe(() => undefined));
    await vi.advanceTimersByTimeAsync(0);
    expect(useReachability.getState().apiReachable).toBe(false);
    expect(states).not.toContain(true);
  });

  it('retains the claim while a replacement page read is pending and then fails', async () => {
    const view = await setup();
    let fail!: () => void;
    const next = new QueryObserver(view.queryClient, {
      queryKey: ['runs'],
      queryFn: () =>
        new Promise<never>((_resolve, reject) => {
          fail = () => reject(networkError());
        }),
    });
    const states: boolean[] = [];
    cleanups.push(useReachability.subscribe((state) => states.push(state.apiReachable)));
    view.unsubscribe();
    cleanups.push(next.subscribe(() => undefined));
    await vi.advanceTimersByTimeAsync(800);
    expect(next.getCurrentResult().fetchStatus).toBe('fetching');
    expect(useReachability.getState().apiReachable).toBe(false);
    fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(useReachability.getState().apiReachable).toBe(false);
    expect(states).not.toContain(true);
  });

  it('does not reopen an outage from an inactive query cached error', async () => {
    const view = await setup();
    view.unsubscribe();
    await vi.advanceTimersByTimeAsync(0);
    view.queryClient.setQueryData(['good'], 'ok');
    const observer = new QueryObserver(view.queryClient, {
      queryKey: ['loops'],
      queryFn: view.read,
      retryOnMount: false,
    });
    cleanups.push(observer.subscribe(() => undefined));
    expect(useReachability.getState().apiReachable).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(view.fetch).toHaveBeenCalledTimes(1);
    view.read.mockRejectedValue(networkError());
    await observer.refetch();
    expect(useReachability.getState().apiReachable).toBe(false);
  });

  it('announces each confirmed recovery once and opens a new outage for a fresh failure', async () => {
    const view = await setup();
    const recovered = vi.fn();
    cleanups.push(subscribeApiRecovery(recovered));
    view.setAvailable();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(recovered).toHaveBeenCalledTimes(1);
    view.read.mockRejectedValue(networkError());
    await view.observer.refetch();
    expect(useReachability.getState().apiReachable).toBe(false);
    view.read.mockResolvedValue('back');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(recovered).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(recovered).toHaveBeenCalledTimes(2);
  });

  it('backs off at 2, 4, 8, 16, then at most every 30 seconds', async () => {
    const view = await setup();
    for (const [index, delay] of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(view.fetch).toHaveBeenCalledTimes(index);
      await vi.advanceTimersByTimeAsync(1);
      expect(view.fetch).toHaveBeenCalledTimes(index + 1);
    }
    expect(view.read).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a manual cache update for confirmed API recovery', async () => {
    const view = await setup();
    const recovered = vi.fn();
    cleanups.push(subscribeApiRecovery(recovered));
    view.queryClient.setQueryData(['loops'], 'optimistic');
    await vi.advanceTimersByTimeAsync(0);
    expect(useReachability.getState().apiReachable).toBe(true); // No demand, no claim.
    expect(recovered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.fetch).not.toHaveBeenCalled();
  });

  it.each([400, 401, 404, 500, 503])('never probes for HTTP %i', async (status) => {
    const view = await setup(
      new GraphGoblinApiError({ status, code: 'REFUSED', detail: 'refused' }),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.fetch).not.toHaveBeenCalled();
    expect(useReachability.getState().apiReachable).toBe(true);
  });

  it('stops when errors become inactive, and resumes when the query becomes active', async () => {
    const view = await setup();
    view.unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.fetch).not.toHaveBeenCalled();
    const observer = new QueryObserver(view.queryClient, {
      queryKey: ['loops'],
      queryFn: view.read,
      retryOnMount: false,
    });
    cleanups.push(observer.subscribe(() => undefined));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(view.fetch).toHaveBeenCalledTimes(1);
  });

  it('pauses while hidden or browser offline and resumes while visible and online', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const view = await setup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.fetch).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    online.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.fetch).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(view.fetch).toHaveBeenCalledTimes(1);
  });

  it('holds one in-flight probe, aborts on hide, and ignores its late success', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const view = await setup();
    let finish!: (response: Response) => void;
    view.fetch.mockImplementation(
      (request) =>
        new Promise<Response>((resolve, reject) => {
          finish = resolve;
          request.signal.addEventListener('abort', () => reject(new Error('probe aborted')), {
            once: true,
          });
        }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    const request = view.fetch.mock.calls[0]?.[0];
    for (let i = 0; i < 3; i++) document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(view.fetch).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(request?.signal.aborted).toBe(true);
    finish(new Response('ok'));
    await vi.advanceTimersByTimeAsync(0);
    expect(useReachability.getState().apiReachable).toBe(false);
    expect(view.read).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(view.fetch).toHaveBeenCalledTimes(2);
    finish(new Response('ok'));
    await vi.advanceTimersByTimeAsync(0);
  });

  it('times out an abort-aware fetch and schedules the next backed-off probe', async () => {
    const view = await setup();
    view.fetch.mockImplementation(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new Error('probe aborted')), {
            once: true,
          });
        }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    const request = view.fetch.mock.calls[0]![0];
    await vi.advanceTimersByTimeAsync(4_999);
    expect(request.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(request.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(view.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.fetch).toHaveBeenCalledTimes(2);
  });

  it('clears demand that becomes inactive during a recovery refetch', async () => {
    const view = await setup();
    let finish!: (value: string) => void;
    view.fetch.mockResolvedValue(new Response('ok'));
    view.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    view.unsubscribe();
    await vi.advanceTimersByTimeAsync(0);
    expect(useReachability.getState().apiReachable).toBe(true);
    finish('back');
    await vi.advanceTimersByTimeAsync(0);
  });

  it('ignores a recovery refetch that completes after disposal', async () => {
    const view = await setup();
    const recovered = vi.fn();
    cleanups.push(subscribeApiRecovery(recovered));
    let finish!: (value: string) => void;
    view.fetch.mockResolvedValue(new Response('ok'));
    view.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    cleanups[0]!(); // Dispose while the recovery read is still in flight.
    markApiUnreachable(); // A later source owns this outage, not the disposed probe.
    finish('back');
    await vi.advanceTimersByTimeAsync(0);
    expect(useReachability.getState().apiReachable).toBe(false);
    expect(recovered).not.toHaveBeenCalled();
  });

  it('treats a refused health response as a failed probe, and disposes pending work', async () => {
    const view = await setup();
    view.fetch.mockResolvedValue(new Response('not ready', { status: 503 }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(view.read).toHaveBeenCalledTimes(1);
    for (const cleanup of cleanups.splice(0)) cleanup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.fetch).toHaveBeenCalledTimes(1);
  });
});
