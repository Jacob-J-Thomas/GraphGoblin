import { subscribeRunEvents, TERMINAL_RUN_EVENT_TYPES } from '@graphgoblin/api-client';
import type { RunEvent } from '@graphgoblin/contracts';
import { useEffect, useState } from 'react';
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
    setStatus('connecting');
    setError(undefined);
    const subscription = subscribeRunEvents({
      client,
      runId,
      after: known?.lastSeq ?? 0,
      // Open is live, even when a stream resumed at the cursor has nothing new to send yet.
      onOpen: () => {
        if (active) setStatus('live');
      },
      onEvent: (event) => {
        buffer.push(event);
        timer ??= setTimeout(flush, EVENT_BATCH_MS);
      },
    });
    subscription.done.then(
      () => {
        flush();
        if (active) setStatus('finished');
      },
      (err: unknown) => {
        flush();
        if (!active) return;
        setError(errorMessage(err));
        setStatus('error');
      },
    );
    return () => {
      flush();
      active = false;
      subscription.close();
    };
    // `onEvents` is a notification hook; re-subscribing when it changes identity would churn the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, runId, apiKey]);

  return { ...log, status, ...(error ? { error } : {}) };
}
