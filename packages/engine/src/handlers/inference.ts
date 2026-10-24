import {
  COMMAND_PREVIEW_MAX,
  PROGRESS_SUMMARY_MAX,
  type ContextThread,
  type JsonValue,
  type NodeProgress,
  type PatchOperation,
  type ProgressItemStatus,
  type Usage,
} from '@graphgoblin/contracts';
import { applyPatch, renderTemplate, threadView, validateJson } from '@graphgoblin/domain';
import {
  ArtifactStoreError,
  RunCancelledError,
  RunFailureError,
  describeError,
  isAbortError,
} from '../errors.js';
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
  visitTurn,
  provenance,
  submission,
  recoveryFailure,
  canContinueTurn,
  type PendingTurn,
} from './inference-turn.js';
import {
  mapHarnessFailure,
  isHarnessFailureCode,
  harnessFailureEvidence,
  harnessFailureRank,
  harnessFailureSubmission,
  mergeHarnessFailure,
  type HarnessFailureEvidence,
} from './inference-failure.js';
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

interface TurnFailures {
  evidence?: HarnessFailureEvidence | undefined;
  rejected: boolean;
  acceptanceFailure?: { error: unknown };
  recording: { operation: string; message: string; name?: string; stack?: string }[];
}

function recordingFault(state: TurnFailures, operation: string, error: unknown): void {
  state.recording.push({
    operation,
    message: describeError(error),
    ...(error instanceof Error
      ? { name: error.name, ...(error.stack ? { stack: error.stack } : {}) }
      : {}),
  });
}
function observe(state: TurnFailures, error: unknown): void {
  state.evidence = mergeHarnessFailure(state.evidence, harnessFailureEvidence(error));
}

function requireAcceptanceRecording(state: TurnFailures): void {
  if (state.acceptanceFailure) throw state.acceptanceFailure.error;
}

/** Recording is secondary: it cannot replace the selected evidence or authorize another call. */
async function recordSubmission(
  ctx: NodeContext<'inference'>,
  pending: PendingTurn,
  state: TurnFailures,
  value: Parameters<typeof submission>[2],
  marker?: Parameters<typeof submission>[3],
): Promise<void> {
  try {
    await submission(ctx, pending, value, marker);
  } catch (error) {
    recordingFault(state, 'harness.submission', error);
    if (marker) state.acceptanceFailure = { error };
  }
}

/** Fold every provider boundary into the same invocation's evidence, independently of writes. */
async function consume(
  ctx: NodeContext<'inference'>,
  session: HarnessSession,
  row: HarnessSessionRecord,
  pending: PendingTurn,
  state: TurnFailures,
): Promise<HarnessResult> {
  async function* events() {
    try {
      yield* session.events;
    } catch (error) {
      if (!(error instanceof RunFailureError) || isHarnessFailureCode(error.code)) {
        observe(state, error);
        state.rejected = true;
      }
      throw error;
    }
  }
  for await (const event of events()) {
    switch (event.type) {
      case 'session':
        row.sessionId = event.sessionId;
        pending.sessionId = event.sessionId;
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
      case 'submitted':
        await recordSubmission(ctx, pending, state, 'submitted', event.marker);
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
        observe(state, event);
        await recordSubmission(
          ctx,
          pending,
          state,
          harnessFailureSubmission(state.evidence!, pending.submission, pending.accepted),
        );
        break;
      case 'turn-complete':
        break;
    }
  }
  try {
    return await session.result;
  } catch (error) {
    if (!(error instanceof RunFailureError) || isHarnessFailureCode(error.code)) {
      observe(state, error);
      state.rejected = true;
    }
    throw error;
  }
}

/** An explicitly returned native candidate stays authoritative, including undefined or null. */
function outputCandidate(result: HarnessResult): unknown {
  return Object.hasOwn(result, 'structured') ? result.structured : jsonOrText(result.finalText);
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

    // Provenance comes from this run's open logical visit, never a session repository row.
    const visit = visitTurn(await ctx.services.events(), ctx.node.id);
    let pending = visit.pending;
    let resumeId: string | undefined;
    let prompt: string;
    let promptKind: PendingTurn['turn']['promptKind'] = 'authored';
    if (pending) {
      if (
        pending.submission === 'session-missing' ||
        (pending.submission === 'delivery-uncertain' && !canContinueTurn(pending))
      )
        throw recoveryFailure(pending, ctx.node.id);
      if (pending.submission === 'definitely-not-submitted') {
        prompt = pending.turn.prompt;
        promptKind = pending.turn.promptKind;
        resumeId = pending.turn.resumeSessionId;
      } else {
        resumeId = pending.sessionId;
        prompt = CONTINUATION_PROMPT;
        promptKind = 'continuation';
      }
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
      } else if (config.session.policy === 'resume-own' && visit.completedVisits > 0) {
        const reset = config.session.resetAfterVisits;
        // Pending turns above retain #244's exact retry/continuation and inherited-ID rules,
        // including at a reset boundary. Forks/children have separate run IDs and logs.
        if (reset === undefined || visit.completedVisits % reset !== 0) {
          const previous =
            visit.completedAttempt === undefined
              ? undefined
              : await ctx.ports.sessions.forNodeAttempt(
                  ctx.run.id,
                  ctx.node.id,
                  visit.completedAttempt,
                  config.harness,
                );
          if (!previous?.sessionId)
            throw new RunFailureError(
              'HARNESS_SESSION_MISSING',
              'The completed node visit has no recorded provider session. An explicit fresh-session choice is required.',
              { nodeId: ctx.node.id, resumable: false },
            );
          resumeId = previous.sessionId;
        }
      }
    }
    const beginTurn = (
      text: string,
      kind: PendingTurn['turn']['promptKind'],
      id?: string,
    ): PendingTurn => {
      const turn = {
        visitId: visit.visitId,
        turnId: ctx.services.newId(),
        harness: config.harness,
        prompt: text,
        promptKind: kind,
        ...(id ? { resumeSessionId: id } : {}),
      };
      return {
        turn,
        submission: 'delivery-uncertain',
        accepted: false,
        ...(id ? { sessionId: id } : {}),
      };
    };
    const recordTurn = (task: PendingTurn) =>
      ctx.services.record({ type: 'harness.turn', nodeId: ctx.node.id, ...task.turn });
    // A safe retry retains the original turn identity and exact rendered prompt.
    if (!pending || pending.submission !== 'definitely-not-submitted') {
      pending = beginTurn(prompt, promptKind, resumeId);
      // A crash after this append may occur on either side of invocation: uncertain by default.
    } else {
      // Re-record the same task intent before another invocation. This resets any init-only ID
      // from the refused invocation, so a fresh retry cannot recover into that unused session.
      pending = {
        turn: pending.turn,
        submission: 'delivery-uncertain',
        accepted: false,
        ...(resumeId ? { sessionId: resumeId } : {}),
      };
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
    let invoking = false;
    let intentUnconfirmed = true;
    pending.intentUnconfirmed = true;
    const failures: TurnFailures = { rejected: false, recording: [] };
    let usage: Usage = ZERO_USAGE;
    try {
      // Initial tasks, exact retries and repairs share the same guarded intent boundary.
      await recordTurn(pending);
      intentUnconfirmed = false;
      pending.intentUnconfirmed = false;
      await ctx.ports.sessions.upsert({ ...row });
      if (!harness) {
        throw new RunFailureError(
          'HARNESS_NOT_INSTALLED',
          `harness "${config.harness}" is not configured`,
          { nodeId: ctx.node.id },
        );
      }
      invoking = true;
      // F3's one retry uses F4's selected evidence, including acceptance and recording faults.
      for (let retry = 0; ; retry += 1) {
        session = resumeId
          ? harness.resume(resumeId, sessionRequest(turn), timeout.signal)
          : harness.start(sessionRequest(turn), timeout.signal);
        try {
          result = await consume(ctx, session, row, pending, failures);
          requireAcceptanceRecording(failures);
          failures.evidence = undefined;
          break;
        } catch (error) {
          const selected = mapHarnessFailure(error, failures.evidence, ctx.node.id, config.harness);
          const state = harnessFailureSubmission(
            selected.evidence,
            pending.submission,
            pending.accepted || pending.acceptanceObserved,
          );
          if (
            retry >= 1 ||
            selected.failure.code !== 'HARNESS_TRANSPORT_FAILED' ||
            !selected.evidence.retriable ||
            state !== 'definitely-not-submitted' ||
            failures.acceptanceFailure ||
            failures.recording.length ||
            timeout.signal.aborted
          )
            throw error;
          failures.evidence = selected.evidence;
          try {
            await session.cancel();
          } catch (cleanupError) {
            observe(failures, cleanupError);
            failures.rejected = true;
            throw error;
          }
          await recordSubmission(ctx, pending, failures, state);
          if (failures.recording.length) throw error;
          // Establish the exact retry intent before its fallible append. Recovery must not
          // confuse the retired handle with a new invocation that has not happened yet.
          session = undefined;
          invoking = false;
          pending = {
            turn: pending.turn,
            submission: 'delivery-uncertain',
            accepted: false,
            ...(resumeId ? { sessionId: resumeId } : {}),
            intentUnconfirmed: true,
          };
          intentUnconfirmed = true;
          failures.evidence = undefined;
          failures.rejected = false;
          await recordTurn(pending);
          intentUnconfirmed = false;
          pending.intentUnconfirmed = false;
          invoking = true;
        }
      }
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
          // Establish the repair task and release the completed handle before persistence:
          // an append can commit and then throw, without any repair invocation having started.
          session = undefined;
          invoking = false;
          pending = beginTurn(repairPrompt, 'repair', sessionId);
          intentUnconfirmed = true;
          pending.intentUnconfirmed = true;
          await recordTurn(pending);
          intentUnconfirmed = false;
          pending.intentUnconfirmed = false;
          failures.evidence = undefined;
          failures.rejected = false;
          invoking = true;
          session = harness.resume(
            sessionId,
            sessionRequest({ prompt: repairPrompt, outputSchema: schema.jsonSchema }),
            timeout.signal,
          );
          const repairResult = await consume(ctx, session, row, pending, failures);
          requireAcceptanceRecording(failures);
          failures.evidence = undefined;
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
      let failure: unknown = error;
      if (!session && invoking && !(error instanceof RunCancelledError)) {
        observe(failures, error);
        failures.rejected = true;
      }
      if (intentUnconfirmed) {
        // Establishing the current intent preceded this fallible append. Reconcile only against
        // the real log; a failed read must retain the intent, never restore the completed handle.
        try {
          const turnId = pending.turn.turnId;
          const history = await ctx.ports.events.read(ctx.run.id);
          if (!history.some((event) => event.type === 'harness.turn' && event.turnId === turnId))
            await recordTurn(pending);
          pending.intentUnconfirmed = false;
        } catch (recordError) {
          recordingFault(failures, 'turn.intent.reconcile', recordError);
        }
      }
      const unconfirmed = () =>
        failures.evidence?.code.toUpperCase() === 'HARNESS_TERMINATION_UNCONFIRMED';
      if (session && !unconfirmed()) {
        try {
          await session.cancel();
        } catch (cleanupError) {
          observe(failures, cleanupError);
          // Cleanup participates in the same fold. Safety evidence can supersede an engine
          // failure too; an ordinary cleanup diagnostic cannot replace a non-provider cause.
          if (harnessFailureRank(failures.evidence!) >= 4) failures.rejected = true;
          else
            ctx.ports.logger.warn(
              {
                nodeId: ctx.node.id,
                code: mapHarnessFailure(cleanupError, undefined, ctx.node.id, config.harness)
                  .failure.code,
              },
              'harness cleanup failed',
            );
        }
      }
      if (timeout.timedOut()) {
        observe(failures, {
          code: 'HARNESS_TIMEOUT',
          message: 'inference exceeded ' + (config.timeoutSeconds ?? 0) + 's',
          retriable: true,
        });
        failures.rejected = true;
      }
      if (failures.evidence && (failures.rejected || harnessFailureRank(failures.evidence) >= 4))
        failure = mapHarnessFailure(
          failures.evidence,
          undefined,
          ctx.node.id,
          config.harness,
        ).failure;
      if (
        !unconfirmed() &&
        !timeout.timedOut() &&
        (error instanceof RunCancelledError || isAbortError(error) || ctx.signal.aborted)
      )
        failure = new RunCancelledError();
      if (failure instanceof ArtifactStoreError && failure.code === 'ARTIFACT_WRITE_FAILED')
        failure = new RunFailureError(failure.code, failure.message, {
          nodeId: ctx.node.id,
          details: { ref: failure.ref },
        });
      if (!(failure instanceof RunFailureError) && !(failure instanceof RunCancelledError))
        failure = new RunFailureError('INTERNAL_ERROR', describeError(failure), {
          nodeId: ctx.node.id,
          details:
            failure instanceof Error ? { name: failure.name, stack: failure.stack ?? null } : null,
        });

      // Decide first, persist second. Even a before/after-commit storage exception can only add
      // details.recording; it cannot change cause, submission, cancellation precedence or retry.
      const state =
        failures.rejected && failures.evidence
          ? harnessFailureSubmission(
              failures.evidence,
              session ? pending.submission : 'definitely-not-submitted',
              pending.accepted || pending.acceptanceObserved,
            )
          : session
            ? pending.submission
            : 'definitely-not-submitted';
      await recordSubmission(ctx, pending, failures, state);
      if (!(failure instanceof RunCancelledError)) {
        row.status = 'failed';
        row.updatedAt = ctx.services.now();
        try {
          await ctx.ports.sessions.upsert({ ...row });
        } catch (recordError) {
          recordingFault(failures, 'harness.status', recordError);
        }
      }
      if (failure instanceof RunFailureError) {
        const uncertain = pending.submission === 'delivery-uncertain';
        const missing = pending.submission === 'session-missing';
        const code = missing
          ? 'HARNESS_SESSION_MISSING'
          : uncertain && failure.code === 'HARNESS_TURN_FAILED'
            ? 'HARNESS_DELIVERY_UNCERTAIN'
            : failure.code;
        const details = failure.options.details;
        failure = new RunFailureError(
          code,
          missing
            ? recoveryFailure(pending, ctx.node.id).message
            : uncertain && !canContinueTurn(pending)
              ? failure.message + '. ' + recoveryFailure(pending, ctx.node.id).message
              : failure.message,
          {
            ...failure.options,
            inference: provenance(pending),
            ...(failures.recording.length
              ? {
                  details: {
                    ...(typeof details === 'object' && details !== null && !Array.isArray(details)
                      ? details
                      : { cause: details ?? null }),
                    recording: failures.recording,
                  },
                }
              : {}),
            resumable:
              !missing &&
              (!uncertain || canContinueTurn(pending)) &&
              failure.options.resumable !== false,
          },
        );
      }
      throw failure;
    } finally {
      timeout.dispose();
    }
  },
};
