import type {
  ExitCriterion,
  ExitCriterionEvaluation,
  ExitEvaluationOutcome,
} from '@graphgoblin/contracts';
import {
  evaluateExit,
  evaluateExpression,
  threadView,
  type PredicateAnswer,
} from '@graphgoblin/domain';
import { DeciderFailureError, deciderFailure } from '../decider-errors.js';
import { isAbortError, RunFailureError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import { toJson } from './common.js';

async function askPredicate(
  ctx: NodeContext<'exit'>,
  criterion: Extract<ExitCriterion, { when: 'predicate' }>,
  question: string,
  onResolvedModel: (model: string) => void,
): Promise<PredicateAnswer> {
  const decider = ctx.ports.deciders.find((d) => d.id === criterion.strategy && d.available());
  if (!decider) {
    throw new RunFailureError(
      'DECIDER_UNAVAILABLE',
      `exit criterion needs the "${criterion.strategy}" decider, which is not available`,
      { nodeId: ctx.node.id },
    );
  }
  const resolved =
    criterion.strategy === 'codex' ? await ctx.services.resolveModel('codex') : undefined;
  if (resolved) onResolvedModel(resolved.model);
  const context = toJson({
    trigger: ctx.thread.invocation.trigger.payload,
    vars: ctx.thread.vars,
    lastOutput: ctx.thread.lastOutput?.value ?? null,
    lastMessage: ctx.thread.messages.at(-1)?.content ?? null,
    iteration: ctx.run.iteration,
  });
  try {
    const answer = await decider.judge(
      {
        question,
        context,
        ...(resolved ? { model: resolved.model, effort: resolved.effort } : {}),
      },
      ctx.signal,
    );
    if (
      typeof answer.holds !== 'boolean' ||
      (answer.confidence !== undefined &&
        (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1))
    ) {
      throw Object.assign(new Error('Invalid predicate result'), {
        code: 'DECIDER_INVALID_RESPONSE',
      });
    }
    return {
      holds: answer.holds,
      ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
      ...(resolved ? { model: resolved.model } : { classifierModel: 'jev' }),
      ...(criterion.strategy === 'codex' && typeof answer.reasoning === 'string'
        ? { reasoning: answer.reasoning.slice(0, 2048) }
        : {}),
    };
  } catch (error) {
    if (isAbortError(error) || ctx.signal.aborted) throw error;
    throw new DeciderFailureError(error, decider.id);
  }
}

export const exitHandler: NodeHandler<'exit'> = {
  kind: 'exit',
  async execute(ctx) {
    const startedAt = ctx.run.startedAt
      ? Date.parse(ctx.run.startedAt)
      : Date.parse(ctx.run.createdAt);
    const criteria: ExitCriterionEvaluation[] = [];
    const resolvedModels = new Map<ExitCriterion, string>();
    const record = async (result: ExitEvaluationOutcome) => {
      for (let index = criteria.length; index < ctx.config.criteria.length; index++) {
        const criterion = ctx.config.criteria[index]!;
        criteria.push({
          index,
          strategy: criterion.when === 'predicate' ? criterion.strategy : criterion.when,
          status: 'skipped',
          reason:
            !criteria.some((entry) => entry.status === 'matched') &&
            (result.kind === 'failed' || result.kind === 'cancelled')
              ? {
                  code: 'EARLIER_CRITERION_FAILED',
                  message: 'An earlier criterion stopped evaluation',
                }
              : { code: 'EARLIER_CRITERION_MATCHED', message: 'An earlier criterion matched' },
        });
      }
      await ctx.services.record({
        type: 'exit.evaluated',
        nodeId: ctx.node.id,
        iteration: ctx.run.iteration,
        maxIterations: ctx.definition.settings.maxIterations,
        criteria,
        result,
      });
    };
    let decision;
    try {
      decision = await evaluateExit(ctx.config, {
        thread: ctx.thread,
        iteration: ctx.run.iteration,
        maxIterations: ctx.definition.settings.maxIterations,
        elapsedMs: Math.max(0, Date.parse(ctx.services.now()) - startedAt),
        askPredicate: (criterion, question) =>
          askPredicate(ctx, criterion, question, (model) => resolvedModels.set(criterion, model)),
        renderQuestion: (template) => ctx.services.render(template),
        onCriterion: (evaluation) =>
          criteria.push({
            ...evaluation,
            ...(evaluation.strategy === 'jev' ? { classifierModel: 'jev' } : {}),
            ...(resolvedModels.has(ctx.config.criteria[evaluation.index]!)
              ? { model: resolvedModels.get(ctx.config.criteria[evaluation.index]!)! }
              : {}),
          }),
      });
    } catch (error) {
      if (isAbortError(error) || ctx.signal.aborted) {
        await record({ kind: 'cancelled' });
      } else {
        const diagnostic =
          error instanceof DeciderFailureError
            ? {
                code: error.code,
                message: error.message,
                ...(error.diagnostic.status !== undefined
                  ? { status: error.diagnostic.status }
                  : {}),
              }
            : error instanceof RunFailureError && error.code === 'DECIDER_UNAVAILABLE'
              ? { code: 'DECIDER_UNAVAILABLE' as const, message: deciderFailure(error).message }
              : { code: 'CRITERION_ERROR' as const, message: 'Exit criterion evaluation failed' };
        const last = criteria.at(-1);
        if (last?.status === 'error') last.diagnostic = diagnostic;
        await record({ kind: 'failed', diagnostic });
      }
      throw error;
    }

    if (decision.kind === 'loop-back') {
      await record({
        kind: 'looped-back',
        reason: 'no-criterion-matched',
        targetNodeId: decision.targetNodeId,
      });
      return { kind: 'loop-back', patch: [], targetNodeId: decision.targetNodeId };
    }

    const matched =
      decision.criterionIndex !== undefined
        ? ctx.config.criteria[decision.criterionIndex]
        : undefined;
    const result: ExitEvaluationOutcome =
      matched?.when === 'max-iterations' || matched?.when === 'max-duration'
        ? {
            kind: 'limit-reached',
            limit: matched.when,
            value: matched.when === 'max-iterations' ? matched.value : matched.seconds,
            criterionIndex: decision.criterionIndex,
            outcome: 'exhausted',
          }
        : decision.criterionIndex === undefined && decision.outcome === 'exhausted'
          ? {
              kind: 'limit-reached',
              limit: 'iteration-ceiling',
              value: ctx.definition.settings.maxIterations,
              outcome: 'exhausted',
            }
          : {
              kind: 'completed',
              reason: matched ? 'criterion-matched' : 'default-success',
              outcome: decision.outcome,
              ...(decision.criterionIndex !== undefined
                ? { criterionIndex: decision.criterionIndex }
                : {}),
            };

    const mapping = ctx.config.return.mapping;
    let returnPayload;
    try {
      returnPayload =
        mapping === 'none'
          ? undefined
          : toJson(await evaluateExpression(mapping, threadView(ctx.thread)));
    } catch (error) {
      await record(
        isAbortError(error) || ctx.signal.aborted
          ? { kind: 'cancelled' }
          : {
              kind: 'failed',
              diagnostic: { code: 'RETURN_MAPPING_ERROR', message: 'Exit return mapping failed' },
            },
      );
      throw error;
    }
    await record(result);
    return {
      kind: 'exit',
      patch: [],
      outcome: decision.outcome,
      reason: decision.reason,
      ...(returnPayload !== undefined ? { returnPayload } : {}),
      channels: mapping === 'none' ? [] : ctx.config.return.channels,
    };
  },
};
