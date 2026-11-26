import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliFailureState, readinessFailure, readinessMessage } from '@graphgoblin/domain';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { HarnessPreflight } from '@graphgoblin/engine';

/**
 * Running the Codex CLI directly, for `preflight` and the MCP server listing before each turn
 * (isolation.ts). Sessions go through the SDK.
 */

export interface CliCommand {
  command: string;
  /** Arguments placed before the subcommand, e.g. the launcher script when running through node. */
  prefix: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CliResult {
  code: number | null;
  /** stdout and stderr together, in arrival order: preflight reads diagnostics from either. */
  output: string;
  /** stdout alone, for machine-readable output (the MCP listing's JSON). */
  stdout: string;
  /**
   * Set when the process could not be started at all (missing binary, permissions), and for the
   * first failure of one that did start: its deadline or cancellation.
   */
  spawnError?: string;
  /**
   * After a deadline or cancellation, the child this call started did not close within
   * `CLI_CLEANUP_ALLOWANCE_MS`: it, or a process holding its output, may still be running.
   * `spawnError` keeps the first failure. A fact for callers, never text for a client.
   */
  terminationUnconfirmed?: true;
}

/** `signal` ends the call early (the per-turn MCP listing passes the turn's own signal). */
export type CliRunner = (
  cli: CliCommand,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<CliResult>;

/**
 * The CLI the SDK runs when no `codexPathOverride` is given: the `@openai/codex` package the SDK
 * depends on (pinned to the same version). Its `bin/codex.js` launcher starts the same native
 * binary the SDK resolves, so preflight checks exactly what sessions will use.
 */
export function bundledCli(
  resolveSdk: () => string = () => import.meta.resolve('@openai/codex-sdk'),
): CliCommand | undefined {
  try {
    const sdk = fileURLToPath(resolveSdk());
    const launcher = createRequire(sdk).resolve('@openai/codex/bin/codex.js');
    return { command: process.execPath, prefix: [launcher] };
  } catch {
    return undefined;
  }
}

/** A user-supplied binary. A `.js`/`.mjs` launcher runs through this Node. */
export function cliFor(codexBinary: string): CliCommand {
  return /\.m?js$/i.test(codexBinary)
    ? { command: process.execPath, prefix: [codexBinary] }
    : { command: codexBinary, prefix: [] };
}

/**
 * How long a call waits, after its deadline or cancellation asked the child to stop, for that
 * child to close. Separate from, and in addition to, the command's own deadline (#506).
 */
export const CLI_CLEANUP_ALLOWANCE_MS = 2_000;

/** Within the allowance, when a child that has not exited gets the one stronger request. */
const STRONGER_REQUEST_MS = CLI_CLEANUP_ALLOWANCE_MS / 2;

/** The first failure of a cancelled call, in the words Node uses for an aborted spawn. */
const ABORTED = 'The operation was aborted';

/**
 * Runs one CLI command and settles the exact child it started (#506). Ordinary completion
 * resolves from the child's `close`. A deadline or cancellation is the call's first failure: it
 * asks the child to stop, then waits for its `close` within `CLI_CLEANUP_ALLOWANCE_MS`. A child
 * that has not exited halfway through gets one stronger request (`SIGKILL`; on Windows both
 * requests terminate the process); its descendants are not looked for. A later exit code or error
 * never replaces the first failure, and a kill request is never taken as proof of exit: without a
 * `close` in time the result carries `terminationUnconfirmed`. A process that never started (a
 * missing binary) is reported at once, and a call whose signal is already aborted starts nothing.
 * Output arriving after the first failure is drained, not kept. This bounds the orchestration
 * only, not an operating-system call that stalls.
 */
export const runCli: CliRunner = (cli, args, timeoutMs, signal) =>
  new Promise((resolve) => {
    let output = '';
    let stdout = '';
    if (signal?.aborted) {
      resolve({ code: null, output, stdout, spawnError: ABORTED });
      return;
    }
    // No timer or listener exists yet: a synchronous spawn failure rejects and leaves nothing.
    const child = spawn(cli.command, [...cli.prefix, ...args], {
      windowsHide: true,
      ...(cli.cwd ? { cwd: cli.cwd } : {}),
      ...(cli.env ? { env: cli.env } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let settled = false;
    let failure: string | undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (result: CliResult): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    // The first failure stays the result, whatever the child does afterwards.
    const failed = (cause: string, unconfirmed = false): void =>
      finish({
        code: null,
        output,
        stdout,
        spawnError: cause,
        ...(unconfirmed ? { terminationUnconfirmed: true } : {}),
      });
    const terminate = (request: NodeJS.Signals): void => {
      try {
        child.kill(request);
      } catch {
        // A refused request ends nothing; the allowance still bounds the wait for close.
      }
    };
    const stop = (cause: string): void => {
      if (settled || failure !== undefined) return;
      failure = cause;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', onAbort);
      // A child without a pid never started; its spawn error is still on its way.
      if (child.pid === undefined) {
        failed(cause);
        return;
      }
      terminate('SIGTERM');
      timers.push(
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) terminate('SIGKILL');
        }, STRONGER_REQUEST_MS),
        setTimeout(() => failed(cause, true), CLI_CLEANUP_ALLOWANCE_MS),
      );
    };
    const onAbort = (): void => stop(ABORTED);
    const deadline = setTimeout(() => stop(`timed out after ${timeoutMs} ms`), timeoutMs);
    timers.push(deadline);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (failure !== undefined) return;
      const text = chunk.toString('utf8');
      output += text;
      stdout += text;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (failure === undefined) output += chunk.toString('utf8');
    });
    // A child that never started has nothing to wait for. A started child's error, such as a
    // refused kill, leaves its close authoritative.
    child.on('error', (error) => {
      if (child.pid === undefined) {
        failure ??= error.message;
        failed(failure);
      } else stop(error.message);
    });
    child.on('close', (code) => {
      if (failure === undefined) finish({ code, output, stdout });
      else failed(failure);
    });
  });

/** Fresh names tried before collisions fail a no-turn check. */
const PROBE_DIRECTORY_ATTEMPTS = 4;

/**
 * Exclusively create an empty directory for the version/help/login checks. On Windows,
 * `fs.mkdtemp` fails from 248 characters although `mkdir` and CLI working directories still
 * work through 258 characters (docs/qa/2026-10-19-wp-f5-launch-diagnosis.md). An existing name
 * is never reused or removed; try up to four fresh names instead.
 */
async function probeDirectory(): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const directory = join(tmpdir(), `gg-codex-probe-${randomBytes(4).toString('hex')}`);
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
 * Fixed cleanup details (#506), each followed by the `unknown` action. They never carry CLI
 * output, a path or a raw error message.
 */
const CHECK_NOT_STOPPED = 'Codex CLI check process did not confirm that it stopped.';
const PROBE_LEFT = 'Codex readiness check could not remove its temporary folder.';

/**
 * Version/help/login only: no prompt, session, or provider model request. Each check has settled
 * before the next starts, so the probe directory's one removal follows the last check's close, or
 * its spent cleanup allowance. A failed cleanup adds its own problem after the check's own, which
 * keeps its state; a check that passed becomes `unknown`. The removal is not retried.
 */
export async function preflightCli(
  cli: CliCommand | undefined,
  run: CliRunner,
  timeoutMs: number,
): Promise<HarnessPreflight> {
  if (!cli) return readinessFailure('codex', 'cli-missing');
  const cwd = await probeDirectory();
  let notStopped = false;
  const settled: CliRunner = async (...call) => {
    const result = await run(...call);
    if (result.terminationUnconfirmed) notStopped = true;
    return result;
  };
  let result: HarnessPreflight;
  try {
    result = await inspectCli({ ...cli, cwd }, settled, timeoutMs);
  } catch {
    result = readinessFailure('codex', 'unknown');
  }
  const cleanup = notStopped ? [CHECK_NOT_STOPPED] : [];
  try {
    await rm(cwd, { recursive: true, force: true });
  } catch {
    // Leave the disposable directory; another attempt cannot outwait a process still holding it.
    cleanup.push(PROBE_LEFT);
  }
  if (!cleanup.length) return result;
  const problems = cleanup.map((detail) => readinessMessage('codex', 'unknown', detail));
  if (result.state === 'ready') return { state: 'unknown', ok: false, problems };
  return { ...result, problems: [...result.problems, ...problems] };
}

async function inspectCli(
  cli: CliCommand,
  run: CliRunner,
  timeoutMs: number,
): Promise<HarnessPreflight> {
  const probe = cli;
  const execute = async (args: string[]) => {
    const result = await run(probe, args, timeoutMs);
    if (result.spawnError || result.code !== 0) {
      // A failed start or deadline never makes partial diagnostic output authoritative.
      const state =
        result.spawnError !== undefined
          ? /enoent/i.test(result.spawnError)
            ? 'cli-missing'
            : 'unknown'
          : cliFailureState(result.output);
      return { failure: readinessFailure('codex', state === 'ready' ? 'unknown' : state) };
    }
    return { output: result.output };
  };
  const versionRun = await execute(['--version']);
  if (versionRun.failure)
    return versionRun.failure.state === 'cli-incompatible'
      ? readinessFailure('codex', 'cli-incompatible', 'Codex CLI rejected the --version option.')
      : versionRun.failure;
  const version = /(?:^|\s)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=\s|$)/.exec(
    versionRun.output,
  )?.[1];
  // 0.160.0 is the SDK baseline; newer binaries must also advertise the SDK's flags.
  const parts = version?.split(/[.+-]/).slice(0, 3).map(Number);
  // Each detail is one sentence naming the version and the failed flag or check.
  const incompatible = (detail: string): HarnessPreflight => ({
    ...readinessFailure('codex', 'cli-incompatible', detail),
    ...(version ? { version } : {}),
  });
  if (!parts)
    return incompatible(
      'Codex CLI --version did not print a version number; 0.160.0 or newer is required.',
    );
  if (parts[0] === 0 && parts[1]! < 160)
    return incompatible(`Codex CLI ${version} is older than the minimum version 0.160.0.`);
  const help = await execute(['exec', '--help']);
  if (help.failure)
    return help.failure.state === 'cli-incompatible'
      ? incompatible(`Codex CLI ${version} rejected exec --help.`)
      : { ...help.failure, version };
  const flags = help.output.split(/\s+/).map((token) => token.replace(/,$/, ''));
  const required = [
    '--json',
    '--model',
    '--sandbox',
    '--cd',
    '--skip-git-repo-check',
    '--output-schema',
    '--config',
  ];
  const missing = required.filter((flag) => !flags.includes(flag));
  if (missing.length)
    return incompatible(
      `Codex CLI ${version} does not list required exec options: ${missing.join(', ')}.`,
    );
  // --help terminates parsing without executing a resumed turn or creating a session.
  const resume = await execute(['exec', 'resume', '--help']);
  if (resume.failure)
    return resume.failure.state === 'cli-incompatible'
      ? incompatible(`Codex CLI ${version} rejected exec resume --help.`)
      : { ...resume.failure, version };
  if (!/--json\b/.test(resume.output))
    return incompatible(`Codex CLI ${version} does not list --json for exec resume.`);
  const login = await execute(['login', 'status']);
  if (login.failure)
    return {
      ...login.failure,
      ...(login.failure.state === 'auth' ? { authenticated: false } : {}),
      version,
    };
  if (/not logged in/i.test(login.output))
    return {
      ...readinessFailure('codex', 'auth', 'Codex is not signed in.'),
      authenticated: false,
      version,
    };
  // Successful exit alone cannot establish login; preserve the absence of that fact.
  if (!/^\s*logged in\b/im.test(login.output))
    return { ...readinessFailure('codex', 'unknown'), version };
  return { state: 'ready', ok: true, version, authenticated: true, problems: [] };
}
