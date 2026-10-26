// QA tooling for the targeted re-check of D1 and D2 on dca4272b, not product code. It reuses the
// original record's helpers (../lib.mjs) and writes its logs into this folder.
import { execFile, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BIN_DIR, Log as BaseLog, ROOT, TMP, sanitize } from '../lib.mjs';

export * from '../lib.mjs';

export const RECHECK_DIR = dirname(fileURLToPath(import.meta.url));
export const ORIGINAL_DIR = resolve(RECHECK_DIR, '..');

/** The original Log, saving into this folder instead of the original record's folder. */
export class Log extends BaseLog {
  save() {
    this.line('');
    this.line(`SUMMARY ${this.name}: ${this.passes} passed, ${this.failures.length} failed`);
    for (const failure of this.failures) this.line(`  FAILED: ${failure}`);
    writeFileSync(join(RECHECK_DIR, `${this.name}.log.txt`), sanitize(this.lines.join('\n')) + '\n');
  }
}

/** Compile the original record's AF_UNIX socket helper once. */
export async function afUnixTool() {
  const exe = join(BIN_DIR, 'afunix.exe');
  if (existsSync(exe)) return exe;
  mkdirSync(BIN_DIR, { recursive: true });
  await promisify(execFile)(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -Path '${join(ORIGINAL_DIR, 'af-unix-socket.cs')}' -OutputAssembly '${exe}' -OutputType ConsoleApplication`],
    { windowsHide: true },
  );
  return exe;
}

/** Create a Windows AF_UNIX socket file at `path` (bound from its folder: sockaddr_un is 108 bytes). */
export async function socketFile(path) {
  const { stdout } = await promisify(execFile)(await afUnixTool(), [basename(path)], {
    windowsHide: true,
    cwd: dirname(path),
  });
  return `${stdout.trim()} in ${dirname(path)}`;
}

/** The physical system temp directory, as the reset resolves it. */
export const TEMP_ROOT = realpathSync(TMP);

/** gg-reset-store-* entries in the temp directory. */
export const copies = () => readdirSync(TEMP_ROOT).filter((name) => name.startsWith('gg-reset-store-'));

/** The reset's identity construction (tree.ts identityFrom): volume root | dev:ino, bigint lstat. */
export function identityOf(path) {
  const stats = lstatSync(path, { bigint: true });
  return `${parse(resolve(path)).root.toLowerCase()}|${String(stats.dev)}:${String(stats.ino)}`;
}

/** The owner marker of a copy directory, or undefined. */
export function marker(name) {
  try {
    return JSON.parse(readFileSync(join(TEMP_ROOT, name, 'owner.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Whether `pid` is alive (only ESRCH proves death). */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

/**
 * Node processes of this worktree whose command line runs the reset's store reader (copy owner)
 * or SQLite worker, from Win32_Process. Returns [{ pid, role, commandLine }].
 */
export function readerProcesses() {
  const script = `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'store-facts-(reader|worker)' } | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const worktree = ROOT.toLowerCase();
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [pid, commandLine] = line.split('\t');
      return { pid: Number(pid), role: /store-facts-worker/.test(commandLine) ? 'worker' : 'owner', commandLine };
    })
    .filter((p) => p.commandLine.toLowerCase().includes(worktree.replaceAll('/', '\\')) || p.commandLine.toLowerCase().includes(worktree));
}

/** A PID that has certainly exited: spawn a trivial process and wait for it. */
export function deadPid() {
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const pid = Number(result.stdout);
  if (alive(pid)) throw new Error(`pid ${pid} is unexpectedly alive`);
  return pid;
}
