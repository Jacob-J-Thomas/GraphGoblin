import { spawn } from 'node:child_process';
import { killTree } from '../process/index.js';
import { ClaudeHarnessError } from './errors.js';
import { cliFailureState } from '@graphgoblin/domain';
import type { HarnessReadinessState } from '@graphgoblin/contracts';
export interface ClaudeProcessRequest {
  binary: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  signal: AbortSignal;
  timeoutMs: number | null;
  maxOutputBytes: number;
  /** Ephemeral diagnostic inference is permitted only for no-turn prerequisite probes. */
  classifyDiagnostics?: true;
}
export interface ClaudeProcessResult {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
  aborted: boolean;
  overflow: boolean;
  spawnCode?: 'ENOENT' | 'EACCES' | 'UNKNOWN';
  /** Kill deadline elapsed without the child's close event; never treat this as successful cancellation. */
  terminationUnconfirmed?: true;
  stdinFailed?: boolean;
  callbackError?: ClaudeHarnessError;
  /** Fixed classification only; stdout/stderr diagnostic bodies are never retained here. */
  failureState?: HarnessReadinessState;
  /** Fixed pre-turn refusal inferred only from bounded CLI stderr, never model stdout. */
  turnRejection?: 'arguments' | 'auth' | 'session-missing';
}
export type ClaudeCliRunner = (
  request: ClaudeProcessRequest,
  onStdout?: (chunk: Buffer) => void,
) => Promise<ClaudeProcessResult>;
/** Own every child and its descendants, with no shell, bounded capture and fixed diagnostic codes. */
export const runClaudeProcess = (
  request: ClaudeProcessRequest,
  onStdout?: (chunk: Buffer) => void,
  /** Optional ephemeral observer; stderr is never retained in the result. */
  onStderr?: (chunk: Buffer) => void,
): Promise<ClaudeProcessResult> =>
  new Promise((resolve) => {
    const empty = { exitCode: null, stdout: '', timedOut: false, aborted: false, overflow: false };
    if (request.signal.aborted) {
      resolve({ ...empty, aborted: true });
      return;
    }
    const child = spawn(request.binary, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      bytes = 0,
      settled = false,
      timedOut = false,
      overflow = false,
      stdinFailed = false;
    let callbackError: ClaudeHarnessError | undefined, spawnCode: ClaudeProcessResult['spawnCode'];
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let diagnostic = '';
    let rejection: ClaudeProcessResult['turnRejection'];
    const finish = (exitCode: number | null, terminationUnconfirmed = false): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      request.signal.removeEventListener('abort', kill);
      resolve({
        exitCode,
        stdout,
        timedOut,
        aborted: request.signal.aborted,
        overflow,
        ...(terminationUnconfirmed ? { terminationUnconfirmed: true } : {}),
        ...(spawnCode ? { spawnCode } : {}),
        ...(exitCode !== 0 && rejection ? { turnRejection: rejection } : {}),
        ...(stdinFailed ? { stdinFailed } : {}),
        ...(callbackError ? { callbackError } : {}),
        ...(request.classifyDiagnostics && exitCode !== 0 && diagnostic
          ? { failureState: cliFailureState(diagnostic) }
          : {}),
      });
    };
    const kill = (): void => {
      if (settled) return;
      clearTimeout(timer);
      killTree(child);
      if (!killTimer) killTimer = setTimeout(() => finish(null, true), 5000);
    };
    const timer =
      request.timeoutMs === null
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            kill();
          }, request.timeoutMs);
    request.signal.addEventListener('abort', kill, { once: true });
    const collect = (chunk: Buffer, output: boolean): void => {
      if (settled || overflow || callbackError) return;
      bytes += chunk.byteLength;
      if (bytes > request.maxOutputBytes) {
        overflow = true;
        kill();
        return;
      }
      try {
        // Keep only stderr in this ephemeral window. Turn stdout can contain authored/model text.
        // No-turn probe stdout is classified separately by the harness inspection path.
        if (!output) {
          diagnostic = (diagnostic + chunk.toString('utf8')).slice(-8192);
          if (/^(?:Error: )?No conversation found with session ID:/im.test(diagnostic))
            rejection = 'session-missing';
          else if (/^error: (?:unknown option|unexpected argument)/im.test(diagnostic))
            rejection = 'arguments';
          else if (
            /^(?:Error: )?(?:Not logged in|Invalid API key|Authentication required)\b/im.test(
              diagnostic,
            )
          )
            rejection = 'auth';
        }
        if (output) {
          stdout += chunk.toString('utf8');
          onStdout?.(chunk);
        } else onStderr?.(chunk);
      } catch (error) {
        callbackError =
          error instanceof ClaudeHarnessError
            ? error
            : new ClaudeHarnessError('HARNESS_PROTOCOL_ERROR', 'Claude stream parser failed');
        kill();
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stderr?.on('data', (chunk: Buffer) => collect(chunk, false));
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnCode =
        error.code === 'ENOENT' ? 'ENOENT' : error.code === 'EACCES' ? 'EACCES' : 'UNKNOWN';
      finish(null);
    });
    child.on('close', (code) => finish(code));
    child.stdin?.on('error', () => {
      stdinFailed = true;
      kill();
    });
    child.stdin?.end(request.stdin ?? '');
  });
