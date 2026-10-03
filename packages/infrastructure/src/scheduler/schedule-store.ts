export type MissedFirePolicy = 'skip' | 'run-once' | 'run-each';

/** One cron trigger node of one published loop version (docs/08). Timestamps are UTC ISO strings. */
export interface ScheduleRecord {
  id: string;
  ownerId: string;
  loopId: string;
  versionId: string;
  triggerNodeId: string;
  expression: string;
  timezone: string;
  missedFirePolicy: MissedFirePolicy;
  enabled: boolean;
  nextFireAt?: string;
  lastFiredAt?: string;
  createdAt: string;
}

export interface ScheduleAdvance {
  /** When the schedule last fired; omit to keep the stored value (a skipped slot). */
  lastFiredAt?: string;
  /** The next slot, or undefined when the expression has no future fire. */
  nextFireAt: string | undefined;
}

/**
 * Persisted cron schedules. The scheduler fires them; a store keeps them. `SqliteScheduleStore` in
 * the sqlite folder satisfies this interface.
 */
export interface ScheduleStore {
  /** Every enabled schedule, whatever its next fire time. */
  listEnabled(): Promise<ScheduleRecord[]>;
  /** Enabled schedules whose next fire is at or before `now`, oldest first. */
  listDue(now: Date, limit?: number): Promise<ScheduleRecord[]>;
  /** Record a fire (or a skip) and move the schedule to its next slot. */
  markFired(id: string, advance: ScheduleAdvance): Promise<void>;
}
