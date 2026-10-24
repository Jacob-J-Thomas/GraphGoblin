import { TERMINAL_RUN_STATUSES } from '@graphgoblin/contracts';
import type { GraphGoblinClient } from './client.js';
import { runs, type RunSnapshot } from './resources.js';
import { defaultSleep } from './sse.js';

export interface WaitForRunOptions {
  /** How long to wait in total. */
  timeoutMs: number;
  /** Delay between polls. Default 1000 ms. */
  pollMs?: number;
  /** Aborting rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Injectable delay, for tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Injectable clock in milliseconds, for tests. Default `Date.now`. */
  now?: () => number;
}

/** A deadline may expire before the first snapshot arrives. */
export type WaitForRunResult =
  { finished: true; run: RunSnapshot } | { finished: false; run?: RunSnapshot };

/** Optional observation behavior, shared with MCP's early return and progress reporting. */
export interface RunObserver {
  /** Return early with finished: false when the caller needs to act. */
  stopWhen?: (run: RunSnapshot) => boolean;
  /** Called after each nonterminal poll that did not request an early return. */
  onPoll?: (run: RunSnapshot, polls: number) => void | Promise<void>;
}

const TERMINAL = new Set<string>(TERMINAL_RUN_STATUSES);

/** Race even an injected fetch/delay that ignores cancellation; consume late rejections. */
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- AbortSignal.reason is a caller-owned value and must pass through verbatim.
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve injected transport/delay failures without changing their identity.
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

/**
 * Observe snapshots with one budget covering requests, response bodies, callbacks and sleeps.
 * Only observation is aborted: this never calls the run cancellation endpoint.
 */
export async function observeRun(
  client: GraphGoblinClient,
  runId: string,
  options: WaitForRunOptions,
  observer: RunObserver,
): Promise<WaitForRunResult> {
  options.signal?.throwIfAborted();
  const pollMs = options.pollMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  const controller = new AbortController();
  const { signal } = controller;
  const deadlineReason = new Error('run observation deadline elapsed');
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  // JavaScript timers overflow above the signed 32-bit millisecond limit. Chunk long
  // budgets so an otherwise valid multi-day wait does not accidentally expire after 1 ms.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armDeadline = (remaining: number) => {
    const delay = Math.min(remaining, 2_147_483_647);
    timer = setTimeout(
      () => {
        if (remaining > delay) armDeadline(remaining - delay);
        else controller.abort(deadlineReason);
      },
      Math.max(0, delay),
    );
  };
  armDeadline(options.timeoutMs);
  // Check the clock after each await as well: a late response can beat a delayed timer callback.
  const check = () => {
    if (now() >= deadline) controller.abort(deadlineReason);
    signal.throwIfAborted();
  };
  let latest: RunSnapshot | undefined;
  try {
    for (let polls = 1; ; polls += 1) {
      check();
      const run = await abortable(runs.get(client, runId, { signal }), signal);
      check();
      latest = run;
      if (TERMINAL.has(run.status)) return { run, finished: true };
      if (observer.stopWhen?.(run)) return { run, finished: false };
      if (observer.onPoll) await abortable(Promise.resolve(observer.onPoll(run, polls)), signal);
      check();
      await abortable(sleep(Math.min(pollMs, deadline - now()), signal), signal);
    }
  } catch (error) {
    if (signal.aborted) {
      if (signal.reason === deadlineReason) {
        return { finished: false, ...(latest ? { run: latest } : {}) };
      }
      throw signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Poll until a terminal status or timeout. Caller abort rejects with its reason; the deadline
 * returns finished: false and the last timely snapshot, if any. Waiting for input is nonterminal.
 */
export function waitForRun(
  client: GraphGoblinClient,
  runId: string,
  options: WaitForRunOptions,
): Promise<WaitForRunResult> {
  return observeRun(client, runId, options, {});
}
