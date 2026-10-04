import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppClient } from '../api/context.js';
import { startReachability, subscribeApiRecovery, useReachability } from './reachability.js';

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
    expect(useReachability.getState().apiReachable).toBe(false);
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
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    const request = view.fetch.mock.calls[0]?.[0];
    for (let i = 0; i < 3; i++) document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.fetch).toHaveBeenCalledTimes(1);
    expect(request?.signal.aborted).toBe(true); // bounded request timeout
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
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
