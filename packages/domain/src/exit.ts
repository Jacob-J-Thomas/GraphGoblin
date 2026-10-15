import type {
  ContextThread,
  ExitConfig,
  ExitCriterionEvaluation,
  ExitPredicate,
  ExitPredicateMatch,
  Outcome,
  PredicateEvaluation,
  EvaluationObservation,
} from '@graphgoblin/contracts';
import { validateJson } from './json-schema.js';

export interface ExitContext {
  thread: ContextThread;
  /** Current iteration, 1-based. */
  iteration: number;
  maxIterations: number;
  elapsedMs: number;
  /** The caller prepares expression state, provider state and question rendering. */
  evaluatePredicate: (criterion: ExitPredicate) => Promise<PredicateEvaluation>;
  onCriterion?: (evaluation: ExitCriterionEvaluation) => void;
}

export type ExitDecision =
  | { kind: 'finish'; outcome: Outcome; reason: string; criterionIndex?: number }
  | { kind: 'loop-back'; targetNodeId: string };

function matches(observation: EvaluationObservation, match: ExitPredicateMatch): boolean {
  if (observation.kind === 'boolean')
    return match.type === 'boolean' && observation.holds === match.value;
  if (observation.kind !== 'classifier') return false;
  const answer = observation.answer;
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
    const strategy = criterion.when === 'predicate' ? criterion.predicate.kind : criterion.when;
    let evidence: ExitCriterionEvaluation;
    let matched: boolean;
    try {
      if (criterion.when === 'predicate') {
        const result = await ctx.evaluatePredicate(criterion);
        const minimum =
          'minReportedConfidence' in criterion.match
            ? criterion.match.minReportedConfidence
            : undefined;
        const confidence =
          result.observation.kind === 'classifier'
            ? result.observation.answer.confidence
            : result.observation.confidence;
        const rejection =
          result.acceptance.status === 'rejected'
            ? {
                kind: 'classifier-confidence' as const,
                minimum: result.acceptance.minConfidence,
                confidence: confidence,
              }
            : minimum !== undefined && (confidence === null || confidence < minimum)
              ? {
                  kind: 'llm-reported-confidence' as const,
                  minimum,
                  confidence: confidence,
                }
              : undefined;
        matched = rejection === undefined && matches(result.observation, criterion.match);
        evidence = {
          index,
          strategy: criterion.predicate.kind,
          status: matched ? 'matched' : 'not-matched',
          ...result,
          match: criterion.match,
          ...(rejection ? { rejection } : {}),
          ...(criterion.predicate.kind === 'classifier' &&
          criterion.predicate.minConfidence !== undefined
            ? { configuredMinConfidence: criterion.predicate.minConfidence }
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
