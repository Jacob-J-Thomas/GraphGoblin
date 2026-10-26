import { readinessFailure } from '@graphgoblin/domain';
import type { Effort } from '@graphgoblin/contracts';
import {
  harnessFailureSubmission,
  type HarnessEvent,
  type HarnessPort,
  type HarnessPreflight,
  type HarnessResult,
  type HarnessSession,
  type HarnessStartRequest,
  type HarnessTurnRequest,
  type Logger,
} from '@graphgoblin/engine';
import {
  Codex,
  type CodexOptions,
  type ThreadEvent,
  type ThreadOptions,
  type TurnOptions,
} from '@openai/codex-sdk';
import { bundledCli, cliFor, preflightCli, runCli, type CliRunner } from './cli.js';
import { TurnAccumulator } from './events.js';
import { clientOptions, threadOptions, type ResolvedSettings } from './options.js';
import { EventQueue } from './queue.js';

/** The slice of the SDK's `Thread` the harness uses. Tests substitute a fixture replayer. */
export interface CodexThreadLike {
  runStreamed(
    input: string,
    options?: TurnOptions,
  ): Promise<{ events: AsyncIterable<ThreadEvent | { type: string }> }>;
}

/** The slice of the SDK's `Codex` client the harness uses. */
export interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
  resumeThread(id: string, options?: ThreadOptions): CodexThreadLike;
}

export type CodexClientFactory = (options: CodexOptions) => CodexClientLike;

export interface CodexHarnessOptions {
  /** Path to a `codex` executable (or a `.js` launcher). Default: the CLI bundled with the SDK. */
  codexBinary?: string;
  logger?: Logger;
  /** Model when a request names none. Default `gpt-6-luna`. */
  model?: string;
  /** Effort when a request names none. Default `low`. */
  effort?: Effort;
  /** Environment for the CLI. Default: inherit this process's environment. */
  env?: Record<string, string>;
  /** Timeout for each preflight CLI call. Default 15 s. */
  preflightTimeoutMs?: number;
  /**
   * Acknowledgement bound after a turn is aborted: the CLI's output must end within it, or the
   * turn fails `HARNESS_TERMINATION_UNCONFIRMED`. Default 5 s, the harness bound of ADR-0049.
   */
  cancelGraceMs?: number;
  /** Injected for tests. Default: `new Codex(options)`. */
  clientFactory?: CodexClientFactory;
  /** Injected for tests. Default: spawn the CLI. */
  cliRunner?: CliRunner;
}

export const DEFAULT_MODEL = 'gpt-6-luna';
const DEFAULT_EFFORT: Effort = 'low';

function abortError(): Error {
  return new DOMException('The Codex turn was aborted', 'AbortError');
}

const TERMINATION_UNCONFIRMED = 'HARNESS_TERMINATION_UNCONFIRMED';

function terminationUnconfirmed(graceMs: number): Error {
  return Object.assign(
    new Error(
      `Codex CLI termination was not confirmed: its output stayed open ${graceMs} ms after the turn was aborted, so a process it started may still be running`,
    ),
    { code: TERMINATION_UNCONFIRMED, retriable: false },
  );
}

/** A turn result rejects only with errors built by this harness, never with a non-object. */
function isTerminationUnconfirmed(error: unknown): boolean {
  return String((error as { code?: unknown }).code).toUpperCase() === TERMINATION_UNCONFIRMED;
}

/**
 * `HarnessPort` over `@openai/codex-sdk`.
 *
 * Cancellation: the SDK accepts an `AbortSignal` per turn and passes it to `child_process.spawn`,
 * which kills the CLI process when it fires. The SDK keeps the child private, so no pid is
 * reachable and a GraphGoblin-side tree kill is not possible. The SDK's event stream ends only when
 * the CLI's stdout closes, which a process the CLI started can hold open after the kill. An aborted
 * turn therefore stops waiting after `cancelGraceMs` and fails `HARNESS_TERMINATION_UNCONFIRMED`
 * instead of waiting for that stream (ADR-0049). Verified on 2026-10-02 (CLI 0.160.0,
 * `workspace-write` and `danger-full-access`) that aborting mid-command also ends the shell command
 * Codex was running, because Codex runs commands inside its own job object. See
 * docs/06-harness-integration.md, "Cancellation".
 */
export class CodexHarness implements HarnessPort {
  readonly id = 'codex' as const;
  private readonly model: string;
  private readonly effort: Effort;
  private readonly clientFactory: CodexClientFactory;
  private readonly cliRunner: CliRunner;

  constructor(private readonly options: CodexHarnessOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.effort = options.effort ?? DEFAULT_EFFORT;
    this.clientFactory = options.clientFactory ?? ((o) => new Codex(o));
    this.cliRunner = options.cliRunner ?? runCli;
  }

  preflight(): Promise<HarnessPreflight> {
    const cli = this.options.codexBinary ? cliFor(this.options.codexBinary) : bundledCli();
    return preflightCli(
      cli && this.options.env ? { ...cli, env: this.options.env } : cli,
      this.cliRunner,
      this.options.preflightTimeoutMs ?? 15_000,
    ).catch(() => readinessFailure('codex', 'unknown'));
  }

  start(request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    return this.run(this.resolve(request), request.turn, signal, undefined);
  }

  /** Resumed turns carry the node's full settings, so `resumeThread` gets the same options as `startThread`. */
  resume(sessionId: string, request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    return this.run(this.resolve(request), request.turn, signal, sessionId);
  }

  private resolve(request: HarnessStartRequest): ResolvedSettings {
    const settings: ResolvedSettings = {
      model: request.model ?? this.model,
      effort: request.effort ?? this.effort,
      options: request.options,
      workingDirectory: request.workingDirectory,
    };
    if (request.capabilities) {
      // Capability profiles (MCP servers, plugins, skills) have no resolver yet; they arrive as
      // slugs only. Pass them through `harnessOptions.configOverrides` until M5 adds profiles.
      this.options.logger?.debug(
        { capabilities: request.capabilities },
        'codex: capability slugs ignored; no capability profile resolver is configured',
      );
    }
    return settings;
  }

  private run(
    settings: ResolvedSettings,
    turn: HarnessTurnRequest,
    signal: AbortSignal,
    resumeId: string | undefined,
  ): HarnessSession {
    const logger = this.options.logger;
    const client = this.clientFactory(
      clientOptions(settings.options, this.options.codexBinary, this.options.env),
    );
    const thread = resumeId
      ? client.resumeThread(resumeId, threadOptions(settings))
      : client.startThread(threadOptions(settings));

    const controller = new AbortController();
    // After an abort the CLI's output must end within the acknowledgement bound. A descendant that
    // inherited its stdout can hold the SDK's stream open after the CLI is killed; then the turn is
    // reported as unconfirmed termination rather than awaited indefinitely.
    const grace = this.options.cancelGraceMs ?? 5_000;
    let finished = false;
    let acknowledgement: ReturnType<typeof setTimeout> | undefined;
    let expire!: (error: Error) => void;
    const expired = new Promise<never>((_resolve, reject) => {
      expire = reject;
    });
    expired.catch(() => undefined);
    controller.signal.addEventListener(
      'abort',
      () => {
        if (!finished)
          acknowledgement = setTimeout(() => expire(terminationUnconfirmed(grace)), grace);
      },
      { once: true },
    );
    const bounded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, expired]);
    const onAbort = (): void => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });

    const queue = new EventQueue<HarnessEvent>();
    const accumulator = new TurnAccumulator(resumeId ? 'resumed' : 'fresh');

    let resolveId!: (id: string) => void;
    let rejectId!: (error: unknown) => void;
    const sessionId = new Promise<string>((resolve, reject) => {
      resolveId = resolve;
      rejectId = reject;
    });
    // The engine reads ids from events; nobody may await this promise, so never leave it unhandled.
    sessionId.catch(() => undefined);

    let accepted = false;
    let nativeResumeId: string | undefined;
    let announced: string | undefined;
    const announce = (id: string): void => {
      if (announced === id) return;
      announced = id;
      resolveId(id);
      queue.push({ type: 'session', sessionId: id, mode: resumeId ? 'resumed' : 'fresh' });
    };
    // A requested handle is provenance, not evidence of reuse. Await native thread.started.

    const pump = async (): Promise<HarnessResult> => {
      let iterator: AsyncIterator<ThreadEvent | { type: string }> | undefined;
      let exhausted = false;
      try {
        if (controller.signal.aborted) throw abortError();
        const streamed = await bounded(
          thread.runStreamed(turn.prompt, {
            ...(turn.outputSchema ? { outputSchema: turn.outputSchema } : {}),
            signal: controller.signal,
          }),
        );
        iterator = streamed.events[Symbol.asyncIterator]();
        for (;;) {
          const step = await bounded(
            iterator.next().catch((error: unknown) => {
              exhausted = true;
              throw error;
            }),
          );
          if (step.done) {
            exhausted = true;
            break;
          }
          const event = step.value;
          for (const out of accumulator.push(event)) {
            if (out.type === 'submitted') accepted = true;
            if (out.type === 'session') {
              if (resumeId && out.sessionId !== resumeId) {
                controller.abort();
                throw Object.assign(new Error('Codex did not resume the requested conversation'), {
                  code: 'HARNESS_SESSION_MISSING',
                  submission: 'session-missing',
                  retriable: false,
                });
              }
              if (resumeId) {
                nativeResumeId = out.sessionId;
                resolveId(out.sessionId);
              } else announce(out.sessionId);
            } else queue.push(out);
          }
        }
      } catch (error) {
        // Even cancellation cannot discard higher-ranked terminal evidence from this boundary.
        accumulator.fail(error);
        // Close the stream as `for await` would. Never await it: after an unconfirmed termination
        // the SDK's generator is still waiting for output that may never end, and its cleanup
        // (closing the reader and killing the CLI) runs whenever that wait ends.
        if (iterator && !exhausted) iterator.return?.().catch(() => undefined);
      } finally {
        finished = true;
        clearTimeout(acknowledgement);
        signal.removeEventListener('abort', onAbort);
      }

      const outcome = accumulator.finish();
      if (
        controller.signal.aborted &&
        outcome.failure?.code.toUpperCase() !== TERMINATION_UNCONFIRMED &&
        outcome.failure?.code.toUpperCase() !== 'HARNESS_SESSION_MISSING'
      ) {
        queue.close();
        const error = abortError();
        rejectId(error);
        throw error;
      }
      if (outcome.failure) {
        const { code, message, retriable } = outcome.failure;
        logger?.warn({ code, retriable, sessionId: announced }, `codex turn failed: ${message}`);
        const fallback =
          !accepted &&
          [
            'HARNESS_NOT_INSTALLED',
            'HARNESS_NOT_AUTHENTICATED',
            'HARNESS_ARGUMENTS_REJECTED',
          ].includes(code)
            ? 'definitely-not-submitted'
            : 'delivery-uncertain';
        const submission = harnessFailureSubmission(outcome.failure, fallback, accepted);
        queue.push({ type: 'error', code, message, retriable, submission });
        queue.close();
        const error = Object.assign(new Error(message), { code, retriable, submission });
        rejectId(error);
        throw error;
      }
      // Initialization alone cannot prove reuse when a missing-session refusal follows it.
      if (nativeResumeId) announce(nativeResumeId);
      queue.close();
      return {
        finalText: outcome.finalText,
        ...(turn.outputSchema ? parseStructured(outcome.finalText) : {}),
        usage: outcome.usage,
        items: outcome.items,
      };
    };
    const result = pump();
    // Consumers may cancel without awaiting the result; keep that from becoming unhandled.
    result.catch(() => undefined);

    return {
      sessionId,
      events: queue,
      result,
      // The acknowledgement bound settles the result after an abort; only unconfirmed termination
      // is a cleanup failure, as for the Claude harness.
      cancel: async () => {
        controller.abort();
        await result.then(
          () => undefined,
          (error: unknown) => {
            if (isTerminationUnconfirmed(error)) throw error;
          },
        );
      },
    };
  }
}

/** With an output schema, Codex's final message is the JSON document. Validation is the engine's. */
function parseStructured(text: string): { structured?: unknown } {
  try {
    return { structured: JSON.parse(text) as unknown };
  } catch {
    return {};
  }
}

export function createCodexHarness(options: CodexHarnessOptions = {}): CodexHarness {
  return new CodexHarness(options);
}
