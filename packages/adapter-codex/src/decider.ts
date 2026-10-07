import type { PredicateAnswer } from '@graphgoblin/domain';
import type {
  ChoiceRequest,
  ChoiceResult,
  DeciderPort,
  StructuredPort,
  YesNoRequest,
} from '@graphgoblin/engine';

/**
 * `DeciderPort` (`id: 'codex'`) over a structured Codex completion. Schemas follow OpenAI's strict
 * structured-output rules (every property required, `additionalProperties: false`), so numeric
 * bounds are validated locally for Choice. Exit judging retains its existing behavior.
 */

function clamp(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

/** Convert trusted harness error categories at the Choice boundary; never retain provider text. */
function choiceFailure(error: unknown): unknown {
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
    ? Object.assign(new Error('Codex Choice completion failed'), { code: selected })
    : error;
}

function contextBlock(context: unknown): string {
  return JSON.stringify(context ?? null, null, 2);
}

export function choicePrompt(request: ChoiceRequest): string {
  const routes = request.options.map((o) => `- ${o.id} (${o.label}): ${o.criteria}`).join('\n');
  return [
    'You are the routing step of an automated workflow. Choose exactly one route.',
    '',
    `Question: ${request.question}`,
    '',
    'Routes:',
    routes,
    '',
    'Context (JSON):',
    contextBlock(request.context),
    '',
    'Do not run commands or change files. Answer with the chosen stable route id, your confidence between 0 and 1, and one or two sentences of reasoning.',
  ].join('\n');
}

export function judgePrompt(request: YesNoRequest): string {
  return [
    'You are a verification step of an automated workflow. Answer the yes-or-no question.',
    '',
    `Question: ${request.question}`,
    '',
    'Context (JSON):',
    contextBlock(request.context),
    '',
    'Do not run commands or change files. Answer with holds (true for yes, false for no), your confidence between 0 and 1, and one or two sentences of reasoning.',
  ].join('\n');
}

export function choiceSchema(labels: string[]): Record<string, unknown> {
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

export const JUDGE_SCHEMA: Record<string, unknown> = {
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

  async choose(request: ChoiceRequest, signal: AbortSignal): Promise<ChoiceResult> {
    const labels = request.options.map((o) => o.id);
    const { value } = await this.structured
      .complete(
        {
          prompt: choicePrompt(request),
          schema: choiceSchema(labels),
          ...(request.model ? { model: request.model } : {}),
          ...(request.effort ? { effort: request.effort } : {}),
        },
        signal,
      )
      .catch((error: unknown) => {
        throw choiceFailure(error);
      });
    const answer = asRecord(value, 'choice');
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
      throw Object.assign(new Error('Codex choice returned an invalid structured answer'), {
        code: 'DECIDER_INVALID_RESPONSE',
      });
    }
    return {
      type: 'choice',
      optionId: answer.route,
      confidence: answer.confidence,
      probabilities: null,
    };
  }

  async judge(request: YesNoRequest, signal: AbortSignal): Promise<PredicateAnswer> {
    const { value } = await this.structured.complete(
      {
        prompt: judgePrompt(request),
        schema: JUDGE_SCHEMA,
        ...(request.model ? { model: request.model } : {}),
        ...(request.effort ? { effort: request.effort } : {}),
      },
      signal,
    );
    const answer = asRecord(value, 'yes/no');
    if (typeof answer.holds !== 'boolean') {
      throw Object.assign(new Error('Codex yes/no answer has no boolean "holds"'), {
        code: 'DECIDER_INVALID_RESPONSE',
      });
    }
    const confidence = clamp(answer.confidence);
    return {
      holds: answer.holds,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(typeof answer.reasoning === 'string'
        ? { reasoning: answer.reasoning.slice(0, 2048) }
        : {}),
    };
  }
}

export function createCodexDecider(structured: StructuredPort): CodexDecider {
  return new CodexDecider(structured);
}
