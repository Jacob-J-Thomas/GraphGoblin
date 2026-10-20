import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliFailureState, readinessFailure } from '@graphgoblin/domain';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { HarnessPreflight } from '@graphgoblin/engine';

/**
 * Running the Codex CLI directly, for `preflight` only. Sessions go through the SDK.
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
  output: string;
  /** Set when the process could not be started at all (missing binary, permissions). */
  spawnError?: string;
}

export type CliRunner = (cli: CliCommand, args: string[], timeoutMs: number) => Promise<CliResult>;

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

export const runCli: CliRunner = (cli, args, timeoutMs) =>
  new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (result: CliResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(cli.command, [...cli.prefix, ...args], {
      windowsHide: true,
      ...(cli.cwd ? { cwd: cli.cwd } : {}),
      ...(cli.env ? { env: cli.env } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, output, spawnError: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => finish({ code: null, output, spawnError: error.message }));
    child.on('close', (code) => finish({ code, output }));
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

/** Version/help/login only: no prompt, session, or provider model request. */
export async function preflightCli(
  cli: CliCommand | undefined,
  run: CliRunner,
  timeoutMs: number,
): Promise<HarnessPreflight> {
  if (!cli) return readinessFailure('codex', 'cli-missing');
  const cwd = await probeDirectory();
  let result: HarnessPreflight;
  try {
    result = await inspectCli({ ...cli, cwd }, run, timeoutMs);
  } catch {
    result = readinessFailure('codex', 'unknown');
  }
  try {
    await rm(cwd, { recursive: true, force: true });
  } catch {
    // Preserve a typed failed probe if Windows still holds its directory. This is not evidence
    // of an orphan, and does not alter process termination. Leave that disposable directory.
    if (result.state === 'ready') return readinessFailure('codex', 'unknown');
  }
  return result;
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
  if (!/logged in/i.test(login.output) || /not logged in/i.test(login.output))
    return {
      ...readinessFailure('codex', 'auth', 'Codex is not signed in.'),
      authenticated: false,
      version,
    };
  return { state: 'ready', ok: true, version, authenticated: true, problems: [] };
}
