import type { RunEvent } from '@graphgoblin/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { keys } from '../api/queries.js';
import { createLiveRefresh, liveChanges, type LiveRefresh } from './live-refresh.js';

/**
 * Keeps the inspector's server read models current while it follows a run (#186). Live changes
 * are coalesced (`createLiveRefresh`), and each refresh reads only what the changes can affect:
 * the run record always, the latest evidence after evidence events, and the current thread after
 * thread events and only while it is shown. A thread change while a selected event's thread is
 * shown is refreshed once, when the current thread is shown again.
 */
export function useLiveRefresh(runId: string) {
  const queryClient = useQueryClient();
  const scheduler = useRef<LiveRefresh | undefined>(undefined);
  const thread = useRef({ shown: true, stale: false });
  useEffect(() => {
    thread.current.stale = false;
    const refresh = createLiveRefresh(async (changes) => {
      const reads = [queryClient.invalidateQueries({ queryKey: keys.run(runId) })];
      if (changes.observation)
        reads.push(queryClient.invalidateQueries({ queryKey: keys.observation(runId) }));
      if (changes.thread && thread.current.shown)
        reads.push(queryClient.invalidateQueries({ queryKey: keys.thread(runId) }));
      else if (changes.thread) thread.current.stale = true;
      await Promise.all(reads);
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
        void queryClient.invalidateQueries({ queryKey: keys.thread(runId) });
      },
    }),
    [queryClient, runId],
  );
}
