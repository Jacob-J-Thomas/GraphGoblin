import type { NodeHandler } from '../handler.js';
import { outputPatch } from './common.js';

/** A trigger node records the trigger payload as its output and moves on. Run creation already validated it. */
export const triggerHandler: NodeHandler<'trigger'> = {
  kind: 'trigger',
  execute(ctx) {
    const payload = ctx.thread.invocation.trigger.payload;
    return Promise.resolve({
      kind: 'done',
      patch: outputPatch(ctx.thread, ctx.node.id, payload, ctx.services.now()),
      route: 'out',
    });
  },
};
