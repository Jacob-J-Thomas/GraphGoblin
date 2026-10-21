import type { ClockPort, Logger, TimerPort } from '@graphgoblin/engine';
import type { TimerStore } from './timer-store.js';

type Listener = (runId: string, key: string) => void | boolean | Promise<void | boolean>;

export interface TimerServiceOptions {
  /** How often to look for due timers. Default 1000 ms. */
  pollIntervalMs?: number;
  /** Max timers fired per poll. Default 100. */
  batchSize?: number;
  logger?: Logger;
}

/**
 * Fires persisted timers, at least once. A timer is removed from the store only after every
 * listener has accepted it (did not return false or throw): a listener that defers, throws, or
 * a crash mid-fire leaves it durable for another poll or restart. Paused/unreadable runs are
 * acknowledged by the manager; paused deadlines are re-armed on resume/recovery.
 * Listeners must be idempotent; the run manager's wake is a compare-and-set on the wait it was
 * armed for. The removal is conditional on the fired time, so a listener that re-armed the same
 * key keeps its new timer. Same-run mutations are serialized and an overlapping re-arm
 * suppresses the old acknowledgement, even when the deadline is unchanged. The row remains
 * durable across restart; in-flight acknowledgements belong only to the stopped process.
 */
export class TimerService implements TimerPort {
  private listeners: Listener[] = [];
  private interval: NodeJS.Timeout | undefined;
  private polling = false;
  private readonly mutations = new Map<string, Promise<void>>();
  private readonly pendingSchedules = new Map<string, number>();
  private rearmed = new Set<string>();
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly logger: Logger | undefined;

  constructor(
    private readonly store: TimerStore,
    private readonly clock: ClockPort,
    options: TimerServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 100;
    this.logger = options.logger;
  }

  schedule(runId: string, key: string, at: Date): Promise<void> {
    const identity = JSON.stringify([runId, key]);
    this.pendingSchedules.set(identity, (this.pendingSchedules.get(identity) ?? 0) + 1);
    if (this.polling) this.rearmed.add(identity);
    return this.mutate(runId, () => this.store.upsert(runId, key, at)).finally(() => {
      const pending = (this.pendingSchedules.get(identity) ?? 1) - 1;
      if (pending === 0) this.pendingSchedules.delete(identity);
      else this.pendingSchedules.set(identity, pending);
    });
  }

  cancel(runId: string, key?: string): Promise<void> {
    return this.mutate(runId, () => this.store.remove(runId, key));
  }

  /** Serialize same-run writes, including bulk cancellation; never hold this across listeners. */
  private mutate(runId: string, change: () => Promise<void>): Promise<void> {
    const previous = this.mutations.get(runId) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(change);
    const tracked: Promise<void> = work.finally(() => {
      if (this.mutations.get(runId) === tracked) this.mutations.delete(runId);
    });
    this.mutations.set(runId, tracked);
    return tracked;
  }

  onFire(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    this.interval.unref();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
  }

  /** Fire every due timer once. Safe to call directly; concurrent polls are skipped. */
  async poll(): Promise<number> {
    // Without a listener nobody can deliver a wake, so leave the timers for one that can.
    if (this.polling || this.listeners.length === 0) return 0;
    this.polling = true;
    this.rearmed = new Set(this.pendingSchedules.keys());
    try {
      const due = await this.store.listDue(this.clock.now(), this.batchSize);
      for (const timer of due) {
        let delivered = true;
        for (const listener of this.listeners) {
          try {
            if ((await listener(timer.runId, timer.key)) === false) delivered = false;
          } catch (error) {
            delivered = false;
            this.logger?.error(
              {
                runId: timer.runId,
                key: timer.key,
                error: error instanceof Error ? error.message : String(error),
              },
              'timer listener failed; the timer stays and fires again on the next poll',
            );
          }
        }
        await this.mutate(timer.runId, async () => {
          // A resume can re-arm the same key at the exact same deadline. The date predicate
          // alone cannot distinguish it. Keep re-arms that overlap delivery, and order a
          // later schedule after this acknowledgement so its durable row survives as well.
          if (this.rearmed.has(JSON.stringify([timer.runId, timer.key]))) return;
          if (delivered) await this.store.acknowledge(timer.runId, timer.key, timer.at);
          else {
            // One poll interval avoids a hot loop and lets other overdue rows progress.
            const retryAt = new Date(this.clock.now().getTime() + this.pollIntervalMs);
            await this.store.defer(timer.runId, timer.key, timer.at, retryAt);
          }
        });
      }
      return due.length;
    } catch (error) {
      this.logger?.error(
        { error: error instanceof Error ? error.message : String(error) },
        'timer poll failed',
      );
      return 0;
    } finally {
      this.polling = false;
      this.rearmed.clear();
    }
  }
}
