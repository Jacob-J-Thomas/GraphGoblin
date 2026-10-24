import { GraphGoblinApiError, runs, type GraphGoblinClient } from '@graphgoblin/api-client';
import type { RunEvent } from '@graphgoblin/contracts';
import { isTerminal } from '@graphgoblin/domain';

/** Two seconds keeps remote resumes visible while limiting idle observation to one check per interval. */
const RESUMED_RUN_POLL_MS = 2000;

/**
 * Catch up past historical terminal events using finite JSON pages before opening another SSE
 * tail. SSE deliberately ends at a terminal event. Only resumable failures need continued checks.
 */
export function followRunAttempts(
  client: GraphGoblinClient,
  runId: string,
  observer: {
    cursor(): number;
    append(events: RunEvent[]): void;
    running(): void;
    finished(): void;
    error(error: unknown): void;
  },
): () => void {
  const controller = new AbortController();
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    try {
      // Capture a finite boundary: a continuously growing log cannot keep this read looping.
      const run = await runs.get(client, runId, { signal: controller.signal });
      while (!controller.signal.aborted && observer.cursor() < run.lastEventSeq) {
        const after = observer.cursor();
        const page = await runs.events(client, runId, { after, limit: 500 });
        if (controller.signal.aborted) return;
        observer.append(page.items);
        if (!page.hasMore) break;
        if (observer.cursor() <= after)
          throw new Error('Run history page did not advance its cursor');
      }
      if (controller.signal.aborted) return;
      if (!isTerminal(run.status)) {
        observer.running();
        return;
      }
      failures = 0;
      observer.finished();
      if (run.status === 'failed' && run.failure?.resumable)
        timer = setTimeout(() => {
          void refresh();
        }, RESUMED_RUN_POLL_MS);
    } catch (error) {
      if (controller.signal.aborted) return;
      observer.error(error);
      if (
        error instanceof TypeError ||
        (error instanceof GraphGoblinApiError && error.status === 0)
      ) {
        // Reconnect read-only observation after transport loss, bounded like the stream backoff.
        const delay = Math.min(30_000, RESUMED_RUN_POLL_MS * 2 ** failures++);
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
