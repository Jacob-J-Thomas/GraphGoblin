import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { canonicalPath } from './canonical-path.js';
import { ownWindowsProcessIdentity, windowsProcessIdentity } from './windows-process-identity.js';

const heldPaths = new Set<string>();
const acquiringPaths = new Set<string>();

export interface DataDirLock {
  /** Release only this acquisition's file. Safe to call more than once. */
  release(): Promise<void>;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Permission denied and unrecognised errors cannot establish that the owner died.
    return !hasCode(error, 'ESRCH');
  }
}

const held = (path: string): Error => new Error(`another GraphGoblin process holds ${path}`);

/**
 * Who owns a lock file, read-only: `absent`, `stale` (its recorded PID is dead, or is this
 * process's own PID without an in-process hold, or a provably reused Windows PID), or `held`. Malformed records and PIDs that cannot
 * be checked count as held: they cannot establish that the owner died.
 */
async function lockFileState(path: string): Promise<'absent' | 'stale' | 'held'> {
  let owner: unknown;
  try {
    const existing = await readFile(path, 'utf8');
    try {
      owner = JSON.parse(existing);
    } catch {
      return 'held';
    }
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return 'absent';
    throw error;
  }
  if (
    typeof owner !== 'object' ||
    owner === null ||
    !('pid' in owner) ||
    typeof owner.pid !== 'number' ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0
  )
    return 'held';
  if (owner.pid === process.pid) return heldPaths.has(path) ? 'held' : 'stale';
  if (!pidIsAlive(owner.pid)) return 'stale';
  if (
    'windowsCreationTime' in owner &&
    typeof owner.windowsCreationTime === 'string' &&
    /^[1-9][0-9]{16,18}$/.test(owner.windowsCreationTime)
  ) {
    const current = await windowsProcessIdentity(owner.pid);
    if (current && current !== owner.windowsCreationTime) return 'stale';
  }
  return 'held';
}

async function removeStale(path: string): Promise<void> {
  const state = await lockFileState(path);
  if (state === 'held') throw held(path);
  if (state === 'stale') await unlink(path);
}

/**
 * Whether acquiring the data-directory lock now would be refused, without creating, reclaiming or
 * removing anything. `held` names the lock (or its reclamation guard) a live owner holds.
 */
export async function dataDirLockState(
  dataDir: string,
  filename = 'graphgoblin.lock',
): Promise<{ state: 'free' } | { state: 'held'; path: string }> {
  const path = resolve(canonicalPath(dataDir), filename);
  for (const file of [`${path}.reclaim`, path])
    if (heldPaths.has(file) || acquiringPaths.has(path) || (await lockFileState(file)) === 'held')
      return { state: 'held', path: file };
  return { state: 'free' };
}

async function acquireFile(path: string, record: string): Promise<DataDirLock> {
  const file = await open(path, 'wx', 0o600).catch(async (error: unknown) => {
    if (!hasCode(error, 'EEXIST')) throw error;
    await removeStale(path);
    return open(path, 'wx', 0o600).catch((retryError: unknown) => {
      if (hasCode(retryError, 'EEXIST')) throw held(path);
      throw retryError;
    });
  });
  heldPaths.add(path);
  try {
    await file.writeFile(record, 'utf8');
  } catch (error) {
    heldPaths.delete(path);
    await file.close();
    await unlink(path);
    throw error;
  } finally {
    await file.close();
  }
  let releasing: Promise<void> | undefined;
  return {
    release() {
      releasing ??= (async () => {
        try {
          // The record includes a random ownership token: never remove a replacement lock.
          if ((await readFile(path, 'utf8')) === record) await unlink(path);
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error;
        } finally {
          heldPaths.delete(path);
        }
      })();
      return releasing;
    },
  };
}

/**
 * One API writer per local data directory, before database or recovery work. A lock naming
 * this PID is stale unless held here (container restarts reuse PIDs); other PIDs must be dead
 * or have a different, verified Windows creation identity.
 * The short-lived recovery guard follows the same rule after interrupted reclamation.
 */
export async function acquireDataDirLock(
  dataDir: string,
  filename = 'graphgoblin.lock',
): Promise<DataDirLock> {
  const path = resolve(canonicalPath(dataDir), filename);
  // Reserve pending acquisitions too, before any asynchronous filesystem operation.
  if (heldPaths.has(path) || acquiringPaths.has(path)) throw held(path);
  acquiringPaths.add(path);
  try {
    await mkdir(dataDir, { recursive: true });
    const record = JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      windowsCreationTime: await ownWindowsProcessIdentity(),
      token: randomUUID(),
    });
    // Take the guard even if the main file is missing after a crash during reclamation.
    const recovery = await acquireFile(`${path}.reclaim`, record);
    try {
      return await acquireFile(path, record);
    } finally {
      await recovery.release();
    }
  } finally {
    acquiringPaths.delete(path);
  }
}

/** A shared external SQLite file has one owner even when data directories differ. */
export async function acquireDatabaseLock(databaseFile: string): Promise<DataDirLock> {
  const file = canonicalPath(databaseFile);
  const info = await stat(file).catch((error: unknown) => {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (info && info.nlink > 1)
    throw new Error(
      `database ${file} has multiple hard links; use one ordinary SQLite file so GraphGoblin can establish exclusive ownership`,
    );
  return acquireDataDirLock(dirname(file), `${basename(file)}.graphgoblin.lock`);
}

export function databaseLockState(databaseFile: string): ReturnType<typeof dataDirLockState> {
  const file = canonicalPath(databaseFile);
  return dataDirLockState(dirname(file), `${basename(file)}.graphgoblin.lock`);
}
