import { expect, it, vi } from 'vitest';
import { completeWithDeadline } from './completion-deadline.js';
import { CapturingLogger } from './testing/index.js';

it('treats an undefined runtime completion limit as Unlimited', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  let signal: AbortSignal | undefined;
  const call = completeWithDeadline(
    (supplied) => {
      signal = supplied;
      return new Promise<number>((resolve) => {
        finish = () => resolve(7);
      });
    },
    new AbortController().signal,
    undefined,
    new CapturingLogger(),
    { runId: 'run', nodeId: 'repair' },
  );
  // Observe rejection immediately so the pre-fix regression is an ordinary assertion failure.
  const outcome = call.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await vi.advanceTimersByTimeAsync(120_001);
    expect(signal?.aborted).toBe(false);
    finish();
    expect(await outcome).toEqual({ value: 7 });
  } finally {
    finish?.();
    await outcome;
    vi.useRealTimers();
  }
});
