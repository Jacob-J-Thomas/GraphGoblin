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
import { decisionRouteDeclarations, getAtPointer } from '@graphgoblin/domain';

export interface PatchLine {
  op: string;
  path: string;
  from?: string;
  before: unknown;
  after: unknown;
}

/** Add operations show the recorded inserted value; other operations show the path before/after the completed patch. */
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
    after: op.op === 'add' ? op.value : read(after, op.path),
  }));
}

/** A one-line description of an event for the timeline. */
export function describeEvent(event: RunEvent, definition?: LoopDefinition): string {
  return describeParts(descriptionParts(event), definition);
}

/**
 * One piece of an event's description: recorded text, a node, a decision node's route, or the
 * exit node that prefixes an exit's description once the pinned version is known. Labels are
 * named when the description is shown, so a row whose payload stays on the server keeps only
 * these pieces and is still described with the pinned version's labels (#186).
 */
export type DescriptionPart =
  string | { node: string } | { node: string; route: string } | { exit: string };

/** Joins description parts, naming nodes and routes from the pinned version when it is known. */
export function describeParts(
  parts: readonly DescriptionPart[],
  definition?: LoopDefinition,
): string {
  return parts
    .map((part) =>
      typeof part === 'string'
        ? part
        : 'exit' in part
          ? definition
            ? `${nodeName(definition, part.exit)}: `
            : ''
          : 'route' in part
            ? routeName(definition, part.node, part.route)
            : nodeName(definition, part.node),
    )
    .join('');
}

/** The pieces `describeEvent` joins: everything a description reads from the event. */
export function descriptionParts(event: RunEvent): DescriptionPart[] {
  switch (event.type) {
    case 'run.started':
      return [`attempt ${event.attempt}`];
    case 'run.finished':
      return [`${event.status} (${event.outcome})`];
    case 'run.failed':
      return [`${event.failure.code}: ${event.failure.message}`];
    case 'run.replay_requested':
      return [`Replay fork ${event.replayRunId} requested at ${event.nodeId}`];
    case 'run.paused':
    case 'run.resumed':
    case 'run.cancel_requested':
      return [`by ${event.actor.kind} ${event.actor.id}`];
    case 'run.waiting':
      return [{ node: event.nodeId }, ` waits for ${event.wait.kind}`];
    case 'run.woken':
      return [{ node: event.nodeId }, ` woken by ${event.reason}`];
    case 'iteration.incremented':
      return [`iteration ${event.from} → ${event.to} at `, { node: event.targetNodeId }];
    case 'node.started':
      return [{ node: event.nodeId }, ` (${event.kind}) attempt ${event.attempt}`];
    case 'script.dispatched':
      return [
        { node: event.nodeId },
        `: script dispatch ${event.dispatchId} (visit ${event.visitId})`,
      ];
    case 'node.finished':
      return [
        { node: event.nodeId },
        ...(event.route ? [' → ', { node: event.nodeId, route: event.route }] : []),
        `, ${event.patch.length} change${event.patch.length === 1 ? '' : 's'}, ${event.durationMs} ms`,
      ];
    case 'node.progress':
    case 'harness.usage':
    case 'heartbeat.beat':
    case 'input.received':
    case 'child_run.started':
    case 'child_run.finished':
    case 'harness.turn':
    case 'harness.submission':
    case 'harness.session':
      return [{ node: event.nodeId }];
    case 'decision.made':
      return decisionParts(event);
    case 'exit.evaluated':
      return [{ exit: event.nodeId }, `Exited: ${event.outcome}`];
    case 'signal.received':
      return [event.name];
    case 'delivery.queued':
    case 'delivery.attempted':
    case 'delivery.attempt_finished':
    case 'delivery.finished':
      return [
        `Webhook ${event.delivery.status}, ${event.delivery.attempts}/${event.delivery.maxAttempts} attempts${event.delivery.lastError ? `: ${event.delivery.lastError.message}` : ''}`,
      ];
    case 'return.delivered':
    case 'return.failed':
      return [event.channel.kind];
    case 'run.cancelled':
      return ['Cancelled'];
    case 'run.queued':
      return [];
  }
}

function decisionParts(event: Extract<RunEvent, { type: 'decision.made' }>): DescriptionPart[] {
  const route = (id: string) => ({ node: event.nodeId, route: id });
  const { observation, provenance } = event;
  let description: DescriptionPart[];
  let confidence: number | null;
  switch (observation.kind) {
    case 'route':
      description = ['Chose ', route(observation.routeId)];
      confidence = observation.confidence;
      break;
    case 'boolean':
      description = [`Answered ${observationDescription(observation)}`];
      confidence = observation.confidence;
      break;
    case 'classifier': {
      const answer = observation.answer;
      confidence = answer.confidence;
      switch (answer.type) {
        case 'choice':
          description = ['Chose ', route(answer.optionId)];
          break;
        case 'score':
          description = [
            `Scored ${answer.score} to band `,
            route(event.gate?.limit ? event.gate.repeatRouteId : event.portId),
          ];
          break;
        case 'noul':
          description = [
            `Answered ${answer.holds === null ? 'unknown (not recorded)' : answer.holds} (true probability ${answer.trueProbability === null ? 'not recorded' : formatProbability(answer.trueProbability)})`,
          ];
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
      ? ` with ${confidenceLabel} ${formatProbability(confidence)}`
      : provenance.kind === 'llm' ||
          (observation.kind === 'classifier' && observation.answer.type !== 'score')
        ? ` with ${confidenceLabel} not recorded`
        : '';
  const diagnostics = event.diagnostics.map((item) => `; ${item.code}: ${item.message}`).join('');
  return [
    ...description,
    ` with ${provenance.kind}${provider}${model}${confidenceText}${event.gate ? `; passes ${event.gate.previousPasses} → ${event.gate.passes}${event.gate.maxPasses === null ? ' (unlimited)' : ` of ${event.gate.maxPasses}`}${event.gate.limit ? `; Limit reached (${event.gate.limit})` : ''}` : ''}${diagnostics}`,
  ];
}

/**
 * The latest gate decision's pass and limit evidence, in one line for the top of the run: where
 * a loop-back exit used to say "iteration 2 of 5", a gate says which pass chose what and whether a
 * limit stopped the repeat (#129). Undefined when no gate decided.
 */
export function lastGateSummary(
  events: readonly RunEvent[],
  definition?: LoopDefinition,
): string | undefined {
  const event = events.findLast(
    (e): e is Extract<RunEvent, { type: 'decision.made' }> =>
      e.type === 'decision.made' && e.gate !== undefined,
  );
  const gate = event?.gate;
  if (!event || !gate) return undefined;
  // An Unlimited gate records `maxPasses: null` (#243): name the pass without a bound.
  const of = gate.maxPasses === null ? ' (unlimited passes)' : ` of ${gate.maxPasses}`;
  const chose = `Last gate decision: ${nodeName(definition, event.nodeId)} chose ${routeName(definition, event.nodeId, gate.limit ? gate.repeatRouteId : event.portId)} on pass ${gate.previousPasses}${of}`;
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

/** The caller supplies only the immutable run version. Stable IDs remain visible. */
export function nodeName(definition: LoopDefinition | undefined, id: string): string {
  const node = definition?.nodes.find((item) => item.id === id);
  return node ? `${node.label} (${id})` : definition ? `${id} (label not recorded)` : id;
}

export function routeName(
  definition: LoopDefinition | undefined,
  nodeId: string,
  id: string,
): string {
  const node = definition?.nodes.find((item) => item.id === nodeId);
  if (node?.kind !== 'decision') return id;
  if (id === 'limit-reached') return 'Limit reached (limit-reached)';
  const route = decisionRouteDeclarations(node.config).find((item) => item.id === id);
  return route ? `${route.label} (${id})` : `${id} (label not recorded)`;
}

/** Two percentage decimals for scanning; exact numbers remain in the recorded-event disclosure. */
export function formatProbability(value: number | null): string {
  if (value === null) return 'Not recorded';
  if (value > 0 && value < 0.0001) return '<0.01%';
  if (value < 1 && value > 0.9999) return '>99.99%';
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(
    value,
  );
}

/** A cancellation's actor is its recorded request's actor, never a provider error. */
export function cancellationSummary(events: readonly RunEvent[]): string | undefined {
  const cancelled = events.findLast((event) => event.type === 'run.cancelled');
  if (!cancelled) return undefined;
  const resumed = events.findLast(
    (event) => event.type === 'run.resumed' && event.seq < cancelled.seq,
  );
  const request = events.findLast(
    (event) =>
      event.type === 'run.cancel_requested' &&
      event.seq > (resumed?.seq ?? 0) &&
      event.seq < cancelled.seq,
  );
  return request?.type === 'run.cancel_requested'
    ? `Cancelled by ${request.actor.kind} ${request.actor.id} (request #${request.seq}; cancellation #${cancelled.seq}).`
    : 'Cancelled; actor not recorded.';
}
