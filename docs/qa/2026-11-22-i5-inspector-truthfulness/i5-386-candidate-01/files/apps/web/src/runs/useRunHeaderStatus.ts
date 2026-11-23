import type { RunEvent } from '@graphgoblin/contracts';
import { useCallback, useState } from 'react';
import {
  emptyEvidence,
  headerStatus,
  observeEvents,
  observeLifecycle,
  type HeaderStatus,
  type RecordedPosition,
} from './run-header-status.js';

/**
 * The run header's status evidence (#386), held by the inspector for the run it shows and reset
 * when the run changes. `observe` takes each accepted streamed batch with the run it was streamed
 * for; a batch for another run is ignored. `lifecycle` is the whole-run observation's latest
 * marker. Only sequence numbers and terminal statuses are kept, never payloads, and nothing is
 * stored on the device.
 */
export function useRunHeaderStatus(
  runId: string,
  lifecycle: RunEvent | undefined,
): {
  observe: (streamedFor: string, events: readonly RunEvent[]) => void;
  status: (row: RecordedPosition) => HeaderStatus;
} {
  const [stored, setStored] = useState(() => emptyEvidence(runId));
  const evidence = observeLifecycle(
    stored.runId === runId ? stored : emptyEvidence(runId),
    lifecycle,
  );
  if (evidence !== stored) setStored(evidence);
  const observe = useCallback((streamedFor: string, events: readonly RunEvent[]) => {
    setStored((current) =>
      current.runId === streamedFor ? observeEvents(current, events) : current,
    );
  }, []);
  return { observe, status: (row) => headerStatus(evidence, row) };
}
