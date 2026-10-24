import { CURRENT_DEFINITION_FORMAT, type RunEvent } from '@graphgoblin/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface RunEventLog {
  events: RunEvent[];
  /** The highest `seq` received; the SSE subscription resumes after it. */
  lastSeq: number;
  /**
   * Characters of JSON the recorded events amount to, accumulated as they arrive. The inspector
   * uses it to tell a history whose reconstruction would freeze the page (#259).
   */
  bytes: number;
}

/**
 * Recorded characters of JSON above which a run's history is "large": replaying it for a newly
 * selected event, and enumerating the keys of a value it holds, would each freeze the page for
 * hundreds of milliseconds (a 350,000-property variable measured at 344 to 473 ms), as would
 * serialising the log into session storage on every append. The inspector reconstructs the thread
 * at an event of such a run on request only, and the stored copy leaves such a log out, so a
 * reload replays it from its first event (#259). Ordinary runs record kilobytes to a few hundred
 * kilobytes.
 */
export const LARGE_HISTORY_BYTES = 2_000_000;

export interface RunEventStoreState {
  runs: Record<string, RunEventLog>;
  /** Append events in order; any at or below the cursor are dropped as duplicates. */
  append: (runId: string, ...events: RunEvent[]) => void;
  clear: (runId: string) => void;
}

/**
 * Session storage that never throws on write. Very long logs can exceed the browser's quota; the
 * in-memory log stays complete and the stored copy is dropped, so a reload replays the run from
 * its first event instead of resuming (still without gaps or duplicates).
 */
export const quotaSafeSessionStorage = {
  getItem: (name: string) => sessionStorage.getItem(name),
  setItem: (name: string, value: string) => {
    try {
      sessionStorage.setItem(name, value);
    } catch {
      sessionStorage.removeItem(name);
    }
  },
  removeItem: (name: string) => sessionStorage.removeItem(name),
};

/** Keep at most this many runs' logs in session storage. */
const MAX_RUNS = 20;

/**
 * Per-run event logs fed by the SSE hook. Persisted to session storage, so a reload keeps the
 * timeline and resumes the stream after the stored cursor without gaps or duplicates.
 */
export const useRunEventStore = create<RunEventStoreState>()(
  persist(
    (set) => ({
      runs: {},
      append: (runId, ...incoming) =>
        set((state) => {
          const log = state.runs[runId] ?? EMPTY;
          const fresh: RunEvent[] = [];
          let lastSeq = log.lastSeq;
          let bytes = log.bytes;
          for (const event of incoming) {
            if (event.seq <= lastSeq) continue;
            fresh.push(event);
            lastSeq = event.seq;
            bytes += JSON.stringify(event).length;
          }
          if (fresh.length === 0) return state;
          const runs = {
            ...state.runs,
            [runId]: { events: [...log.events, ...fresh], lastSeq, bytes },
          };
          const ids = Object.keys(runs);
          if (ids.length > MAX_RUNS) delete runs[ids[0] as string];
          return { runs };
        }),
      clear: (runId) =>
        set((state) => {
          const { [runId]: _removed, ...runs } = state.runs;
          return { runs };
        }),
    }),
    {
      name: `graphgoblin-run-events-v${CURRENT_DEFINITION_FORMAT}`,
      storage: createJSONStorage(() => {
        // Once at module initialisation, before hydration. Never read old events or cursors.
        for (const version of [1, 2, 3])
          sessionStorage.removeItem(`graphgoblin-run-events-v${version}`);
        sessionStorage.removeItem('graphgoblin-run-events');
        return quotaSafeSessionStorage;
      }),
      // Version 1 added `bytes` to each log. A stored log of an earlier version has no size to
      // carry on from, so it is dropped and the run replays from its first event.
      version: 1,
      migrate: () => ({ runs: {} }),
      partialize: (state) => ({
        runs: Object.fromEntries(
          Object.entries(state.runs).filter(([, log]) => log.bytes <= LARGE_HISTORY_BYTES),
        ),
      }),
    },
  ),
);

const EMPTY: RunEventLog = { events: [], lastSeq: 0, bytes: 0 };

export function useRunEventLog(runId: string): RunEventLog {
  return useRunEventStore((s) => s.runs[runId] ?? EMPTY);
}
