import {
  GraphGoblinApiError,
  runs,
  TERMINAL_RUN_EVENT_TYPES,
  type GraphGoblinClient,
} from '@graphgoblin/api-client';
import type { RunEvent, RunStatus } from '@graphgoblin/contracts';
import { isTerminal, summarizeRun } from '@graphgoblin/domain';

/** Two seconds keeps remote resumes visible while limiting idle checks to one per interval. */
const RUN_OBSERVATION_POLL_MS = 2000;

/**
 * Catch up past historical terminals in finite JSON pages, then follow an active SSE tail.
 * Durable lifecycle evidence can overtake the captured row; observe that outcome and recheck
 * the row until it catches up. Only resumable failures otherwise need continued checks.
 */
export function followRunAttempts(
  client: GraphGoblinClient,
  runId: string,
  observer: {
    cursor(): number;
    events(): readonly RunEvent[];
    append(events: RunEvent[]): void;
    changed(): void;
    running(): void;
    finished(): void;
    error(error: unknown): void;
  },
): () => void {
  const controller = new AbortController();
  let failures = 0;
  let previous: { status: RunStatus; seq: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    try {
      // A continuously growing log cannot keep this read looping beyond its captured boundary.
      const run = await runs.get(client, runId, { signal: controller.signal });
      const changed =
        previous === undefined ||
        previous.status !== run.status ||
        previous.seq !== run.lastEventSeq;
      previous = { status: run.status, seq: run.lastEventSeq };
      let appended = false;
      while (!controller.signal.aborted && observer.cursor() < run.lastEventSeq) {
        const after = observer.cursor();
        const page = await runs.events(client, runId, { after, limit: 500 });
        if (controller.signal.aborted) return;
        observer.append(page.items);
        appended ||= page.items.length > 0;
        if (!page.hasMore) {
          if (observer.cursor() < run.lastEventSeq) throw new Error('Run history is incomplete');
          break;
        }
        if (observer.cursor() <= after)
          throw new Error('Run history page did not advance its cursor');
      }
      if (controller.signal.aborted) return;
      // Appends already notify the inspector. Metadata can also catch up without another event.
      if (changed && !appended) observer.changed();
      if (controller.signal.aborted) return;
      const events = observer.events();
      const status = events.length ? summarizeRun(events).status : run.status;
      if (!isTerminal(status)) {
        observer.running();
        return;
      }
      failures = 0;
      observer.finished();
      if (controller.signal.aborted) return;
      const terminal = events.findLast((event) => TERMINAL_RUN_EVENT_TYPES.has(event.type));
      const failure = terminal
        ? terminal.type === 'run.failed'
          ? terminal.failure
          : undefined
        : run.failure;
      if (status !== run.status || (status === 'failed' && failure?.resumable))
        timer = setTimeout(() => {
          void refresh();
        }, RUN_OBSERVATION_POLL_MS);
    } catch (error) {
      if (controller.signal.aborted) return;
      observer.error(error);
      if (
        error instanceof TypeError ||
        (error instanceof GraphGoblinApiError && error.status === 0)
      ) {
        // Retry read-only observation after transport loss with bounded exponential backoff.
        const delay = Math.min(30_000, RUN_OBSERVATION_POLL_MS * 2 ** failures++);
        timer = setTimeout(() => {
          void refresh();
        }, delay);
      }
    }
  };
  void refresh();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
