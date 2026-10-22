import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cliFailureState,
  readinessDetail,
  readinessFailure,
  readinessMessage,
} from '@graphgoblin/domain';
import type { HarnessReadinessState, PromptSubmission } from '@graphgoblin/contracts';
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
function failureState(error: unknown): Exclude<HarnessReadinessState, 'ready'> {
  const failure = error;
  if (!(failure instanceof ClaudeHarnessError)) return 'unknown';
  switch (failure.code) {
    case 'HARNESS_NOT_INSTALLED':
      return 'cli-missing';
    case 'HARNESS_CLI_INCOMPATIBLE':
    case 'HARNESS_UNSUPPORTED_POLICY':
      return 'cli-incompatible';
    case 'HARNESS_NOT_AUTHENTICATED':
      return 'auth';
    case 'HARNESS_QUOTA_EXHAUSTED':
      return 'quota';
    case 'HARNESS_TRANSPORT_FAILED':
      return 'transport';
    default:
      return 'unknown';
  }
}
/** Fresh names tried before a run of name collisions fails the check. */
const PROBE_DIRECTORY_ATTEMPTS = 4;
/**
 * A fresh, exclusively created, empty directory for the version, help and auth checks. Not
 * `fs.mkdtemp`: on Windows it hands its prefix to the OS without the long-path namespace and fails
 * with ENAMETOOLONG from 248 characters (247 still works), while `mkdir` and starting the CLI there
 * still work up to the 258-character working-directory limit (#102,
 * docs/qa/2026-10-19-wp-f5-launch-diagnosis.md). A name that already exists is never reused or
 * removed; a few fresh names are tried instead.
 */
async function probeDirectory(): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const directory = join(tmpdir(), `gg-claude-probe-${randomBytes(4).toString('hex')}`);
    try {
      await mkdir(directory, { mode: 0o700 });
      return directory;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
        attempt === PROBE_DIRECTORY_ATTEMPTS
      )
        throw error;
    }
  }
}
/**
 * Turns and no-turn probes share the failure order. A probe's messages are single detail
 * sentences about the check (preflight adds the one next step); turn messages are unchanged.
 */
function checkOutcome(result: ClaudeProcessResult, signal: AbortSignal, probe = false): void {
  if (result.terminationUnconfirmed)
    throw new ClaudeHarnessError(
      'HARNESS_TERMINATION_UNCONFIRMED',
      probe
        ? 'Claude CLI check process did not confirm that it stopped.'
        : 'Claude process termination was not confirmed; stop the installed CLI before retrying',
    );
  if (signal.aborted || result.aborted) throw abortError();
  if (result.spawnCode)
    throw new ClaudeHarnessError(
      result.spawnCode === 'ENOENT' ? 'HARNESS_NOT_INSTALLED' : 'HARNESS_TURN_FAILED',
      !probe
        ? 'The installed Claude executable could not be started; check its path and permissions'
        : result.spawnCode === 'ENOENT'
          ? 'Claude CLI was not found at the configured path.'
          : `Claude CLI could not be started (${result.spawnCode}).`,
    );
  if (result.timedOut)
    throw new ClaudeHarnessError(
      'HARNESS_TIMEOUT',
      probe ? 'Claude CLI did not answer before the check deadline.' : 'Claude process timed out',
      true,
    );
  if (result.overflow)
    throw new ClaudeHarnessError(
      'HARNESS_OUTPUT_LIMIT',
      probe
        ? 'Claude CLI printed more output than the check accepts.'
        : 'Claude process output exceeded the configured limit',
    );
  if (result.callbackError) throw result.callbackError;
  if (probe && result.exitCode !== 0 && result.failureState && result.failureState !== 'unknown') {
    const codes: Partial<
      Record<HarnessReadinessState, ConstructorParameters<typeof ClaudeHarnessError>[0]>
    > = {
      auth: 'HARNESS_NOT_AUTHENTICATED',
      quota: 'HARNESS_QUOTA_EXHAUSTED',
      transport: 'HARNESS_TRANSPORT_FAILED',
      'cli-incompatible': 'HARNESS_CLI_INCOMPATIBLE',
    };
    throw new ClaudeHarnessError(
      codes[result.failureState] ?? 'HARNESS_TURN_FAILED',
      readinessDetail('claude', result.failureState),
      result.failureState === 'transport',
    );
  }
  if (probe && (result.stdinFailed || result.exitCode !== 0))
    throw new ClaudeHarnessError(
      'HARNESS_TURN_FAILED',
      result.exitCode === null
        ? 'Claude CLI check stopped without an exit code.'
        : `Claude CLI check exited with code ${result.exitCode}.`,
    );
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
      state: 'unknown',
      ok: false,
      problems: [],
      authMethod: null,
      models: claudeModelCapabilities(),
      supportedPolicies: [],
    };
    const failures: unknown[] = [];
    // Unsupported platforms cannot execute this native Windows adapter.
    facts.supportedPolicies = this.supportedPolicies();
    const cwd = await probeDirectory();
    const run = async (args: string[], authStatus = false): Promise<string> => {
      if (signal.aborted) throw abortError();
      const result = await this.runner({
        binary: this.binary,
        args,
        cwd,
        env: this.environment,
        signal,
        timeoutMs: this.options.preflightTimeoutMs ?? 15000,
        maxOutputBytes: 128 * 1024,
        classifyDiagnostics: true,
      });
      // Signed-out status is structured stdout with exit 1 and no stderr on real Claude.
      // Parse it before generic exit handling, but keep timeout/start/termination failures authoritative.
      let auth: unknown;
      if (authStatus) {
        try {
          auth = JSON.parse(result.stdout);
        } catch {
          /* No structured status. */
        }
      }
      if (
        typeof auth === 'object' &&
        auth !== null &&
        (('loggedIn' in auth && auth.loggedIn === false) ||
          ('authMethod' in auth &&
            typeof auth.authMethod === 'string' &&
            auth.authMethod !== '' &&
            auth.authMethod !== 'claude.ai'))
      ) {
        checkOutcome({ ...result, exitCode: 0 }, signal, true);
        facts.authenticated = false;
        throw new ClaudeHarnessError(
          'HARNESS_NOT_AUTHENTICATED',
          'loggedIn' in auth && auth.loggedIn === false
            ? 'Claude is not signed in.'
            : 'Claude is not signed in with a Claude.ai account.',
        );
      }
      // This path runs version/help/auth only; stdout cannot be a model response.
      // Recognised stderr is the CLI's primary error evidence, including conflicts with stdout.
      // An unrelated warning must not hide a recognised stdout failure. Turn stdout is untouched.
      checkOutcome(
        {
          ...result,
          failureState:
            !result.failureState || result.failureState === 'unknown'
              ? cliFailureState(result.stdout)
              : result.failureState,
        },
        signal,
        true,
      );
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
        // A rejected or failing option check names the version; timeouts and causes keep their detail.
        if (
          error instanceof ClaudeHarnessError &&
          (error.code === 'HARNESS_CLI_INCOMPATIBLE' || error.code === 'HARNESS_TURN_FAILED')
        )
          throw new ClaudeHarnessError(
            error.code,
            `Claude CLI ${version ?? '(unknown version)'} failed the --max-turns/--help check.`,
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
      const auth = await run([...SUPPRESSION_ARGS, 'auth', 'status', '--json'], true);
      facts.authMethod = authCategory(auth);
      if (facts.authMethod === null)
        throw new ClaudeHarnessError('HARNESS_TURN_FAILED', readinessDetail('claude', 'unknown'));
      facts.authenticated = true;
    } catch (error) {
      if (failureState(error) === 'auth') facts.authenticated = false;
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
            'Claude readiness check could not remove its temporary folder.',
          ),
        );
    }
    facts.ok = failures.length === 0;
    facts.state = facts.ok ? 'ready' : failureState(failures[0]);
    // One problem per failure: its own detail sentence and the action for its state.
    // Anything other than a typed harness error keeps the generic detail, never its message.
    facts.problems = [
      ...new Set(
        failures.map((error) =>
          readinessMessage(
            'claude',
            failureState(error),
            error instanceof ClaudeHarnessError ? error.message : undefined,
          ),
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
        ...readinessFailure('claude', failureState(error)),
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
      let delivery: PromptSubmission = 'definitely-not-submitted';
      let accepted = false;
      let initialized = false;
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
          // Native missing-session refusals can precede init (CLI 2.1.304). They are not
          // turn output. Await the fixed stderr refusal; never retain the provider error body.
          if (
            !initialized &&
            !accepted &&
            record.type === 'result' &&
            record.is_error === true &&
            record.num_turns === 0
          )
            return;
          const events = accumulator.push(record);
          if (events.some((event) => event.type === 'session')) initialized = true;
          if (events.some((event) => event.type === 'submitted')) accepted = true;
          if (record.type === 'result') {
            // A validated result proves consumption even while the CLI is still alive.
            // Persist that evidence now; usage/completion remain gated by process outcome.
            completionEvents = [];
            for (const event of events) {
              if (event.type === 'submitted') queue.push(event);
              else completionEvents.push(event);
            }
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
        delivery = 'delivery-uncertain';
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
        if (result.spawnCode) delivery = 'definitely-not-submitted';
        // Refusal diagnostics must never conceal an unconfirmed process or a transport cutoff.
        if (
          result.terminationUnconfirmed ||
          result.aborted ||
          result.timedOut ||
          result.overflow ||
          result.callbackError
        )
          checkOutcome(result, controller.signal);
        if (!accepted && result.turnRejection) {
          delivery =
            result.turnRejection === 'session-missing'
              ? 'session-missing'
              : 'definitely-not-submitted';
          if (result.turnRejection === 'session-missing')
            throw new ClaudeHarnessError(
              'HARNESS_SESSION_MISSING',
              'The recorded Claude conversation was not found',
            );
          if (result.turnRejection === 'auth')
            throw new ClaudeHarnessError(
              'HARNESS_NOT_AUTHENTICATED',
              'Claude requires authentication before submitting this turn',
            );
        }
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
            submission: delivery,
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
