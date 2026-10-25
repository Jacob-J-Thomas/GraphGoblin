import type { RunEvent } from '@graphgoblin/contracts';
import type { EventStorePort } from './ports.js';

/** Keep finalization's complete evidence, but bound each synchronous SQLite decode span. */
export async function finalizationHistory(
  store: EventStorePort,
  runId: string,
): Promise<RunEvent[]> {
  // Engineering quantum, not a byte bound or latency SLA. 256 keeps the measured small-event
  // workload's decode spans short without changing event validation or return/recovery evidence.
  const pageSize = 256;
  const history: RunEvent[] = [];
  let after = 0;
  for (;;) {
    const page = await store.read(runId, after, pageSize);
    history.push(...page);
    if (page.length < pageSize) return history;
    after = page.at(-1)!.seq;
    // Promise-only fake/native ports can settle entirely in microtasks; explicitly let timers
    // and API requests run between pages, just as the executor does between nodes.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
