import type {
  DeciderPort,
  LlmRouteRequest,
  LlmRouteResult,
  LlmBooleanRequest,
  LlmBooleanResult,
  StructuredPort,
} from '@graphgoblin/engine';

/**
 * `DeciderPort` (`id: 'codex'`) over a structured Codex completion. Schemas follow OpenAI's strict
 * structured-output rules (every property required, `additionalProperties: false`), so numeric
 * bounds are validated locally for routes and predicates.
 */

/** Convert trusted harness error categories at the structured completion boundary; never retain provider text. */
function completionFailure(error: unknown, primitive = 'route'): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) return error;
  const code = error.code;
  const mapping: Record<string, string> = {
    HARNESS_NOT_INSTALLED: 'DECIDER_UNAVAILABLE',
    HARNESS_NOT_AUTHENTICATED: 'DECIDER_NOT_AUTHENTICATED',
    HARNESS_QUOTA_EXHAUSTED: 'DECIDER_RATE_LIMITED',
  };
  const selected =
    typeof code === 'string' && Object.hasOwn(mapping, code)
      ? mapping[code]
      : code === 'HARNESS_TURN_FAILED'
        ? 'retriable' in error && error.retriable === true
          ? 'DECIDER_UNREACHABLE'
          : 'DECIDER_HTTP_ERROR'
        : undefined;
  return selected
    ? Object.assign(new Error(`Codex ${primitive} completion failed`), { code: selected })
    : error;
}

function contextBlock(context: unknown): string {
  return JSON.stringify(context ?? null, null, 2);
}

export function routePrompt(request: LlmRouteRequest): string {
  return [
    'You are the routing step of an automated workflow. Choose exactly one declared route.',
    '',
    request.instructions,
    '',
    'Routes:',
    ...request.routes.map((route) => `- ${route.id}: ${route.label}`),
    '',
    'Context (JSON):',
    contextBlock(request.context),
    '',
    'Do not run commands or change files. Return the route id, confidence between 0 and 1, and short reasoning.',
  ].join('\n');
}
export function booleanPrompt(request: LlmBooleanRequest): string {
  return [
    'You are a boolean predicate in an automated workflow.',
    '',
    request.instructions,
    '',
    'Context (JSON):',
    contextBlock(request.context),
    '',
    'Do not run commands or change files. Return holds (a boolean), confidence between 0 and 1, and short reasoning.',
  ].join('\n');
}

export function routeSchema(labels: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      route: { type: 'string', enum: labels },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['route', 'confidence', 'reasoning'],
    additionalProperties: false,
  };
}

export const BOOLEAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    holds: { type: 'boolean' },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: ['holds', 'confidence', 'reasoning'],
  additionalProperties: false,
};

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw Object.assign(new Error(`Codex ${what} returned no structured answer`), {
    code: 'DECIDER_INVALID_RESPONSE',
  });
}

export class CodexDecider implements DeciderPort {
  readonly id = 'codex' as const;

  constructor(private readonly structured: StructuredPort) {}

  /** Codex availability is a harness concern (preflight); the decider itself needs no key. */
  available(): boolean {
    return true;
  }

  async route(request: LlmRouteRequest, signal: AbortSignal): Promise<LlmRouteResult> {
    signal.throwIfAborted();
    const labels = request.routes.map((o) => o.id);
    const { value } = await this.structured
      .complete(
        {
          prompt: routePrompt(request),
          schema: routeSchema(labels),
          model: request.model,
          effort: request.effort,
        },
        signal,
      )
      .catch((error: unknown) => {
        throw completionFailure(error);
      });
    signal.throwIfAborted();
    const answer = asRecord(value, 'route');
    if (
      Object.keys(answer).length !== 3 ||
      !Object.keys(answer).every((key) => ['route', 'confidence', 'reasoning'].includes(key)) ||
      typeof answer.route !== 'string' ||
      !labels.includes(answer.route) ||
      typeof answer.confidence !== 'number' ||
      !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 ||
      answer.confidence > 1 ||
      typeof answer.reasoning !== 'string'
    ) {
      throw Object.assign(new Error('Codex route returned an invalid structured answer'), {
        code: 'DECIDER_INVALID_RESPONSE',
      });
    }
    return {
      route: answer.route,
      confidence: answer.confidence,
      reasoning: answer.reasoning.slice(0, 2048),
    };
  }

  async evaluateBoolean(
    request: LlmBooleanRequest,
    signal: AbortSignal,
  ): Promise<LlmBooleanResult> {
    signal.throwIfAborted();
    const { value } = await this.structured
      .complete(
        {
          prompt: booleanPrompt(request),
          schema: BOOLEAN_SCHEMA,
          model: request.model,
          effort: request.effort,
        },
        signal,
      )
      .catch((error: unknown) => {
        throw completionFailure(error, 'predicate');
      });
    signal.throwIfAborted();
    const answer = asRecord(value, 'predicate');
    if (
      Object.keys(answer).length !== 3 ||
      !Object.keys(answer).every((key) => ['holds', 'confidence', 'reasoning'].includes(key)) ||
      typeof answer.holds !== 'boolean' ||
      typeof answer.confidence !== 'number' ||
      !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 ||
      answer.confidence > 1 ||
      typeof answer.reasoning !== 'string'
    )
      throw Object.assign(new Error('Codex predicate returned an invalid structured answer'), {
        code: 'DECIDER_INVALID_RESPONSE',
      });
    return {
      holds: answer.holds,
      confidence: answer.confidence,
      reasoning: answer.reasoning.slice(0, 2048),
    };
  }
}

export function createCodexDecider(structured: StructuredPort): CodexDecider {
  return new CodexDecider(structured);
}
