import { evaluateExpression, threadView } from '@graphgoblin/domain';
import type { NodeHandler } from '../handler.js';
import { toJson } from './common.js';

/** Terminal exits only map a result and declare its outcome and destinations. */
export const exitHandler: NodeHandler<'exit'> = {
  kind: 'exit',
  async execute(ctx) {
    const mapping = ctx.config.returns;
    const returnPayload =
      mapping === 'none'
        ? undefined
        : toJson(await evaluateExpression(mapping, threadView(ctx.thread)));
    return {
      kind: 'exit',
      patch: [],
      outcome: ctx.config.outcome,
      reason: `terminal exit: ${ctx.config.outcome}`,
      ...(returnPayload !== undefined ? { returnPayload } : {}),
      channels: mapping === 'none' ? [] : ctx.config.destinations,
    };
  },
};
