import { and, asc, eq, lte } from 'drizzle-orm';
import type { Database } from './db.js';
import { timers } from './schema.js';

/** Timers in the `timers` table. Satisfies the scheduler's `TimerStore` structurally. */
export class SqliteTimerStore {
  constructor(private readonly db: Database) {}

  async upsert(runId: string, key: string, at: Date): Promise<void> {
    const value = { runId, key, at: at.toISOString() };
    await this.db
      .insert(timers)
      .values(value)
      .onConflictDoUpdate({ target: [timers.runId, timers.key], set: { at: value.at } });
  }

  async remove(runId: string, key?: string): Promise<void> {
    await this.db
      .delete(timers)
      .where(
        key === undefined
          ? eq(timers.runId, runId)
          : and(eq(timers.runId, runId), eq(timers.key, key)),
      );
  }

  async acknowledge(runId: string, key: string, at: Date): Promise<void> {
    await this.db
      .delete(timers)
      .where(and(eq(timers.runId, runId), eq(timers.key, key), eq(timers.at, at.toISOString())));
  }

  async listDue(now: Date, limit = 100): Promise<{ runId: string; key: string; at: Date }[]> {
    const rows = await this.db
      .select()
      .from(timers)
      .where(lte(timers.at, now.toISOString()))
      .orderBy(asc(timers.at))
      .limit(limit);
    return rows.map((r) => ({ runId: r.runId, key: r.key, at: new Date(r.at) }));
  }

  async list(runId: string): Promise<{ runId: string; key: string; at: Date }[]> {
    const rows = await this.db
      .select()
      .from(timers)
      .where(eq(timers.runId, runId))
      .orderBy(asc(timers.at));
    return rows.map((r) => ({ runId: r.runId, key: r.key, at: new Date(r.at) }));
  }
}
