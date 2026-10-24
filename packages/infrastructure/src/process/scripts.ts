import { spawn, type ChildProcess } from 'node:child_process';
import type { ScriptPort, ScriptRunRequest, ScriptRunResult } from '@graphgoblin/engine';
import { BoundedOutputCapture } from './output-capture.js';

export interface ProcessScriptsOptions {
  /** Cap on captured stdout and stderr, each. Default 10 MiB. */
  maxOutputBytes?: number;
  /** Environment the script inherits before the request's own variables are applied. Default: this process's environment. */
  baseEnv?: NodeJS.ProcessEnv;
  /** Injected for tests. */
  spawnImpl?: typeof spawn;
  platform?: NodeJS.Platform;
}

/**
 * Kill a process and everything it started. Windows has no process groups or POSIX signals, so
 * `taskkill /T /F` is used there; elsewhere the child was started detached as a group leader and
 * the whole group is signalled.
 */
export function killTree(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  spawnImpl: typeof spawn = spawn,
): Promise<boolean> {
  if (child.pid === undefined) return Promise.resolve(true);
  if (platform === 'win32') {
    return new Promise((resolve) => {
      let killer: ChildProcess;
      try {
        killer = spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        try {
          child.kill();
        } catch {
          /* no confirmed root cleanup */
        }
        resolve(false);
        return;
      }
      // Killing just the root is best effort; it never establishes tree cleanup.
      killer.once('error', () => {
        try {
          child.kill();
        } catch {
          /* no confirmed root cleanup */
        }
        resolve(false);
      });
      killer.once('close', (code) => resolve(code === 0));
    });
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
    return Promise.resolve(true);
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* no confirmed root cleanup */
    }
    return Promise.resolve(false);
  }
}

export class ProcessScripts implements ScriptPort {
  private readonly maxOutputBytes: number;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly spawnImpl: typeof spawn;
  private readonly platform: NodeJS.Platform;

  constructor(options: ProcessScriptsOptions = {}) {
    this.maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
    this.baseEnv = options.baseEnv ?? process.env;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.platform = options.platform ?? process.platform;
  }

  run(request: ScriptRunRequest): Promise<ScriptRunResult> {
    if (request.signal.aborted)
      return Promise.resolve({
        exitCode: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        stdoutBytes: 0,
        stderrBytes: 0,
        stdoutOverflow: false,
        stderrOverflow: false,
      });
    const stdout = new BoundedOutputCapture(request.maxStdoutBytes ?? this.maxOutputBytes);
    const stderr = new BoundedOutputCapture(request.maxStderrBytes ?? this.maxOutputBytes);
    return new Promise((resolve) => {
      const child = this.spawnImpl(request.command, request.args, {
        cwd: request.cwd,
        env: { ...(request.inheritEnv === false ? {} : this.baseEnv), ...request.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: this.platform !== 'win32',
        shell: false,
      });

      let timedOut = false;
      let settled = false;
      let killing: Promise<boolean> | undefined;
      let closed = false;
      let treeConfirmed = false;
      let closeCode: number | null = null;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      child.stdout?.on('data', (chunk: Buffer) => {
        if (!settled) stdout.append(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (!settled) stderr.append(chunk);
      });

      const kill = (): void => {
        if (settled || killing) return;
        // Five seconds bounds acknowledgement of explicit native termination, not normal drain.
        cleanupTimer = setTimeout(() => finish(null, false, true), 5000);
        killing = killTree(child, this.platform, this.spawnImpl);
        void killing.then((confirmed) => {
          if (!confirmed) finish(null, false, true);
          else {
            treeConfirmed = true;
            if (closed) finish(closeCode);
          }
        });
      };
      const timer =
        request.timeoutMs !== undefined
          ? setTimeout(() => {
              timedOut = true;
              kill();
            }, request.timeoutMs)
          : undefined;
      const onAbort = (): void => kill();
      const finish = (
        exitCode: number | null,
        spawnFailed = false,
        terminationUnconfirmed = false,
      ): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        clearTimeout(cleanupTimer);
        request.signal.removeEventListener('abort', onAbort);
        const errorText = stderr.text();
        resolve({
          exitCode,
          ...(terminationUnconfirmed ? { terminationUnconfirmed: true as const } : {}),
          timedOut,
          stdout: stdout.text(),
          stdoutBytes: stdout.byteLength,
          stderrBytes: stderr.byteLength,
          stderr:
            spawnFailed && request.maxStderrBytes === undefined
              ? `${errorText}${errorText ? '\n' : ''}spawn failed: PROCESS_START_FAILED`
              : errorText,
          stderrOverflow: stderr.overflow,
          stdoutOverflow: stdout.overflow,
        });
      };

      child.on('error', () => {
        finish(null, true);
      });
      child.on('close', (code) => {
        closed = true;
        closeCode = code;
        if (!killing || treeConfirmed) finish(code);
      });

      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener('abort', onAbort, { once: true });
      if (child.stdin) {
        child.stdin.on('error', () => undefined);
        if (request.stdin !== undefined) child.stdin.end(request.stdin);
        else child.stdin.end();
      }
    });
  }
}
