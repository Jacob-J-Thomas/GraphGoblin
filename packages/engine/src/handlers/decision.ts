import {
  ChoiceAnswerSchema,
  DecisionEmissionSchema,
  type DecisionContext,
  type DecisionPayload,
  type EvaluationProvenance,
  type JsonValue,
} from '@graphgoblin/contracts';
import { evaluateExpression, threadView } from '@graphgoblin/domain';
import { summarizeDeciderError } from '../decider-errors.js';
import { isAbortError, RunFailureError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import type { ClassifierUnavailableReason, ChoiceResult } from '../ports.js';
import { outputPatch, selectMessages, toJson } from './common.js';

const CLASSIFIER_MESSAGES: Record<ClassifierUnavailableReason, string> = {
  CLASSIFIER_MODEL_NOT_FOUND: 'The selected classifier is not in the catalog',
  CLASSIFIER_PRIMITIVE_UNSUPPORTED: 'The selected classifier does not support Choice',
  CLASSIFIER_MODEL_DISABLED: 'The selected classifier is disabled',
  CLASSIFIER_SECRET_MISSING: 'The classifier key is not configured',
  CLASSIFIER_SECRET_UNREADABLE: 'The classifier key cannot be read',
};

async function decisionContext(
  ctx: NodeContext<'decision'>,
  context: DecisionContext,
): Promise<JsonValue> {
  const view = threadView(ctx.thread) as unknown as Record<string, unknown>;
  const messages = await selectMessages(ctx.thread.messages, context.messages, view);
  const vars: Record<string, JsonValue> = {};
  for (const name of context.vars ?? Object.keys(ctx.thread.vars)) {
    if (name in ctx.thread.vars) vars[name] = ctx.thread.vars[name] as JsonValue;
  }
  return toJson({
    trigger: ctx.thread.invocation.trigger.payload,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    vars,
    ...(context.includeLastOutput && ctx.thread.lastOutput
      ? { lastOutput: ctx.thread.lastOutput.value }
      : {}),
  });
}

function fail(
  ctx: NodeContext<'decision'>,
  code: ConstructorParameters<typeof RunFailureError>[0],
  message: string,
  resumable = false,
  details?: unknown,
): never {
  throw new RunFailureError(code, message, {
    nodeId: ctx.node.id,
    resumable,
    ...(details !== undefined ? { details } : {}),
  });
}

function providerFailure(ctx: NodeContext<'decision'>, error: unknown): never {
  if (isAbortError(error) || ctx.signal.aborted) throw error;
  const diagnostic = summarizeDeciderError(error);
  ctx.ports.logger.warn(
    {
      nodeId: ctx.node.id,
      kind: ctx.config.evaluation.kind,
      name: diagnostic.name,
      code: diagnostic.code,
      status: diagnostic.status,
    },
    'decision provider failed',
  );
  if (diagnostic.code === 'DECIDER_INVALID_RESPONSE')
    fail(ctx, 'EVALUATION_INVALID_RESPONSE', diagnostic.message);
  const resumable =
    diagnostic.code === 'DECIDER_UNAVAILABLE' ||
    diagnostic.code === 'DECIDER_NOT_AUTHENTICATED' ||
    diagnostic.code === 'DECIDER_RATE_LIMITED' ||
    diagnostic.code === 'DECIDER_UNREACHABLE' ||
    diagnostic.code === 'DECIDER_TIMEOUT' ||
    (diagnostic.status !== undefined && diagnostic.status >= 500);
  fail(
    ctx,
    diagnostic.code === 'DECIDER_UNAVAILABLE'
      ? 'EVALUATION_UNAVAILABLE'
      : 'EVALUATION_PROVIDER_FAILED',
    diagnostic.message,
    resumable,
    {
      ...(diagnostic.code ? { code: diagnostic.code } : {}),
      ...(diagnostic.status !== undefined ? { status: diagnostic.status } : {}),
    },
  );
}

function validateAnswer(ctx: NodeContext<'decision'>, result: ChoiceResult): ChoiceResult {
  const parsed = ChoiceAnswerSchema.safeParse(result);
  if (!parsed.success)
    fail(ctx, 'EVALUATION_INVALID_RESPONSE', 'The evaluator returned an invalid Choice answer');
  const ids = new Set(ctx.config.answer.options.map((option) => option.id));
  const answer = parsed.data;
  if (!ids.has(answer.optionId))
    fail(ctx, 'EVALUATION_INVALID_RESPONSE', 'The evaluator did not select a declared option id');
  if (answer.probabilities !== null) {
    const keys = Object.keys(answer.probabilities);
    if (keys.length !== ids.size || keys.some((key) => !ids.has(key)))
      fail(
        ctx,
        'EVALUATION_INVALID_RESPONSE',
        'Classifier probabilities must cover exactly the declared option ids',
      );
  }
  return answer;
}

export const decisionHandler: NodeHandler<'decision'> = {
  kind: 'decision',
  async execute(ctx) {
    const evaluation = ctx.config.evaluation;
    let result: ChoiceResult;
    let provenance: EvaluationProvenance;
    if (evaluation.kind === 'expression') {
      let value: unknown;
      try {
        value = await evaluateExpression(evaluation.jsonata, threadView(ctx.thread));
      } catch (error) {
        if (isAbortError(error) || ctx.signal.aborted) throw error;
        fail(ctx, 'EVALUATION_EXPRESSION_FAILED', 'The decision expression could not be evaluated');
      }
      if (
        typeof value !== 'string' ||
        !ctx.config.answer.options.some((option) => option.id === value)
      )
        fail(
          ctx,
          'EVALUATION_INVALID_RESPONSE',
          'The decision expression must return a declared string option id',
        );
      result = { type: 'choice', optionId: value, confidence: null, probabilities: null };
      provenance = {
        kind: 'expression',
        provider: null,
        classifierId: null,
        model: null,
        effort: null,
      };
    } else {
      // Keep the existing question exposure and selected provider-state behavior until #38 is refined.
      const question = await ctx.services.render(evaluation.question);
      const context = await decisionContext(ctx, evaluation.context);
      const request = { question, context, options: ctx.config.answer.options };
      if (evaluation.kind === 'classifier') {
        const selection = await ctx.ports.classifiers.resolve(ctx.run.ownerId, evaluation.model);
        if (selection.status === 'unavailable') {
          const invalid = selection.reason === 'CLASSIFIER_PRIMITIVE_UNSUPPORTED';
          fail(
            ctx,
            invalid ? 'EVALUATION_INVALID_CONFIGURATION' : 'EVALUATION_UNAVAILABLE',
            CLASSIFIER_MESSAGES[selection.reason],
            !invalid,
            { reason: selection.reason },
          );
        }
        try {
          result = await selection.classifier.choose(request, ctx.signal);
        } catch (error) {
          providerFailure(ctx, error);
        }
        result = validateAnswer(ctx, result);
        if (result.confidence === null || result.probabilities === null)
          fail(
            ctx,
            'EVALUATION_INVALID_RESPONSE',
            'The classifier must return confidence and option probabilities',
          );
        if (evaluation.minConfidence !== undefined && result.confidence < evaluation.minConfidence)
          fail(
            ctx,
            'EVALUATION_RESULT_REJECTED',
            'Classifier confidence is below the authored minimum',
          );
        provenance = { kind: 'classifier', ...selection.provenance, effort: null };
      } else {
        const decider = ctx.ports.deciders.find(
          (port) => port.id === evaluation.harness && port.available(),
        );
        if (!decider)
          fail(ctx, 'EVALUATION_UNAVAILABLE', 'The selected LLM evaluator is unavailable', true);
        const resolved = await ctx.services.resolveModel(
          evaluation.harness,
          evaluation.model.mode === 'explicit' ? evaluation.model.value : undefined,
          evaluation.effort.mode === 'explicit' ? evaluation.effort.value : undefined,
        );
        try {
          result = await decider.choose({ ...request, ...resolved }, ctx.signal);
        } catch (error) {
          providerFailure(ctx, error);
        }
        result = validateAnswer(ctx, result);
        if (result.confidence === null || result.probabilities !== null)
          fail(
            ctx,
            'EVALUATION_INVALID_RESPONSE',
            'LLM Choice requires informational confidence without classifier probabilities',
          );
        provenance = { kind: 'llm', provider: evaluation.harness, classifierId: null, ...resolved };
      }
    }
    const payload: DecisionPayload = {
      answer: {
        ...result,
        probabilities: ctx.config.recordAlternatives ? result.probabilities : null,
      },
      portId: result.optionId,
      provenance,
    };
    const evidence = DecisionEmissionSchema.safeParse({ ...payload, diagnostics: [] });
    if (!evidence.success)
      fail(
        ctx,
        'EVALUATION_INVALID_RESPONSE',
        'The evaluator returned evidence inconsistent with its kind',
      );
    await ctx.services.record({ type: 'decision.made', nodeId: ctx.node.id, ...evidence.data });
    return {
      kind: 'done',
      patch: outputPatch(ctx.thread, ctx.node.id, toJson(payload), ctx.services.now()),
      route: payload.portId,
    };
  },
};
