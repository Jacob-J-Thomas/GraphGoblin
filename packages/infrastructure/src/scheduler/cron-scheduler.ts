import { Cron } from 'croner';
import type { ClockPort, Logger } from '@graphgoblin/engine';
import type { ScheduleRecord, ScheduleStore } from './schedule-store.js';

/**
 * Upper bound on catch-up fires for one `run-each` schedule at boot. A minutely schedule that was
 * down for a day would otherwise start 1,440 runs at once; past the cap the older missed slots
 * are dropped with a warning and the schedule moves to its next future slot.
 */
export const RUN_EACH_CAP = 100;

export interface CronFire {
  schedule: ScheduleRecord;
  /** The slot this fire stands for (UTC ISO). For catch-up fires it lies in the past. */
  scheduledFor: string;
  /** True when the fire replays a slot missed while the process was down. */
  catchUp: boolean;
}

type Listener = (fire: CronFire) => void | Promise<void>;

export interface CronSchedulerOptions {
  /** How often to look for due schedules. Default 1000 ms. */
  pollIntervalMs?: number;
  /** Max schedules fired per poll. Default 100. */
  batchSize?: number;
  /** Max catch-up fires per `run-each` schedule at boot. Default `RUN_EACH_CAP`. */
  maxCatchUp?: number;
  logger?: Logger;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fires persisted cron schedules. croner computes slots in each schedule's timezone; the store
 * keeps the next slot, so a restart knows what it missed. A schedule is advanced in the store
 * before its listeners run, so a crash mid-fire loses at most that one fire and never repeats it.
 */
export class CronScheduler {
  private listeners: Listener[] = [];
  private interval: NodeJS.Timeout | undefined;
  private busy = false;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxCatchUp: number;
  private readonly logger: Logger | undefined;

  constructor(
    private readonly store: ScheduleStore,
    private readonly clock: ClockPort,
    options: CronSchedulerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
    this.maxCatchUp = options.maxCatchUp ?? RUN_EACH_CAP;
    this.logger = options.logger;
  }

  /** The first slot strictly after `after` in `timezone`, or undefined when there is none. Throws on a bad expression or timezone. */
  static nextFire(expression: string, timezone: string, after: Date): Date | undefined {
    const cron = new Cron(expression, { timezone, paused: true });
    return cron.nextRun(after) ?? undefined;
  }

  /** Undefined when usable, otherwise the field that failed and its reason. */
  static validate(
    expression: string,
    timezone: string,
  ): { field: 'expression' | 'timezone'; message: string } | undefined {
    try {
      CronScheduler.nextFire(expression, 'UTC', new Date(0));
    } catch (error) {
      return { field: 'expression', message: describe(error) };
    }
    if (timezone.length === 0) return { field: 'timezone', message: 'A time zone is required.' };
    try {
      // Validate even when the expression has no future slots and never converts a date.
      new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch (error) {
      return { field: 'timezone', message: describe(error) };
    }
    return undefined;
  }

  onFire(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Apply missed-fire policies, then poll on an interval. */
  async start(): Promise<void> {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    this.interval.unref();
    await this.recover();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
  }

  /**
   * Boot-time catch-up. Every enabled schedule whose stored next slot is already past was missed
   * while the process was down: `skip` moves to the next future slot, `run-once` fires once for
   * the latest missed slot, `run-each` fires for the latest `maxCatchUp` missed slots, oldest first.
   * A schedule without a next slot gets one. Returns the number of fires.
   */
  async recover(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let fired = 0;
    try {
      const now = this.clock.now();
      for (const schedule of await this.store.listEnabled()) {
        fired += await this.recoverOne(schedule, now);
      }
    } catch (error) {
      this.logger?.error({ error: describe(error) }, 'cron recovery failed');
    } finally {
      this.busy = false;
    }
    return fired;
  }

  /** Fire every due schedule once and advance it. Safe to call directly; overlapping calls are skipped. */
  async poll(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let fired = 0;
    try {
      const now = this.clock.now();
      const due = await this.store.listDue(now, this.batchSize);
      for (const schedule of due) {
        const scheduledFor = schedule.nextFireAt ?? now.toISOString();
        await this.store.markFired(schedule.id, {
          lastFiredAt: scheduledFor,
          nextFireAt: this.next(schedule, now),
        });
        await this.emit({ schedule, scheduledFor, catchUp: false });
        fired += 1;
      }
    } catch (error) {
      this.logger?.error({ error: describe(error) }, 'cron poll failed');
    } finally {
      this.busy = false;
    }
    return fired;
  }

  private async recoverOne(schedule: ScheduleRecord, now: Date): Promise<number> {
    const nextFireAt = this.next(schedule, now);
    if (!schedule.nextFireAt) {
      await this.store.markFired(schedule.id, { nextFireAt });
      return 0;
    }
    if (new Date(schedule.nextFireAt).getTime() > now.getTime()) return 0;
    const { slots, missedCount } = this.missedSlots(schedule, schedule.nextFireAt, now);
    const truncated = missedCount > this.maxCatchUp;
    const fires =
      schedule.missedFirePolicy === 'skip'
        ? []
        : schedule.missedFirePolicy === 'run-once'
          ? truncated
            ? new Cron(schedule.expression, { timezone: schedule.timezone, paused: true })
                .previousRuns(1, new Date(now.getTime() + 1000))
                .map((slot) => slot.toISOString())
            : slots.slice(-1)
          : slots.slice(Math.max(0, slots.length - this.maxCatchUp));
    if (schedule.missedFirePolicy === 'run-each' && truncated) {
      const dropped = missedCount - fires.length;
      const firstRetainedSlot = fires[0];
      this.logger?.warn(
        { scheduleId: schedule.id, cap: this.maxCatchUp, dropped, firstRetainedSlot },
        `cron catch-up capped; older missed slots dropped: ${dropped}; first retained slot: ${firstRetainedSlot ?? 'none'}`,
      );
    }
    await this.store.markFired(schedule.id, {
      ...(fires.length > 0 ? { lastFiredAt: fires[fires.length - 1] } : {}),
      nextFireAt,
    });
    for (const scheduledFor of fires) await this.emit({ schedule, scheduledFor, catchUp: true });
    return fires.length;
  }

  /**
   * Keep at most `maxCatchUp + 1` recent slots, oldest first. Count every missed slot for
   * `run-each`; other policies need only enough slots to detect truncation.
   */
  private missedSlots(
    schedule: ScheduleRecord,
    first: string,
    now: Date,
  ): { slots: string[]; missedCount: number } {
    const slots = [first];
    let missedCount = 1;
    let cursor = new Date(first);
    while (schedule.missedFirePolicy === 'run-each' || missedCount <= this.maxCatchUp) {
      const next = this.safeNext(schedule, cursor);
      if (!next || next.getTime() > now.getTime()) break;
      slots.push(next.toISOString());
      missedCount += 1;
      if (slots.length > this.maxCatchUp + 1) slots.shift();
      cursor = next;
    }
    return { slots, missedCount };
  }

  private next(schedule: ScheduleRecord, after: Date): string | undefined {
    return this.safeNext(schedule, after)?.toISOString();
  }

  private safeNext(schedule: ScheduleRecord, after: Date): Date | undefined {
    try {
      return CronScheduler.nextFire(schedule.expression, schedule.timezone, after);
    } catch (error) {
      this.logger?.error(
        { scheduleId: schedule.id, error: describe(error) },
        'cron expression failed; schedule disarmed',
      );
      return undefined;
    }
  }

  private async emit(fire: CronFire): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(fire);
      } catch (error) {
        this.logger?.error(
          { scheduleId: fire.schedule.id, error: describe(error) },
          'cron listener failed',
        );
      }
    }
  }
}
