import { Workbox } from 'workbox-window';
import { subscribeApiRecovery, useReachability } from '../lib/reachability.js';
import { usePwaStore } from './store.js';

/** The hook the app exposes so tests and tools can drive the update flow (docs/09). */
export interface PwaTestHook {
  /** Behave as if a new service worker were waiting: shows the update toast. */
  simulateUpdate(): void;
  /** How many times an update was applied (the user confirmed). */
  readonly appliedUpdates: number;
  /** Remove scheduled checks and listeners when the app unmounts or the page unloads. */
  dispose(this: void): void;
}

declare global {
  interface Window {
    graphgoblinPwa?: PwaTestHook;
  }
}

export interface RegisterPwaOptions {
  /** Service worker URL. Default `/app/sw.js`. */
  url?: string;
  scope?: string;
  /** Injectable for tests. */
  createWorkbox?: (
    url: string,
    scope: string,
  ) => Pick<Workbox, 'addEventListener' | 'register' | 'messageSkipWaiting'>;
  reload?: () => void;
  serviceWorkerSupported?: boolean;
}

/**
 * Register the service worker with the prompt update flow: when a new worker is waiting, the store
 * raises the "A new version is available" toast; only the user's confirmation sends SKIP_WAITING,
 * and the page reloads once the new worker controls it. Nothing activates automatically.
 */
export function registerPwa(options: RegisterPwaOptions = {}): PwaTestHook {
  const url = options.url ?? '/app/sw.js';
  const scope = options.scope ?? '/app/';
  const reload = options.reload ?? (() => window.location.reload());
  const supported = options.serviceWorkerSupported ?? 'serviceWorker' in navigator;
  let applied = 0;
  let disposed = false;
  let cleanup = () => undefined;
  const store = usePwaStore.getState();

  const hook: PwaTestHook = {
    simulateUpdate: () =>
      store.promptUpdate(() => {
        applied += 1;
      }),
    get appliedUpdates() {
      return applied;
    },
    dispose: () => {
      disposed = true;
      cleanup();
    },
  };
  window.graphgoblinPwa = hook;

  if (!supported) return hook;
  const create =
    options.createWorkbox ??
    ((swUrl: string, swScope: string) => new Workbox(swUrl, { scope: swScope }));
  const wb = create(url, scope);
  let promptedWorker: ServiceWorker | undefined;
  const prompt = (worker?: ServiceWorker) => {
    if (disposed || (worker && worker === promptedWorker)) return;
    promptedWorker = worker;
    store.promptUpdate(() => {
      applied += 1;
      wb.addEventListener('controlling', () => reload());
      wb.messageSkipWaiting();
    });
  };
  wb.addEventListener('waiting', (event) => prompt(event.sw));
  wb.addEventListener('activated', (event) => {
    if (!disposed && !event.isUpdate) store.setOfflineReady();
  });
  let registration: ServiceWorkerRegistration | undefined;
  let checking = false;
  let warned = false;
  const check = async () => {
    if (
      disposed ||
      !registration ||
      checking ||
      document.visibilityState !== 'visible' ||
      !navigator.onLine ||
      !useReachability.getState().apiReachable
    )
      return;
    checking = true;
    try {
      await registration.update();
      warned = false;
    } catch (error) {
      if (!warned) console.warn('service worker update check failed', error);
      warned = true;
    } finally {
      checking = false;
    }
  };
  const trigger = () => void check();
  const pageHide = (event: PageTransitionEvent) => {
    // A cached page may be restored with the same JS state; keep its lifecycle intact.
    if (!event.persisted) hook.dispose();
  };
  const unsubscribe = subscribeApiRecovery(trigger);
  const interval = setInterval(trigger, 60 * 60 * 1_000);
  window.addEventListener('focus', trigger);
  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', trigger);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', trigger);
  cleanup = () => {
    clearInterval(interval);
    unsubscribe();
    window.removeEventListener('focus', trigger);
    window.removeEventListener('online', trigger);
    document.removeEventListener('visibilitychange', trigger);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', trigger);
  };
  void wb.register().then(
    (result) => {
      if (disposed) return;
      registration = result;
      if (registration?.waiting) prompt(registration.waiting);
      trigger();
    },
    (error: unknown) => console.warn('service worker registration failed', error),
  );
  return hook;
}
