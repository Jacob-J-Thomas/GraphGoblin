import {
  COMMAND_PREVIEW_MAX,
  PROGRESS_SUMMARY_MAX,
  type ContextThread,
  type HarnessId,
  type JsonValue,
  type NodeProgress,
  type PatchOperation,
  type ProgressItemStatus,
  type Usage,
} from '@graphgoblin/contracts';
import { applyPatch, renderTemplate, threadView, validateJson } from '@graphgoblin/domain';
import { RunCancelledError, RunFailureError, describeError, isAbortError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import type {
  HarnessItem,
  HarnessPort,
  HarnessResult,
  HarnessSession,
  HarnessSessionRecord,
  HarnessStartRequest,
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

function progressSummary(item: HarnessItem): string {
  if (item.type === 'error') return 'Harness reported an error';
  if (item.type === 'tool-call') {
    const diagnostic = item.summary.indexOf(' failed: ');
    if (diagnostic >= 0)
      return `${item.summary.slice(0, diagnostic)} failed`.slice(0, PROGRESS_SUMMARY_MAX);
  }
  return item.summary.slice(0, PROGRESS_SUMMARY_MAX);
}

function safeStatus(status: HarnessItem['status']): ProgressItemStatus | undefined {
  return status === 'ok' || status === 'failed' || status === 'running' ? status : undefined;
}

function progressFor(item: HarnessItem): NodeProgress {
  const reportedStatus = safeStatus(item.status);
  if (item.type !== 'command') {
    return {
      item: {
        id: item.id,
        type: item.type,
        summary: progressSummary(item),
        ...(reportedStatus ? { status: reportedStatus } : {}),
      },
    };
  }

  const candidateExitCode = item.exitCode;
  const exitCode =
    typeof candidateExitCode === 'number' && Number.isInteger(candidateExitCode)
      ? candidateExitCode
      : undefined;
  const status: ProgressItemStatus =
    reportedStatus === 'failed' || (exitCode !== undefined && exitCode !== 0)
      ? 'failed'
      : reportedStatus === 'ok' || exitCode === 0
        ? 'ok'
        : 'running';
  return {
    item: {
      id: item.id,
      type: item.type,
      summary: progressSummary(item),
      commandPreview: (item.commandPreview ?? item.summary)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, COMMAND_PREVIEW_MAX),
      ...(exitCode !== undefined ? { exitCode } : {}),
      status,
    },
  };
}

/** Consume a session: record progress and usage, resolve the result, map failures to run failures. */
async function consume(
  ctx: NodeContext<'inference'>,
  session: HarnessSession,
  row: HarnessSessionRecord,
): Promise<HarnessResult> {
  let lastError: { code: string; message: string; retriable: boolean } | undefined;
  const rethrow = (error: unknown): never => {
    if (error instanceof RunFailureError || error instanceof RunCancelledError) throw error;
    const failure = mapHarnessFailure(error, lastError, ctx.node.id, ctx.config.harness);
    if (failure.code === 'HARNESS_TERMINATION_UNCONFIRMED') throw failure;
    if (isAbortError(error) || ctx.signal.aborted) throw new RunCancelledError();
    throw failure;
  };
  // Only iterator-origin failures are provider failures. Persistence in the consumer stays outside.
  async function* events() {
    try {
      yield* session.events;
    } catch (error) {
      rethrow(error);
    }
  }
  for await (const event of events()) {
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
          progress: progressFor(event.item),
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
        lastError = { code: event.code, message: event.message, retriable: event.retriable };
        break;
      case 'turn-complete':
        break;
    }
  }
  try {
    return await session.result;
  } catch (error) {
    return rethrow(error);
  }
}

/** An explicitly returned native candidate stays authoritative, including undefined or null. */
function outputCandidate(result: HarnessResult): unknown {
  return Object.hasOwn(result, 'structured') ? result.structured : jsonOrText(result.finalText);
}

function mapHarnessFailure(
  error: unknown,
  lastError: { code: string; message: string; retriable: boolean } | undefined,
  nodeId: string,
  harness: HarnessId,
): RunFailureError {
  const info = typeof error === 'object' && error !== null ? error : {};
  const reportedCode =
    lastError?.code ?? ('code' in info && typeof info.code === 'string' ? info.code : undefined);
  const reportedRetriable =
    lastError?.retriable ?? ('retriable' in info && info.retriable === true);
  const code = (reportedCode ?? '').toLowerCase();
  const message = lastError?.message ?? describeError(error);
  if (code === 'harness_termination_unconfirmed')
    return new RunFailureError('HARNESS_TERMINATION_UNCONFIRMED', message, {
      nodeId,
      resumable: false,
      details: { adapterCode: reportedCode },
    });
  if (
    [
      'harness_quota_exhausted',
      'usage_limit_reached',
      'insufficient_quota',
      'rate_limit_exceeded',
    ].includes(code)
  )
    return new RunFailureError('HARNESS_QUOTA_EXHAUSTED', message, { nodeId, resumable: true });
  if (['harness_not_authenticated', 'unauthorized', '401', 'not_authenticated'].includes(code))
    return new RunFailureError('HARNESS_NOT_AUTHENTICATED', message, { nodeId, resumable: true });
  if (code === 'harness_not_installed')
    return new RunFailureError('HARNESS_NOT_INSTALLED', message, { nodeId, resumable: true });
  if (code === 'harness_timeout')
    return new RunFailureError('INFERENCE_TIMEOUT', message, { nodeId, resumable: true });
  return new RunFailureError('HARNESS_TURN_FAILED', 'harness turn failed: ' + message, {
    nodeId,
    // Keep Codex's current fallback; Claude emits strict documented retry evidence.
    resumable: harness === 'claude' ? reportedRetriable : true,
    details: { adapterCode: reportedCode ?? null },
  });
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
    const { model, effort } = await ctx.services.resolveModel(
      config.harness,
      config.model,
      config.effort,
    );
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
      if (existing.harness !== config.harness)
        throw new RunFailureError(
          'HARNESS_TURN_FAILED',
          'Interrupted session belongs to another harness family',
          {
            nodeId: ctx.node.id,
            resumable: false,
            details: { adapterCode: 'HARNESS_SESSION_FAMILY_MISMATCH' },
          },
        );
      resumeId = existing.sessionId;
      prompt = CONTINUATION_PROMPT;
    } else {
      prompt = await renderTemplate(config.prompt.template, view);
      if (config.session.policy === 'resume-previous') {
        resumeId = (await ctx.ports.sessions.latestWithSession(ctx.run.id, config.harness))
          ?.sessionId;
      } else if (config.session.policy === 'resume-named') {
        resumeId = (
          await ctx.ports.sessions.byScopeKey(
            `${ctx.thread.run.loopId}:${config.session.key}`,
            config.harness,
          )
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
    const sessionRequest = (next: HarnessTurnRequest): HarnessStartRequest => ({
      workingDirectory,
      model,
      effort,
      options: config.harnessOptions,
      ...(config.capabilities ? { capabilities: config.capabilities } : {}),
      turn: next,
    });
    const timeout = withTimeout(
      ctx.signal,
      config.timeoutSeconds,
      () => new Error('inference timeout'),
    );

    let result: HarnessResult;
    let session: HarnessSession | undefined;
    let usage: Usage = ZERO_USAGE;
    try {
      session = resumeId
        ? harness.resume(resumeId, sessionRequest(turn), timeout.signal)
        : harness.start(sessionRequest(turn), timeout.signal);
      result = await consume(ctx, session, row);
      usage = addUsage(usage, result.usage);

      // Structured output: validate, then repair on the same session as the policy allows.
      let output: JsonValue;
      if (schema) {
        let candidate: unknown = outputCandidate(result);
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
          session = harness.resume(
            sessionId,
            sessionRequest({ prompt: repairPrompt, outputSchema: schema.jsonSchema }),
            timeout.signal,
          );
          const repairResult = await consume(ctx, session, row);
          usage = addUsage(usage, repairResult.usage);
          result = {
            ...result,
            items: [...result.items, ...repairResult.items],
            finalText: repairResult.finalText,
          };
          candidate = outputCandidate(repairResult);
          validation = validateJson(schema.jsonSchema, candidate);
        }
        if (validation.ok) {
          output = toJson(candidate);
        } else if (schema.repair.onFailure === 'continue-raw') {
          output = toJson(candidate);
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
      } else {
        output = jsonOrText(result.finalText);
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
      patch.push(...outputPatch(working, ctx.node.id, output, ctx.services.now()));
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
      let failure = error;
      const unconfirmed = (value: unknown): boolean =>
        value instanceof RunFailureError && value.code === 'HARNESS_TERMINATION_UNCONFIRMED';
      if (session && !unconfirmed(failure)) {
        try {
          await session.cancel();
        } catch (cancelError) {
          const cleanup = mapHarnessFailure(
            cancelError,
            undefined,
            ctx.node.id,
            ctx.config.harness,
          );
          if (unconfirmed(cleanup)) failure = cleanup;
          else {
            // Native Codex cancellation resolves; Claude rejects only for unconfirmed termination.
            // An unrelated cleanup fault cannot replace the primary engine or provider cause.
            ctx.ports.logger.warn(
              { nodeId: ctx.node.id, code: cleanup.code },
              'harness cleanup failed',
            );
          }
        }
      }
      if (!unconfirmed(failure) && timeout.timedOut())
        failure = new RunFailureError(
          'INFERENCE_TIMEOUT',
          'inference exceeded ' + (config.timeoutSeconds ?? 0) + 's',
          { nodeId: ctx.node.id },
        );
      if (!(failure instanceof RunCancelledError)) {
        row.status = 'failed';
        row.updatedAt = ctx.services.now();
        try {
          await ctx.ports.sessions.upsert({ ...row });
        } catch {
          // The primary failure, especially unconfirmed termination, remains actionable.
          ctx.ports.logger.warn(
            { nodeId: ctx.node.id },
            'failed harness status could not be persisted',
          );
        }
      }
      throw failure;
    } finally {
      timeout.dispose();
    }
  },
};
