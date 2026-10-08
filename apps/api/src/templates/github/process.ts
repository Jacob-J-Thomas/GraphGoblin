import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fail } from './protocol.js';

export interface CommandRequest {
  program: string;
  args: readonly string[];
  cwd: string;
  env?: Readonly<Record<string, string>>;
  stdin?: string;
  timeoutMs: number;
  maxBytes?: number;
}
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  overflow: boolean;
  termination: 'confirmed' | 'unconfirmed';
}
export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}
type Spawn = (program: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
export function safeEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const allowed = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'LANG',
  ]);
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] =>
        allowed.has(entry[0].toUpperCase()) && entry[1] !== undefined,
    ),
  );
}
export interface ProcessGroups {
  kill(pid: number): void;
  alive(pid: number): boolean;
}
const nativeGroups: ProcessGroups = {
  kill: (pid) => {
    process.kill(-pid, 'SIGKILL');
  },
  alive: (pid) => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
    }
  },
};
/** Native processes only. Uncertain descendant termination is never advertised as confirmed. */
export class NativeCommands implements CommandRunner {
  constructor(
    private readonly spawnProcess: Spawn = spawn,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly killGraceMs = 2000,
    private readonly groups: ProcessGroups = nativeGroups,
  ) {}
  run(request: CommandRequest): Promise<CommandResult> {
    if (/\.(cmd|bat)$/i.test(request.program) || request.args.some((arg) => arg.includes('\0')))
      return Promise.reject(new Error('Native command required.'));
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawnProcess(request.program, [...request.args], {
          cwd: request.cwd,
          env: { ...safeEnvironment(this.environment), ...request.env },
          shell: false,
          windowsHide: true,
          detached: this.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        resolve({
          exitCode: -1,
          stdout: '',
          stderr: '',
          timedOut: false,
          overflow: false,
          termination: 'confirmed',
        });
        return;
      }
      let done = false,
        stopping = false,
        timedOut = false,
        overflow = false;
      let stdout = '',
        stderr = '',
        bytes = 0,
        closed: number | undefined;
      let treeKilled = false;
      let hardStop: ReturnType<typeof setTimeout> | undefined;
      const finish = (exitCode: number, termination: CommandResult['termination']) => {
        if (done) return;
        done = true;
        clearTimeout(deadline);
        if (hardStop) clearTimeout(hardStop);
        resolve({ exitCode, stdout, stderr, timedOut, overflow, termination });
      };
      const confirmedClose = () => {
        if (closed === undefined) return;
        if (this.platform === 'win32') {
          if (!stopping || treeKilled) finish(closed, 'confirmed');
        } else {
          let alive = true;
          try {
            alive = !!child.pid && this.groups.alive(child.pid);
          } catch {
            /* quarantine uncertainty */
          }
          finish(closed, alive ? 'unconfirmed' : 'confirmed');
        }
      };
      const terminate = () => {
        if (stopping || done) return;
        stopping = true;
        hardStop = setTimeout(() => finish(closed ?? -1, 'unconfirmed'), this.killGraceMs);
        if (this.platform === 'win32' && child.pid) {
          const fallback = () => {
            try {
              child.kill('SIGKILL');
            } catch {
              /* hard deadline remains */
            }
          };
          try {
            const killer = this.spawnProcess(
              'taskkill.exe',
              ['/pid', String(child.pid), '/t', '/f'],
              {
                shell: false,
                windowsHide: true,
                stdio: 'ignore',
                env: safeEnvironment(this.environment),
              },
            );
            killer.once('error', fallback);
            killer.once('close', (code) => {
              if (code === 0) {
                treeKilled = true;
                confirmedClose();
              } else fallback(); // Parent close alone cannot establish descendant termination.
            });
          } catch {
            fallback();
          }
        } else {
          try {
            if (child.pid) this.groups.kill(child.pid);
            else child.kill('SIGKILL');
          } catch {
            try {
              child.kill('SIGKILL');
            } catch {
              /* hard deadline remains */
            }
          }
        }
      };
      const deadline = setTimeout(() => {
        timedOut = true;
        terminate();
      }, request.timeoutMs);
      const capture = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
        if (done || stopping) return;
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
        bytes += Buffer.byteLength(text);
        if (bytes > (request.maxBytes ?? 65536)) {
          overflow = true;
          terminate();
          return;
        }
        if (stream === 'stdout') stdout += text;
        else stderr += text;
      };
      child.stdout?.on('data', (chunk: Buffer | string) => capture('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer | string) => capture('stderr', chunk));
      child.once('error', () => {
        if (stopping || child.pid) {
          closed = -1;
          if (!stopping) terminate();
          confirmedClose();
        } else finish(-1, 'confirmed');
      });
      child.once('close', (code) => {
        closed = code ?? -1;
        confirmedClose();
      });
      child.stdin?.on('error', () => terminate());
      child.stdin?.end(request.stdin);
    });
  }
}
export async function nativeExecutable(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (/\.(cmd|bat)$/i.test(name)) fail('NATIVE_PROGRAM_REQUIRED');
  const extensions = process.platform === 'win32' && !/\.exe$/i.test(name) ? ['.exe'] : [''];
  const paths = isAbsolute(name)
    ? [name]
    : (environment.PATH ?? environment.Path ?? '')
        .split(delimiter)
        .flatMap((folder) => extensions.map((ext) => join(folder, name + ext)));
  for (const path of paths) {
    try {
      if ((await lstat(path)).isFile()) return await realpath(path);
    } catch {
      /* try next installed candidate */
    }
  }
  return fail('NATIVE_PROGRAM_UNAVAILABLE');
}
export async function gateCommand(
  program: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (program !== 'pnpm')
    return { program: await nativeExecutable(program, environment), args: [...args] };
  const folders = (environment.PATH ?? environment.Path ?? '').split(delimiter);
  const candidates = folders.flatMap((folder) => [
    join(folder, 'node_modules/pnpm/bin/pnpm.cjs'),
    join(folder, 'pnpm/bin/pnpm.cjs'),
    join(dirname(folder), 'node_modules/pnpm/bin/pnpm.cjs'),
  ]);
  for (const path of candidates) {
    try {
      if ((await lstat(path)).isFile())
        return { program: await realpath(process.execPath), args: [await realpath(path), ...args] };
    } catch {
      /* try next installed candidate */
    }
  }
  return fail('PNPM_LAUNCHER_UNAVAILABLE');
}
