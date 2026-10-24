import { z } from 'zod';
import type { RunManager, Logger } from '@graphgoblin/engine';

export const ShutdownActionSchema = z.enum(['drain', 'wait', 'force']);
export type ShutdownAction = z.infer<typeof ShutdownActionSchema>;
export const ShutdownStateSchema = z.object({
  phase: z.enum([
    'running',
    'draining',
    'awaiting-choice',
    'forcing',
    'force-failed',
    'ready',
    'stopped',
  ]),
  graceMs: z.number(),
  startedAt: z.string().optional(),
  choiceAt: z.string().optional(),
  activeRunIds: z.array(z.string()),
  choices: z.array(z.enum(['wait', 'force'])),
  error: z.string().optional(),
});
type ShutdownState = z.infer<typeof ShutdownStateSchema>;

/** Container-owned shutdown sequence. This controller never closes HTTP or the database. */
export class ShutdownController {
  readonly closing = new AbortController();
  private phase: ShutdownState['phase'] = 'running';
  private startedAt: string | undefined;
  private choiceAt: string | undefined;
  private error: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private draining: Promise<void> | undefined;
  private forcing: Promise<void> | undefined;
  private resolveReady!: () => void;
  readonly ready = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });

  constructor(
    private readonly manager: Pick<
      RunManager,
      'beginDrain' | 'waitForDrain' | 'forceStop' | 'drainingRunIds'
    >,
    private readonly graceMs: number,
    private readonly stopSources: () => void,
    private readonly logger: Logger,
  ) {}

  state(): ShutdownState {
    return {
      phase: this.phase,
      graceMs: this.graceMs,
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      ...(this.choiceAt ? { choiceAt: this.choiceAt } : {}),
      ...(this.error ? { error: this.error } : {}),
      activeRunIds: this.manager.drainingRunIds(),
      choices:
        this.phase === 'draining' || this.phase === 'awaiting-choice' ? ['wait', 'force'] : [],
    };
  }

  request(action: ShutdownAction): ShutdownState {
    if (action === 'wait') {
      // Acknowledgement only: no new countdown or automatic interruption.
      if (this.phase === 'awaiting-choice') this.phase = 'draining';
      clearTimeout(this.timer);
      return this.state();
    }
    if (!this.draining) {
      this.phase = 'draining';
      this.startedAt = new Date().toISOString();
      this.choiceAt = new Date(Date.now() + this.graceMs).toISOString();
      const admitted = this.manager.beginDrain();
      this.stopSources();
      this.timer = setTimeout(() => {
        if (this.phase !== 'draining') return;
        this.phase = 'awaiting-choice';
        this.logger.warn(
          this.state(),
          'Shutdown grace elapsed: keep waiting or explicitly force with a second signal or POST /system/shutdown',
        );
      }, this.graceMs);
      this.timer.unref();
      this.draining = admitted.then(() => this.manager.waitForDrain());
      void this.draining.then(
        () => {
          if (!this.forcing) this.complete();
        },
        (error) => this.failed(error),
      );
    }
    if (action === 'force' && !this.forcing && this.phase !== 'ready' && this.phase !== 'stopped') {
      this.phase = 'forcing';
      clearTimeout(this.timer);
      // Readiness owns both observers: neither a normal-drain completion nor a force
      // completion may close storage while the other sequence is still returning.
      this.forcing = Promise.all([this.manager.forceStop(), this.draining]).then(() => undefined);
      void this.forcing.then(
        () => this.complete(),
        (error) => this.failed(error),
      );
    }
    return this.state();
  }

  async drain(): Promise<void> {
    this.request('drain');
    await this.draining;
    await this.forcing;
  }

  stopped(): void {
    this.phase = 'stopped';
    clearTimeout(this.timer);
  }

  private complete(): void {
    if (this.phase === 'force-failed') return;
    clearTimeout(this.timer);
    this.phase = 'ready';
    this.closing.abort();
    this.resolveReady();
  }

  private failed(error: unknown): void {
    clearTimeout(this.timer);
    this.phase = 'force-failed';
    this.error =
      'Shutdown cleanup failed; listener, store and ownership retained. Inspect logs and native processes.';
    this.logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      this.error,
    );
  }
}
