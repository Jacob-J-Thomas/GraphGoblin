import { subscribeRunEvents, TERMINAL_RUN_EVENT_TYPES } from '@graphgoblin/api-client';
import { useEffect, useState } from 'react';
import { useApi } from '../api/context.js';
import { errorMessage } from '../lib/utils.js';
import { useRunEventLog, useRunEventStore, type RunEventLog } from './event-store.js';

export type StreamStatus = 'connecting' | 'live' | 'finished' | 'error';

/**
 * Live tail of a run's events through the API client's SSE helper. Resumes after the stored cursor,
 * so a reload neither replays nor misses events; the helper itself reconnects on drops.
 */
export function useRunEvents(
  runId: string,
  onEvent?: () => void,
): RunEventLog & { status: StreamStatus; error?: string } {
  const client = useApi();
  const log = useRunEventLog(runId);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const { runs, append } = useRunEventStore.getState();
    const known = runs[runId];
    if (known?.events.some((e) => TERMINAL_RUN_EVENT_TYPES.has(e.type))) {
      setStatus('finished');
      return;
    }
    let active = true;
    setStatus('connecting');
    const subscription = subscribeRunEvents({
      client,
      runId,
      after: known?.lastSeq ?? 0,
      onEvent: (event) => {
        append(runId, event);
        setStatus('live');
        onEvent?.();
      },
    });
    subscription.done.then(
      () => {
        if (active) setStatus('finished');
      },
      (err: unknown) => {
        if (!active) return;
        setError(errorMessage(err));
        setStatus('error');
      },
    );
    return () => {
      active = false;
      subscription.close();
    };
    // `onEvent` is a notification hook; re-subscribing when it changes identity would churn the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, runId]);

  return { ...log, status, ...(error ? { error } : {}) };
}
