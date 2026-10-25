import { CURRENT_DEFINITION_FORMAT, type RunEvent } from '@graphgoblin/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { describeEvent } from './projections.js';

// 512 ordinary events cover several dozen turns. 1 MiB (UTF-16 JSON estimate) bounds
// payload-heavy windows independently of count; both apply to memory and session storage.
export const MAX_HISTORY_EVENTS = 512;
export const MAX_HISTORY_BYTES = 1_048_576;
export interface UncachedEvent {
  seq: number;
  type: RunEvent['type'];
  uncached: true;
  description: string;
}
export type TimelineEvent = RunEvent | UncachedEvent;
export interface RunEventLog {
  events: RunEvent[];
  /** Oversized payloads stay on the server. Their selectable rows preserve history membership. */
  uncached: UncachedEvent[];
  /** Live acknowledgement, independent of the history window being browsed. */
  lastSeq: number;
  bytes: number;
  mode: 'live' | 'history';
  olderCursor?: string | null | undefined;
  newerCursor?: string | null | undefined;
}
export interface HistoryWindow {
  items: RunEvent[];
  olderCursor?: string | null | undefined;
  newerCursor?: string | null | undefined;
}
export interface RunEventStoreState {
  runs: Record<string, RunEventLog>;
  append: (runId: string, ...events: RunEvent[]) => void;
  window: (
    runId: string,
    page: HistoryWindow,
    direction: 'older' | 'newer' | 'live' | 'seek',
  ) => void;
  resume: (runId: string) => void;
  pause: (runId: string) => void;
  clear: (runId: string) => void;
}

/** Storage denial/quota never prevents live observation, even if removal is denied too. */
export const quotaSafeSessionStorage = {
  getItem: (name: string) => {
    try {
      return sessionStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      sessionStorage.setItem(name, value);
    } catch {
      try {
        sessionStorage.removeItem(name);
      } catch {
        /* storage unavailable */
      }
    }
  },
  removeItem: (name: string) => {
    try {
      sessionStorage.removeItem(name);
    } catch {
      /* storage unavailable */
    }
  },
};
const EMPTY: RunEventLog = { events: [], uncached: [], lastSeq: 0, bytes: 0, mode: 'live' };
export const timelineEvents = (log: RunEventLog): TimelineEvent[] =>
  [...log.events, ...log.uncached].sort((a, b) => a.seq - b.seq);

function bounded(items: TimelineEvent[], older: boolean) {
  const unique = [...new Map(items.map((item) => [item.seq, item])).values()].sort(
    (a, b) => a.seq - b.seq,
  );
  const kept: TimelineEvent[] = [];
  let bytes = 0;
  for (const item of older ? unique : unique.reverse()) {
    let row = item;
    let size = JSON.stringify(row).length * 2;
    if (size > MAX_HISTORY_BYTES) {
      // Preserve the row's ordinary accessible name even when its payload stays on the server.
      // Pathological free-text summaries use the same 4,096-character preview budget as #259.
      const description = 'uncached' in item ? item.description : describeEvent(item);
      row = {
        seq: item.seq,
        type: item.type,
        uncached: true,
        description: description.slice(0, 4096),
      };
      size = JSON.stringify(row).length * 2;
    }
    if (kept.length === MAX_HISTORY_EVENTS || bytes + size > MAX_HISTORY_BYTES) break;
    kept.push(row);
    bytes += size;
  }
  kept.sort((a, b) => a.seq - b.seq);
  return {
    events: kept.filter((row): row is RunEvent => !('uncached' in row)),
    uncached: kept.filter((row): row is UncachedEvent => 'uncached' in row),
    bytes,
  };
}
const keepRun = (runs: Record<string, RunEventLog>, id: string, log: RunEventLog) => {
  const next = { ...runs, [id]: log };
  if (Object.keys(next).length > 20) delete next[Object.keys(next)[0]!];
  return next;
};

export const useRunEventStore = create<RunEventStoreState>()(
  persist(
    (set) => ({
      runs: {},
      append: (runId, ...incoming) =>
        set((state) => {
          const log = state.runs[runId] ?? EMPTY;
          const fresh: RunEvent[] = [];
          let lastSeq = log.lastSeq;
          for (const event of incoming) {
            if (event.seq <= lastSeq) continue;
            fresh.push(event);
            lastSeq = event.seq;
          }
          if (!fresh.length) return state;
          const next =
            log.mode === 'live'
              ? {
                  ...log,
                  ...bounded([...timelineEvents(log), ...fresh], false),
                  olderCursor: undefined,
                  newerCursor: null,
                  lastSeq,
                }
              : { ...log, lastSeq };
          return { runs: keepRun(state.runs, runId, next) };
        }),
      window: (runId, page, direction) =>
        set((state) => {
          const log = state.runs[runId] ?? EMPTY;
          const merge = direction === 'older' || direction === 'newer';
          const window = bounded(
            [...(merge ? timelineEvents(log) : []), ...page.items],
            direction === 'older',
          );
          const rows = timelineEvents({ ...log, ...window });
          return {
            runs: keepRun(state.runs, runId, {
              ...log,
              ...window,
              mode: direction === 'live' ? 'live' : 'history',
              // A trimmed boundary needs a new numeric seek, never a stale page cursor that skips rows.
              olderCursor: rows[0]?.seq === page.items[0]?.seq ? page.olderCursor : undefined,
              newerCursor:
                rows.at(-1)?.seq === page.items.at(-1)?.seq ? page.newerCursor : undefined,
            }),
          };
        }),
      resume: (runId) =>
        set((state) => {
          const log = state.runs[runId];
          return log ? { runs: { ...state.runs, [runId]: { ...log, mode: 'live' } } } : state;
        }),
      pause: (runId) =>
        set((state) => {
          const log = state.runs[runId];
          return log ? { runs: { ...state.runs, [runId]: { ...log, mode: 'history' } } } : state;
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
        for (const version of [1, 2, 3])
          quotaSafeSessionStorage.removeItem(`graphgoblin-run-events-v${version}`);
        quotaSafeSessionStorage.removeItem('graphgoblin-run-events');
        return quotaSafeSessionStorage;
      }),
      // Device cache only: discard the old unbounded shape; complete server history is untouched.
      version: 2,
      migrate: () => ({ runs: {} }),
    },
  ),
);

export function useRunEventLog(runId: string): RunEventLog {
  return useRunEventStore((s) => s.runs[runId] ?? EMPTY);
}
