import type { RunRecord } from '@graphgoblin/contracts';
import { RunFailureError } from './errors.js';

export const RUN_DEADLINE_TIMER = 'run-deadline';
/** Wall time includes waits, pauses and downtime; a queued run has not started its clock. */
export function runDeadline(run: RunRecord): Date | undefined {
  const seconds = run.pinned.limits.runDeadlineSeconds;
  if (!run.startedAt || seconds === null) return undefined;
  return new Date(Date.parse(run.startedAt) + seconds * 1000);
}
export function deadlineFailure(): RunFailureError {
  return new RunFailureError(
    'RUN_DEADLINE_EXCEEDED',
    'The run exceeded its configured elapsed execution deadline',
    { resumable: false },
  );
}
export function isDeadlineAbort(signal: AbortSignal): boolean {
  return (
    signal.aborted &&
    signal.reason instanceof RunFailureError &&
    signal.reason.code === 'RUN_DEADLINE_EXCEEDED'
  );
}

/** Active work keeps its authored deadline while the manager drains and durable timer delivery stops. */
export function watchRunDeadline(
  run: RunRecord,
  controller: AbortController,
  now: () => Date,
): (() => void) | undefined {
  const at = runDeadline(run);
  if (!at) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const check = () => {
    if (disposed) return;
    const remaining = at.getTime() - now().getTime();
    if (remaining <= 0) {
      controller.abort(deadlineFailure());
      return;
    }
    // Node timers overflow above about 24.8 days; a long authored deadline re-arms in chunks.
    timer = setTimeout(check, Math.min(remaining, 2147483647));
    timer.unref();
  };
  check();
  return () => {
    disposed = true;
    clearTimeout(timer);
  };
}
