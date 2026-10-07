import type { RunEvent } from '@graphgoblin/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface RunEventLog {
  events: RunEvent[];
  /** The highest `seq` received; the SSE subscription resumes after it. */
  lastSeq: number;
}

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
          const log = state.runs[runId] ?? { events: [], lastSeq: 0 };
          const fresh: RunEvent[] = [];
          let lastSeq = log.lastSeq;
          for (const event of incoming) {
            if (event.seq <= lastSeq) continue;
            fresh.push(event);
            lastSeq = event.seq;
          }
          if (fresh.length === 0) return state;
          const runs = {
            ...state.runs,
            [runId]: { events: [...log.events, ...fresh], lastSeq },
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
      // Canonical decision evidence replaces the older v2 decision payload; replay these logs.
      name: 'graphgoblin-run-events-v3',
      storage: createJSONStorage(() => quotaSafeSessionStorage),
      partialize: (state) => ({ runs: state.runs }),
    },
  ),
);

const EMPTY: RunEventLog = { events: [], lastSeq: 0 };

export function useRunEventLog(runId: string): RunEventLog {
  return useRunEventStore((s) => s.runs[runId] ?? EMPTY);
}
