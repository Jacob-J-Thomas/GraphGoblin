import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HarnessEvent,
  HarnessPreflight,
  HarnessPort,
  HarnessResult,
  HarnessSession,
  HarnessStartRequest,
} from '@graphgoblin/engine';
import { subscriptionEnvironment } from './environment.js';
import { ClaudeHarnessError, abortError } from './errors.js';
import {
  claudePolicy,
  policyArgs,
  resolvedClaudeSettings,
  SUPPRESSION_ARGS,
  type ClaudePolicy,
} from './policy.js';
import {
  ClaudeAccumulator,
  JsonLines,
  authCategory,
  validClaudeSessionId,
  installedClaudeVersion,
  verifyInstalledCapabilities,
} from './protocol.js';
import { runClaudeProcess, type ClaudeCliRunner, type ClaudeProcessResult } from './process.js';
import { EventQueue } from './queue.js';
import { claudeModelCapabilities } from './models.js';
export interface ClaudeHarnessOptions {
  /** User-installed native executable; never installed, downloaded, or substituted by this adapter. */
  binary?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  preflightTimeoutMs?: number;
  turnTimeoutMs?: number;
  maxOutputBytes?: number;
  maxTurns?: number;
  /** Deterministic process transport injection; no provider call is needed for unit tests. */
  runner?: ClaudeCliRunner;
}
export interface ClaudeHarnessPreflight extends HarnessPreflight {
  authMethod: 'claude.ai' | null;
  supportedPolicies: ClaudePolicy[];
}
function checkOutcome(result: ClaudeProcessResult, signal: AbortSignal): void {
  if (result.terminationUnconfirmed)
    throw new ClaudeHarnessError(
      'HARNESS_TERMINATION_UNCONFIRMED',
      'Claude process termination was not confirmed; stop the installed CLI before retrying',
    );
  if (signal.aborted || result.aborted) throw abortError();
  if (result.spawnCode)
    throw new ClaudeHarnessError(
      'HARNESS_NOT_INSTALLED',
      'The installed Claude executable could not be started',
    );
  if (result.timedOut)
    throw new ClaudeHarnessError('HARNESS_TIMEOUT', 'Claude process timed out', true);
  if (result.overflow)
    throw new ClaudeHarnessError(
      'HARNESS_OUTPUT_LIMIT',
      'Claude process output exceeded the configured limit',
    );
  if (result.callbackError) throw result.callbackError;
  if (result.stdinFailed || result.exitCode !== 0)
    throw new ClaudeHarnessError('HARNESS_TURN_FAILED', 'Claude turn failed');
}
/** Structural current HarnessPort implementation; additive HarnessId integration follows the issue 98 cutover. */
export class ClaudeHarness implements HarnessPort {
  readonly id = 'claude' as const;
  private readonly binary: string;
  private readonly runner: ClaudeCliRunner;
  private readonly platform: NodeJS.Platform;
  private readonly environment: NodeJS.ProcessEnv;
  constructor(private readonly options: ClaudeHarnessOptions = {}) {
    this.binary =
      options.binary ??
      join(
        options.env?.USERPROFILE ?? process.env.USERPROFILE ?? homedir(),
        '.local',
        'bin',
        'claude.exe',
      );
    this.runner = options.runner ?? runClaudeProcess;
    this.platform = options.platform ?? process.platform;
    this.environment = subscriptionEnvironment(options.env ?? process.env);
    for (const value of [
      options.preflightTimeoutMs,
      options.turnTimeoutMs,
      options.maxOutputBytes,
      options.maxTurns,
    ])
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
        throw new ClaudeHarnessError(
          'HARNESS_INVALID_CONFIGURATION',
          'Claude process bounds must be positive integers',
        );
  }
  private supportedPolicies(): ClaudePolicy[] {
    return (['read-only', 'danger-full-access'] as const).map((sandbox) =>
      claudePolicy({ sandbox, approval: 'never' }, undefined, this.platform),
    );
  }
  private async inspect(signal: AbortSignal): Promise<{
    facts: ClaudeHarnessPreflight;
    failures: unknown[];
  }> {
    const facts: ClaudeHarnessPreflight = {
      ok: false,
      authenticated: false,
      problems: [],
      authMethod: null,
      models: claudeModelCapabilities(),
      supportedPolicies: [],
    };
    const failures: unknown[] = [];
    // Unsupported platforms cannot execute this native Windows adapter.
    facts.supportedPolicies = this.supportedPolicies();
    const cwd = await mkdtemp(join(tmpdir(), 'gg-claude-probe-'));
    const run = async (args: string[]): Promise<string> => {
      if (signal.aborted) throw abortError();
      const result = await this.runner({
        binary: this.binary,
        args,
        cwd,
        env: this.environment,
        signal,
        timeoutMs: this.options.preflightTimeoutMs ?? 15000,
        maxOutputBytes: 128 * 1024,
      });
      checkOutcome(result, signal);
      return result.stdout;
    };
    try {
      const versionText = await run([...SUPPRESSION_ARGS, '--version']);
      const version = installedClaudeVersion(versionText);
      if (version !== undefined) facts.version = version;
      // --max-turns is a hidden CLI option. Parse it alongside --help without starting a turn.
      let help: string;
      try {
        help = await run([...SUPPRESSION_ARGS, '--max-turns', '1', '--help']);
      } catch (error) {
        if (error instanceof ClaudeHarnessError)
          throw new ClaudeHarnessError(
            error.code,
            `Claude CLI ${version ?? 'unknown'}: required capability --max-turns/--help probe failed: ${error.message}`,
            error.retriable,
          );
        throw error;
      }
      verifyInstalledCapabilities(versionText, help);
    } catch (error) {
      failures.push(error);
    }
    // Login is a separate fact, even when the CLI version or policy flags are unsupported.
    try {
      const auth = await run([...SUPPRESSION_ARGS, 'auth', 'status', '--json']);
      facts.authMethod = authCategory(auth);
      facts.authenticated = facts.authMethod === 'claude.ai';
      if (!facts.authenticated)
        throw new ClaudeHarnessError(
          'HARNESS_NOT_AUTHENTICATED',
          'Claude account login is required; run claude auth login',
        );
    } catch (error) {
      failures.push(error);
    }
    try {
      await rm(cwd, { recursive: true, force: true });
    } catch {
      // Cleanup must not hide a still-running native process or another prerequisite failure.
      if (!failures.length)
        failures.push(
          new ClaudeHarnessError(
            'HARNESS_TURN_FAILED',
            'Claude prerequisite workspace cleanup failed',
          ),
        );
    }
    facts.ok = failures.length === 0;
    facts.problems = [
      ...new Set(
        failures.map((error) =>
          error instanceof ClaudeHarnessError ? error.message : 'Claude preflight failed',
        ),
      ),
    ];
    return { facts, failures };
  }
  async preflight(): Promise<ClaudeHarnessPreflight> {
    try {
      return (await this.inspect(new AbortController().signal)).facts;
    } catch (error) {
      return {
        ok: false,
        authenticated: false,
        problems: [error instanceof ClaudeHarnessError ? error.message : 'Claude preflight failed'],
        authMethod: null,
        models: claudeModelCapabilities(),
        supportedPolicies: this.platform === 'win32' ? this.supportedPolicies() : [],
      };
    }
  }
  start(request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    return this.turn(request, signal);
  }
  resume(sessionId: string, request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    return this.turn(request, signal, sessionId);
  }
  private turn(
    request: HarnessStartRequest,
    signal: AbortSignal,
    resumeId?: string,
  ): HarnessSession {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    const queue = new EventQueue<HarnessEvent>();
    let closed = false;
    let resolveId!: (id: string) => void, rejectId!: (error: unknown) => void;
    const sessionId = new Promise<string>((resolve, reject) => {
      resolveId = resolve;
      rejectId = reject;
    });
    sessionId.catch(() => undefined);
    const pump = async (): Promise<HarnessResult> => {
      let detectedVersion: string | undefined;
      try {
        if (controller.signal.aborted) throw abortError();
        if (resumeId !== undefined && !validClaudeSessionId(resumeId))
          throw new ClaudeHarnessError(
            'HARNESS_INVALID_CONFIGURATION',
            'Claude resume requires a valid native session id',
          );
        const policy = claudePolicy(request.options, request.capabilities, this.platform);
        const settings = resolvedClaudeSettings(request);
        const inspection = await this.inspect(controller.signal);
        if (!inspection.facts.ok) throw inspection.failures[0];
        detectedVersion = inspection.facts.version;
        const accumulator = new ClaudeAccumulator({
          policy,
          model: settings.model,
          effort: settings.effort,
          mode: resumeId ? 'resumed' : 'fresh',
          ...(resumeId ? { resumeId } : {}),
          ...(request.turn.outputSchema ? { schema: request.turn.outputSchema } : {}),
        });
        const parser = new JsonLines();
        let completionEvents: HarnessEvent[] = [];
        const accept = (record: Record<string, unknown>): void => {
          const events = accumulator.push(record);
          if (record.type === 'result') {
            completionEvents = events;
            return;
          }
          for (const event of events) {
            if (event.type === 'session') resolveId(event.sessionId);
            queue.push(event);
          }
        };
        const args = [
          ...policyArgs(policy),
          '--model',
          settings.model,
          '--effort',
          settings.effort,
          '--max-turns',
          String(this.options.maxTurns ?? 100),
          '--output-format',
          'stream-json',
          '--verbose',
          ...(resumeId ? ['--resume', resumeId] : []),
          ...(request.turn.outputSchema
            ? ['--json-schema', JSON.stringify(request.turn.outputSchema)]
            : []),
          '--input-format',
          'text',
          '--print',
        ];
        const result = await this.runner(
          {
            binary: this.binary,
            args,
            cwd: request.workingDirectory,
            env: this.environment,
            stdin: request.turn.prompt,
            signal: controller.signal,
            timeoutMs: this.options.turnTimeoutMs ?? 600000,
            maxOutputBytes: this.options.maxOutputBytes ?? 4 * 1024 * 1024,
          },
          (chunk) => {
            for (const record of parser.push(chunk)) accept(record);
          },
        );
        checkOutcome(result, controller.signal);
        for (const record of parser.finish()) accept(record);
        const completed = accumulator.finish();
        for (const event of completionEvents) queue.push(event);
        return completed;
      } catch (error) {
        const failure =
          error instanceof ClaudeHarnessError && error.code === 'HARNESS_TERMINATION_UNCONFIRMED'
            ? error
            : controller.signal.aborted
              ? abortError()
              : error instanceof ClaudeHarnessError
                ? error.code === 'HARNESS_PROTOCOL_ERROR' && detectedVersion !== undefined
                  ? new ClaudeHarnessError(
                      error.code,
                      `Claude CLI ${detectedVersion}: required capability stream-json protocol verification failed: ${error.message}`,
                      error.retriable,
                    )
                  : error.code === 'HARNESS_UNSUPPORTED_POLICY' && detectedVersion !== undefined
                    ? new ClaudeHarnessError(
                        error.code,
                        `Claude CLI ${detectedVersion}: required capability effective launch policy verification failed: ${error.message}`,
                        error.retriable,
                      )
                    : error
                : new ClaudeHarnessError('HARNESS_TURN_FAILED', 'Claude turn failed');
        rejectId(failure);
        if (failure instanceof ClaudeHarnessError)
          queue.push({
            type: 'error',
            code: failure.code,
            message: failure.message,
            retriable: failure.retriable,
          });
        throw failure;
      } finally {
        closed = true;
        signal.removeEventListener('abort', abort);
        queue.close();
      }
    };
    const result = pump();
    result.catch(() => undefined);
    let cancellation: Promise<void> | undefined;
    return {
      sessionId,
      events: queue,
      result,
      cancel: () => {
        if (closed)
          return result.then(
            () => undefined,
            (error: unknown) => {
              if (
                error instanceof ClaudeHarnessError &&
                error.code === 'HARNESS_TERMINATION_UNCONFIRMED'
              )
                throw error;
            },
          );
        cancellation ??= (async () => {
          controller.abort();
          await result.catch((error: unknown) => {
            if (
              error instanceof ClaudeHarnessError &&
              error.code === 'HARNESS_TERMINATION_UNCONFIRMED'
            )
              throw error;
          });
        })();
        return cancellation;
      },
    };
  }
}
