import {
  DecisionEmissionSchema,
  type DecisionContext,
  type DecisionPayload,
  type JsonValue,
} from '@graphgoblin/contracts';
import { decisionPortId, threadView } from '@graphgoblin/domain';
import { RunFailureError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import { evaluatePrimitive } from '../primitive-evaluator.js';
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
    const evaluation = ctx.config.evaluation;
    // The full-thread question and separately selected provider state remain caller-owned.
    const prepared =
      evaluation.kind === 'expression'
        ? {}
        : {
            question: await ctx.services.render(evaluation.question),
            context: await decisionContext(ctx, evaluation.context),
          };
    const result = await evaluatePrimitive({
      nodeId: ctx.node.id,
      ownerId: ctx.run.ownerId,
      evaluation,
      answer: ctx.config.answer,
      expressionView: threadView(ctx.thread),
      ...prepared,
      signal: ctx.signal,
      ports: ctx.ports,
      resolveModel: (...args) => ctx.services.resolveModel(...args),
    });
    const rawAnswer = result.answer;
    const answer =
      rawAnswer.type === 'choice' || rawAnswer.type === 'score'
        ? {
            ...rawAnswer,
            probabilities: ctx.config.recordAlternatives ? rawAnswer.probabilities : null,
          }
        : rawAnswer;
    if (result.acceptance.status === 'rejected')
      throw new RunFailureError(
        result.acceptance.code,
        'Classifier confidence is below the authored minimum',
        {
          nodeId: ctx.node.id,
          resumable: false,
          details: {
            answer,
            provenance: result.provenance,
            acceptance: result.acceptance,
          },
        },
      );
    const payload: DecisionPayload = {
      answer,
      portId: decisionPortId(ctx.config.answer, answer),
      provenance: result.provenance,
    };
    const evidence = DecisionEmissionSchema.safeParse({ ...payload, diagnostics: [] });
    if (!evidence.success)
      throw new RunFailureError(
        'EVALUATION_INVALID_RESPONSE',
        'The evaluator returned evidence inconsistent with its kind',
        { nodeId: ctx.node.id, resumable: false },
      );
    await ctx.services.record({ type: 'decision.made', nodeId: ctx.node.id, ...evidence.data });
    return {
      kind: 'done',
      patch: outputPatch(ctx.thread, ctx.node.id, toJson(payload), ctx.services.now()),
      route: payload.portId,
    };
  },
};
