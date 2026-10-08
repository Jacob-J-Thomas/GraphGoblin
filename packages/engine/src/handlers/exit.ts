import {
  ExitCriterionEmissionSchema,
  ExitDiagnosticSchema,
  EvaluationProvenanceSchema,
  type ExitCriterionEvaluation,
  type ExitEvaluationOutcome,
} from '@graphgoblin/contracts';
import { evaluateExit, evaluateExpression, threadView } from '@graphgoblin/domain';
import { isAbortError, RunFailureError } from '../errors.js';
import type { NodeHandler } from '../handler.js';
import { evaluatePrimitive } from '../primitive-evaluator.js';
import { toJson } from './common.js';

function failureEvidence(error: unknown) {
  if (error instanceof RunFailureError) {
    const details = error.options.details;
    const status =
      typeof details === 'object' && details !== null && 'status' in details
        ? details.status
        : undefined;
    const diagnostic = ExitDiagnosticSchema.safeParse({
      code: error.code,
      message: error.message,
      ...(status !== undefined ? { status } : {}),
    });
    const provenance = EvaluationProvenanceSchema.safeParse(
      typeof details === 'object' && details !== null && 'provenance' in details
        ? details.provenance
        : undefined,
    );
    if (diagnostic.success)
      return {
        diagnostic: diagnostic.data,
        ...(provenance.success ? { provenance: provenance.data } : {}),
      };
  }
  return {
    diagnostic: { code: 'CRITERION_ERROR' as const, message: 'Exit criterion evaluation failed' },
  };
}

export const exitHandler: NodeHandler<'exit'> = {
  kind: 'exit',
  async execute(ctx) {
    const startedAt = ctx.run.startedAt
      ? Date.parse(ctx.run.startedAt)
      : Date.parse(ctx.run.createdAt);
    const criteria: ExitCriterionEvaluation[] = [];
    const record = async (result: ExitEvaluationOutcome) => {
      for (let index = criteria.length; index < ctx.config.criteria.length; index++) {
        const criterion = ctx.config.criteria[index]!;
        criteria.push({
          index,
          strategy: criterion.when === 'predicate' ? criterion.evaluation.kind : criterion.when,
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
        criteria: criteria.map((entry) => ExitCriterionEmissionSchema.parse(entry)),
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
        evaluatePredicate: async (criterion) =>
          evaluatePrimitive({
            nodeId: ctx.node.id,
            ownerId: ctx.run.ownerId,
            evaluation: criterion.evaluation,
            answer: criterion.answer,
            expressionView: threadView(ctx.thread),
            ...(criterion.evaluation.kind !== 'expression'
              ? {
                  question: await ctx.services.render(criterion.evaluation.question),
                  context: toJson({
                    trigger: ctx.thread.invocation.trigger.payload,
                    vars: ctx.thread.vars,
                    lastOutput: ctx.thread.lastOutput?.value ?? null,
                    lastMessage: ctx.thread.messages.at(-1)?.content ?? null,
                    iteration: ctx.run.iteration,
                  }),
                }
              : {}),
            signal: ctx.signal,
            ports: ctx.ports,
            resolveModel: (...args) => ctx.services.resolveModel(...args),
          }),
        onCriterion: (evaluation) => criteria.push(evaluation),
      });
    } catch (error) {
      if (isAbortError(error) || ctx.signal.aborted) {
        await record({ kind: 'cancelled' });
      } else {
        const { diagnostic, ...details } = failureEvidence(error);
        const last = criteria.at(-1);
        if (last?.status === 'error') Object.assign(last, { diagnostic, ...details });
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
