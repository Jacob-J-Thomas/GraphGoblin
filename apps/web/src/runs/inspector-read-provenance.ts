import type { Query, QueryCache, QueryFunctionContext, QueryKey } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { useApiKeyStore } from '../api/api-key.js';
import { isOfflineError } from '../lib/utils.js';
import type { RunHeaderRegistry } from './run-header-store.js';

/** In-memory ordering shared by run and observation reads. Compare a read's start to a loss. */
let position = 0;
export function markInspectorReadLoss(): number {
  return ++position;
}

export interface InspectorRead {
  /** Start of the GET that supplied the currently cached revision. Zero means unqualified. */
  readonly committed: number;
  /** Start of an actual GET in flight. A paused first load has no start yet. */
  readonly pending: number;
  /** Start of the latest unrecovered outage. Repeated failures keep this recovery boundary. */
  readonly loss: number;
}

const empty: InspectorRead = { committed: 0, pending: 0, loss: 0 };

interface Attempt {
  readonly start: number;
  readonly signal: AbortSignal;
  /** Weak identity of the actual fetch, including when its promise has already resolved. */
  readonly fetch: WeakRef<Promise<unknown>>;
  eligible: boolean | undefined;
  readonly cancel: () => void;
}

interface Entry {
  readonly owner: WeakRef<RunHeaderRegistry>;
  readonly listeners: Set<() => void>;
  readonly generation: number;
  snapshot: InspectorRead;
  attempt: Attempt | undefined;
  dataCount: number;
  /** Identity only. This does not keep the cached body alive. */
  body: WeakRef<object> | undefined;
  awaitingRecovery: boolean;
}

// The physical Query is the weak key. An evicted/recreated key starts without any evidence.
const entries = new WeakMap<object, Entry>();
const subscriptions = new WeakMap<QueryCache, Set<() => void>>();

function accepted(entry: Entry): boolean {
  const { rejected, generation } = useApiKeyStore.getState();
  return !rejected && entry.generation === generation;
}

function update(entry: Entry, changes: Partial<InspectorRead>): void {
  entry.snapshot = { ...entry.snapshot, ...changes };
  entry.listeners.forEach((notify) => notify());
}

function endAttempt(entry: Entry): void {
  const attempt = entry.attempt;
  if (attempt) attempt.signal.removeEventListener('abort', attempt.cancel);
  entry.attempt = undefined;
}

function loss(entry: Entry, pending = entry.snapshot.pending): void {
  if (entry.awaitingRecovery && entry.snapshot.pending === pending) return;
  const boundary = entry.awaitingRecovery ? entry.snapshot.loss : markInspectorReadLoss();
  entry.awaitingRecovery = true;
  update(entry, { loss: boundary, pending });
}

function monitor(cache: QueryCache): Set<() => void> {
  const existing = subscriptions.get(cache);
  if (existing) return existing;
  const listeners = new Set<() => void>();
  subscriptions.set(cache, listeners);
  cache.subscribe((event) => {
    const { query } = event;
    const entry = entries.get(query);
    if (!entry) return;
    if (event.type === 'removed') {
      endAttempt(entry);
      entries.delete(query);
      listeners.forEach((notify) => notify());
      return;
    }
    if (event.type !== 'updated' || cache.get(query.queryHash) !== query) return;
    const { action } = event;
    if (action.type === 'success') {
      // Observers run before cache subscribers. A nested manual write can already have consumed
      // this revision before an older success notification reaches us, even for identical data.
      const newRevision = entry.dataCount !== query.state.dataUpdateCount;
      entry.dataCount = query.state.dataUpdateCount;
      if (action.manual) {
        update(entry, { committed: 0 });
        return;
      }
      const attempt = entry.attempt;
      // A synchronous observer can start the next fetch before this older commit reaches us.
      // Consume only the request that has actually returned, never that new pending request.
      const returned =
        attempt?.eligible !== undefined &&
        query.promise !== undefined &&
        query.promise === attempt.fetch.deref();
      const committed =
        newRevision && returned && attempt.eligible && !attempt.signal.aborted && accepted(entry)
          ? attempt.start
          : 0;
      if (returned) endAttempt(entry);
      entry.body =
        committed && typeof action.data === 'object' && action.data !== null
          ? new WeakRef(action.data)
          : undefined;
      if (committed > entry.snapshot.loss) entry.awaitingRecovery = false;
      update(entry, { committed, pending: entry.attempt?.start ?? 0 });
    } else if (action.type === 'setState' && 'data' in action.state) {
      // Cancellation can revert a running, paused or retrying fetch to the same qualified revision.
      // A reset, a data edit, or a restoration with a different object/count cannot borrow it.
      const sameRevision =
        action.state.fetchStatus === 'idle' &&
        action.state.dataUpdateCount === entry.dataCount &&
        entry.body?.deref() === action.state.data;
      entry.dataCount = query.state.dataUpdateCount;
      if (!sameRevision) update(entry, { committed: 0 });
    } else if (query.state.fetchStatus === 'paused') {
      loss(entry);
    }
  });
  return listeners;
}

/**
 * The evidence of a query in the owner's cache for the owner and generation. Another owner or
 * generation starts without any evidence.
 */
function own(owner: RunHeaderRegistry, query: Query, generation: number): Entry {
  const existing = entries.get(query);
  if (existing?.owner.deref() === owner && existing.generation === generation) return existing;
  if (existing) endAttempt(existing);
  const entry: Entry = {
    owner: new WeakRef(owner),
    listeners: monitor(owner.source.queryClient.getQueryCache()),
    generation,
    snapshot: empty,
    dataCount: query.state.dataUpdateCount,
    awaitingRecovery: false,
    attempt: undefined,
    body: undefined,
  };
  entries.set(query, entry);
  return entry;
}

/**
 * An established transport outage of a connection that follows this read, such as the run's event
 * stream (#575), recorded at once in the receipts that `getInspectorRead` and every write gate
 * consult. It fabricates no error and marks no cached value as read: committed evidence stays as
 * last observed and a read in flight keeps its identity, but only a read started after this loss
 * can end the outage. One unrecovered outage keeps its boundary, unless a read started since that
 * boundary is still unanswered: it may have been answered before this loss, so a new boundary
 * follows it. Recorded only on the owner's current physical query under accepted credentials;
 * another owner or generation starts from this loss without evidence.
 */
export function markInspectorTransportLoss(
  owner: RunHeaderRegistry | undefined,
  queryKey: QueryKey,
): void {
  const { rejected, generation } = useApiKeyStore.getState();
  if (!owner || rejected) return;
  const query = owner.source.queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query) return;
  const entry = own(owner, query, generation);
  if (entry.awaitingRecovery && !(entry.snapshot.pending > entry.snapshot.loss)) return;
  entry.awaitingRecovery = true;
  update(entry, { loss: markInspectorReadLoss() });
}

/**
 * Surround one real inspector GET. The caller keeps its ordinary response and error contract.
 * Eligibility only arms the current attempt. TanStack installs the body before notifying the
 * cache of a nonmanual success, including when structural sharing returns the previous object.
 */
export async function trackInspectorRead<T>(
  owner: RunHeaderRegistry | undefined,
  { client, queryKey, signal }: QueryFunctionContext,
  read: () => Promise<T>,
  eligible: (value: T) => boolean,
): Promise<T> {
  const cache = client.getQueryCache();
  const query = cache.find({ queryKey, exact: true });
  const fetch = query?.promise;
  const { rejected, generation } = useApiKeyStore.getState();
  if (
    !owner ||
    owner.source.queryClient !== client ||
    !query ||
    !fetch ||
    rejected ||
    signal.aborted
  )
    return read();

  const entry = own(owner, query, generation);
  const attempt: Attempt = {
    start: ++position,
    signal,
    fetch: new WeakRef(fetch),
    eligible: undefined,
    cancel: () => {
      if (entry.attempt !== attempt || entries.get(query) !== entry) return;
      endAttempt(entry);
      update(entry, { pending: 0 });
    },
  };
  endAttempt(entry);
  entry.attempt = attempt;
  signal.addEventListener('abort', attempt.cancel, { once: true });
  update(entry, { pending: attempt.start });
  const current = () =>
    entry.attempt === attempt &&
    !signal.aborted &&
    accepted(entry) &&
    cache.get(query.queryHash) === query &&
    entries.get(query) === entry &&
    query.promise === fetch;
  try {
    const value = await read();
    if (current()) {
      try {
        attempt.eligible = eligible(value);
      } catch {
        // Eligibility is an extra check for fallback. A refusal cannot change the GET's result.
        attempt.eligible = false;
      }
      if (!attempt.eligible) update(entry, { committed: 0 });
    }
    return value;
  } catch (error) {
    if (current()) {
      endAttempt(entry);
      if (isOfflineError(error)) {
        loss(entry, 0);
      } else {
        // A definitive refusal retires the previous proof immediately, even before a retry.
        update(entry, { committed: 0, pending: 0 });
      }
    }
    throw error;
  } finally {
    if (entry.attempt === attempt && !current()) {
      endAttempt(entry);
      update(entry, { pending: 0 });
    }
  }
}

/** A synchronous, render-pure check, including at a queued action's actual dispatch boundary. */
export function getInspectorRead(owner: RunHeaderRegistry, queryKey: QueryKey): InspectorRead {
  const query = owner.source.queryClient.getQueryCache().find({ queryKey, exact: true });
  const entry = query && entries.get(query);
  if (
    !entry ||
    entry.owner.deref() !== owner ||
    !accepted(entry) ||
    entry.dataCount !== query.state.dataUpdateCount ||
    (entry.snapshot.committed !== 0 && entry.body?.deref() !== query.state.data)
  )
    return empty;
  return entry.snapshot;
}

/** Receipts advance independently of the body and timestamp that TanStack publishes to React. */
export function useInspectorRead(owner: RunHeaderRegistry, queryKey: QueryKey): InspectorRead {
  const subscribe = useCallback(
    (notify: () => void) => {
      const listeners = monitor(owner.source.queryClient.getQueryCache());
      listeners.add(notify);
      const stopAuth = useApiKeyStore.subscribe(notify);
      return () => {
        listeners.delete(notify);
        stopAuth();
      };
    },
    [owner],
  );
  return useSyncExternalStore(subscribe, () => getInspectorRead(owner, queryKey));
}
