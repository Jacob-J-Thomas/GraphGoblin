import { spawn, type ChildProcess } from 'node:child_process';
import type { ScriptPort, ScriptRunRequest, ScriptRunResult } from '@graphgoblin/engine';

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
): void {
  if (child.pid === undefined) return;
  if (platform === 'win32') {
    const killer = spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
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
    return new Promise((resolve) => {
      const child = this.spawnImpl(request.command, request.args, {
        cwd: request.cwd,
        env: { ...this.baseEnv, ...request.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: this.platform !== 'win32',
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const collect = (current: string, chunk: Buffer): string => {
        if (current.length >= this.maxOutputBytes) return current;
        return (current + chunk.toString('utf8')).slice(0, this.maxOutputBytes);
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = collect(stdout, chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = collect(stderr, chunk);
      });

      const kill = (): void => killTree(child, this.platform, this.spawnImpl);
      const timer =
        request.timeoutMs !== undefined
          ? setTimeout(() => {
              timedOut = true;
              kill();
            }, request.timeoutMs)
          : undefined;
      const onAbort = (): void => kill();
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener('abort', onAbort, { once: true });

      const finish = (result: ScriptRunResult): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
        resolve(result);
      };

      child.on('error', (error) => {
        finish({
          exitCode: null,
          stdout,
          stderr: `${stderr}${stderr ? '\n' : ''}spawn failed: ${error.message}`,
          timedOut,
        });
      });
      child.on('close', (code) => {
        finish({ exitCode: code, stdout, stderr, timedOut });
      });

      if (child.stdin) {
        child.stdin.on('error', () => undefined);
        if (request.stdin !== undefined) child.stdin.end(request.stdin);
        else child.stdin.end();
      }
    });
  }
}
