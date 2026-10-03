import type { ExitCriterion } from '@graphgoblin/contracts';
import {
  evaluateExit,
  evaluateExpression,
  threadView,
  type PredicateAnswer,
} from '@graphgoblin/domain';
import { RunFailureError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import { toJson } from './common.js';

async function askPredicate(
  ctx: NodeContext<'exit'>,
  criterion: Extract<ExitCriterion, { when: 'predicate' }>,
  question: string,
): Promise<PredicateAnswer> {
  const decider = ctx.ports.deciders.find((d) => d.id === criterion.strategy && d.available());
  if (!decider) {
    throw new RunFailureError(
      'DECIDER_UNAVAILABLE',
      `exit criterion needs the "${criterion.strategy}" decider, which is not available`,
      { nodeId: ctx.node.id },
    );
  }
  const resolved = criterion.strategy === 'codex' ? ctx.services.resolveModel() : undefined;
  const context = toJson({
    trigger: ctx.thread.invocation.trigger.payload,
    vars: ctx.thread.vars,
    lastOutput: ctx.thread.lastOutput?.value ?? null,
    lastMessage: ctx.thread.messages.at(-1)?.content ?? null,
    iteration: ctx.run.iteration,
  });
  return decider.judge(
    { question, context, ...(resolved ? { model: resolved.model, effort: resolved.effort } : {}) },
    ctx.signal,
  );
}

export const exitHandler: NodeHandler<'exit'> = {
  kind: 'exit',
  async execute(ctx) {
    const startedAt = ctx.run.startedAt
      ? Date.parse(ctx.run.startedAt)
      : Date.parse(ctx.run.createdAt);
    const decision = await evaluateExit(ctx.config, {
      thread: ctx.thread,
      iteration: ctx.run.iteration,
      maxIterations: ctx.definition.settings.maxIterations,
      elapsedMs: Math.max(0, Date.parse(ctx.services.now()) - startedAt),
      askPredicate: (criterion, question) => askPredicate(ctx, criterion, question),
      renderQuestion: (template) => ctx.services.render(template),
    });

    if (decision.kind === 'loop-back') {
      return { kind: 'loop-back', patch: [], targetNodeId: decision.targetNodeId };
    }

    const mapping = ctx.config.return.mapping;
    const returnPayload =
      mapping === 'none'
        ? undefined
        : toJson(await evaluateExpression(mapping, threadView(ctx.thread)));
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
