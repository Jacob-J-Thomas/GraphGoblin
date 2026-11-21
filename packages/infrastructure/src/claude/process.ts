import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute, normalize, resolve as resolvePath } from 'node:path';
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
  /** Readiness diagnostic inference is permitted only for no-turn prerequisite probes. */
  classifyDiagnostics?: true;
}
export interface ClaudeProcessResult {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
  aborted: boolean;
  overflow: boolean;
  /** Set only for an actual spawn refusal: no process was created, so nothing was submitted. */
  spawnCode?: 'ENOENT' | 'EACCES' | 'UNKNOWN';
  /**
   * The cause of a spawn refusal, when the read-only observation made after it established one.
   * Absent when the cause is unknown, including when an observation could not be read.
   */
  startRefusal?: ClaudeStartRefusal;
  /** Kill deadline elapsed without the child's close event; never treat this as successful cancellation. */
  terminationUnconfirmed?: true;
  stdinFailed?: boolean;
  /** A started process's stdout or stderr pipe failed, so its output is incomplete. */
  outputFailed?: true;
  callbackError?: ClaudeHarnessError;
  /** Fixed classification only; stdout/stderr diagnostic bodies are never retained here. */
  failureState?: HarnessReadinessState;
  /** Fixed pre-turn refusal inferred only from bounded CLI stderr, never model stdout. */
  turnRejection?: 'arguments' | 'auth' | 'session-missing';
  /** Positive sign-out text in bounded no-turn stderr; never a retained diagnostic body. */
  notLoggedIn?: true;
}
export type ClaudeCliRunner = (
  request: ClaudeProcessRequest,
  onStdout?: (chunk: Buffer) => void,
) => Promise<ClaudeProcessResult>;
export type ClaudeStartRefusal =
  'executable-missing' | 'working-directory-missing' | 'working-directory-not-directory';
type PathState = 'missing' | 'directory' | 'other' | 'unknown';
async function pathState(path: string): Promise<PathState> {
  try {
    return (await stat(path)).isDirectory() ? 'directory' : 'other';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Only a definite absence counts; access, length or other read faults leave the cause unknown.
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unknown';
  }
}
/**
 * Read-only observation after a spawn refusal (#364). A spawn `ENOENT` does not say which operand
 * failed: Windows also reports a missing, non-folder or overlong working directory that way. An
 * executable counts as missing only for a fully qualified path whose every name Windows process
 * start tries (the path, then with `.com` and `.exe` appended) is absent or a folder; a bare name
 * or relative path is never resolved here. An existing folder is not proof that a process can
 * start in it, so it establishes nothing.
 */
async function observeStartRefusal(
  request: ClaudeProcessRequest,
  code: NonNullable<ClaudeProcessResult['spawnCode']>,
): Promise<ClaudeStartRefusal | undefined> {
  const binary = request.binary;
  if (code === 'ENOENT' && isAbsolute(binary) && resolvePath(binary) === normalize(binary)) {
    const names =
      process.platform === 'win32' ? [binary, `${binary}.com`, `${binary}.exe`] : [binary];
    const states = await Promise.all(names.map(pathState));
    if (states.every((state) => state === 'missing' || state === 'directory'))
      return 'executable-missing';
  }
  const directory = await pathState(request.cwd);
  if (directory === 'missing') return 'working-directory-missing';
  if (directory === 'other') return 'working-directory-not-directory';
  return undefined;
}
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
      stdinFailed = false,
      outputFailed = false;
    let callbackError: ClaudeHarnessError | undefined, spawnCode: ClaudeProcessResult['spawnCode'];
    let startRefusal: ClaudeStartRefusal | undefined;
    let killing: Promise<boolean> | undefined;
    let closed = false;
    let treeConfirmed = false;
    let closeCode: number | null = null;
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
        ...(startRefusal ? { startRefusal } : {}),
        ...(exitCode !== 0 && rejection ? { turnRejection: rejection } : {}),
        ...(stdinFailed ? { stdinFailed } : {}),
        ...(outputFailed ? { outputFailed: true } : {}),
        ...(callbackError ? { callbackError } : {}),
        ...(request.classifyDiagnostics && exitCode !== 0 && diagnostic
          ? { failureState: cliFailureState(diagnostic) }
          : {}),
        ...(request.classifyDiagnostics && /\bnot logged in\b/i.test(diagnostic)
          ? { notLoggedIn: true }
          : {}),
      });
    };
    const kill = (): void => {
      if (settled) return;
      clearTimeout(timer);
      // A refused start has no process to stop: report the refusal now, without its diagnosis.
      if (spawnCode) {
        finish(null);
        return;
      }
      if (killing) return;
      killTimer = setTimeout(() => finish(null, true), 5000);
      killing = killTree(child);
      void killing.then((confirmed) => {
        if (!confirmed) finish(null, true);
        else {
          treeConfirmed = true;
          if (closed) finish(closeCode);
        }
      });
    };
    const timer =
      request.timeoutMs === null
        ? undefined
        : setTimeout(() => {
            // A process that never started cannot have timed out.
            if (!spawnCode) timedOut = true;
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
        // The same bounded buffer supports turn refusals and probe-only sign-out inference;
        // only fixed classifications leave it. Probe stdout is inspected separately by the harness.
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
    // Node has no pid only for a child that never started. Its pipes can still fail afterwards (on
    // Windows from a 260-character working directory, stdout and stderr fail with ENOTCONN); the
    // refusal itself arrives as the child's error event, so those secondary faults are ignored.
    const started = (): boolean => child.pid !== undefined;
    const outputFault = (): void => {
      if (!started()) return;
      outputFailed = true;
      kill();
    };
    child.stdout?.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stderr?.on('data', (chunk: Buffer) => collect(chunk, false));
    child.stdout?.on('error', outputFault);
    child.stderr?.on('error', outputFault);
    child.on('error', (error: NodeJS.ErrnoException) => {
      // Only an actual spawn refusal proves that nothing started. A later error, such as a failed
      // kill, leaves the close and termination outcomes authoritative.
      if (settled || spawnCode || started()) return;
      const code =
        error.code === 'ENOENT' ? 'ENOENT' : error.code === 'EACCES' ? 'EACCES' : 'UNKNOWN';
      spawnCode = code;
      void observeStartRefusal(request, code).then((observed) => {
        startRefusal = observed;
        finish(null);
      });
    });
    child.on('close', (code) => {
      closed = true;
      closeCode = code;
      // After a refusal Node still closes the child; the refusal path settles the result.
      if (spawnCode) return;
      if (!killing || treeConfirmed) finish(code);
    });
    child.stdin?.on('error', () => {
      if (!started()) return;
      stdinFailed = true;
      kill();
    });
    child.stdin?.end(request.stdin ?? '');
  });
