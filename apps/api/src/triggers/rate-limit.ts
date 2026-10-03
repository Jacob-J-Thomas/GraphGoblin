import type { ClockPort } from '@graphgoblin/engine';

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the current window resets. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter per key, in memory. Good enough for one process: a burst at a window
 * boundary can reach twice the limit, and counts reset on restart. Windows of idle keys are
 * dropped lazily so the map does not grow with dead tokens.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly clock: ClockPort,
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  hit(key: string): RateLimitDecision {
    const now = this.clock.now().getTime();
    if (this.windows.size > 10_000) this.sweep(now);
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((window.start + this.windowMs - now) / 1000));
    return { allowed: window.count <= this.limit, retryAfterSeconds };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
