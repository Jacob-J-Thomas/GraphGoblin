import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
let ownIdentity: Promise<string> | undefined;

/** Creation time is an OS process identity, not the time the lock was written. */
export async function windowsProcessIdentity(pid: number): Promise<string | undefined> {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
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
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 },
    );
    const identity = stdout.trim();
    return /^[1-9][0-9]{16,18}$/.test(identity) ? identity : undefined;
  } catch {
    // A failed/denied/timed-out probe is never proof that a lock is stale.
    return undefined;
  }
}

/** Cache only ourselves: another PID can be reused between successive observations. */
export async function ownWindowsProcessIdentity(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  ownIdentity ??= windowsProcessIdentity(process.pid).then((identity) => {
    if (!identity) {
      ownIdentity = undefined;
      throw new Error(
        'Cannot establish Windows process identity. Check that Windows Management Instrumentation and PowerShell are available, then retry.',
      );
    }
    return identity;
  });
  return ownIdentity;
}
