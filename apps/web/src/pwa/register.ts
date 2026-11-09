import { Workbox } from 'workbox-window';
import { subscribeApiRecovery, useReachability } from '../lib/reachability.js';
import {
  isChatUpdateUnsafe,
  startChatUpdateGuard,
  subscribeChatUpdateGuard,
  type ChatUpdateGuard,
} from './chat-update-guard.js';
import { usePwaStore } from './store.js';

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
  createUpdateGuard?: (
    scope: string,
    committed: (worker: ServiceWorker) => void,
  ) => ChatUpdateGuard;
}

/**
 * Register the service worker with the prompt update flow: when a new worker is waiting, the store
 * raises the "A new version is available" toast; only the user's confirmation requests guarded
 * APPLY. The waiting worker activates after every open scoped page is safely frozen, and the page
 * reloads once that worker controls it. Dirty voice drafts and unresolved submissions veto
 * activation. The application never applies updates on its own.
 */
export function registerPwa(options: RegisterPwaOptions = {}): { dispose(this: void): void } {
  const url = options.url ?? '/app/sw.js';
  const scope = options.scope ?? '/app/';
  const reload = options.reload ?? (() => window.location.reload());
  const supported = options.serviceWorkerSupported ?? 'serviceWorker' in navigator;
  let disposed = false;
  let cleanup = () => undefined;
  const store = usePwaStore.getState();
  let reloadRequested = false;
  let controlled = false;
  let committedWorker: ServiceWorker | undefined;
  let reloaded = false;
  const maybeReload = () => {
    if (!disposed && reloadRequested && controlled && !reloaded && !isChatUpdateUnsafe()) {
      reloaded = true;
      reload();
    }
  };
  const guard = (options.createUpdateGuard ?? startChatUpdateGuard)(scope, (worker) => {
    committedWorker = worker;
    controlled = navigator.serviceWorker?.controller === worker;
    reloadRequested = true;
    maybeReload();
  });
  const unsubscribeGuard = subscribeChatUpdateGuard(maybeReload);
  cleanup = () => {
    unsubscribeGuard();
    guard.dispose();
  };

  const lifecycle = {
    dispose: () => {
      disposed = true;
      cleanup();
    },
  };

  if (!supported) return lifecycle;
  const create =
    options.createWorkbox ??
    ((swUrl: string, swScope: string) =>
      new Workbox(swUrl, { scope: swScope, updateViaCache: 'none' }));
  const wb = create(url, scope);
  wb.addEventListener('controlling', () => {
    // For external updates Workbox reports its previously tracked worker in event.sw. The
    // browser's actual controller is the authority for whether our committed worker took over.
    controlled = !committedWorker || navigator.serviceWorker?.controller === committedWorker;
    maybeReload();
  });
  const promptedWorkers = new WeakSet<ServiceWorker>();
  const prompt = (worker?: ServiceWorker) => {
    if (disposed || (worker && promptedWorkers.has(worker))) return;
    if (worker) promptedWorkers.add(worker);
    const apply = async () => {
      controlled = false;
      const result = await guard.apply(worker ?? registration?.waiting ?? undefined);
      if (disposed || usePwaStore.getState().applyUpdate !== apply) return false;
      if (!result.accepted) {
        store.setUpdateBlocked(result.reason ?? 'The update could not be checked. Try again.');
        return false;
      }
      reloadRequested = true;
      maybeReload();
      return true;
    };
    store.promptUpdate(apply);
  };
  wb.addEventListener('waiting', (event) => prompt(event.sw));
  wb.addEventListener('activated', (event) => {
    if (!disposed && !event.isUpdate) store.setOfflineReady();
  });
  let registration: ServiceWorkerRegistration | undefined;
  let checking = false;
  let warned = false;
  let lastFocusCheck = Number.NEGATIVE_INFINITY;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  const clearFocusTimer = () => {
    clearTimeout(focusTimer);
    focusTimer = undefined;
  };
  const workerListeners = new Map<ServiceWorker, () => void>();
  const promptWaiting = () => {
    if (registration?.active && registration.waiting) prompt(registration.waiting);
  };
  const watchInstalling = () => {
    const worker = registration?.installing;
    if (!worker || workerListeners.has(worker)) return;
    const changed = () => {
      // The first install briefly waits too, before activating without an older worker to replace.
      if (worker.state === 'installed' && registration?.active && registration.waiting === worker)
        prompt(worker);
      if (worker.state === 'installed' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', changed);
        workerListeners.delete(worker);
      }
    };
    workerListeners.set(worker, changed);
    worker.addEventListener('statechange', changed);
    changed();
  };
  const check = async (fromFocus = false) => {
    if (!disposed) promptWaiting();
    if (
      disposed ||
      !registration ||
      checking ||
      document.visibilityState !== 'visible' ||
      !navigator.onLine ||
      !useReachability.getState().apiReachable
    )
      return;
    const remaining = lastFocusCheck + 60_000 - Date.now();
    if (fromFocus && remaining > 0) {
      focusTimer ??= setTimeout(() => {
        focusTimer = undefined;
        void check(true);
      }, remaining);
      return;
    }
    clearFocusTimer();
    if (fromFocus) lastFocusCheck = Date.now();
    checking = true;
    try {
      await registration.update();
      if (!disposed) {
        watchInstalling();
        promptWaiting();
      }
      warned = false;
    } catch (error) {
      if (!warned) console.warn('service worker update check failed', error);
      warned = true;
    } finally {
      checking = false;
    }
  };
  const trigger = () => void check();
  const focus = () => void check(true);
  const pageHide = (event: PageTransitionEvent) => {
    // A cached page may be restored with the same JS state; keep its lifecycle intact.
    if (!event.persisted) lifecycle.dispose();
  };
  const unsubscribe = subscribeApiRecovery(trigger);
  const interval = setInterval(trigger, 60 * 60 * 1_000);
  window.addEventListener('focus', focus);
  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', trigger);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', trigger);
  cleanup = () => {
    unsubscribeGuard();
    guard.dispose();
    clearInterval(interval);
    clearFocusTimer();
    unsubscribe();
    registration?.removeEventListener('updatefound', watchInstalling);
    for (const [worker, listener] of workerListeners)
      worker.removeEventListener('statechange', listener);
    workerListeners.clear();
    window.removeEventListener('focus', focus);
    window.removeEventListener('online', trigger);
    document.removeEventListener('visibilitychange', trigger);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', trigger);
  };
  void wb.register().then(
    (result) => {
      if (disposed) return;
      registration = result;
      // Workbox drops its own listener for later external updates. Own the whole registration.
      registration?.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      trigger();
    },
    (error: unknown) => console.warn('service worker registration failed', error),
  );
  return lifecycle;
}
