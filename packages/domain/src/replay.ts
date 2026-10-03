import type { ContextThread, RunEvent, RunStatus } from '@graphgoblin/contracts';
import { applyPatch } from './patch.js';

/**
 * Rebuild the thread at a point in the event log by replaying node patches. Wake payloads are
 * recorded by the node that consumed them inside its own `node.finished` patch, so patches are
 * the only thing to replay. Every `node.started` counts one visit in `counters.nodeVisits`, as
 * the executor does.
 */
export function replayThread(
  initial: ContextThread,
  events: readonly RunEvent[],
  uptoSeq?: number,
): ContextThread {
  let thread = initial;
  // The last node event seen: a `node.finished` repeating it (no `node.started` in between) is a
  // duplicate record of the same completion and is not applied twice.
  let lastNode: { type: string; nodeId: string } | undefined;
  for (const event of events) {
    if (uptoSeq !== undefined && event.seq > uptoSeq) break;
    if (event.type === 'node.started' || event.type === 'node.finished') {
      const duplicate =
        event.type === 'node.finished' &&
        lastNode?.type === 'node.finished' &&
        lastNode.nodeId === event.nodeId;
      lastNode = { type: event.type, nodeId: event.nodeId };
      if (duplicate) continue;
    }
    if (event.type === 'node.started') {
      const visits = thread.counters.nodeVisits;
      thread = {
        ...thread,
        counters: {
          ...thread.counters,
          nodeVisits: { ...visits, [event.nodeId]: (visits[event.nodeId] ?? 0) + 1 },
        },
      };
    }
    if (event.type === 'node.finished') thread = applyPatch(thread, event.patch);
    if (event.type === 'iteration.incremented') {
      thread = { ...thread, run: { ...thread.run, iteration: event.to } };
    }
  }
  return thread;
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
  for (const event of events) {
    lastSeq = Math.max(lastSeq, event.seq);
    switch (event.type) {
      case 'run.started':
      case 'run.resumed':
      case 'run.woken':
        status = 'running';
        break;
      case 'run.waiting':
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
