/**
 * Persisted timers. The scheduler fires them; a store keeps them. `SqliteTimerStore` in the
 * sqlite folder satisfies this interface structurally, and `MemoryTimerStore` backs tests.
 */
export interface TimerStore {
  upsert(runId: string, key: string, at: Date): Promise<void>;
  remove(runId: string, key?: string): Promise<void>;
  /**
   * Remove a fired timer only while its deadline matches `at`: a listener may
   * already have re-armed the same key for a later time, which must survive.
   */
  acknowledge(runId: string, key: string, at: Date): Promise<void>;
  /** Requeue the matching deadline; TimerService also fences identical-deadline re-arms. */
  defer(runId: string, key: string, at: Date, retryAt: Date): Promise<void>;
  /** Timers due at or before `now`, oldest first. */
  listDue(now: Date, limit?: number): Promise<{ runId: string; key: string; at: Date }[]>;
  list(runId: string): Promise<{ runId: string; key: string; at: Date }[]>;
}
