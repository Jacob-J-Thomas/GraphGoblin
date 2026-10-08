import type {
  ContextThread,
  ExitConfig,
  ExitCriterionEvaluation,
  ExitPredicate,
  ExitPredicateMatch,
  Outcome,
  PrimitiveAnswer,
  PrimitiveEvaluation,
} from '@graphgoblin/contracts';
import { validateJson } from './json-schema.js';

export interface ExitContext {
  thread: ContextThread;
  /** Current iteration, 1-based. */
  iteration: number;
  maxIterations: number;
  elapsedMs: number;
  /** The caller prepares expression state, provider state and question rendering. */
  evaluatePredicate: (criterion: ExitPredicate) => Promise<PrimitiveEvaluation>;
  onCriterion?: (evaluation: ExitCriterionEvaluation) => void;
}

export type ExitDecision =
  | { kind: 'finish'; outcome: Outcome; reason: string; criterionIndex?: number }
  | { kind: 'loop-back'; targetNodeId: string };

function matches(answer: PrimitiveAnswer, match: ExitPredicateMatch): boolean {
  if (answer.type === 'noul' && match.type === 'noul') return answer.holds === match.value;
  if (answer.type === 'choice' && match.type === 'choice')
    return match.optionIds.includes(answer.optionId);
  if (answer.type === 'score' && match.type === 'score') {
    switch (match.operator) {
      case 'lt':
        return answer.score < match.value;
      case 'lte':
        return answer.score <= match.value;
      case 'eq':
        return answer.score === match.value;
      case 'gte':
        return answer.score >= match.value;
      case 'gt':
        return answer.score > match.value;
    }
  }
  return false;
}

/** Criteria run in authored order before the implicit no-match loop-back ceiling. */
export async function evaluateExit(config: ExitConfig, ctx: ExitContext): Promise<ExitDecision> {
  for (const [index, criterion] of config.criteria.entries()) {
    const strategy = criterion.when === 'predicate' ? criterion.evaluation.kind : criterion.when;
    let evidence: ExitCriterionEvaluation;
    let matched: boolean;
    try {
      if (criterion.when === 'predicate') {
        const result = await ctx.evaluatePredicate(criterion);
        const minimum =
          'minReportedConfidence' in criterion.match
            ? criterion.match.minReportedConfidence
            : undefined;
        const rejection =
          result.acceptance.status === 'rejected'
            ? {
                kind: 'classifier-confidence' as const,
                minimum: result.acceptance.minConfidence,
                confidence: result.answer.confidence,
              }
            : minimum !== undefined &&
                (result.answer.confidence === null || result.answer.confidence < minimum)
              ? {
                  kind: 'llm-reported-confidence' as const,
                  minimum,
                  confidence: result.answer.confidence,
                }
              : undefined;
        matched = rejection === undefined && matches(result.answer, criterion.match);
        evidence = {
          index,
          strategy: criterion.evaluation.kind,
          status: matched ? 'matched' : 'not-matched',
          ...result,
          match: criterion.match,
          ...(rejection ? { rejection } : {}),
          ...(criterion.evaluation.kind === 'classifier' &&
          criterion.evaluation.minConfidence !== undefined
            ? { configuredMinConfidence: criterion.evaluation.minConfidence }
            : {}),
        };
      } else {
        matched =
          criterion.when === 'max-iterations'
            ? ctx.iteration >= criterion.value
            : criterion.when === 'max-duration'
              ? ctx.elapsedMs >= criterion.seconds * 1000
              : ctx.thread.lastOutput !== undefined &&
                validateJson(criterion.jsonSchema, ctx.thread.lastOutput.value).ok;
        evidence = {
          index,
          strategy: criterion.when,
          status: matched ? 'matched' : 'not-matched',
          holds: matched,
        };
      }
    } catch (error) {
      ctx.onCriterion?.({
        index,
        strategy,
        status: 'error',
        diagnostic: { code: 'CRITERION_ERROR', message: 'Exit criterion evaluation failed' },
      });
      throw error;
    }
    ctx.onCriterion?.(evidence);
    if (matched)
      return {
        kind: 'finish',
        outcome: criterion.outcome,
        reason: `criterion ${index} (${criterion.when})`,
        criterionIndex: index,
      };
  }
  if (config.default === 'loop-back' && config.loopBack) {
    if (ctx.iteration >= ctx.maxIterations)
      return {
        kind: 'finish',
        outcome: 'exhausted',
        reason: `loop ceiling of ${ctx.maxIterations} iterations reached`,
      };
    return { kind: 'loop-back', targetNodeId: config.loopBack.targetNodeId };
  }
  return { kind: 'finish', outcome: 'success', reason: 'default' };
}
