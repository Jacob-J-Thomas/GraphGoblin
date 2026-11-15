import { ExpressionError, MutationError, PatchError, TemplateError } from '@graphgoblin/domain';
import { RunFailureError } from '../errors.js';
import { boundedAuthoredCause } from '../failure-publication.js';
import type { NodeHandler } from '../handler.js';
import { runMutations } from './common.js';

export const mutateHandler: NodeHandler<'mutate'> = {
  kind: 'mutate',
  async execute(ctx) {
    const { patch } = await runMutations(
      ctx,
      ctx.thread,
      ctx.config.operations,
      (error, operationIndex, operationKind) => {
        if (!(
          error instanceof ExpressionError ||
          error instanceof TemplateError ||
          error instanceof MutationError ||
          error instanceof PatchError
        ))
          return error;
        const cause = { code: error.code, message: boundedAuthoredCause(error.message) };
        const reason =
          error instanceof PatchError ? `Patch error: ${cause.message}` : cause.message;
        return new RunFailureError(
          'MUTATION_ERROR',
          `Mutation operation ${operationIndex + 1} (${operationKind}) failed: ${reason}`,
          {
            nodeId: ctx.node.id,
            resumable: false,
            details: { operationIndex, operationKind, cause },
          },
        );
      },
    );
    return { kind: 'done', patch, route: 'out' };
  },
};
