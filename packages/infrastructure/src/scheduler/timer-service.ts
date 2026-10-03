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
 * Fires persisted timers. A timer is removed from the store before its listeners run, so a crash
 * mid-fire loses at most that one wake, and the run manager's own recovery covers the rest.
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
    if (this.polling) return 0;
    this.polling = true;
    try {
      const due = await this.store.listDue(this.clock.now(), this.batchSize);
      for (const timer of due) {
        await this.store.remove(timer.runId, timer.key);
        for (const listener of this.listeners) {
          try {
            await listener(timer.runId, timer.key);
          } catch (error) {
            this.logger?.error(
              {
                runId: timer.runId,
                key: timer.key,
                error: error instanceof Error ? error.message : String(error),
              },
              'timer listener failed',
            );
          }
        }
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
