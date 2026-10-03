import { Workbox } from 'workbox-window';
import { usePwaStore } from './store.js';

/** The hook the app exposes so tests and tools can drive the update flow (docs/09). */
export interface PwaTestHook {
  /** Behave as if a new service worker were waiting: shows the update toast. */
  simulateUpdate(): void;
  /** How many times an update was applied (the user confirmed). */
  readonly appliedUpdates: number;
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
  const store = usePwaStore.getState();

  const hook: PwaTestHook = {
    simulateUpdate: () =>
      store.promptUpdate(() => {
        applied += 1;
      }),
    get appliedUpdates() {
      return applied;
    },
  };
  window.graphgoblinPwa = hook;

  if (!supported) return hook;
  const create =
    options.createWorkbox ??
    ((swUrl: string, swScope: string) => new Workbox(swUrl, { scope: swScope }));
  const wb = create(url, scope);
  wb.addEventListener('waiting', () => {
    store.promptUpdate(() => {
      applied += 1;
      wb.addEventListener('controlling', () => reload());
      wb.messageSkipWaiting();
    });
  });
  wb.addEventListener('activated', (event) => {
    if (!event.isUpdate) store.setOfflineReady();
  });
  void wb.register().catch((error: unknown) => {
    console.warn('service worker registration failed', error);
  });
  return hook;
}
