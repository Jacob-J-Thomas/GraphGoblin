import type { ContextThread, ExitConfig, ExitCriterion, Outcome } from '@graphgoblin/contracts';
import { evaluatePredicate } from './expression.js';
import { validateJson } from './json-schema.js';
import { threadView } from './thread-view.js';

export interface PredicateAnswer {
  holds: boolean;
  confidence?: number;
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
}

export type ExitDecision =
  | { kind: 'finish'; outcome: Outcome; reason: string; criterionIndex?: number }
  | { kind: 'loop-back'; targetNodeId: string };

async function criterionHolds(criterion: ExitCriterion, ctx: ExitContext): Promise<boolean> {
  switch (criterion.when) {
    case 'max-iterations':
      return ctx.iteration >= criterion.value;
    case 'max-duration':
      return ctx.elapsedMs >= criterion.seconds * 1000;
    case 'last-output-matches':
      return (
        ctx.thread.lastOutput !== undefined &&
        validateJson(criterion.jsonSchema, ctx.thread.lastOutput.value).ok
      );
    case 'predicate': {
      if (criterion.strategy === 'expression') {
        return evaluatePredicate(criterion.jsonata as string, threadView(ctx.thread));
      }
      const question = await ctx.renderQuestion(criterion.question as string);
      const answer = await ctx.askPredicate(criterion, question);
      if (!answer.holds) return false;
      if (criterion.minConfidence !== undefined && answer.confidence !== undefined) {
        return answer.confidence >= criterion.minConfidence;
      }
      return true;
    }
  }
}

/**
 * Evaluate exit criteria in order. The first matching criterion decides. If none match, the
 * configured default applies. The loop's hard iteration ceiling always wins over loop-back.
 */
export async function evaluateExit(config: ExitConfig, ctx: ExitContext): Promise<ExitDecision> {
  for (const [index, criterion] of config.criteria.entries()) {
    if (await criterionHolds(criterion, ctx)) {
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
