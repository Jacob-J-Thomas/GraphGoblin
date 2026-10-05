import type { JsonValue } from '@graphgoblin/contracts';
import { evaluateExpression, threadView } from '@graphgoblin/domain';
import { isAbortError, RunFailureError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import type { ClassifierPort, ChoiceResult } from '../ports.js';
import { outputPatch, selectMessages, toJson } from './common.js';

/** Provider exception messages, stacks, and even codes may contain their raw answer or a key. */
const DECIDER_FAILURE_MESSAGES: Record<string, string> = {
  DECIDER_UNAVAILABLE: 'Decision provider is unavailable',
  DECIDER_NOT_AUTHENTICATED: 'Decision provider rejected authentication',
  DECIDER_RATE_LIMITED: 'Decision provider rate limit exceeded',
  DECIDER_HTTP_ERROR: 'Decision provider request failed',
  DECIDER_UNREACHABLE: 'Classifier endpoint is unreachable',
  DECIDER_INVALID_RESPONSE: 'Decision provider returned an invalid response',
  DECIDER_REDIRECT: 'Classifier redirects are not followed',
  DECIDER_TIMEOUT: 'Decision provider request timed out',
};

async function decisionContext(ctx: NodeContext<'decision'>): Promise<JsonValue> {
  const view = threadView(ctx.thread) as unknown as Record<string, unknown>;
  const { context } = ctx.config;
  const messages = await selectMessages(ctx.thread.messages, context.messages, view);
  const vars: Record<string, JsonValue> = {};
  for (const name of context.vars ?? Object.keys(ctx.thread.vars)) {
    if (name in ctx.thread.vars) vars[name] = ctx.thread.vars[name] as JsonValue;
  }
  return toJson({
    trigger: ctx.thread.invocation.trigger.payload,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    vars,
    ...(context.includeLastOutput && ctx.thread.lastOutput
      ? { lastOutput: ctx.thread.lastOutput.value }
      : {}),
  });
}

export const decisionHandler: NodeHandler<'decision'> = {
  kind: 'decision',
  async execute(ctx) {
    const { config } = ctx;
    const labels = new Set(config.routes.map((r) => r.label));
    const question = await ctx.services.render(config.question);
    const context = await decisionContext(ctx);
    const tried: string[] = [];

    for (const strategy of config.strategy) {
      if (strategy === 'expression') {
        const value = await evaluateExpression(
          config.expression?.jsonata ?? '',
          threadView(ctx.thread),
        );
        const label = typeof value === 'string' ? value : String(value);
        if (labels.has(label)) return decide(ctx, strategy, { label });
        tried.push('expression returned a route that is not declared on this node');
        continue;
      }
      let decider: ClassifierPort | undefined;
      const classifierModel = strategy === 'jev' ? (config.jev?.model ?? 'jev') : undefined;
      if (classifierModel !== undefined) {
        const selection = await ctx.ports.classifiers.resolve(ctx.run.ownerId, classifierModel);
        if (selection.status === 'unavailable') {
          tried.push(`jev unavailable: ${selection.reason}: ${selection.message}`);
          continue;
        }
        decider = selection.classifier;
      } else {
        decider = ctx.ports.deciders.find((d) => d.id === strategy && d.available());
      }
      if (!decider) {
        tried.push(`${strategy} unavailable`);
        continue;
      }
      const resolved =
        strategy === 'codex'
          ? ctx.services.resolveModel(config.codex?.model, config.codex?.effort)
          : undefined;
      let result: ChoiceResult;
      try {
        result = await decider.choose(
          {
            question,
            options: config.routes.map((r) => ({ label: r.label, description: r.description })),
            context,
            ...(resolved ? { model: resolved.model, effort: resolved.effort } : {}),
          },
          ctx.signal,
        );
      } catch (error) {
        if (isAbortError(error) || ctx.signal.aborted) throw error;
        const code =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string' &&
          Object.hasOwn(DECIDER_FAILURE_MESSAGES, error.code)
            ? error.code
            : undefined;
        throw new RunFailureError(
          'INTERNAL_ERROR',
          code ? DECIDER_FAILURE_MESSAGES[code]! : 'Decision provider request failed',
          { nodeId: ctx.node.id, details: { strategy, ...(code ? { code } : {}) } },
        );
      }
      if (!labels.has(result.label)) {
        tried.push(`${strategy} chose a route that is not declared on this node`);
        continue;
      }
      if (
        result.confidence !== undefined &&
        (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1)
      ) {
        tried.push(`${strategy} returned invalid confidence`);
        continue;
      }
      const minConfidence = strategy === 'jev' ? config.jev?.minConfidence : undefined;
      if (
        minConfidence !== undefined &&
        result.confidence !== undefined &&
        result.confidence < minConfidence
      ) {
        tried.push(`${strategy} confidence ${result.confidence} below ${minConfidence}`);
        continue;
      }
      return decide(ctx, strategy, result, classifierModel);
    }

    throw new RunFailureError(
      'DECISION_NO_ROUTE',
      `no strategy produced a route: ${tried.join('; ')}`,
      {
        nodeId: ctx.node.id,
        details: { tried },
      },
    );
  },
};

async function decide(
  ctx: NodeContext<'decision'>,
  strategy: 'jev' | 'codex' | 'expression',
  result: ChoiceResult,
  classifierModel?: string,
) {
  await ctx.services.record({
    type: 'decision.made',
    nodeId: ctx.node.id,
    strategy,
    ...(classifierModel !== undefined ? { classifierModel } : {}),
    route: result.label,
    ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
    ...(ctx.config.recordAlternatives && result.alternatives
      ? {
          alternatives: result.alternatives.map((a) => ({
            route: a.label,
            ...(a.confidence !== undefined ? { confidence: a.confidence } : {}),
          })),
        }
      : {}),
  });
  const value = toJson({ route: result.label, strategy, confidence: result.confidence ?? null });
  return {
    kind: 'done' as const,
    patch: outputPatch(ctx.thread, ctx.node.id, value, ctx.services.now()),
    route: result.label,
  };
}
