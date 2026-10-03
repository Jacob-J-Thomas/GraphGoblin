import type {
  ContextThread,
  JsonValue,
  Message,
  PatchOperation,
  RunEvent,
} from '@graphgoblin/contracts';
import { JsonPatchSchema } from '@graphgoblin/contracts';
import {
  MUTABLE_REGIONS,
  evaluateExpression,
  isTerminal,
  pointerStartsWith,
  threadView,
} from '@graphgoblin/domain';
import { RunFailureError } from '../errors.js';
import type { ChildOutcome, NodeContext, NodeHandler, NodeResult } from '../handler.js';
import {
  addUsage,
  makeMessage,
  messagePatch,
  outputPatch,
  selectCollection,
  selectMessages,
  toJson,
} from './common.js';

type Seed = Pick<
  Partial<ContextThread>,
  'messages' | 'vars' | 'artifacts' | 'outputs' | 'lastOutput'
>;

async function buildSeed(ctx: NodeContext<'subloop'>): Promise<Seed> {
  const { input } = ctx.config;
  const thread = ctx.thread;
  const view = threadView(thread) as unknown as Record<string, unknown>;
  const seed: Seed = {};

  if (input.mode === 'inherit') {
    const excluded = new Set(input.exclude ?? []);
    if (!excluded.has('messages')) seed.messages = [...thread.messages];
    if (!excluded.has('vars')) seed.vars = { ...thread.vars };
    if (!excluded.has('artifacts')) seed.artifacts = [...thread.artifacts];
    if (!excluded.has('outputs')) seed.outputs = { ...thread.outputs };
    if (!excluded.has('lastOutput') && thread.lastOutput) seed.lastOutput = thread.lastOutput;
  } else if (input.mode === 'project') {
    seed.messages = await selectMessages(thread.messages, input.messages ?? 'none', view);
    seed.artifacts = await selectCollection(thread.artifacts, input.artifacts ?? 'none', view);
  }

  if (input.vars) {
    const vars: Record<string, JsonValue> = { ...(seed.vars ?? {}) };
    for (const [name, expression] of Object.entries(input.vars)) {
      vars[name] = toJson(await evaluateExpression(expression, view));
    }
    seed.vars = vars;
  }

  if (input.inject?.length) {
    const injected: Message[] = [];
    for (const message of input.inject) {
      injected.push(
        makeMessage(ctx, message.role, await ctx.services.render(message.content), message.tags),
      );
    }
    seed.messages = [...(seed.messages ?? []), ...injected];
  }
  return seed;
}

async function outputMapping(
  ctx: NodeContext<'subloop'>,
  child: ChildOutcome,
): Promise<PatchOperation[]> {
  const { output } = ctx.config;
  const parent = ctx.thread;
  const parentView = threadView(parent) as unknown as Record<string, unknown>;
  const childView = child.thread
    ? (threadView(child.thread) as unknown as Record<string, unknown>)
    : undefined;
  const summary = toJson({
    status: child.status,
    outcome: child.outcome ?? null,
    result: child.result ?? null,
    childRunId: child.runId,
  });
  const patch: PatchOperation[] = [];

  if (output.mode === 'custom') {
    const value = await evaluateExpression(output.custom?.patch ?? '[]', {
      parent: parentView,
      child: childView ?? null,
      result: child.result ?? null,
      outcome: child.outcome ?? null,
      status: child.status,
    });
    const checked = JsonPatchSchema.safeParse(value);
    if (!checked.success) {
      throw new RunFailureError(
        'EXPRESSION_ERROR',
        `custom output mapping did not produce a JSON patch: ${checked.error.issues.map((i) => i.message).join('; ')}`,
        { nodeId: ctx.node.id },
      );
    }
    for (const op of checked.data) {
      if (
        !MUTABLE_REGIONS.some((r) => pointerStartsWith(op.path, r)) ||
        (op.op === 'move' && !MUTABLE_REGIONS.some((r) => pointerStartsWith(op.from, r)))
      ) {
        throw new RunFailureError(
          'EXPRESSION_ERROR',
          `custom output mapping touches "${op.path}", outside the mutable regions`,
          { nodeId: ctx.node.id },
        );
      }
    }
    patch.push(...checked.data);
    return patch;
  }

  if (output.resultTo.lastOutput)
    patch.push(...outputPatch(parent, ctx.node.id, summary, ctx.services.now()));

  // Variables are merged into one replacement so the result variable and the merge strategy compose.
  let vars: Record<string, JsonValue> = { ...parent.vars };
  let varsChanged = false;
  if (output.resultTo.var) {
    vars[output.resultTo.var] = child.result ?? null;
    varsChanged = true;
  }

  if (output.mode === 'merge' && child.thread) {
    const childThread = child.thread;
    if (output.vars) {
      if (output.vars.strategy === 'explicit') {
        for (const [name, expression] of Object.entries(output.vars.map ?? {})) {
          vars[name] = toJson(await evaluateExpression(expression, childView));
        }
      } else if (output.vars.strategy === 'parent-wins') {
        vars = { ...childThread.vars, ...vars };
      } else {
        vars = { ...vars, ...childThread.vars };
      }
      varsChanged = true;
    }
    const messages = await selectMessages(
      childThread.messages,
      output.messages ?? 'none',
      childView ?? {},
    );
    for (const message of messages) patch.push(messagePatch(message));
    const artifacts = await selectCollection(
      childThread.artifacts,
      output.artifacts ?? 'none',
      childView ?? {},
    );
    for (const artifact of artifacts)
      patch.push({ op: 'add', path: '/artifacts/-', value: toJson(artifact) });
  }
  if (varsChanged) patch.push({ op: 'replace', path: '/vars', value: toJson(vars) });

  if (output.usage === 'roll-up' && child.thread) {
    patch.push({
      op: 'replace',
      path: '/counters/usage',
      value: toJson(addUsage(parent.counters.usage, child.thread.counters.usage)),
    });
  }
  return patch;
}

export const subloopHandler: NodeHandler<'subloop'> = {
  kind: 'subloop',
  async execute(ctx) {
    const { config } = ctx;
    // A visit that already started its child (the process died before the park was recorded, or
    // the node runs again without a wake) re-parks on that child, or maps its outcome if it has
    // finished, instead of starting a second one (docs/05, crash recovery).
    const existing = ctx.wake ? undefined : await childOfThisVisit(ctx);
    if (existing) {
      const child = await ctx.services.childOutcome(existing);
      if (!isTerminal(child.status)) {
        return {
          kind: 'park',
          patch: [],
          wait: { nodeId: ctx.node.id, kind: 'child', childRunId: existing },
        };
      }
      return finishWithChild(ctx, child);
    }
    if (!ctx.wake) {
      const depth = await ctx.services.depth();
      const limit = config.depthLimitOverride ?? ctx.definition.settings.subloopDepthLimit;
      if (depth + 1 > limit) {
        throw new RunFailureError(
          'SUBLOOP_DEPTH_EXCEEDED',
          `subloop depth ${depth + 1} exceeds the limit ${limit}`,
          { nodeId: ctx.node.id, resumable: false },
        );
      }
      const seed = await buildSeed(ctx);
      const view = threadView(ctx.thread) as unknown as Record<string, unknown>;
      const triggerPayload = config.input.trigger
        ? toJson(await evaluateExpression(config.input.trigger.payload, view))
        : ctx.thread.invocation.trigger.payload;
      const childRunId = await ctx.services.startChild({
        loopId: config.loopRef.loopId,
        version: config.loopRef.version,
        seed,
        triggerPayload,
        depthLimit: limit,
      });
      await ctx.services.record({ type: 'child_run.started', nodeId: ctx.node.id, childRunId });
      return { kind: 'park', patch: [], wait: { nodeId: ctx.node.id, kind: 'child', childRunId } };
    }

    const childRunId = ctx.previousWait?.childRunId;
    if (!childRunId) {
      throw new RunFailureError('INTERNAL_ERROR', 'subloop woke without a child run id', {
        nodeId: ctx.node.id,
      });
    }
    return finishWithChild(ctx, await ctx.services.childOutcome(childRunId));
  },
};

async function finishWithChild(
  ctx: NodeContext<'subloop'>,
  child: ChildOutcome,
): Promise<NodeResult> {
  await ctx.services.record({
    type: 'child_run.finished',
    nodeId: ctx.node.id,
    childRunId: child.runId,
    status: child.status,
    ...(child.outcome ? { outcome: child.outcome } : {}),
  });
  const patch = await outputMapping(ctx, child);
  return { kind: 'done', patch, route: 'out' };
}

/** The child this node started during its current, unfinished visit, from the run's log. */
async function childOfThisVisit(ctx: NodeContext<'subloop'>): Promise<string | undefined> {
  const events = await ctx.services.events();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as RunEvent;
    if (event.type === 'node.finished' && event.nodeId === ctx.node.id) return undefined;
    if (event.type === 'child_run.started' && event.nodeId === ctx.node.id) return event.childRunId;
  }
  return undefined;
}
