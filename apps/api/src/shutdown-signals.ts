import type { ShutdownAction } from './shutdown.js';

/** A foreground process-group SIGINT plus pnpm forwarding can duplicate one keypress. */
export const SHUTDOWN_SIGNAL_COALESCE_MS = 1000;

/** Translate deliberate operator signals; forwarding duplicates never advance the sequence. */
export class ShutdownSignals {
  private lastAt: number | undefined;
  constructor(
    private readonly request: (action: ShutdownAction) => void,
    private readonly isStopping: () => boolean,
  ) {}

  receive(): void {
    const now = Date.now();
    if (this.lastAt !== undefined && now - this.lastAt < SHUTDOWN_SIGNAL_COALESCE_MS) return;
    this.lastAt = now;
    // The API may have initiated the stop before any terminal signal arrived.
    this.request(this.isStopping() ? 'force' : 'drain');
  }
}
