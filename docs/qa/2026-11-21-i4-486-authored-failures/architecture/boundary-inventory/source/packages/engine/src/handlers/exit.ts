import type { JsonValue } from '@graphgoblin/contracts';
import { evaluateExpression, ExpressionError, threadView } from '@graphgoblin/domain';
import { RunFailureError } from '../errors.js';
import { boundedAuthoredCause } from '../failure-publication.js';
import type { NodeHandler } from '../handler.js';
import { toJson } from './common.js';

/** Terminal exits only map a result and declare its outcome and destinations. */
export const exitHandler: NodeHandler<'exit'> = {
  kind: 'exit',
  async execute(ctx) {
    const mapping = ctx.config.returns;
    let returnPayload: JsonValue | undefined;
    if (mapping !== 'none') {
      const view = threadView(ctx.thread);
      const evaluated = await evaluateExpression(mapping, view).catch((error: unknown) => {
        if (!(error instanceof ExpressionError)) throw error;
        throw new RunFailureError('EXPRESSION_ERROR', boundedAuthoredCause(error.message), {
          nodeId: ctx.node.id,
          resumable: false,
        });
      });
      returnPayload = toJson(evaluated);
    }
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
