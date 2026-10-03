import type { WaitSpec } from '@graphgoblin/contracts';
import { RunFailureError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import { makeMessage, messagePatch, outputPatch, toJson } from './common.js';

function isoFromTemplate(ctx: NodeContext<'wait'>, rendered: string): string {
  const ms = Date.parse(rendered.trim());
  if (Number.isNaN(ms)) {
    throw new RunFailureError(
      'TEMPLATE_ERROR',
      `wait "until" rendered "${rendered}", which is not a timestamp`,
      { nodeId: ctx.node.id },
    );
  }
  return new Date(ms).toISOString();
}

export const waitHandler: NodeHandler<'wait'> = {
  kind: 'wait',
  async execute(ctx) {
    const { config } = ctx;
    const now = Date.parse(ctx.services.now());

    if (!ctx.wake) {
      let wait: WaitSpec;
      switch (config.mode) {
        case 'input':
          wait = {
            nodeId: ctx.node.id,
            kind: 'input',
            prompt: await ctx.services.render(config.prompt),
            ...(config.inputSchema ? { inputSchema: config.inputSchema } : {}),
          };
          break;
        case 'duration': {
          const until = new Date(now + config.seconds * 1000).toISOString();
          await ctx.ports.timers.schedule(ctx.run.id, 'timer', new Date(until));
          wait = { nodeId: ctx.node.id, kind: 'timer', until };
          break;
        }
        case 'until': {
          const until = isoFromTemplate(ctx, await ctx.services.render(config.timestamp));
          await ctx.ports.timers.schedule(ctx.run.id, 'timer', new Date(until));
          wait = { nodeId: ctx.node.id, kind: 'timer', until };
          break;
        }
        case 'signal':
          wait = { nodeId: ctx.node.id, kind: 'signal', signalName: config.name };
          break;
      }
      if (config.timeoutSeconds !== undefined) {
        const deadline = new Date(now + config.timeoutSeconds * 1000);
        await ctx.ports.timers.schedule(ctx.run.id, 'timeout', deadline);
        // Both deadlines are kept in the spec, so recovery can re-arm both (docs/05).
        wait = {
          ...wait,
          timeoutAt: deadline.toISOString(),
          ...(wait.until ? {} : { until: deadline.toISOString() }),
        };
      }
      return { kind: 'park', patch: [], wait };
    }

    await ctx.ports.timers.cancel(ctx.run.id);
    const at = ctx.services.now();
    switch (ctx.wake.reason) {
      case 'timeout':
        if (config.onTimeout === 'fail-run') {
          throw new RunFailureError(
            'WAIT_TIMEOUT',
            `wait node timed out after ${config.timeoutSeconds ?? 0}s`,
            { nodeId: ctx.node.id },
          );
        }
        return {
          kind: 'done',
          patch: outputPatch(ctx.thread, ctx.node.id, { timedOut: true }, at),
          route: 'out',
        };
      case 'input': {
        const payload = ctx.wake.payload ?? null;
        const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
        return {
          kind: 'done',
          patch: [
            messagePatch(makeMessage(ctx, 'user', content, ['input'])),
            ...outputPatch(ctx.thread, ctx.node.id, payload, at),
          ],
          route: 'out',
        };
      }
      case 'signal': {
        const payload = ctx.wake.payload ?? null;
        return {
          kind: 'done',
          patch: [
            messagePatch(
              makeMessage(ctx, 'note', `Signal received: ${JSON.stringify(payload)}`, ['signal']),
            ),
            ...outputPatch(ctx.thread, ctx.node.id, payload, at),
          ],
          route: 'out',
        };
      }
      default:
        return {
          kind: 'done',
          patch: outputPatch(
            ctx.thread,
            ctx.node.id,
            toJson({ wokeAt: at, reason: ctx.wake.reason }),
            at,
          ),
          route: 'out',
        };
    }
  },
};
