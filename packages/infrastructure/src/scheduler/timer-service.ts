import type { ClockPort, Logger, TimerPort } from '@graphgoblin/engine';
import type { TimerStore } from './timer-store.js';

type Listener = (runId: string, key: string) => void | Promise<void>;

export interface TimerServiceOptions {
  /** How often to look for due timers. Default 1000 ms. */
  pollIntervalMs?: number;
  /** Max timers fired per poll. Default 100. */
  batchSize?: number;
  logger?: Logger;
}

/**
 * Fires persisted timers, at least once. A timer is removed from the store only after every
 * listener has handled it without throwing: a listener that throws (a transient store error) or
 * a crash mid-fire leaves it in place, and it fires again on the next poll or after a restart.
 * Listeners must be idempotent; the run manager's wake is a compare-and-set on the wait it was
 * armed for. The removal is conditional on the fired time, so a listener that re-armed the same
 * key keeps its new timer.
 */
export class TimerService implements TimerPort {
  private listeners: Listener[] = [];
  private interval: NodeJS.Timeout | undefined;
  private polling = false;
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
    return this.store.upsert(runId, key, at);
  }

  cancel(runId: string, key?: string): Promise<void> {
    return this.store.remove(runId, key);
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
    try {
      const due = await this.store.listDue(this.clock.now(), this.batchSize);
      for (const timer of due) {
        let delivered = true;
        for (const listener of this.listeners) {
          try {
            await listener(timer.runId, timer.key);
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
        if (delivered) await this.store.acknowledge(timer.runId, timer.key, timer.at);
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
    }
  }
}
