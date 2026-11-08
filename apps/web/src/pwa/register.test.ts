import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { Workbox } from 'workbox-window';
import { createAppClient } from '../api/context.js';
import { startReachability, useReachability } from '../lib/reachability.js';
import { registerPwa as registerPwaComponent, type RegisterPwaOptions } from './register.js';
import { usePwaStore } from './store.js';
import { setChatSubmissionUnresolved } from './chat-update-guard.js';
import { flush, setNavigator } from './__fixtures__/update.js';

const lifecycles: ReturnType<typeof registerPwaComponent>[] = [];
const nativeRestorers: (() => void)[] = [];
function registerPwa(options: RegisterPwaOptions = {}) {
  const lifecycle = registerPwaComponent(options);
  lifecycles.push(lifecycle);
  return lifecycle;
}

type Listener = (event: { isUpdate?: boolean; sw?: ServiceWorker }) => void;

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
    emit(type: string, event: { isUpdate?: boolean; sw?: ServiceWorker } = {}) {
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
  for (const lifecycle of lifecycles.splice(0)) lifecycle.dispose();
  for (const restore of nativeRestorers.splice(0)) restore();
  usePwaStore.setState({
    needRefresh: false,
    applyUpdate: undefined,
    offlineReady: false,
    applying: false,
    blockedReason: undefined,
  });
  setChatSubmissionUnresolved('pending-test', false);
  useReachability.setState({ apiReachable: true });
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

  it('defers repeated throttled focuses into one check at the 60-second boundary', async () => {
    vi.useFakeTimers();
    const wb = fakeWorkbox();
    const hook = registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(1_000);
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(58_999);
    expect(wb.registration.update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.registration.update).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('focus'));
    hook.dispose();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(wb.registration.update).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a deferred focus check when a visibility check runs', async () => {
    vi.useFakeTimers();
    const wb = fakeWorkbox();
    registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(1_000);
    window.dispatchEvent(new Event('focus'));
    expect(vi.getTimerCount()).toBe(2); // Hourly interval and one deferred focus.
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(wb.registration.update).toHaveBeenCalledTimes(3);
  });

  it.each(['hidden', 'offline', 'API unreachable'])(
    'does not run a deferred check while %s and checks once visibility permits it',
    async (blocked) => {
      vi.useFakeTimers();
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      const wb = fakeWorkbox();
      registerPwa({ createWorkbox: () => wb as never, serviceWorkerSupported: true });
      await vi.advanceTimersByTimeAsync(0);
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(1_000);
      window.dispatchEvent(new Event('focus'));
      if (blocked === 'hidden') visibility.mockReturnValue('hidden');
      if (blocked === 'offline') online.mockReturnValue(false);
      if (blocked === 'API unreachable') useReachability.setState({ apiReachable: false });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(wb.registration.update).toHaveBeenCalledTimes(2);
      visibility.mockReturnValue('visible');
      online.mockReturnValue(true);
      useReachability.setState({ apiReachable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(wb.registration.update).toHaveBeenCalledTimes(3);
    },
  );

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
  it('prompts on a waiting worker and activates it only after confirmation', async () => {
    const wb = fakeWorkbox();
    const reload = vi.fn();
    const apply = vi.fn(() => Promise.resolve({ accepted: true }));
    registerPwa({
      createWorkbox: () => wb as never,
      reload,
      serviceWorkerSupported: true,
      createUpdateGuard: () => ({ apply, dispose: vi.fn() }),
    });
    expect(wb.register).toHaveBeenCalled();

    wb.emit('activated', { isUpdate: false });
    expect(usePwaStore.getState().offlineReady).toBe(true);
    wb.emit('activated', { isUpdate: true });

    wb.emit('waiting');
    expect(usePwaStore.getState().needRefresh).toBe(true);
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
    usePwaStore.getState().confirm();
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(1);
    usePwaStore.getState().confirm();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    wb.emit('controlling');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the prompt and reason when another tab vetoes the update, then retries', async () => {
    const wb = fakeWorkbox();
    const apply = vi
      .fn()
      .mockResolvedValueOnce({ accepted: false, reason: 'Voice is pending in another tab.' })
      .mockResolvedValueOnce({ accepted: true });
    registerPwa({
      createWorkbox: () => wb as never,
      serviceWorkerSupported: true,
      createUpdateGuard: () => ({ apply, dispose: vi.fn() }),
    });
    wb.emit('waiting');
    usePwaStore.getState().confirm();
    await vi.waitFor(() => expect(usePwaStore.getState().applying).toBe(false));
    expect(usePwaStore.getState().needRefresh).toBe(true);
    expect(usePwaStore.getState().blockedReason).toContain('Voice is pending');
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled();
    usePwaStore.getState().confirm();
    await vi.waitFor(() => expect(usePwaStore.getState().needRefresh).toBe(false));
  });

  it('defers a controlling-event reload until a local uncertain submission clears', async () => {
    const wb = fakeWorkbox();
    const reload = vi.fn();
    registerPwa({
      createWorkbox: () => wb as never,
      serviceWorkerSupported: true,
      reload,
      createUpdateGuard: () => ({
        apply: () => Promise.resolve({ accepted: true }),
        dispose: vi.fn(),
      }),
    });
    wb.emit('waiting');
    usePwaStore.getState().confirm();
    await Promise.resolve();
    setChatSubmissionUnresolved('pending-test', true);
    wb.emit('controlling');
    expect(reload).not.toHaveBeenCalled();
    setChatSubmissionUnresolved('pending-test', false);
    expect(reload).toHaveBeenCalledTimes(1);
    wb.emit('controlling');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not mistake first-install control for the confirmed update controlling this page', async () => {
    const wb = fakeWorkbox();
    const reload = vi.fn();
    const first = {} as ServiceWorker;
    const next = {} as ServiceWorker;
    const native = Object.assign(new EventTarget(), { controller: first });
    nativeRestorers.push(setNavigator('serviceWorker', native));
    registerPwa({
      createWorkbox: () => wb as never,
      serviceWorkerSupported: true,
      reload,
      createUpdateGuard: (_scope, committed) => ({
        apply: () => {
          committed(next);
          return Promise.resolve({ accepted: true });
        },
        dispose: vi.fn(),
      }),
    });
    wb.emit('controlling', { sw: first });
    wb.emit('waiting', { sw: next });
    usePwaStore.getState().confirm();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    native.controller = next;
    wb.emit('controlling', { sw: next });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'uses the actual controller for an external update after 60 seconds (new controller=%s)',
    async (changed) => {
      vi.useFakeTimers();
      vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
      const now = vi.spyOn(performance, 'now').mockReturnValue(100);
      const scriptURL = new URL('/app/sw.js', location.href).href;
      const firstTarget = Object.assign(new EventTarget(), { state: 'activated', scriptURL });
      const nextTarget = Object.assign(new EventTarget(), { state: 'installing', scriptURL });
      const first = firstTarget as unknown as ServiceWorker;
      const next = nextTarget as unknown as ServiceWorker;
      const registration = Object.assign(new EventTarget(), {
        active: first,
        waiting: null as ServiceWorker | null,
        installing: null as ServiceWorker | null,
        update: vi.fn(() => Promise.resolve()),
      });
      const native = Object.assign(new EventTarget(), {
        controller: first,
        register: vi.fn(() =>
          Promise.resolve(registration as unknown as ServiceWorkerRegistration),
        ),
      });
      nativeRestorers.push(setNavigator('serviceWorker', native));
      const controlling: { sw: ServiceWorker | undefined; isExternal: boolean | undefined }[] = [];
      const reload = vi.fn();
      registerPwa({
        serviceWorkerSupported: true,
        reload,
        createWorkbox: (url, scope) => {
          const workbox = new Workbox(url, { scope });
          workbox.addEventListener('controlling', (event) => {
            controlling.push({ sw: event.sw, isExternal: event.isExternal });
          });
          return workbox;
        },
        createUpdateGuard: (_scope, committed) => ({
          apply: (worker) => {
            expect(worker).toBe(next);
            committed(next);
            return Promise.resolve({ accepted: true });
          },
          dispose: vi.fn(),
        }),
      });
      await flush();
      expect(registration.update).toHaveBeenCalledTimes(1);
      // Exercise Workbox 7's real time heuristic. It retains its old _sw and reports the update
      // as external, even though the application correctly prompts for this new native worker.
      now.mockReturnValue(60_101);
      registration.installing = next;
      registration.dispatchEvent(new Event('updatefound'));
      registration.waiting = next;
      nextTarget.state = 'installed';
      nextTarget.dispatchEvent(new Event('statechange'));
      expect(usePwaStore.getState().needRefresh).toBe(true);
      usePwaStore.getState().confirm();
      await flush();
      expect(reload).not.toHaveBeenCalled();
      native.controller = changed ? next : first;
      native.dispatchEvent(new Event('controllerchange'));
      expect(controlling).toEqual([{ sw: first, isExternal: changed }]);
      expect(reload).toHaveBeenCalledTimes(changed ? 1 : 0);
      native.dispatchEvent(new Event('controllerchange'));
      expect(reload).toHaveBeenCalledTimes(changed ? 1 : 0);
    },
  );

  it('does no worker work on unsupported browsers and disposes safely', () => {
    const createWorkbox = vi.fn();
    const lifecycle = registerPwa({ createWorkbox, serviceWorkerSupported: false });
    expect(createWorkbox).not.toHaveBeenCalled();
    expect(usePwaStore.getState().needRefresh).toBe(false);
    lifecycle.dispose();
    usePwaStore.getState().confirm();
    usePwaStore.getState().confirm();
    expect(createWorkbox).not.toHaveBeenCalled();
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
    expect(register).toHaveBeenCalledWith('/app/sw.js', { scope: '/app/', updateViaCache: 'none' });
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
});
