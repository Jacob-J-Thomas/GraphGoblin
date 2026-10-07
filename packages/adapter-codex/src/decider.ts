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
 * bounds are not declared; confidence is clamped to [0, 1] here instead.
 */

function clamp(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

function contextBlock(context: unknown): string {
  return JSON.stringify(context ?? null, null, 2);
}

export function choicePrompt(request: ChoiceRequest): string {
  const routes = request.options.map((o) => `- ${o.label}: ${o.description}`).join('\n');
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
    'Do not run commands or change files. Answer with the chosen route label, your confidence between 0 and 1, and one or two sentences of reasoning.',
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
    const labels = request.options.map((o) => o.label);
    const { value } = await this.structured.complete(
      {
        prompt: choicePrompt(request),
        schema: choiceSchema(labels),
        ...(request.model ? { model: request.model } : {}),
        ...(request.effort ? { effort: request.effort } : {}),
      },
      signal,
    );
    const answer = asRecord(value, 'choice');
    if (typeof answer.route !== 'string') {
      throw Object.assign(new Error('Codex choice answer has no route'), {
        code: 'DECIDER_INVALID_RESPONSE',
      });
    }
    const confidence = clamp(answer.confidence);
    return {
      label: answer.route,
      ...(confidence !== undefined ? { confidence } : {}),
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
