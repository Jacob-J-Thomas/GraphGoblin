import type { RunEvent } from '@graphgoblin/contracts';
import { THREAD_EVENT_TYPES } from '@graphgoblin/domain';

/**
 * While the inspector follows a run, its server read models (the run record, the latest durable
 * evidence and the current thread) refresh at most once per this interval, with at most one
 * refresh in flight, however fast the run appends events (#186). Half a second keeps status,
 * evidence and the current thread visibly live; it bounds a followed run to at most two refreshes
 * a second, each of bounded reads, and a slower gateway slows the refreshes rather than queueing
 * them. An engineering parameter, not an owner-approved budget.
 */
export const LIVE_REFRESH_MS = 500;

/**
 * The event types after which `GET /runs/{id}/observation` can answer differently: its lifecycle,
 * exit, gate, finish, cancellation and fresh-session evidence (apps/api `routes/runs.ts`). Any
 * other event leaves that read unchanged.
 */
export const OBSERVATION_EVENT_TYPES: ReadonlySet<RunEvent['type']> = new Set<RunEvent['type']>([
  'run.started',
  'run.resumed',
  'run.finished',
  'run.failed',
  'run.cancelled',
  'run.cancel_requested',
  'exit.evaluated',
  'decision.made',
]);

/** The read models a change can affect. */
export interface LiveChanges {
  run: boolean;
  observation: boolean;
  thread: boolean;
}

const NONE: LiveChanges = { run: false, observation: false, thread: false };

/** Both sets of changes. */
function mergeChanges(a: LiveChanges | undefined, b: LiveChanges): LiveChanges {
  return a
    ? {
        run: a.run || b.run,
        observation: a.observation || b.observation,
        thread: a.thread || b.thread,
      }
    : b;
}

/**
 * What a batch of live events can change: the run record always, the evidence and the thread only
 * after their own event types. Without events (metadata observed to change by another route, such
 * as the attempt follower) every read model may have changed.
 */
export function liveChanges(events?: readonly RunEvent[]): LiveChanges {
  if (!events) return { run: true, observation: true, thread: true };
  return {
    run: true,
    observation: events.some((event) => OBSERVATION_EVENT_TYPES.has(event.type)),
    thread: events.some((event) => THREAD_EVENT_TYPES.has(event.type)),
  };
}

export interface LiveRefresh {
  /** Record a change. The refresh covering it starts no sooner than `intervalMs` after the last. */
  request(changes: LiveChanges): void;
  /** Cancel a scheduled refresh; one already in flight completes without scheduling another. */
  dispose(): void;
}

/**
 * Coalesces live changes into refreshes: the first change after a quiet interval refreshes at
 * once; changes during an interval, or while a refresh is in flight, merge into one trailing
 * refresh. Refreshes never overlap. A refresh resolves with the changes it could not read (a
 * failed read); they stay pending and join the next refresh a later change requests, so no change
 * is lost and a failing read is not retried on its own.
 */
export function createLiveRefresh(
  refresh: (changes: LiveChanges) => Promise<LiveChanges | void>,
  intervalMs = LIVE_REFRESH_MS,
): LiveRefresh {
  let pending: LiveChanges | undefined;
  let unread: LiveChanges | undefined;
  let running = false;
  let disposed = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (disposed || running || timer !== undefined || pending === undefined) return;
    timer = setTimeout(start, Math.max(0, lastStart + intervalMs - Date.now()));
  };
  function start() {
    timer = undefined;
    const changes = mergeChanges(unread, pending!);
    pending = unread = undefined;
    running = true;
    lastStart = Date.now();
    void refresh(changes)
      .then(
        (left) => left ?? NONE,
        () => changes,
      )
      .then((left) => {
        if (left.run || left.observation || left.thread) unread = mergeChanges(unread, left);
        running = false;
        schedule();
      });
  }
  return {
    request(changes) {
      if (disposed) return;
      pending = mergeChanges(pending, changes);
      schedule();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
      pending = unread = undefined;
    },
  };
}
