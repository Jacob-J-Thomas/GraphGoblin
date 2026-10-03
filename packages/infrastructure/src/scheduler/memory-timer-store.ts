import type { TimerStore } from './timer-store.js';

/** In-memory timer store for tests and for the API's in-memory mode. */
export class MemoryTimerStore implements TimerStore {
  private readonly rows = new Map<string, { runId: string; key: string; at: Date }>();

  upsert(runId: string, key: string, at: Date): Promise<void> {
    this.rows.set(`${runId}\u0000${key}`, { runId, key, at });
    return Promise.resolve();
  }

  remove(runId: string, key?: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.runId === runId && (key === undefined || row.key === key)) this.rows.delete(id);
    }
    return Promise.resolve();
  }

  acknowledge(runId: string, key: string, at: Date): Promise<void> {
    const id = `${runId}\u0000${key}`;
    if (this.rows.get(id)?.at.getTime() === at.getTime()) this.rows.delete(id);
    return Promise.resolve();
  }

  listDue(now: Date, limit = 100): Promise<{ runId: string; key: string; at: Date }[]> {
    const due = [...this.rows.values()]
      .filter((r) => r.at.getTime() <= now.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    return Promise.resolve(due.slice(0, limit));
  }

  list(runId: string): Promise<{ runId: string; key: string; at: Date }[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((r) => r.runId === runId)
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    );
  }
}
