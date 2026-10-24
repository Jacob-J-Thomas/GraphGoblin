import type { ContextThread, RunEvent, RunStatus, JsonPatch } from '@graphgoblin/contracts';
import { applyPatch } from './patch.js';

/** Replay consumes only durable thread operations, independently of evaluation evidence shapes. */
export type ThreadReplayEvent =
  | { type: 'node.started'; seq: number; nodeId: string }
  | { type: 'node.finished'; seq: number; nodeId: string; patch: JsonPatch }
  | { type: 'iteration.incremented'; seq: number; to: number }
  | { type: 'decision.made'; seq: number; nodeId: string; gate?: { passes: number } | undefined }
  | {
      type: Exclude<
        RunEvent['type'],
        'node.started' | 'node.finished' | 'iteration.incremented' | 'decision.made'
      >;
      seq: number;
    };

/**
 * Which completions a replay applies. Once the log has shown a `node.started` (every log the
 * engine writes does), a `node.finished` is applied only when it completes the open visit: the
 * node most recently started and not yet finished (one token, so at most one is open). A second
 * record of the same completion, immediate or delayed, cannot complete a different open visit
 * or apply its patch twice.
 * A log without any `node.started` (hand-built fixtures) applies every completion.
 */
export interface ReplayState {
  /** The visit open at the start of the replayed events. */
  openNodeId?: string | undefined;
  /** Whether a `node.started` was seen before the replayed events. */
  strict: boolean;
}

/**
 * Rebuild the thread at a point in the event log by replaying node patches. Wake payloads are
 * recorded by the node that consumed them inside its own `node.finished` patch, so patches replay their effects. Decision events also project absolute gate pass counts. Every `node.started` counts one visit in `counters.nodeVisits`, as
 * the executor does. Replaying the events after a checkpoint passes the state at the checkpoint
 * (`replayStateAt`), so the result equals a full replay.
 */
type ReplayableThread = Pick<ContextThread, 'run' | 'counters'> & {
  gates?: ContextThread['gates'];
};

export function replayThread<T extends ReplayableThread>(
  initial: T,
  events: readonly ThreadReplayEvent[],
  uptoSeq?: number,
  state: ReplayState = { strict: false },
): T {
  let thread = initial;
  let { openNodeId } = state;
  let { strict } = state;
  for (const event of events) {
    if (uptoSeq !== undefined && event.seq > uptoSeq) break;
    if (event.type === 'node.started') {
      openNodeId = event.nodeId;
      strict = true;
      const visits = thread.counters.nodeVisits;
      thread = {
        ...thread,
        counters: {
          ...thread.counters,
          nodeVisits: { ...visits, [event.nodeId]: (visits[event.nodeId] ?? 0) + 1 },
        },
      };
    }
    if (event.type === 'node.finished') {
      if (strict && openNodeId !== event.nodeId) continue;
      openNodeId = undefined;
      thread = applyPatch(thread, event.patch);
    }
    if (event.type === 'decision.made' && event.gate) {
      thread = {
        ...thread,
        gates: { ...thread.gates, [event.nodeId]: { passes: event.gate.passes } },
      };
    }
    if (event.type === 'iteration.incremented') {
      thread = { ...thread, run: { ...thread.run, iteration: event.to } };
    }
  }
  return thread;
}

/** The replay state after the event `seq`, for replaying only the events that follow it. */
export function replayStateAt(events: readonly ThreadReplayEvent[], seq: number): ReplayState {
  let openNodeId: string | undefined;
  let strict = false;
  for (const event of events) {
    if (event.seq > seq) break;
    if (event.type === 'node.started') {
      openNodeId = event.nodeId;
      strict = true;
    }
    if (event.type === 'node.finished' && (!strict || openNodeId === event.nodeId))
      openNodeId = undefined;
  }
  return { openNodeId, strict };
}

export interface RunSummary {
  status: RunStatus;
  currentNodeId?: string;
  iteration: number;
  lastSeq: number;
  nodeVisits: Record<string, number>;
}

/** Derive run status and position from the event log alone. Used for consistency checks and recovery. */
export function summarizeRun(events: readonly RunEvent[]): RunSummary {
  let status: RunStatus = 'queued';
  let currentNodeId: string | undefined;
  let iteration = 1;
  let lastSeq = 0;
  const nodeVisits: Record<string, number> = {};
  // Parked in a wait nothing has woken: a resume returns the run to that wait (docs/05).
  let parked = false;
  for (const event of events) {
    lastSeq = Math.max(lastSeq, event.seq);
    switch (event.type) {
      case 'run.resumed':
        status = parked ? 'waiting' : 'running';
        break;
      case 'run.started':
      case 'run.woken':
        parked = false;
        status = 'running';
        break;
      case 'run.waiting':
        parked = true;
        status = 'waiting';
        currentNodeId = event.nodeId;
        break;
      case 'run.paused':
        status = 'paused';
        break;
      case 'run.cancelled':
        status = 'cancelled';
        break;
      case 'run.failed':
        status = 'failed';
        break;
      case 'run.finished':
        status = event.status;
        break;
      case 'node.started':
        parked = false;
        currentNodeId = event.nodeId;
        nodeVisits[event.nodeId] = (nodeVisits[event.nodeId] ?? 0) + 1;
        break;
      case 'iteration.incremented':
        iteration = event.to;
        break;
      default:
        break;
    }
  }
  return { status, ...(currentNodeId ? { currentNodeId } : {}), iteration, lastSeq, nodeVisits };
}
