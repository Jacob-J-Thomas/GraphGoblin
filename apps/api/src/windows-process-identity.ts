import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
let ownIdentity: Promise<string> | undefined;
export type ProcessIdentity =
  { identity: string; reason?: never } | { identity?: never; reason: string };

/** Creation time is an OS process identity, not the time the lock was written. */
export async function windowsProcessIdentity(
  pid: number,
  timeout = 5000,
): Promise<ProcessIdentity> {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0)
    return { reason: 'Windows process identity is unavailable on this platform or for this PID' };
  try {
    const { stdout } = await execute(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference='Stop'; $owner=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -ne $owner.CreationDate) { $owner.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture) }`,
      ],
      { windowsHide: true, timeout, maxBuffer: 1024 },
    );
    const identity = stdout.trim();
    return /^[1-9][0-9]{16,18}$/.test(identity)
      ? { identity }
      : { reason: 'WMI returned no valid process creation identity' };
  } catch (error) {
    // A failed/denied/timed-out probe is never proof that a lock is stale.
    if (error instanceof Error && 'killed' in error && error.killed)
      return { reason: `Windows process identity query timed out after ${timeout} ms` };
    if (error instanceof Error && 'code' in error && typeof error.code === 'string')
      return {
        reason: `PowerShell process identity query could not start or complete (${error.code})`,
      };
    return { reason: 'Windows Management Instrumentation process identity query failed' };
  }
}

/** Cache only ourselves: another PID can be reused between successive observations. */
export async function ownWindowsProcessIdentity(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  ownIdentity ??= (async () => {
    let reason = '';
    // At most 40 seconds, inside the launcher's default 60-second startup budget.
    // Only our own immutable identity is cached; foreign probes remain short and fail closed.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await windowsProcessIdentity(process.pid, 20_000);
      if (result.identity !== undefined) return result.identity;
      reason = result.reason;
    }
    ownIdentity = undefined;
    throw new Error(
      `Cannot establish Windows process identity: ${reason}. Check that Windows Management Instrumentation and PowerShell are available, then retry.`,
    );
  })();
  return ownIdentity;
}
