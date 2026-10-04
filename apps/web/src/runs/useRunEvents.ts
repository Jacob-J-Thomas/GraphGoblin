import {
  GraphGoblinApiError,
  subscribeRunEvents,
  TERMINAL_RUN_EVENT_TYPES,
  type RunEventSubscription,
} from '@graphgoblin/api-client';
import type { RunEvent } from '@graphgoblin/contracts';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../api/queries.js';
import { markApiReachable, markApiUnreachable, subscribeApiRecovery } from '../lib/reachability.js';
import { useApiKeyStore } from '../api/api-key.js';
import { useApi } from '../api/context.js';
import { errorMessage } from '../lib/utils.js';
import { useRunEventLog, useRunEventStore, type RunEventLog } from './event-store.js';

export type StreamStatus = 'connecting' | 'live' | 'finished' | 'error';

/**
 * Events arriving within this window are appended, rendered, and reported together. A run that
 * streams thousands of harness items would otherwise re-render the inspector, rewrite session
 * storage, and refetch the run once per event.
 */
export const EVENT_BATCH_MS = 100;

/**
 * Live tail of a run's events through the API client's SSE helper. Resumes after the stored cursor,
 * so a reload neither replays nor misses events; the helper itself reconnects on drops. `onEvents`
 * is called once per batch.
 */
export function useRunEvents(
  runId: string,
  onEvents?: () => void,
): RunEventLog & { status: StreamStatus; error?: string } {
  const client = useApi();
  const queryClient = useQueryClient();
  const log = useRunEventLog(runId);
  // A new or forgotten API key restarts the stream: one ended by a 401 recovers, and one opened
  // with a key that was just forgotten (here or in another tab) closes.
  const apiKey = useApiKeyStore((s) => s.key);
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
    let buffer: RunEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      append(runId, ...batch);
      if (!active) return;
      setStatus('live');
      onEvents?.();
    };
    let subscription: RunEventSubscription | undefined;
    let connection = 0;
    let inTransportBackoff = false;
    let reportedOutage = false;
    let lastSeq = known?.lastSeq ?? 0;
    const connect = () => {
      const currentConnection = ++connection;
      const current = () => active && connection === currentConnection;
      flush(); // Commit the old connection's buffer before taking its resume cursor.
      subscription?.close();
      inTransportBackoff = false;
      setStatus('connecting');
      setError(undefined);
      subscription = subscribeRunEvents({
        client,
        runId,
        after: useRunEventStore.getState().runs[runId]?.lastSeq ?? 0,
        onOpen: () => {
          if (!current()) return;
          inTransportBackoff = false;
          markApiReachable();
          setStatus('live');
        },
        onError: (err, attempt) => {
          if (!current() || attempt === 0) return; // Invalid frames are not connection drops.
          inTransportBackoff =
            err instanceof TypeError || (err instanceof GraphGoblinApiError && err.status === 0);
          // Clean EOF and HTTP errors keep the SSE helper's existing backoff.
          if (!inTransportBackoff) return;
          setStatus('connecting');
          if (reportedOutage) return;
          reportedOutage = true;
          markApiUnreachable();
          // A loaded inspector otherwise has no failed query to drive the shared probe.
          // Try its active run read once per stream outage; a stuck stream must not churn reads.
          void queryClient.refetchQueries(
            { queryKey: keys.run(runId), exact: true, type: 'active' },
            { cancelRefetch: false },
          );
        },
        onEvent: (event) => {
          if (!current()) return;
          if (event.seq > lastSeq) {
            lastSeq = event.seq;
            reportedOutage = false;
          }
          buffer.push(event);
          timer ??= setTimeout(flush, EVENT_BATCH_MS);
        },
      });
      subscription.done.then(
        () => {
          if (!current()) return;
          flush();
          setStatus('finished');
        },
        (err: unknown) => {
          if (!current()) return;
          flush();
          setError(errorMessage(err));
          setStatus('error');
        },
      );
    };
    const unsubscribe = subscribeApiRecovery(() => {
      if (active && inTransportBackoff) connect();
    });
    connect();
    return () => {
      active = false;
      unsubscribe();
      flush();
      subscription?.close();
    };
    // `onEvents` is a notification hook; re-subscribing when it changes identity would churn the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, queryClient, runId, apiKey]);

  return { ...log, status, ...(error ? { error } : {}) };
}
