import { useCallback, useSyncExternalStore } from 'react';
import {
  emptyEvidence,
  headerStatus,
  samePosition,
  type HeaderStatus,
  type RecordedPosition,
} from './run-header-status.js';
import { useRunHeaderRegistry, type RunHeaderRegistry } from './run-header-store.js';

/**
 * The run header's status (#386) for the run shown, from the app's run header registry: the
 * evidence its stream and successful observation reads delivered, and the positions its own run
 * reads returned under the current credentials. Reading it never adds evidence; a cached query
 * value seen on render is not a new read. Only sequences and statuses are kept, in memory.
 */
export function useRunHeaderStatus(runId: string): {
  registry: RunHeaderRegistry;
  status: (row: RecordedPosition) => HeaderStatus;
} {
  const registry = useRunHeaderRegistry();
  if (!registry) throw new Error('useRunHeaderStatus must be used inside the app providers');
  const subscribe = useCallback(
    (listener: () => void) => registry.subscribe(runId, listener),
    [registry, runId],
  );
  const entry = useSyncExternalStore(subscribe, () => registry.snapshot(runId));
  return {
    registry,
    status: (row) =>
      headerStatus(
        entry?.evidence ?? emptyEvidence(runId),
        row,
        entry?.receipts.some((receipt) => samePosition(receipt, row)) ?? false,
      ),
  };
}
