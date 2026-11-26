import {
  GraphGoblinApiError,
  subscribeRunEvents,
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
import { followRunAttempts } from './follow-run-attempts.js';
import { useRunEventLog, useRunEventStore, type RunEventLog } from './event-store.js';
import { markInspectorTransportLoss } from './inspector-read-provenance.js';
import { useRunHeaderRegistry } from './run-header-store.js';

export type StreamStatus = 'connecting' | 'live' | 'finished' | 'error';

/**
 * Events arriving within this window are appended, rendered, and reported together. A run that
 * streams thousands of harness items would otherwise re-render the inspector, rewrite session
 * storage, and refetch the run once per event.
 */
export const EVENT_BATCH_MS = 100;
// Flush early under bursts: timer throttling must not grow the temporary batch indefinitely.
const MAX_BATCH_EVENTS = 256;
const MAX_BATCH_BYTES = 1_048_576;
// Matches the API's default SSE heartbeat interval (apps/api/src/sse.ts).
const STREAM_HEARTBEAT_MS = 15_000;

/**
 * Live tail of a run's events through the API client's SSE helper. Resumes after the stored cursor,
 * so a reload neither replays nor misses events; the helper itself reconnects on drops. `onEvents`
 * is called once per batch with its events, and without events when the run record changed with
 * no new event.
 */
export function useRunEvents(
  runId: string,
  onEvents?: (events?: readonly RunEvent[]) => void,
): RunEventLog & { status: StreamStatus; error?: string } {
  const client = useApi();
  const queryClient = useQueryClient();
  const log = useRunEventLog(runId);
  // A new or forgotten API key restarts the stream: one ended by a 401 recovers, and one opened
  // with a key that was just forgotten (here or in another tab) closes.
  const apiKey = useApiKeyStore((s) => s.key);
  // Each credential generation has its own stream and follower: work begun under an earlier one,
  // including the same key accepted again after a rejection, never adds to the current one's.
  const generation = useApiKeyStore((s) => s.generation);
  const rejected = useApiKeyStore((s) => s.rejected);
  const headers = useRunHeaderRegistry();
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    // Rejected credentials read nothing until a key is accepted again (a new generation).
    if (rejected) return;
    const { runs, append } = useRunEventStore.getState();
    const known = runs[runId];
    // Cached outcomes can be superseded or followed by delivery audits. Resume at the
    // cached cursor and let the helper's authoritative completion confirm the current tail.
    let active = true;
    let buffer: RunEvent[] = [];
    let bufferBytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // This run's header evidence under the credentials the stream opened with (#386). Constant:
    // another generation runs this effect again with its own.
    const lease = headers?.lease(runId);
    // Where the run's own reads keep their receipts (`useRun` chooses the same owner).
    const receipts = headers?.source.client === client ? headers : undefined;
    // Whether the credentials this stream opened with are still the accepted ones, checked live:
    // a rejection or replacement retires its callbacks before React runs this effect's cleanup.
    const authorized = () => {
      const auth = useApiKeyStore.getState();
      return !auth.rejected && auth.generation === generation;
    };
    const live = () => active && authorized();
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      bufferBytes = 0;
      // Read under credentials since rejected or replaced: dropped, not committed, so the next
      // stream reads it again under the current ones.
      if (!authorized()) return;
      append(runId, ...batch);
      // Every accepted batch, whatever window is shown, and the last one flushed on cleanup:
      // the next stream for this run starts after it.
      headers?.events(lease, batch);
      if (!active) return;
      setStatus('live');
      onEvents?.(batch);
    };
    let subscription: RunEventSubscription | undefined;
    let connection = 0;
    let inTransportBackoff = false;
    let reportedOutage = false;
    // Whether a stream was confirmed open since the last transport loss recorded here (#575).
    // Unlike one connection's `openedAt`, which times that open for the heartbeat and the reread
    // budget, a graceful close or another ordinary error keeps it, and so does a restart: the next
    // transport failure is then a new loss. Only recording a loss consumes it.
    let reopened = false;
    let lastSeq = known?.lastSeq ?? 0;
    let stopHistory: (() => void) | undefined;
    const followAttempts = () => {
      stopHistory?.();
      stopHistory = followRunAttempts(client, runId, {
        cursor: () => useRunEventStore.getState().runs[runId]?.lastSeq ?? 0,
        events: () => useRunEventStore.getState().runs[runId]?.events ?? [],
        changed: () => {
          if (live()) onEvents?.();
        },
        lifecycle: (lifecycle) => {
          if (authorized()) headers?.lifecycle(lease, lifecycle);
        },
        append: (events) => {
          if (!authorized()) return;
          buffer.push(...events);
          flush();
        },
        running: () => {
          if (live()) connect();
        },
        finished: () => {
          if (live()) {
            setError(undefined);
            setStatus('finished');
          }
        },
        error: (err) => {
          if (live()) {
            setError(errorMessage(err));
            setStatus('error');
          }
        },
      });
    };
    const connect = () => {
      const currentConnection = ++connection;
      const current = () => live() && connection === currentConnection;
      let openedAt: number | undefined;
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
          openedAt = Date.now();
          reopened = true;
          inTransportBackoff = false;
          markApiReachable();
          setStatus('live');
          setError(undefined);
        },
        onError: (err, attempt) => {
          if (!current() || attempt === 0) return; // Invalid frames are not connection drops.
          if (
            err instanceof GraphGoblinApiError &&
            (err.code === 'SSE_SLOW_CONSUMER' || err.code === 'SSE_REPLAY_FAILED')
          ) {
            inTransportBackoff = false;
            openedAt = undefined;
            flush();
            setError(
              err.detail ?? 'The reader fell behind; reconnecting from the last received event.',
            );
            setStatus('error');
            return;
          }
          if (openedAt !== undefined && Date.now() - openedAt >= STREAM_HEARTBEAT_MS)
            reportedOutage = false;
          openedAt = undefined;
          inTransportBackoff =
            err instanceof TypeError || (err instanceof GraphGoblinApiError && err.status === 0);
          // Clean EOF and HTTP errors keep the SSE helper's existing backoff, and record no loss.
          if (!inTransportBackoff) return;
          setStatus('connecting');
          // A retry refused again with no stream confirmed open since the recorded loss records
          // nothing, so it never overtakes a recovery read, and requests none.
          if (reportedOutage && !reopened) return;
          // The first loss, or a later one after a stream opened again (#575) however that stream
          // then ended, a graceful close included: a run read since recovered cannot leave the view
          // current. First, with the run's read receipts: a write queued before React renders again
          // already finds the view lost, and a run read begun before now, even one the read below
          // joins, cannot end the outage.
          reopened = false;
          markInspectorTransportLoss(receipts, keys.run(runId));
          // A later loss within this outage's one reread requests no other read.
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
        onEvent: (event, bytes) => {
          if (!current()) return;
          if (event.seq > lastSeq) {
            lastSeq = event.seq;
            reportedOutage = false;
          }
          // The transport already has JSON text. Reuse its size rather than serializing here.
          if (buffer.length && bufferBytes + bytes > MAX_BATCH_BYTES) flush();
          buffer.push(event);
          bufferBytes += bytes;
          if (buffer.length >= MAX_BATCH_EVENTS || bufferBytes >= MAX_BATCH_BYTES) {
            flush();
            return;
          }
          timer ??= setTimeout(flush, EVENT_BATCH_MS);
        },
      });
      subscription.done.then(
        () => {
          if (!current()) return;
          flush();
          setStatus('finished');
          // The finalization marker can follow the last delivery event's invalidation.
          void queryClient.invalidateQueries({ queryKey: keys.run(runId) });
          followAttempts();
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
      if (live() && inTransportBackoff) connect();
    });
    connect();
    return () => {
      active = false;
      unsubscribe();
      stopHistory?.();
      // Leaving the run keeps what was accepted: the last batch still advances the cursor and the
      // header evidence, unless the credentials it was read under are no longer the accepted ones.
      flush();
      subscription?.close();
    };
    // `onEvents` is a notification hook; followRunAttempts follows resumed runs from the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, queryClient, runId, apiKey, generation, rejected, headers]);

  // No stream is open while the key is rejected: it is not shown as live.
  const shown = rejected && status === 'live' ? 'connecting' : status;
  return { ...log, status: shown, ...(error ? { error } : {}) };
}
