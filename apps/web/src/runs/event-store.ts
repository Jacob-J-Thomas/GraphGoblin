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
  append: (runId: string, event: RunEvent) => void;
  clear: (runId: string) => void;
}

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
      append: (runId, event) =>
        set((state) => {
          const log = state.runs[runId] ?? { events: [], lastSeq: 0 };
          if (event.seq <= log.lastSeq) return state;
          const runs = {
            ...state.runs,
            [runId]: { events: [...log.events, event], lastSeq: event.seq },
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
      name: 'graphgoblin-run-events',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ runs: state.runs }),
    },
  ),
);

const EMPTY: RunEventLog = { events: [], lastSeq: 0 };

export function useRunEventLog(runId: string): RunEventLog {
  return useRunEventStore((s) => s.runs[runId] ?? EMPTY);
}
