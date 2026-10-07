import { spawn } from 'node:child_process';
import { killTree } from '../process/index.js';
import { ClaudeHarnessError } from './errors.js';
export interface ClaudeProcessRequest {
  binary: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
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
        ...(stdinFailed ? { stdinFailed } : {}),
        ...(callbackError ? { callbackError } : {}),
      });
    };
    const kill = (): void => {
      if (settled) return;
      clearTimeout(timer);
      killTree(child);
      if (!killTimer) killTimer = setTimeout(() => finish(null, true), 5000);
    };
    const timer = setTimeout(() => {
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
