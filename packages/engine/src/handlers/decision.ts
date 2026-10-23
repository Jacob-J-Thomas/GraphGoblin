import {
  DecisionEmissionSchema,
  LIMIT_REACHED_PORT_ID,
  type DecisionContext,
  type DecisionPayload,
  type JsonValue,
} from '@graphgoblin/contracts';
import { decisionPortId, decisionRouteDeclarations, threadView } from '@graphgoblin/domain';
import { RunFailureError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import { pinnedBinding } from '../definition-pin.js';
import { evaluateClassifier, evaluateRoute } from '../primitive-evaluator.js';
import { outputPatch, selectMessages, toJson } from './common.js';

async function decisionContext(
  ctx: NodeContext<'decision'>,
  context: DecisionContext,
): Promise<JsonValue> {
  const view = threadView(ctx.thread) as unknown as Record<string, unknown>;
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
    const config = ctx.config;
    const common = {
      nodeId: ctx.node.id,
      ownerId: ctx.run.ownerId,
      signal: ctx.signal,
      ports: ctx.ports,
      resolveModel: (...args: Parameters<typeof ctx.services.resolveModel>) =>
        ctx.services.resolveModel(...args),
    };
    let payload: DecisionPayload;
    switch (config.kind) {
      case 'expression':
      case 'llm': {
        const result =
          config.kind === 'expression'
            ? await evaluateRoute({ ...common, config, expressionView: threadView(ctx.thread) })
            : await evaluateRoute({
                ...common,
                config,
                instructions: await ctx.services.render(config.instructions),
                context: await decisionContext(ctx, config.context),
              });
        if (result.observation.kind !== 'route')
          throw new Error('route evaluator returned a different observation');
        payload = { ...result, portId: result.observation.routeId };
        break;
      }
      case 'classifier': {
        const result = await evaluateClassifier({
          ...common,
          config,
          binding: pinnedBinding(ctx.run.pinned.classifiers, config.model),
          question: await ctx.services.render(config.question),
          context: await decisionContext(ctx, config.context),
        });
        const answer =
          result.answer.type === 'noul'
            ? result.answer
            : {
                ...result.answer,
                probabilities: config.recordAlternatives ? result.answer.probabilities : null,
              };
        if (result.acceptance.status === 'rejected')
          throw new RunFailureError(
            result.acceptance.code,
            'Classifier confidence is below the authored minimum',
            {
              nodeId: ctx.node.id,
              resumable: false,
              details: {
                observation: { kind: 'classifier', answer },
                provenance: result.provenance,
                acceptance: result.acceptance,
              },
            },
          );
        payload = {
          observation: { kind: 'classifier', answer },
          provenance: result.provenance,
          portId: decisionPortId(config.answer, answer),
        };
        break;
      }
    }
    const repeat = decisionRouteDeclarations(config).find((route) => route.repeat);
    if (repeat) {
      const previousPasses = ctx.thread.gates[ctx.node.id]?.passes ?? 1;
      const maxPasses = config.maxPasses!;
      // Run time includes waits, pauses and recovery downtime, and is checked after evaluation.
      const elapsedSeconds = Math.max(
        0,
        (Date.parse(ctx.services.now()) - Date.parse(ctx.run.startedAt ?? ctx.run.createdAt)) /
          1000,
      );
      const limit =
        payload.portId !== repeat.id
          ? null
          : maxPasses !== null && previousPasses >= maxPasses
            ? 'max-passes'
            : config.maxRunTimeSeconds !== undefined && elapsedSeconds >= config.maxRunTimeSeconds
              ? 'max-run-time'
              : null;
      payload = {
        ...payload,
        portId: limit ? LIMIT_REACHED_PORT_ID : payload.portId,
        gate: {
          previousPasses,
          passes: previousPasses + (payload.portId === repeat.id && !limit ? 1 : 0),
          repeatRouteId: repeat.id,
          maxPasses,
          elapsedSeconds,
          limit,
          ...(config.maxRunTimeSeconds !== undefined
            ? { maxRunTimeSeconds: config.maxRunTimeSeconds }
            : {}),
        },
      };
    }
    const evidence = DecisionEmissionSchema.safeParse({ ...payload, diagnostics: [] });
    if (!evidence.success)
      throw new RunFailureError(
        'EVALUATION_INVALID_RESPONSE',
        'The evaluator returned evidence inconsistent with its kind',
        { nodeId: ctx.node.id, resumable: false },
      );
    return {
      kind: 'decision',
      evidence: evidence.data,
      patch: outputPatch(ctx.thread, ctx.node.id, toJson(payload), ctx.services.now()),
      route: payload.portId,
    };
  },
};
