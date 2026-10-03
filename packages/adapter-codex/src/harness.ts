import type { Effort } from '@graphgoblin/contracts';
import {
  describeError,
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
  /** How long `cancel()` waits for the CLI to exit after aborting. Default 5 s. */
  cancelGraceMs?: number;
  /** Injected for tests. Default: `new Codex(options)`. */
  clientFactory?: CodexClientFactory;
  /** Injected for tests. Default: spawn the CLI. */
  cliRunner?: CliRunner;
}

const DEFAULT_MODEL = 'gpt-6-luna';
const DEFAULT_EFFORT: Effort = 'low';

function abortError(): Error {
  return new DOMException('The Codex turn was aborted', 'AbortError');
}

/**
 * `HarnessPort` over `@openai/codex-sdk`.
 *
 * Cancellation: the SDK accepts an `AbortSignal` per turn and passes it to `child_process.spawn`,
 * which kills the CLI process when it fires. The SDK keeps the child private, so no pid is
 * reachable and a GraphGoblin-side tree kill is not possible. It is not needed on Windows: verified
 * on 2026-10-02 (CLI 0.160.0, `workspace-write` and `danger-full-access`) that aborting mid-command
 * also ends the shell command Codex was running, because Codex runs commands inside its own job
 * object. See docs/06-harness-integration.md, "Cancellation".
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
    return preflightCli(cli, this.cliRunner, this.options.preflightTimeoutMs ?? 15_000).catch(
      (error: unknown) => ({
        ok: false,
        authenticated: false,
        problems: [`preflight failed: ${describeError(error)}`],
      }),
    );
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

    let announced: string | undefined;
    const announce = (id: string): void => {
      if (announced === id) return;
      announced = id;
      resolveId(id);
      queue.push({ type: 'session', sessionId: id, mode: resumeId ? 'resumed' : 'fresh' });
    };
    // A resumed session's id is known up front: report it before the CLI even starts.
    if (resumeId) announce(resumeId);

    const pump = async (): Promise<HarnessResult> => {
      try {
        if (controller.signal.aborted) throw abortError();
        const streamed = await thread.runStreamed(turn.prompt, {
          ...(turn.outputSchema ? { outputSchema: turn.outputSchema } : {}),
          signal: controller.signal,
        });
        for await (const event of streamed.events) {
          for (const out of accumulator.push(event)) {
            if (out.type === 'session') announce(out.sessionId);
            else queue.push(out);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) accumulator.fail(describeError(error));
      } finally {
        signal.removeEventListener('abort', onAbort);
      }

      if (controller.signal.aborted) {
        queue.close();
        const error = abortError();
        rejectId(error);
        throw error;
      }
      const outcome = accumulator.finish();
      if (outcome.failure) {
        const { code, message, retriable } = outcome.failure;
        logger?.warn({ code, retriable, sessionId: announced }, `codex turn failed: ${message}`);
        queue.push({ type: 'error', code, message, retriable });
        queue.close();
        const error = Object.assign(new Error(message), { code, retriable });
        rejectId(error);
        throw error;
      }
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

    const grace = this.options.cancelGraceMs ?? 5_000;
    return {
      sessionId,
      events: queue,
      result,
      cancel: async () => {
        controller.abort();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          result.then(
            () => undefined,
            () => undefined,
          ),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, grace);
          }),
        ]);
        clearTimeout(timer);
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
