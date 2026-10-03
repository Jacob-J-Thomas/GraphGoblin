import type { ContextThread, JsonValue, PatchOperation, Usage } from '@graphgoblin/contracts';
import { applyPatch, renderTemplate, threadView, validateJson } from '@graphgoblin/domain';
import { RunCancelledError, RunFailureError, describeError, isAbortError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import type {
  HarnessItem,
  HarnessPort,
  HarnessResult,
  HarnessSession,
  HarnessSessionRecord,
  HarnessTurnRequest,
} from '../ports.js';
import {
  DEFAULT_REPAIR_PROMPT,
  addUsage,
  jsonOrText,
  makeMessage,
  messagePatch,
  outputPatch,
  runMutations,
  toJson,
  usagePatch,
  withTimeout,
} from './common.js';

const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningOutputTokens: 0,
};

const CONTINUATION_PROMPT =
  'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.';

/** Consume a session: record progress and usage, resolve the result, map failures to run failures. */
async function consume(
  ctx: NodeContext<'inference'>,
  session: HarnessSession,
  row: HarnessSessionRecord,
): Promise<HarnessResult> {
  let lastError: { code: string; message: string } | undefined;
  for await (const event of session.events) {
    switch (event.type) {
      case 'session':
        row.sessionId = event.sessionId;
        row.status = 'active';
        row.updatedAt = ctx.services.now();
        await ctx.ports.sessions.upsert({ ...row });
        await ctx.services.record({
          type: 'harness.session',
          nodeId: ctx.node.id,
          harness: ctx.config.harness,
          sessionId: event.sessionId,
          mode: event.mode,
          ...(row.model ? { model: row.model } : {}),
          ...(row.effort ? { effort: row.effort } : {}),
        });
        break;
      case 'item':
        await ctx.services.record({
          type: 'node.progress',
          nodeId: ctx.node.id,
          progress: toJson({
            item: {
              id: event.item.id,
              type: event.item.type,
              summary: event.item.summary.slice(0, 2000),
            },
          }),
        });
        break;
      case 'usage':
        await ctx.services.record({
          type: 'harness.usage',
          nodeId: ctx.node.id,
          usage: event.usage,
        });
        break;
      case 'error':
        lastError = { code: event.code, message: event.message };
        break;
      case 'turn-complete':
        break;
    }
  }
  try {
    return await session.result;
  } catch (error) {
    if (isAbortError(error) || ctx.signal.aborted) throw new RunCancelledError();
    const code = classifyHarnessError(lastError?.code ?? (error as { code?: string }).code);
    throw new RunFailureError(
      code,
      `harness turn failed: ${lastError?.message ?? describeError(error)}`,
      { nodeId: ctx.node.id, details: lastError },
    );
  }
}

function classifyHarnessError(
  code: string | undefined,
): 'HARNESS_QUOTA_EXHAUSTED' | 'HARNESS_NOT_AUTHENTICATED' | 'HARNESS_TURN_FAILED' {
  const c = (code ?? '').toLowerCase();
  if (c.includes('quota') || c.includes('rate') || c.includes('usage_limit'))
    return 'HARNESS_QUOTA_EXHAUSTED';
  if (c.includes('auth') || c.includes('401') || c.includes('unauthorized'))
    return 'HARNESS_NOT_AUTHENTICATED';
  return 'HARNESS_TURN_FAILED';
}

function noteFor(item: HarnessItem): string | undefined {
  switch (item.type) {
    case 'command':
      return `Ran: ${item.summary}`;
    case 'file-change':
      return `Changed: ${item.summary}`;
    case 'tool-call':
      return `Tool: ${item.summary}`;
    default:
      return undefined;
  }
}

export const inferenceHandler: NodeHandler<'inference'> = {
  kind: 'inference',
  async execute(ctx) {
    const { config } = ctx;
    const harness: HarnessPort | undefined = ctx.ports.harnesses[config.harness];
    if (!harness) {
      throw new RunFailureError(
        'HARNESS_NOT_INSTALLED',
        `harness "${config.harness}" is not configured`,
        { nodeId: ctx.node.id },
      );
    }
    const { model, effort } = ctx.services.resolveModel(config.model, config.effort);
    const workingDirectory = await ctx.services.workingDirectory();

    // Input transforms shape only the view the prompt sees; they are not persisted.
    const viewThread: ContextThread = config.input.length
      ? (await runMutations(ctx, ctx.thread, config.input)).thread
      : ctx.thread;
    const view = threadView(viewThread) as unknown as Record<string, unknown>;

    for (const file of config.contextFiles ?? []) {
      await ctx.ports.workspace.writeFile(
        workingDirectory,
        file.path,
        await renderTemplate(file.template, view),
      );
    }

    // Session resolution: crash recovery first, then the configured policy.
    const existing = await ctx.ports.sessions.forNode(ctx.run.id, ctx.node.id);
    let resumeId: string | undefined;
    let prompt: string;
    if (ctx.attempt > 1 && existing?.sessionId && existing.status !== 'finished') {
      resumeId = existing.sessionId;
      prompt = CONTINUATION_PROMPT;
    } else {
      prompt = await renderTemplate(config.prompt.template, view);
      if (config.session.policy === 'resume-previous') {
        resumeId = (await ctx.ports.sessions.latestWithSession(ctx.run.id))?.sessionId;
      } else if (config.session.policy === 'resume-named') {
        resumeId = (
          await ctx.ports.sessions.byScopeKey(`${ctx.thread.run.loopId}:${config.session.key}`)
        )?.sessionId;
      }
    }

    const row: HarnessSessionRecord = {
      runId: ctx.run.id,
      nodeId: ctx.node.id,
      attempt: ctx.attempt,
      harness: config.harness,
      status: 'starting',
      model,
      effort,
      updatedAt: ctx.services.now(),
      ...(resumeId ? { sessionId: resumeId } : {}),
      ...(config.session.policy === 'resume-named'
        ? { scopeKey: `${ctx.thread.run.loopId}:${config.session.key}` }
        : {}),
    };
    await ctx.ports.sessions.upsert({ ...row });

    const schema = config.output.schema;
    const turn: HarnessTurnRequest = {
      prompt,
      ...(schema?.native ? { outputSchema: schema.jsonSchema } : {}),
    };
    const timeout = withTimeout(
      ctx.signal,
      config.timeoutSeconds,
      () => new Error('inference timeout'),
    );

    let result: HarnessResult;
    let usage: Usage = ZERO_USAGE;
    try {
      const session = resumeId
        ? harness.resume(resumeId, turn, timeout.signal)
        : harness.start(
            {
              workingDirectory,
              model,
              effort,
              options: config.harnessOptions,
              ...(config.capabilities ? { capabilities: config.capabilities } : {}),
              turn,
            },
            timeout.signal,
          );
      try {
        result = await consume(ctx, session, row);
      } catch (error) {
        if (timeout.timedOut()) {
          await session.cancel();
          throw new RunFailureError(
            'INFERENCE_TIMEOUT',
            `inference exceeded ${config.timeoutSeconds ?? 0}s`,
            { nodeId: ctx.node.id },
          );
        }
        if (error instanceof RunCancelledError) await session.cancel();
        throw error;
      }
      usage = addUsage(usage, result.usage);

      // Structured output: validate, then repair on the same session as the policy allows.
      let structured: JsonValue | undefined;
      if (schema) {
        let candidate: unknown = result.structured ?? jsonOrText(result.finalText);
        let validation = validateJson(schema.jsonSchema, candidate);
        let attempts = 0;
        while (!validation.ok && schema.repair.enabled && attempts < schema.repair.maxAttempts) {
          attempts += 1;
          const sessionId = row.sessionId;
          if (!sessionId) break;
          const repairPrompt = await renderTemplate(schema.repair.prompt ?? DEFAULT_REPAIR_PROMPT, {
            ...view,
            schema: JSON.stringify(schema.jsonSchema, null, 2),
            value: JSON.stringify(candidate ?? null, null, 2),
            errors: validation.errors,
            attempt: attempts,
          });
          const repairSession = harness.resume(
            sessionId,
            { prompt: repairPrompt, outputSchema: schema.jsonSchema },
            timeout.signal,
          );
          const repairResult = await consume(ctx, repairSession, row);
          usage = addUsage(usage, repairResult.usage);
          result = {
            ...result,
            items: [...result.items, ...repairResult.items],
            finalText: repairResult.finalText,
          };
          candidate = repairResult.structured ?? jsonOrText(repairResult.finalText);
          validation = validateJson(schema.jsonSchema, candidate);
        }
        if (validation.ok) {
          structured = toJson(candidate);
        } else if (schema.repair.onFailure === 'continue-raw') {
          structured = toJson(candidate);
        } else {
          throw new RunFailureError(
            'OUTPUT_SCHEMA_MISMATCH',
            `harness output does not match the required schema: ${validation.errors.join('; ')}`,
            {
              nodeId: ctx.node.id,
              details: { errors: validation.errors, value: toJson(candidate) },
            },
          );
        }
      }

      // Build the patch: transcript artifact, messages, output, usage.
      const patch: PatchOperation[] = [];
      let working = ctx.thread;
      if (config.output.captureTranscript === 'artifact') {
        const stored = await ctx.ports.artifacts.put('transcript', JSON.stringify(result.items));
        patch.push({
          op: 'add',
          path: '/artifacts/-',
          value: toJson({
            id: ctx.services.newId(),
            kind: 'transcript',
            ref: stored.ref,
            nodeId: ctx.node.id,
            bytes: stored.bytes,
            label: `transcript ${ctx.node.id}`,
          }),
        });
      }
      if (config.output.toMessages !== 'none') {
        if (config.output.toMessages === 'final-and-notes') {
          for (const item of result.items) {
            const note = noteFor(item);
            if (note) patch.push(messagePatch(makeMessage(ctx, 'note', note, ['harness-note'])));
          }
        }
        patch.push(messagePatch(makeMessage(ctx, 'assistant', result.finalText)));
      }
      patch.push(
        ...outputPatch(
          working,
          ctx.node.id,
          structured ?? jsonOrText(result.finalText),
          ctx.services.now(),
        ),
      );
      patch.push(...usagePatch(working, usage));
      working = applyPatch(working, patch);

      if (config.output.transforms.length) {
        const transformed = await runMutations(ctx, working, config.output.transforms);
        patch.push(...transformed.patch);
      }

      row.status = 'finished';
      row.updatedAt = ctx.services.now();
      await ctx.ports.sessions.upsert({ ...row });
      return { kind: 'done', patch, route: 'out' };
    } catch (error) {
      if (!(error instanceof RunCancelledError)) {
        row.status = 'failed';
        row.updatedAt = ctx.services.now();
        await ctx.ports.sessions.upsert({ ...row });
      }
      throw error;
    } finally {
      timeout.dispose();
    }
  },
};
