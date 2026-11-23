import type { GraphGoblinClient } from '@graphgoblin/api-client';
import type { RunEvent } from '@graphgoblin/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { createContext, use, type ReactNode } from 'react';
import { useApiKeyStore } from '../api/api-key.js';
import {
  emptyEvidence,
  observeEvents,
  observeLifecycle,
  samePosition,
  type HeaderEvidence,
  type RecordedPosition,
} from './run-header-status.js';

/** Runs whose header evidence is kept, as many as the event store keeps (event-store.ts). */
export const MAX_HEADER_RUNS = 20;
/** Positions remembered per run, so a read that completes late does not unverify a newer one. */
const MAX_RECEIPTS = 4;

/** One run's header evidence and the positions this scope's own run reads returned. */
export interface HeaderEntry {
  readonly evidence: HeaderEvidence;
  /** Status and sequence only: no other field of the record is kept. */
  readonly receipts: readonly RecordedPosition[];
}

interface Slot {
  entry: HeaderEntry;
}

interface Scope {
  readonly generation: number;
  readonly slots: Map<string, Slot>;
}

/**
 * The right to add evidence to one run's entry, taken when a read is sent or a stream opens. It
 * lapses when the credentials change or are rejected, or when the entry is evicted or cleared: a
 * late answer never recreates an entry or writes into another scope or run.
 */
export interface RunHeaderLease {
  readonly runId: string;
  readonly scope: object;
  readonly slot: object;
}

/**
 * The run headers' lifecycle evidence (#386), for every run this app has shown, owned by the app's
 * providers. It outlives a route, so returning to a run keeps what its stream delivered there, and
 * belongs to one API client, query cache and credential generation: another generation starts an
 * empty scope. It holds only sequences, terminal statuses and record positions, in memory, for at
 * most `MAX_HEADER_RUNS` runs (least recently used first out). Writes happen where a batch is
 * accepted or a read succeeds, never in render.
 */
export class RunHeaderRegistry {
  readonly #capacity: number;
  #scope: Scope;
  readonly #listeners = new Map<string, Set<() => void>>();

  constructor(
    /** The API client and query cache whose reads this registry holds evidence from. */
    readonly source: { client: GraphGoblinClient; queryClient: QueryClient },
    capacity = MAX_HEADER_RUNS,
  ) {
    this.#capacity = capacity;
    this.#scope = { generation: useApiKeyStore.getState().generation, slots: new Map() };
  }

  /** The run's entry under the current credentials, if any. Reads only; safe in render. */
  snapshot(runId: string): HeaderEntry | undefined {
    const auth = useApiKeyStore.getState();
    if (auth.rejected || auth.generation !== this.#scope.generation) return undefined;
    return this.#scope.slots.get(runId)?.entry;
  }

  /**
   * A lease on `runId`'s entry under the current credentials, creating it as the most recent and
   * evicting the least recently used beyond capacity. None while the key is rejected. A new
   * generation retires every entry of the previous one first.
   */
  lease(runId: string): RunHeaderLease | undefined {
    const auth = useApiKeyStore.getState();
    if (auth.rejected) return undefined;
    if (auth.generation !== this.#scope.generation)
      this.#scope = { generation: auth.generation, slots: new Map() };
    const { slots } = this.#scope;
    const slot = slots.get(runId) ?? { entry: { evidence: emptyEvidence(runId), receipts: [] } };
    slots.delete(runId);
    slots.set(runId, slot);
    for (const oldest of slots.keys()) {
      if (slots.size <= this.#capacity) break;
      slots.delete(oldest);
      this.#notify(oldest);
    }
    return { runId, scope: this.#scope, slot };
  }

  /** An accepted batch of the leased run's events (#386). */
  events(lease: RunHeaderLease | undefined, events: readonly RunEvent[]): void {
    this.#write(lease, (entry) => {
      const evidence = observeEvents(entry.evidence, events);
      return evidence === entry.evidence ? entry : { ...entry, evidence };
    });
  }

  /** The lifecycle marker of a whole-run observation that was just read successfully. */
  lifecycle(lease: RunHeaderLease | undefined, lifecycle: RunEvent | undefined): void {
    this.#write(lease, (entry) => {
      const evidence = observeLifecycle(entry.evidence, lifecycle);
      return evidence === entry.evidence ? entry : { ...entry, evidence };
    });
  }

  /** The status and sequence a successful run read returned. */
  receipt(lease: RunHeaderLease | undefined, row: RecordedPosition): void {
    const position = { status: row.status, lastEventSeq: row.lastEventSeq };
    this.#write(lease, (entry) => {
      const last = entry.receipts.at(-1);
      if (last && samePosition(last, position)) return entry;
      const receipts = entry.receipts.filter((known) => !samePosition(known, position));
      return { ...entry, receipts: [...receipts, position].slice(-MAX_RECEIPTS) };
    });
  }

  /** The run is definitively missing: its entry is dropped. */
  forget(lease: RunHeaderLease | undefined): void {
    if (!lease || !this.#slot(lease)) return;
    this.#scope.slots.delete(lease.runId);
    this.#notify(lease.runId);
  }

  /** Calls `listener` when the run's entry or the credentials change. */
  subscribe(runId: string, listener: () => void): () => void {
    const listeners = this.#listeners.get(runId) ?? new Set<() => void>();
    this.#listeners.set(runId, listeners);
    listeners.add(listener);
    const stopAuth = useApiKeyStore.subscribe(listener);
    return () => {
      stopAuth();
      listeners.delete(listener);
      if (listeners.size === 0 && this.#listeners.get(runId) === listeners)
        this.#listeners.delete(runId);
    };
  }

  /** The leased entry, while the lease is still current. */
  #slot(lease: RunHeaderLease): Slot | undefined {
    const auth = useApiKeyStore.getState();
    const slot = this.#scope.slots.get(lease.runId);
    return !auth.rejected &&
      lease.scope === this.#scope &&
      auth.generation === this.#scope.generation &&
      slot === lease.slot
      ? slot
      : undefined;
  }

  #write(lease: RunHeaderLease | undefined, next: (entry: HeaderEntry) => HeaderEntry): void {
    const slot = lease && this.#slot(lease);
    if (!lease || !slot) return;
    const entry = next(slot.entry);
    if (entry === slot.entry) return;
    slot.entry = entry;
    this.#notify(lease.runId);
  }

  #notify(runId: string): void {
    for (const listener of [...(this.#listeners.get(runId) ?? [])]) listener();
  }
}

const RunHeaderContext = createContext<RunHeaderRegistry | null>(null);

export function RunHeaderProvider({
  registry,
  children,
}: {
  registry: RunHeaderRegistry;
  children: ReactNode;
}) {
  return <RunHeaderContext value={registry}>{children}</RunHeaderContext>;
}

/** The app's run header registry; none outside the app's providers. */
export function useRunHeaderRegistry(): RunHeaderRegistry | undefined {
  return use(RunHeaderContext) ?? undefined;
}
