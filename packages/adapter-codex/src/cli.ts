import { spawn } from 'node:child_process';
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

/** `codex --version` and `codex login status`, folded into a preflight result. Never throws. */
export async function preflightCli(
  cli: CliCommand | undefined,
  run: CliRunner,
  timeoutMs: number,
): Promise<HarnessPreflight> {
  if (!cli) {
    return {
      ok: false,
      authenticated: false,
      problems: [
        'Codex CLI not found: @openai/codex is not installed with its platform binary; reinstall dependencies or set codexBinary',
      ],
    };
  }
  const problems: string[] = [];
  const versionRun = await run(cli, ['--version'], timeoutMs);
  if (versionRun.spawnError !== undefined || versionRun.code !== 0) {
    const reason =
      versionRun.spawnError ?? (versionRun.output.trim() || `exit ${String(versionRun.code)}`);
    return {
      ok: false,
      authenticated: false,
      problems: [`Codex CLI could not be run (${cli.command}): ${reason}`],
    };
  }
  const match = /(\d+\.\d+\.\d+\S*)/.exec(versionRun.output);
  const version = match?.[1] ?? versionRun.output.trim();

  const loginRun = await run(cli, ['login', 'status'], timeoutMs);
  const text = loginRun.output;
  const authenticated =
    loginRun.spawnError === undefined &&
    loginRun.code === 0 &&
    /logged in/i.test(text) &&
    !/not logged in/i.test(text);
  if (!authenticated) {
    problems.push(
      loginRun.spawnError !== undefined
        ? `codex login status failed: ${loginRun.spawnError}`
        : 'Codex CLI is not logged in; run `codex login`',
    );
  }
  return { ok: problems.length === 0, version, authenticated, problems };
}
