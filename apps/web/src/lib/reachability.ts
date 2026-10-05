import { GraphGoblinApiError, type GraphGoblinClient } from '@graphgoblin/api-client';
import type { Query, QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { isOfflineError } from './utils.js';

const INITIAL_DELAY = 2_000;
const MAX_DELAY = 30_000;
const PROBE_TIMEOUT = 5_000;
const RECONNECT_GRACE = 5_000;

export const useReachability = create(() => ({ apiReachable: true, reconnecting: false }));
let outageOpen = false;
const recoveryGuards = new Set<() => boolean>();
const recoveryListeners = new Set<() => void>();

/** A confirmed response after an outage, available to recovery listeners and PWA update checks. */
export function subscribeApiRecovery(listener: () => void): () => void {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}

function reachable(value: boolean, confirmed = true): void {
  const notify = value && outageOpen && confirmed;
  outageOpen = !value;
  if (useReachability.getState().apiReachable !== value)
    useReachability.setState({ apiReachable: value });
  if (notify) for (const listener of recoveryListeners) listener();
}

/** A transport failure from an active query, draft save, or run stream. */
export function markApiUnreachable(): void {
  reachable(false);
}

/** A real API response; recovery waits for all active connectivity failures to clear. */
export function markApiReachable(): void {
  if ([...recoveryGuards].every((allowed) => allowed())) reachable(true);
}

/** Probe only while active queries hold transport failures. HTTP errors never create demand. */
export function startReachability(queryClient: QueryClient, client: GraphGoblinClient): () => void {
  const cache = queryClient.getQueryCache();
  const failures = new WeakMap<Query, unknown>();
  let stopped = false;
  let refetching = false;
  let delay = INITIAL_DELAY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectCycle = 0;
  let inFlight: AbortController | undefined;

  const offlineQueries = () =>
    cache.findAll({ type: 'active', predicate: (query) => isOfflineError(query.state.error) });
  const fetching = () =>
    cache.findAll({ type: 'active', predicate: (query) => query.state.fetchStatus !== 'idle' });
  const canRecover = () => !refetching && offlineQueries().length === 0;
  recoveryGuards.add(canRecover);
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
    if (refetching && allowed()) return;
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
        refetching = true;
        try {
          await refetch();
        } finally {
          refetching = false;
        }
        if (stopped) return;
        if (offlineQueries().length === 0) {
          delay = INITIAL_DELAY;
          markApiReachable();
        } else {
          delay = Math.min(delay * 2, MAX_DELAY);
        }
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
    if (stopped) return;
    const queries = offlineQueries();

    for (const query of queries) {
      // A refetch retains the old error while running; it is not a new outage.
      if (failures.get(query) !== query.state.error) markApiUnreachable();
      failures.set(query, query.state.error);
    }
    schedule();
  };
  const resetWithoutDemand = () => {
    // Route changes remove the old observer before attaching the next one in the same tick.
    resetTimer ??= setTimeout(() => {
      resetTimer = undefined;
      if (!stopped && offlineQueries().length === 0 && fetching().length === 0)
        reachable(true, false); // No demand: remove the claim, without inventing a recovery.
    }, 0);
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
      markApiReachable();
    }
    // Observer notifications precede the success event. Do not silently close the outage there.
    if (
      ((event.type === 'removed' ||
        event.type === 'observerRemoved' ||
        event.type === 'observerOptionsUpdated') &&
        !event.query.isActive()) ||
      (event.type === 'updated' && event.action.type === 'success' && event.action.manual)
    )
      resetWithoutDemand();
    sync();
  });
  const endReconnect = (cycle: number) => {
    if (stopped || cycle !== reconnectCycle) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    useReachability.setState({ reconnecting: false });
  };
  const reconnect = () => {
    const cycle = ++reconnectCycle;
    clearTimeout(reconnectTimer);
    useReachability.setState({ reconnecting: true });
    // The pending refetch cycle suppresses an API banner between browser reconnect and its result.
    reconnectTimer = setTimeout(() => endReconnect(cycle), RECONNECT_GRACE);
    const finished = () => {
      endReconnect(cycle);
      sync();
    };
    void refetch().then(finished, finished);
    sync();
  };
  window.addEventListener('online', reconnect);
  window.addEventListener('offline', sync);
  document.addEventListener('visibilitychange', sync);
  resetWithoutDemand();
  sync();
  return () => {
    stopped = true;
    recoveryGuards.delete(canRecover);
    unsubscribe();
    window.removeEventListener('online', reconnect);
    window.removeEventListener('offline', sync);
    document.removeEventListener('visibilitychange', sync);
    clearTimer();
    clearTimeout(resetTimer);
    clearTimeout(reconnectTimer);
    inFlight?.abort();
    reachable(true, false);
    useReachability.setState({ reconnecting: false });
  };
}
