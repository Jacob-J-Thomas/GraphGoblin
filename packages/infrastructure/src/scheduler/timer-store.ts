/**
 * Persisted timers. The scheduler fires them; a store keeps them. `SqliteTimerStore` in the
 * sqlite folder satisfies this interface structurally, and `MemoryTimerStore` backs tests.
 */
export interface TimerStore {
  upsert(runId: string, key: string, at: Date): Promise<void>;
  remove(runId: string, key?: string): Promise<void>;
  /** Timers due at or before `now`, oldest first. */
  listDue(now: Date, limit?: number): Promise<{ runId: string; key: string; at: Date }[]>;
  list(runId: string): Promise<{ runId: string; key: string; at: Date }[]>;
}
