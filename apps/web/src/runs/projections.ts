/**
 * Read-only projections of a run's event log for the inspector. Thread reconstruction uses
 * `replayThread` from `domain`, the same function the engine uses for consistency checks.
 */
import type {
  ContextThread,
  JsonPatch,
  ClassifierAnswer,
  EvaluationObservation,
  RunEvent,
  LoopDefinition,
  ReturnChannel,
} from '@graphgoblin/contracts';
import { getAtPointer, replayThread } from '@graphgoblin/domain';

/**
 * The thread as the run started. The engine records it on the first event (`run.queued`),
 * including a subloop child's or replay fork's seed; logs without that field fall back to the
 * immutable `run` and `invocation` from the current thread and one-based gates from the definition.
 */
export function initialThreadFrom(
  current: ContextThread,
  events: readonly RunEvent[] = [],
  definition?: LoopDefinition,
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
    gates: Object.fromEntries(
      (definition?.nodes ?? [])
        .filter((node) => node.kind === 'decision' && node.config.maxPasses !== undefined)
        .map((node) => [node.id, { passes: 1 }]),
    ),
    counters: {
      nodeVisits: {},
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 },
    },
  };
}

/**
 * The thread after event `seq`, including the seed's counters, gates and iteration. Domain replay
 * increments visits for each `node.started`, just as the executor does, without resetting the seed.
 */
export function threadAt(
  initial: ContextThread,
  events: readonly RunEvent[],
  seq: number,
): ContextThread {
  return replayThread(initial, events, seq);
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
    case 'harness.turn':
    case 'harness.submission':
    case 'harness.session':
      return 'nodeId' in event ? event.nodeId : '';
    case 'decision.made':
      return describeDecision(event);
    case 'exit.evaluated':
      return describeExit(event);
    case 'signal.received':
      return event.name;
    case 'delivery.queued':
    case 'delivery.attempted':
    case 'delivery.attempt_finished':
    case 'delivery.finished':
      return `Webhook ${event.delivery.status}, ${event.delivery.attempts}/${event.delivery.maxAttempts} attempts${event.delivery.lastError ? `: ${event.delivery.lastError.message}` : ''}`;
    case 'return.delivered':
    case 'return.failed':
      return event.channel.kind;
    case 'run.queued':
    case 'run.cancelled':
      return '';
  }
}

function describeDecision(event: Extract<RunEvent, { type: 'decision.made' }>): string {
  const { observation, provenance } = event;
  let description: string;
  let confidence: number | null;
  switch (observation.kind) {
    case 'route':
      description = `Chose ${observation.routeId}`;
      confidence = observation.confidence;
      break;
    case 'boolean':
      description = `Answered ${observationDescription(observation)}`;
      confidence = observation.confidence;
      break;
    case 'classifier': {
      const answer = observation.answer;
      confidence = answer.confidence;
      switch (answer.type) {
        case 'choice':
          description = `Chose ${answer.optionId}`;
          break;
        case 'score':
          description = `Scored ${answer.score} to band ${event.gate?.limit ? event.gate.repeatRouteId : event.portId}`;
          break;
        case 'noul':
          description = `Answered ${answer.holds === null ? 'unknown (not recorded)' : answer.holds} (true probability ${answer.trueProbability ?? 'not recorded'})`;
          break;
      }
      break;
    }
  }
  const provider = provenance.provider ? ` via ${provenance.provider}` : '';
  const model = provenance.model ? ` (${provenance.model})` : '';
  const confidenceLabel =
    provenance.kind === 'llm' ? 'self-reported confidence (informational)' : 'confidence';
  const confidenceText =
    confidence !== null
      ? ` with ${confidenceLabel} ${confidence}`
      : provenance.kind === 'llm' ||
          (observation.kind === 'classifier' && observation.answer.type !== 'score')
        ? ` with ${confidenceLabel} not recorded`
        : '';
  const diagnostics = event.diagnostics.map((item) => `; ${item.code}: ${item.message}`).join('');
  return `${description} with ${provenance.kind}${provider}${model}${confidenceText}${event.gate ? `; passes ${event.gate.previousPasses} → ${event.gate.passes} of ${event.gate.maxPasses}${event.gate.limit ? `; Limit reached (${event.gate.limit})` : ''}` : ''}${diagnostics}`;
}

function describeExit(event: Extract<RunEvent, { type: 'exit.evaluated' }>): string {
  return `Exited: ${event.outcome}`;
}

/**
 * The latest gate decision's pass and limit evidence, in one line for the top of the run: where
 * a loop-back exit used to say "iteration 2 of 5", a gate says which pass chose what and whether a
 * limit stopped the repeat (#129). Undefined when no gate decided.
 */
export function lastGateSummary(events: readonly RunEvent[]): string | undefined {
  const event = events.findLast(
    (e): e is Extract<RunEvent, { type: 'decision.made' }> =>
      e.type === 'decision.made' && e.gate !== undefined,
  );
  const gate = event?.gate;
  if (!event || !gate) return undefined;
  const chose = `Last gate decision: ${event.nodeId} chose ${gate.limit ? gate.repeatRouteId : event.portId} on pass ${gate.previousPasses} of ${gate.maxPasses}`;
  if (!gate.limit) return `${chose}.`;
  const limit = gate.limit === 'max-passes' ? 'maximum passes' : 'maximum run time';
  return `${chose}; ${limit} stopped the repeat, so it took Limit reached.`;
}

/**
 * Why a finished run recorded no result. Undefined while the run has not finished through an
 * exit, or when the exit returned a value (null included); Result shows that value. Only the
 * pinned definition can establish that nothing was returned on purpose: an exit whose Returns is
 * None delivers to no destination, the exit's own or the start request's (#129, #258), and the
 * summary names the destinations that received nothing or identifies a quiet exit. An exit whose
 * Returns is an expression, or a definition that is not available, establishes nothing: a run
 * recorded by an older build omitted a null result, so the history alone does not show whether the
 * exit returned nothing or null, and the summary says so rather than inventing a configuration.
 */
export function exitReturnSummary(
  events: readonly RunEvent[],
  definition: LoopDefinition | undefined,
  startDestinations: readonly ReturnChannel[] = [],
): string | undefined {
  const exit = events.findLast(
    (e): e is Extract<RunEvent, { type: 'exit.evaluated' }> => e.type === 'exit.evaluated',
  );
  const finished = events.findLast(
    (e): e is Extract<RunEvent, { type: 'run.finished' }> => e.type === 'run.finished',
  );
  if (!exit || !finished || finished.result !== undefined) return undefined;
  const node = definition?.nodes.find((n) => n.id === exit.nodeId);
  if (node?.kind !== 'exit')
    return `No value was recorded for this run. The pinned definition ${definition ? `has no exit node ${exit.nodeId}` : 'is not available'}, so the exit’s Returns setting cannot be shown.`;
  if (node.config.returns !== 'none')
    return 'No value was recorded for this run. The exit’s Returns is an expression, so the history alone does not show whether it returned nothing or a null that an older build did not record.';
  const configuration = 'This is the exit’s configuration, not a failure.';
  const own = node.config.destinations;
  const key = (channel: ReturnChannel) => JSON.stringify(channel);
  const requested = startDestinations.filter((extra) => !own.some((c) => key(c) === key(extra)));
  if (own.length === 0 && requested.length === 0)
    return `Quiet exit: Returns is None and there are no destinations, so nothing was returned or delivered. ${configuration}`;
  const kinds = (channels: readonly ReturnChannel[]) => channels.map((c) => c.kind).join(', ');
  const named = [
    ...(own.length ? [`${kinds(own)} from the exit`] : []),
    ...(requested.length ? [`${kinds(requested)} from the start request`] : []),
  ].join('; ');
  return `No value was returned: Returns is None, so no destination received anything (${named}). ${configuration}`;
}

export function strategyName(strategy: string): string {
  return strategy === 'classifier'
    ? 'Classifier'
    : strategy === 'llm'
      ? 'Codex'
      : strategy === 'expression'
        ? 'Expression'
        : strategy;
}

export function answerDescription(answer: ClassifierAnswer): string {
  switch (answer.type) {
    case 'choice':
      return `Choice ${answer.optionId}`;
    case 'noul':
      return `Noul ${answer.holds === null ? 'unknown (not recorded)' : answer.holds ? 'true' : 'false'}`;
    case 'score':
      return `Score ${answer.score}`;
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
      event.type === 'exit.evaluated' ||
      event.type === 'heartbeat.beat'
    ) {
      const list = byNode.get(event.nodeId) ?? [];
      list.push(event);
      byNode.set(event.nodeId, list);
    }
  }
  return byNode;
}

export function observationDescription(observation: EvaluationObservation): string {
  switch (observation.kind) {
    case 'route':
      return `Route ${observation.routeId}`;
    case 'boolean':
      return `Boolean ${observation.holds === null ? 'unknown (not recorded)' : observation.holds}`;
    case 'classifier':
      return answerDescription(observation.answer);
  }
}
