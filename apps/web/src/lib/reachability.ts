import { GraphGoblinApiError, type GraphGoblinClient } from '@graphgoblin/api-client';
import type { Query, QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { isOfflineError } from './utils.js';

const INITIAL_DELAY = 2_000;
const MAX_DELAY = 30_000;
const PROBE_TIMEOUT = 5_000;

export const useReachability = create(() => ({ apiReachable: true }));
const recoveryListeners = new Set<() => void>();

/** A confirmed response after an outage, available to recovery listeners and PWA update checks. */
export function subscribeApiRecovery(listener: () => void): () => void {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}

function reachable(value: boolean): void {
  const previous = useReachability.getState().apiReachable;
  useReachability.setState({ apiReachable: value });
  if (value && !previous) for (const listener of recoveryListeners) listener();
}

/** Probe only while active queries hold transport failures. HTTP errors never create demand. */
export function startReachability(queryClient: QueryClient, client: GraphGoblinClient): () => void {
  const cache = queryClient.getQueryCache();
  const failures = new Map<Query, unknown>();
  let stopped = false;
  let delay = INITIAL_DELAY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;

  const offlineQueries = () =>
    cache.findAll({ type: 'active', predicate: (query) => isOfflineError(query.state.error) });
  const allowed = () => !stopped && document.visibilityState === 'visible' && navigator.onLine;
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const refetch = () =>
    queryClient.refetchQueries(
      { type: 'active', predicate: (query) => isOfflineError(query.state.error) },
      { cancelRefetch: false },
    );

  const schedule = () => {
    if (!allowed() || offlineQueries().length === 0) {
      clearTimer();
      inFlight?.abort();
      delay = INITIAL_DELAY;
    } else if (timer === undefined && !inFlight) {
      timer = setTimeout(() => void probe(), delay);
    }
  };
  const probe = async () => {
    timer = undefined;
    const controller = new AbortController();
    inFlight = controller;
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
    try {
      const response = await client.config.fetch(
        new Request(`${client.config.baseUrl}/healthz`, {
          signal: controller.signal,
          cache: 'no-store',
        }),
      );
      if (!controller.signal.aborted && allowed() && response.ok) {
        delay = INITIAL_DELAY;
        reachable(true);
        await refetch();
      } else {
        delay = Math.min(delay * 2, MAX_DELAY);
      }
    } catch {
      delay = Math.min(delay * 2, MAX_DELAY);
    } finally {
      clearTimeout(timeout);
      inFlight = undefined;
      schedule();
    }
  };
  const sync = () => {
    const queries = offlineQueries();
    const active = new Set(queries);
    for (const query of failures.keys()) if (!active.has(query)) failures.delete(query);
    for (const query of queries) {
      // A refetch retains the old error while running; it is not a new outage.
      if (failures.get(query) !== query.state.error) reachable(false);
      failures.set(query, query.state.error);
    }
    schedule();
  };
  const unsubscribe = cache.subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.query.isActive() &&
      ((event.action.type === 'success' && !event.action.manual) ||
        (event.action.type === 'error' &&
          event.query.state.error instanceof GraphGoblinApiError &&
          event.query.state.error.status > 0))
    ) {
      reachable(true);
    }
    sync();
  });
  const reconnect = () => {
    void refetch(); // Also covers a cold offline load with no Query online-manager transition.
    sync();
  };
  window.addEventListener('online', reconnect);
  window.addEventListener('offline', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    stopped = true;
    unsubscribe();
    window.removeEventListener('online', reconnect);
    window.removeEventListener('offline', sync);
    document.removeEventListener('visibilitychange', sync);
    clearTimer();
    inFlight?.abort();
    useReachability.setState({ apiReachable: true });
  };
}
