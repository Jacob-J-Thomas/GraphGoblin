/**
 * Read-only projections of a run's event log for the inspector. Thread reconstruction uses
 * `replayThread` from `domain`, the same function the engine uses for consistency checks.
 */
import type { ContextThread, JsonPatch, RunEvent } from '@graphgoblin/contracts';
import { getAtPointer, replayThread } from '@graphgoblin/domain';

/**
 * The thread as the run started. The engine records it on the first event (`run.queued`),
 * including a subloop child's seed; logs written before that field existed fall back to the
 * immutable `run` and `invocation` from the current thread with every collection empty.
 */
export function initialThreadFrom(
  current: ContextThread,
  events: readonly RunEvent[] = [],
): ContextThread {
  const first = events[0];
  if (first?.type === 'run.queued' && first.initialThread) return first.initialThread;
  return {
    schemaVersion: 1,
    run: { ...current.run, iteration: 1 },
    invocation: current.invocation,
    messages: [],
    vars: {},
    artifacts: [],
    outputs: {},
    counters: {
      nodeVisits: {},
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 },
    },
  };
}

/**
 * The thread after the event with sequence `seq`: node patches replayed by `domain`, plus the
 * node-visit counter the engine keeps outside patches (it counts `node.started`).
 */
export function threadAt(
  initial: ContextThread,
  events: readonly RunEvent[],
  seq: number,
): ContextThread {
  const thread = replayThread(initial, events, seq);
  const nodeVisits: Record<string, number> = {};
  for (const event of events) {
    if (event.seq > seq) break;
    if (event.type === 'node.started')
      nodeVisits[event.nodeId] = (nodeVisits[event.nodeId] ?? 0) + 1;
  }
  return { ...thread, counters: { ...thread.counters, nodeVisits } };
}

/**
 * `threadAt` that reports a replay failure (for example a log whose patches do not apply to the
 * recorded start) instead of throwing, so one bad event never takes the inspector down.
 */
export function tryThreadAt(
  initial: ContextThread,
  events: readonly RunEvent[],
  seq: number,
): { ok: true; thread: ContextThread } | { ok: false; error: string } {
  try {
    return { ok: true, thread: threadAt(initial, events, seq) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface PatchLine {
  op: string;
  path: string;
  from?: string;
  before: unknown;
  after: unknown;
}

/** One line per patch operation with the value at its path before and after. */
export function patchDiff(
  before: ContextThread,
  after: ContextThread,
  patch: JsonPatch,
): PatchLine[] {
  const read = (doc: unknown, path: string) => {
    const hit = getAtPointer(doc, path);
    return hit.found ? hit.value : undefined;
  };
  return patch.map((op) => ({
    op: op.op,
    path: op.path,
    ...('from' in op ? { from: op.from } : {}),
    before: read(before, op.path),
    after: read(after, op.path),
  }));
}

/** A one-line description of an event for the timeline. */
export function describeEvent(event: RunEvent): string {
  switch (event.type) {
    case 'run.started':
      return `attempt ${event.attempt}`;
    case 'run.finished':
      return `${event.status} (${event.outcome})`;
    case 'run.failed':
      return `${event.failure.code}: ${event.failure.message}`;
    case 'run.paused':
    case 'run.resumed':
    case 'run.cancel_requested':
      return `by ${event.actor.kind} ${event.actor.id}`;
    case 'run.waiting':
      return `${event.nodeId} waits for ${event.wait.kind}`;
    case 'run.woken':
      return `${event.nodeId} woken by ${event.reason}`;
    case 'iteration.incremented':
      return `iteration ${event.from} → ${event.to} at ${event.targetNodeId}`;
    case 'node.started':
      return `${event.nodeId} (${event.kind}) attempt ${event.attempt}`;
    case 'node.finished':
      return `${event.nodeId}${event.route ? ` → ${event.route}` : ''}, ${event.patch.length} change${event.patch.length === 1 ? '' : 's'}, ${event.durationMs} ms`;
    case 'node.progress':
    case 'harness.usage':
    case 'heartbeat.beat':
    case 'input.received':
    case 'child_run.started':
    case 'child_run.finished':
    case 'harness.session':
    case 'decision.made':
      return 'nodeId' in event ? event.nodeId : '';
    case 'signal.received':
      return event.name;
    case 'return.delivered':
    case 'return.failed':
      return event.channel.kind;
    case 'run.queued':
    case 'run.cancelled':
      return '';
  }
}

/** Progress, session, and usage events grouped by node, for the progress drawer. */
export function nodeActivity(events: readonly RunEvent[]): Map<string, RunEvent[]> {
  const byNode = new Map<string, RunEvent[]>();
  for (const event of events) {
    if (
      event.type === 'node.progress' ||
      event.type === 'harness.session' ||
      event.type === 'harness.usage' ||
      event.type === 'decision.made' ||
      event.type === 'heartbeat.beat'
    ) {
      const list = byNode.get(event.nodeId) ?? [];
      list.push(event);
      byNode.set(event.nodeId, list);
    }
  }
  return byNode;
}
