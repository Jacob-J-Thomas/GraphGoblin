import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { lstat, realpath, readFile, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename } from 'node:path';
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
  /** Only deterministic native Git/GitHub requests may inherit credential-location context. */
  credentialContext?: boolean;
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
export function safeEnvironment(
  environment: NodeJS.ProcessEnv,
  credentialContext = false,
): Record<string, string> {
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
  if (credentialContext)
    for (const name of [
      'SSH_AUTH_SOCK',
      'DBUS_SESSION_BUS_ADDRESS',
      'XDG_RUNTIME_DIR',
      'XDG_CONFIG_HOME',
      'GH_CONFIG_DIR',
    ])
      allowed.add(name);
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
          env: {
            ...safeEnvironment(this.environment, request.credentialContext),
            ...Object.fromEntries(
              Object.entries(request.env ?? {}).filter(
                ([name]) =>
                  !/^(GH_TOKEN|GITHUB_TOKEN|GG_API_KEY)$/i.test(name) &&
                  (request.credentialContext ||
                    !/^(SSH_AUTH_SOCK|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|XDG_CONFIG_HOME|GH_CONFIG_DIR)$/i.test(
                      name,
                    )),
              ),
            ),
          },
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
/** Inspect only a bounded executable header; installed shell/Node shims are never run. */
async function isNativePnpm(path: string, platform: NodeJS.Platform): Promise<boolean> {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (platform === 'win32') {
      if (bytesRead < 64 || header.toString('ascii', 0, 2) !== 'MZ') return false;
      const offset = header.readUInt32LE(60);
      if (offset < 64 || offset > 1048576) return false;
      const signature = Buffer.alloc(4);
      const read = await file.read(signature, 0, 4, offset);
      return read.bytesRead === 4 && signature.equals(Buffer.from([80, 69, 0, 0]));
    }
    if (((await file.stat()).mode & 0o111) === 0) return false;
    if (platform === 'darwin')
      return (
        bytesRead >= 4 &&
        ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(
          header.subarray(0, 4).toString('hex'),
        )
      );
    return (
      bytesRead >= 16 &&
      header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) &&
      [1, 2].includes(header[4] ?? 0) &&
      [1, 2].includes(header[5] ?? 0) &&
      header[6] === 1
    );
  } finally {
    await file.close();
  }
}
export async function gateCommand(
  program: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  directory = process.cwd(),
  platform: NodeJS.Platform = process.platform,
) {
  if (program !== 'pnpm')
    return { program: await nativeExecutable(program, environment), args: [...args] };
  const folders = [
    ...new Set([
      ...(environment.PATH ?? environment.Path ?? '').split(delimiter),
      ...(environment.PNPM_HOME ? [environment.PNPM_HOME] : []),
    ]),
  ].filter(Boolean);
  const packageCandidates = (root: string) =>
    ['bin/pnpm.cjs', 'pnpm.exe', 'pnpm'].map((bin) => join(root, bin));
  const candidates = folders.flatMap((folder) => [
    ...packageCandidates(join(folder, 'node_modules/pnpm')),
    ...packageCandidates(join(folder, 'pnpm')),
    ...packageCandidates(join(dirname(folder), 'node_modules/pnpm')),
    ...packageCandidates(join(dirname(folder), 'lib/node_modules/pnpm')),
    join(folder, 'pnpm'),
  ]);
  const cache =
    environment.COREPACK_HOME ??
    join(
      platform === 'win32'
        ? (environment.LOCALAPPDATA ?? homedir())
        : (environment.XDG_CACHE_HOME ?? join(environment.HOME ?? homedir(), '.cache')),
      'node',
      'corepack',
    );
  let version: string | undefined;
  try {
    const project: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (
      project &&
      typeof project === 'object' &&
      'packageManager' in project &&
      typeof project.packageManager === 'string'
    )
      version = project.packageManager.startsWith('pnpm@')
        ? project.packageManager.slice(5)
        : undefined;
  } catch {
    /* A non-project invocation may use the installed Corepack default. */
  }
  if (version === undefined) {
    try {
      const defaults: unknown = JSON.parse(
        await readFile(join(cache, 'lastKnownGood.json'), 'utf8'),
      );
      if (
        defaults &&
        typeof defaults === 'object' &&
        'pnpm' in defaults &&
        typeof defaults.pnpm === 'string'
      )
        version = defaults.pnpm;
    } catch {
      /* No cache means no Corepack fallback or network download. */
    }
  }
  if (version !== undefined) {
    const pinned = /^(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)(?:\+sha(?:224|512)\.[A-Za-z0-9]+)?$/.exec(
      version,
    )?.[1];
    if (!pinned) return fail('PNPM_LAUNCHER_UNAVAILABLE');
    candidates.push(...packageCandidates(join(cache, 'v1', 'pnpm', pinned)));
  }
  for (const path of candidates) {
    try {
      // Resolve an installed link; never interpret a shell/Corepack wrapper or launch Corepack.
      const resolved = await realpath(path);
      if (!(await lstat(resolved)).isFile()) continue;
      const cjs = basename(resolved) === 'pnpm.cjs' && basename(dirname(resolved)) === 'bin';
      if (!cjs && !['pnpm', 'pnpm.exe'].includes(basename(resolved))) continue;
      const packageRoot = cjs ? dirname(dirname(resolved)) : dirname(resolved);
      const declaredBin = cjs ? 'bin/pnpm.cjs' : basename(resolved);
      const metadataPath = join(packageRoot, 'package.json'),
        metadataFile = await lstat(metadataPath);
      if (!metadataFile.isFile() || metadataFile.size > 65536) continue;
      const metadata: unknown = JSON.parse(await readFile(metadataPath, 'utf8'));
      const pinned = version?.split('+')[0];
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        !('name' in metadata) ||
        metadata.name !== 'pnpm' ||
        !('version' in metadata) ||
        typeof metadata.version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(metadata.version) ||
        (pinned !== undefined && metadata.version !== pinned) ||
        !('bin' in metadata) ||
        !metadata.bin ||
        typeof metadata.bin !== 'object' ||
        !('pnpm' in metadata.bin) ||
        metadata.bin.pnpm !== declaredBin
      )
        continue;
      if (cjs) return { program: await realpath(process.execPath), args: [resolved, ...args] };
      if (await isNativePnpm(resolved, platform)) return { program: resolved, args: [...args] };
    } catch {
      /* try the next installed candidate */
    }
  }
  return fail('PNPM_LAUNCHER_UNAVAILABLE');
}
