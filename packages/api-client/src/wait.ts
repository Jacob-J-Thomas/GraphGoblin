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

export interface WaitForRunResult {
  /** The latest snapshot. */
  run: RunSnapshot;
  /** True when the run reached a terminal status; false when the timeout elapsed first. */
  finished: boolean;
}

const TERMINAL = new Set<string>(TERMINAL_RUN_STATUSES);

/**
 * Poll `GET /runs/{id}` until the run reaches a terminal status (`succeeded`, `failed`,
 * `cancelled`, `exhausted`) or `timeoutMs` elapses. A run waiting for input is not terminal, so a
 * caller such as the MCP `wait_for_run` tool gets `finished: false` and can call again.
 */
export async function waitForRun(
  client: GraphGoblinClient,
  runId: string,
  options: WaitForRunOptions,
): Promise<WaitForRunResult> {
  const pollMs = options.pollMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const signal = options.signal ?? new AbortController().signal;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    const run = await runs.get(client, runId);
    if (TERMINAL.has(run.status)) return { run, finished: true };
    const remaining = deadline - now();
    if (remaining <= 0) return { run, finished: false };
    await sleep(Math.min(pollMs, remaining), signal);
  }
}
