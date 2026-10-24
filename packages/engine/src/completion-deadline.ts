import { RunCancelledError, RunFailureError } from './errors.js';
import type { Logger } from './ports.js';

/** One engine boundary for route and repair completions, including adapters that ignore abort. */
export async function completeWithDeadline<T>(
  call: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs: number | null,
  logger: Logger,
  identity: { runId?: string; nodeId: string },
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const deadline = timeoutMs === null ? Infinity : Date.now() + timeoutMs;
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectInterruption!: (reason: Error) => void;
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const dispose = () => {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  };
  const abort = (reason: Error) => {
    if (aborted) return;
    aborted = true;
    dispose();
    controller.abort(reason);
    rejectInterruption(reason);
  };
  const cancel = () =>
    abort(signal.reason instanceof Error ? signal.reason : new RunCancelledError());
  const expire = () => {
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      // Node timers overflow after about 24.8 days; support the full authored range.
      timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
      return;
    }
    abort(
      new RunFailureError(
        'STRUCTURED_COMPLETION_TIMEOUT',
        `Structured completion exceeded its configured deadline of ${timeoutMs} ms`,
        { details: { timeoutMs }, nodeId: identity.nodeId },
      ),
    );
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (timeoutMs !== null) expire();
  const observe = () => {
    // Enforce wall time even when a busy event loop delayed the timer callback. Observe every
    // late settlement once, without retaining provider values or diagnostics in the log.
    if (!aborted && Date.now() >= deadline) expire();
    if (aborted) logger.warn(identity, 'late structured completion discarded');
  };
  const work = Promise.resolve()
    .then(() => {
      controller.signal.throwIfAborted();
      return call(controller.signal);
    })
    .then(
      (value) => {
        observe();
        return value;
      },
      (error: unknown) => {
        observe();
        // Preserve provider failure identity/categories; only interruption is manufactured here.
        throw error;
      },
    );
  try {
    return await Promise.race([interruption, work]);
  } finally {
    dispose();
  }
}
