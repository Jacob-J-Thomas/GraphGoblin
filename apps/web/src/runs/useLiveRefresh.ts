import type { RunEvent } from '@graphgoblin/contracts';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { keys } from '../api/queries.js';
import { createLiveRefresh, liveChanges, type LiveRefresh } from './live-refresh.js';

/**
 * Keeps the inspector's server read models current while it follows a run (#186). Live changes
 * are coalesced (`createLiveRefresh`), and each refresh reads only what the changes can affect:
 * the run record after every batch, the latest evidence after evidence events, and the current
 * thread after thread events and only while it is shown. A thread change while a selected event's
 * thread is shown is read once, through the same refreshes, when the current thread is shown
 * again.
 */
export function useLiveRefresh(runId: string) {
  const queryClient = useQueryClient();
  const scheduler = useRef<LiveRefresh | undefined>(undefined);
  const thread = useRef({ shown: true, stale: false });
  useEffect(() => {
    thread.current.stale = false;
    /**
     * Reads `queryKey` with a request that starts after the change. A request already in flight
     * may have started before it (the first load, or a timed refetch), and an invalidation would
     * reuse a request in flight for a query that has no data yet; so let it settle, then read
     * again. Resolves whether the read succeeded.
     */
    const read = async (queryKey: QueryKey) => {
      if (queryClient.isFetching({ queryKey, exact: true }) > 0)
        await queryClient.refetchQueries({ queryKey, exact: true }, { cancelRefetch: false });
      await queryClient.invalidateQueries({ queryKey, exact: true });
      return queryClient.getQueryState(queryKey)?.status !== 'error';
    };
    const refresh = createLiveRefresh(async (changes) => {
      const showThread = changes.thread && thread.current.shown;
      if (changes.thread && !showThread) thread.current.stale = true;
      const [run, observation, current] = await Promise.all([
        changes.run && read(keys.run(runId)),
        changes.observation && read(keys.observation(runId)),
        showThread && read(keys.thread(runId)),
      ]);
      // A failed read keeps its change for the next refresh.
      return {
        run: changes.run && !run,
        observation: changes.observation && !observation,
        thread: showThread && !current,
      };
    });
    scheduler.current = refresh;
    return () => {
      refresh.dispose();
      scheduler.current = undefined;
    };
  }, [queryClient, runId]);
  return useMemo(
    () => ({
      /** A batch of live events, or no events for a change observed another way. */
      notify: (events?: readonly RunEvent[]) => {
        scheduler.current?.request(liveChanges(events));
      },
      /** Whether the current thread is on screen rather than a selected event's thread. */
      showCurrentThread: (shown: boolean) => {
        thread.current.shown = shown;
        if (!shown || !thread.current.stale) return;
        thread.current.stale = false;
        scheduler.current?.request({ run: false, observation: false, thread: true });
      },
    }),
    [],
  );
}
