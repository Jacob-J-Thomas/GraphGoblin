import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createAppClient } from '../api/context.js';
import { startReachability, useReachability } from '../lib/reachability.js';
import { registerPwa } from './register.js';
import { usePwaStore } from './store.js';

type Listener = (event: { isUpdate?: boolean }) => void;

function fakeWorkbox() {
  const listeners = new Map<string, Listener[]>();
  const registration = Object.assign(new EventTarget(), {
    active: {} as ServiceWorker | null,
    waiting: null as ServiceWorker | null,
    installing: null as ServiceWorker | null,
    update: vi.fn((): Promise<void> => Promise.resolve()),
  });
  return {
    registration,
    listeners,
    emit(type: string, event: { isUpdate?: boolean } = {}) {
      for (const l of listeners.get(type) ?? []) l(event);
    },
    addEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }),
    register: vi.fn((): Promise<ServiceWorkerRegistration | undefined> =>
      Promise.resolve(registration as unknown as ServiceWorkerRegistration),
    ),
    messageSkipWaiting: vi.fn(),
  };
}

afterEach(() => {
  window.graphgoblinPwa?.dispose();
  usePwaStore.setState({ needRefresh: false, applyUpdate: undefined, offlineReady: false });
  useReachability.setState({ apiReachable: true });
  delete window.graphgoblinPwa;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('registerPwa', () => {
  it.each(['registration', 'native installation'])(
    'does not prompt for the first worker during %s',
    async (phase) => {
      const wb = fakeWorkbox();
      wb.registration.active = null;
      const target = Object.assign(new EventTarget(), { state: 'installing' });
      const worker = target as unknown as ServiceWorker;
      if (phase === 'registration') wb.registration.waiting = worker;
      registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
      await Promise.resolve();
      if (phase === 'native installation') {
        wb.registration.installing = worker;
        wb.registration.dispatchEvent(new Event('updatefound'));
        target.state = 'installed';
        wb.registration.waiting = worker;
        target.dispatchEvent(new Event('statechange'));
      }
      expect(usePwaStore.getState().needRefresh).toBe(false);
      window.dispatchEvent(new Event('focus'));
      expect(usePwaStore.getState().needRefresh).toBe(false);
      expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
    },
  );

  it('prompts immediately for a worker already waiting at registration without activating it', async () => {
    const wb = fakeWorkbox();
    wb.registration.waiting = {} as ServiceWorker;
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await Promise.resolve();
    expect(usePwaStore.getState().needRefresh).toBe(true);
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
    usePwaStore.getState().dismiss();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(usePwaStore.getState().needRefresh).toBe(false);
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
  });

  it('prompts for each native updatefound worker after Later without Workbox events', async () => {
    const wb = fakeWorkbox();
    const hook = registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await Promise.resolve();
    for (let build = 0; build < 2; build++) {
      const target = Object.assign(new EventTarget(), {
        state: 'installing',
      });
      const worker = target as unknown as ServiceWorker;
      wb.registration.installing = worker;
      wb.registration.dispatchEvent(new Event('updatefound'));
      target.state = 'installed';
      wb.registration.waiting = worker;
      target.dispatchEvent(new Event('statechange'));
      expect(usePwaStore.getState().needRefresh).toBe(true);
      usePwaStore.getState().dismiss();
      target.dispatchEvent(new Event('statechange'));
      window.dispatchEvent(new Event('focus'));
      expect(usePwaStore.getState().needRefresh).toBe(false);
    }
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
    const pending = Object.assign(new EventTarget(), { state: 'installing' });
    const removed = vi.spyOn(pending, 'removeEventListener');
    wb.registration.installing = pending as unknown as ServiceWorker;
    wb.registration.dispatchEvent(new Event('updatefound'));
    hook.dispose();
    expect(removed).toHaveBeenCalledWith('statechange', expect.any(Function));
    wb.registration.waiting = {} as ServiceWorker;
    wb.registration.dispatchEvent(new Event('updatefound'));
    expect(usePwaStore.getState().needRefresh).toBe(false);
  });

  it('finds an unannounced waiting worker on every trigger', async () => {
    const wb = fakeWorkbox();
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await Promise.resolve();
    wb.registration.waiting = {} as ServiceWorker;
    window.dispatchEvent(new Event('focus'));
    expect(usePwaStore.getState().needRefresh).toBe(true);
  });

  it('throttles focus checks to one per 60 seconds without throttling visibility', async () => {
    vi.useFakeTimers();
    const wb = fakeWorkbox();
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(59_999);
    window.dispatchEvent(new Event('focus'));
    expect(wb.registration.update).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(wb.registration.update).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    window.dispatchEvent(new Event('focus'));
    expect(wb.registration.update).toHaveBeenCalledTimes(4);
  });

  it('checks on registration, focus, visibility and hourly; clears everything on dispose', async () => {
    vi.useFakeTimers();
    const wb = fakeWorkbox();
    const hook = registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(wb.registration.update).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(wb.registration.update).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(wb.registration.update).toHaveBeenCalledTimes(5);
    hook.dispose();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(wb.registration.update).toHaveBeenCalledTimes(5);
  });

  it('never checks while hidden, browser offline, or API unreachable; holds one check in flight', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const wb = fakeWorkbox();
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(wb.registration.update).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    online.mockReturnValue(false);
    window.dispatchEvent(new Event('focus'));
    useReachability.setState({ apiReachable: false });
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(wb.registration.update).not.toHaveBeenCalled();
    useReachability.setState({ apiReachable: true });
    let finish!: () => void;
    wb.registration.update.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(wb.registration.update).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('focus'));
    expect(wb.registration.update).toHaveBeenCalledTimes(2);
    finish();
  });

  it('checks when the API comes back from an outage', async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let available = false;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['loops'],
      queryFn: () =>
        available ? Promise.resolve('ok') : Promise.reject(GraphGoblinApiError.network('refused')),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    const stop = startReachability(
      queryClient,
      createAppClient('http://api.test', () => Promise.resolve(new Response('ok'))),
    );
    const wb = fakeWorkbox();
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(wb.registration.update).not.toHaveBeenCalled();
      available = true;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(wb.registration.update).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      unsubscribe();
      queryClient.clear();
    }
  });

  it('warns only once per failure streak and resets after a successful check', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const wb = fakeWorkbox();
    wb.registration.update.mockRejectedValue(new Error('offline'));
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledTimes(1);
    wb.registration.update.mockResolvedValue(undefined);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    wb.registration.update.mockRejectedValue(new Error('unregistered'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(wb.registration.update).toHaveBeenCalledTimes(4);
  });

  it('ignores a registration that finishes after disposal, including a waiting worker', async () => {
    const wb = fakeWorkbox();
    let finish!: (registration: ServiceWorkerRegistration) => void;
    wb.register.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    hook.dispose();
    wb.registration.waiting = {} as ServiceWorker;
    finish(wb.registration as unknown as ServiceWorkerRegistration);
    await Promise.resolve();
    wb.emit('waiting');
    expect(usePwaStore.getState().needRefresh).toBe(false);
    expect(wb.registration.update).not.toHaveBeenCalled();
  });

  it('resumes checks when a page returns from the browser back-forward cache', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const wb = fakeWorkbox();
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    visibility.mockReturnValue('hidden');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(wb.registration.update).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(wb.registration.update).toHaveBeenCalledTimes(2);
  });
  it('prompts on a waiting worker and activates it only after confirmation', () => {
    const wb = fakeWorkbox();
    const reload = vi.fn();
    const hook = registerPwa({
      createWorkbox: () => wb as never,
      reload,
      serviceWorkerSupported: true,
    });
    expect(wb.register).toHaveBeenCalled();
    expect(window.graphgoblinPwa).toBe(hook);

    wb.emit('activated', { isUpdate: false });
    expect(usePwaStore.getState().offlineReady).toBe(true);
    wb.emit('activated', { isUpdate: true });

    wb.emit('waiting');
    expect(usePwaStore.getState().needRefresh).toBe(true);
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
    usePwaStore.getState().confirm();
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1);
    expect(hook.appliedUpdates).toBe(1);
    expect(reload).not.toHaveBeenCalled();
    wb.emit('controlling');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('exposes a test hook that drives the same prompt, even without service workers', () => {
    const hook = registerPwa({ serviceWorkerSupported: false });
    hook.simulateUpdate();
    expect(usePwaStore.getState().needRefresh).toBe(true);
    usePwaStore.getState().confirm();
    expect(hook.appliedUpdates).toBe(1);
    usePwaStore.getState().confirm();
    expect(hook.appliedUpdates).toBe(1);
  });

  it('logs a failed registration', async () => {
    const wb = fakeWorkbox();
    wb.register.mockImplementation(() => Promise.reject(new Error('nope')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('service worker registration failed', expect.any(Error)),
    );
  });

  it('builds a real Workbox for the default worker URL', async () => {
    const register = vi.fn(() => Promise.reject(new Error('no sw in jsdom')));
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, addEventListener: vi.fn(), controller: null, getRegistration: vi.fn() },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerPwa();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(register).toHaveBeenCalledWith('/app/sw.js', { scope: '/app/' });
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
});
