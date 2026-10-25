import { runs } from '@graphgoblin/api-client';
import type { RunEvent } from '@graphgoblin/contracts';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../api/context.js';
import { errorMessage } from '../lib/utils.js';
import { timelineEvents, useRunEventStore, type RunEventLog } from './event-store.js';

// A read holds at most one 128-event page before merging it into the bounded store.
export const HISTORY_PAGE_SIZE = 128;
export function useRunHistory(runId: string, log: RunEventLog) {
  const client = useApi();
  const [selection, setSelection] = useState<{
    runId: string;
    seq: number;
    detail?: RunEvent;
    oversized?: boolean;
  }>();
  const [read, setRead] = useState<{
    runId: string;
    client: typeof client;
    controller: AbortController;
    busy: boolean;
    error?: string;
  }>();
  // A pending or failed read belongs to this run/client only. An aborted read must not
  // become active again when the reader returns to its previous run.
  const activeRead =
    read?.runId === runId && read.client === client && !read.controller.signal.aborted
      ? read
      : undefined;
  const busy = activeRead?.busy ?? false;
  const error = activeRead?.error;
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), [runId, client]);
  const rows = timelineEvents(log);
  const selected = selection?.runId === runId ? selection : undefined;
  const pause = () => useRunEventStore.getState().pause(runId);
  async function load(direction: 'older' | 'newer' | 'live' | 'seek', seq?: number) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRead({ runId, client, controller, busy: true });
    pause(); // New live arrivals may advance only the resume cursor during a read.
    try {
      const current = useRunEventStore.getState().runs[runId] ?? log;
      const currentRows = timelineEvents(current);
      const cursor = direction === 'older' ? current.olderCursor : current.newerCursor;
      const query =
        direction === 'live' || direction === 'seek'
          ? { around: seq ?? current.lastSeq }
          : cursor
            ? { cursor }
            : direction === 'older'
              ? { around: Math.max(0, (currentRows[0]?.seq ?? 1) - 1) }
              : { after: currentRows.at(-1)?.seq ?? 0 };
      const page = await runs.events(
        client,
        runId,
        { ...query, limit: HISTORY_PAGE_SIZE },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const hit = seq === undefined ? undefined : page.items.find((event) => event.seq === seq);
      if (direction === 'seek' && !hit)
        throw new Error(`Event ${seq} is not available in this run.`);
      useRunEventStore.getState().window(runId, page, direction === 'live' ? 'seek' : direction);
      if (direction === 'live') {
        let after = page.items.at(-1)?.seq ?? 0;
        let pages = 0;
        while (after < (useRunEventStore.getState().runs[runId]?.lastSeq ?? 0)) {
          if (++pages > 8)
            throw new Error('Live history advanced while loading. Try Follow live again.');
          const suffix = await runs.events(
            client,
            runId,
            { after, limit: HISTORY_PAGE_SIZE },
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          const next = suffix.items.at(-1)?.seq ?? after;
          if (next <= after) throw new Error('Run history did not advance its cursor.');
          useRunEventStore.getState().window(runId, suffix, 'newer');
          after = next;
        }
        useRunEventStore.getState().resume(runId);
      }
      if (direction === 'live') setSelection(undefined);
      else if (hit) {
        // One explicitly requested intrinsic payload may exceed the history budget. It is never
        // persisted, and is released on the next selection; the timeline retains its small stub.
        const cached = useRunEventStore
          .getState()
          .runs[runId]?.events.some((e) => e.seq === hit.seq);
        setSelection({ runId, seq: hit.seq, detail: hit, oversized: !cached });
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setRead({ runId, client, controller, busy: false, error: errorMessage(err) });
    } finally {
      if (!controller.signal.aborted)
        setRead((current) =>
          current?.controller === controller ? { ...current, busy: false } : current,
        );
    }
  }
  function select(seq: number) {
    const event = log.events.find((e) => e.seq === seq);
    if (!event) {
      void load('seek', seq);
      return;
    }
    request.current?.abort();
    setRead(undefined);
    pause();
    setSelection({ runId, seq, detail: event });
  }
  return {
    rows,
    selectedSeq: selected?.seq,
    selectedEvent:
      selected?.detail ?? log.events.find((e) => e.seq === (selected?.seq ?? log.lastSeq)),
    payload: selected?.oversized ? selected.detail : undefined,
    busy,
    error,
    select,
    pause,
    older: () => load('older'),
    newer: () => load('newer'),
    live: () => load('live'),
    hasOlder: log.olderCursor !== null && (rows[0]?.seq ?? 0) > 1,
    hasNewer: (rows.at(-1)?.seq ?? 0) < log.lastSeq || Boolean(log.newerCursor),
  };
}
