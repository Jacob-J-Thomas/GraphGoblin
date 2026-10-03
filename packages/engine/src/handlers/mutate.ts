import type { NodeHandler } from '../handler.js';
import { runMutations } from './common.js';

export const mutateHandler: NodeHandler<'mutate'> = {
  kind: 'mutate',
  async execute(ctx) {
    const { patch } = await runMutations(ctx, ctx.thread, ctx.config.operations);
    return { kind: 'done', patch, route: 'out' };
  },
};
