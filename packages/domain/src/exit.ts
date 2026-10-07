import type {
  ContextThread,
  ExitConfig,
  ExitCriterion,
  ExitCriterionEvaluation,
  Outcome,
} from '@graphgoblin/contracts';
import { evaluatePredicate } from './expression.js';
import { validateJson } from './json-schema.js';
import { threadView } from './thread-view.js';

export interface PredicateAnswer {
  holds: boolean;
  confidence?: number;
  reasoning?: string;
  model?: string;
  classifierModel?: string;
}

export interface ExitContext {
  thread: ContextThread;
  /** Current iteration, 1-based. */
  iteration: number;
  /** Hard ceiling from loop settings. */
  maxIterations: number;
  /** Milliseconds since the run started. */
  elapsedMs: number;
  /** Resolves Jev- and Codex-backed predicates. Provided by the engine. */
  askPredicate: (
    criterion: Extract<ExitCriterion, { when: 'predicate' }>,
    question: string,
  ) => Promise<PredicateAnswer>;
  /** Renders the predicate question template. Provided by the engine (it owns templating context). */
  renderQuestion: (template: string) => Promise<string>;
  /** Observes ordered evaluation evidence without changing exit semantics. */
  onCriterion?: (evaluation: ExitCriterionEvaluation) => void;
}

export type ExitDecision =
  | { kind: 'finish'; outcome: Outcome; reason: string; criterionIndex?: number }
  | { kind: 'loop-back'; targetNodeId: string };

async function criterionAnswer(
  criterion: ExitCriterion,
  ctx: ExitContext,
): Promise<PredicateAnswer> {
  switch (criterion.when) {
    case 'max-iterations':
      return { holds: ctx.iteration >= criterion.value };
    case 'max-duration':
      return { holds: ctx.elapsedMs >= criterion.seconds * 1000 };
    case 'last-output-matches':
      return {
        holds:
          ctx.thread.lastOutput !== undefined &&
          validateJson(criterion.jsonSchema, ctx.thread.lastOutput.value).ok,
      };
    case 'predicate': {
      if (criterion.strategy === 'expression') {
        return {
          holds: await evaluatePredicate(criterion.jsonata as string, threadView(ctx.thread)),
        };
      }
      const question = await ctx.renderQuestion(criterion.question as string);
      return ctx.askPredicate(criterion, question);
    }
  }
}

/**
 * Evaluate exit criteria in order. The first matching criterion decides. If none match, the
 * configured default applies. The loop's hard iteration ceiling always wins over loop-back.
 */
export async function evaluateExit(config: ExitConfig, ctx: ExitContext): Promise<ExitDecision> {
  for (const [index, criterion] of config.criteria.entries()) {
    const strategy = criterion.when === 'predicate' ? criterion.strategy : criterion.when;
    let answer: PredicateAnswer;
    try {
      answer = await criterionAnswer(criterion, ctx);
    } catch (error) {
      ctx.onCriterion?.({
        index,
        strategy,
        status: 'error',
        diagnostic: { code: 'CRITERION_ERROR', message: 'Exit criterion evaluation failed' },
      });
      throw error;
    }
    const minConfidence = criterion.when === 'predicate' ? criterion.minConfidence : undefined;
    const matched =
      answer.holds &&
      (minConfidence === undefined ||
        answer.confidence === undefined ||
        answer.confidence >= minConfidence);
    ctx.onCriterion?.({
      index,
      strategy,
      status: matched ? 'matched' : 'not-matched',
      holds: answer.holds,
      ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
      ...(minConfidence !== undefined ? { minConfidence } : {}),
      ...(answer.model !== undefined ? { model: answer.model } : {}),
      ...(answer.classifierModel !== undefined ? { classifierModel: answer.classifierModel } : {}),
      ...(strategy === 'codex' && answer.reasoning !== undefined
        ? { reasoning: answer.reasoning.slice(0, 2048) }
        : {}),
    });
    if (matched) {
      return {
        kind: 'finish',
        outcome: criterion.outcome,
        reason: `criterion ${index} (${criterion.when})`,
        criterionIndex: index,
      };
    }
  }
  if (config.default === 'loop-back' && config.loopBack) {
    if (ctx.iteration >= ctx.maxIterations) {
      return {
        kind: 'finish',
        outcome: 'exhausted',
        reason: `loop ceiling of ${ctx.maxIterations} iterations reached`,
      };
    }
    return { kind: 'loop-back', targetNodeId: config.loopBack.targetNodeId };
  }
  return { kind: 'finish', outcome: 'success', reason: 'default' };
}
