import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
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

function pidState(pid: number): { state: 'alive' | 'dead' } | { state: 'unknown'; reason: string } {
  try {
    process.kill(pid, 0);
    return { state: 'alive' };
  } catch (error) {
    // Permission denied and unrecognised errors cannot establish that the owner died.
    if (hasCode(error, 'ESRCH')) return { state: 'dead' };
    const reason = error instanceof Error && 'code' in error ? String(error.code) : 'unknown error';
    return { state: 'unknown', reason: `PID liveness probe failed (${reason})` };
  }
}

const held = (path: string, detail?: string): Error =>
  new Error(
    detail && !detail.startsWith('another GraphGoblin process')
      ? `${detail}: ${path}`
      : `another GraphGoblin process holds ${path}; check its port/configuration or let startup/shutdown finish`,
  );
type OwnerState = { state: 'absent' | 'stale' } | { state: 'held'; detail: string };
const unknown = (detail: string): OwnerState => ({
  state: 'held',
  detail: `Store ownership could not be verified (${detail})`,
});
const live = (): OwnerState => ({
  state: 'held',
  detail:
    'another GraphGoblin process holds this store; check its port/configuration or let startup/shutdown finish',
});

/**
 * Who owns a lock file, read-only: `absent`, `stale` (its recorded PID is dead, or is this
 * process's own PID without an in-process hold, or a provably reused Windows PID), or `held`. Malformed records and PIDs that cannot
 * be checked count as held: they cannot establish that the owner died.
 */
async function lockFileState(path: string, token?: string): Promise<OwnerState> {
  let owner: unknown;
  try {
    const existing = await readFile(path, 'utf8');
    try {
      owner = JSON.parse(existing);
    } catch {
      return unknown('malformed or incomplete owner record');
    }
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { state: 'absent' };
    throw error;
  }
  if (
    typeof owner !== 'object' ||
    owner === null ||
    !('pid' in owner) ||
    typeof owner.pid !== 'number' ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    (token !== undefined && (!('token' in owner) || owner.token !== token))
  )
    return unknown('malformed or incomplete owner record');
  if (owner.pid === process.pid) return heldPaths.has(path) ? live() : { state: 'stale' };
  const processState = pidState(owner.pid);
  if (processState.state === 'dead') return { state: 'stale' };
  if (
    'windowsCreationTime' in owner &&
    typeof owner.windowsCreationTime === 'string' &&
    /^[1-9][0-9]{16,18}$/.test(owner.windowsCreationTime)
  ) {
    const current = await windowsProcessIdentity(owner.pid);
    if (current.identity === undefined) return unknown(current.reason);
    if (current.identity !== owner.windowsCreationTime) return { state: 'stale' };
    return live();
  }
  if (processState.state === 'unknown') return unknown(processState.reason);
  return process.platform === 'win32'
    ? unknown('live PID without a verifiable process creation identity')
    : live();
}

async function removeStale(path: string): Promise<void> {
  const state = await lockFileState(path);
  if (state.state === 'held') throw held(path, state.detail);
  if (state.state === 'stale') await unlink(path);
}

const markerPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;

type CleanupOperation =
  | 'stale-marker-unlink'
  | 'recovery-marker-unlink'
  | 'recovery-directory-remove'
  | 'staging-marker-unlink'
  | 'staging-directory-remove';

function filesystemFailure(error: unknown, operation: CleanupOperation, path: string): Error {
  const code = error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN';
  return Object.assign(
    new Error(`Store ownership ${operation} failed (${code}): ${path}`, { cause: error }),
    {
      code,
      operation,
      markerToken: markerPattern.exec(basename(path))?.[1] ?? null,
    },
  );
}

function cleanupFailure(primary: unknown, cleanup: unknown[], detail: string): AggregateError {
  return new AggregateError(
    [primary, ...cleanup],
    `${primary instanceof Error ? primary.message : 'Store acquisition failed'}; ${detail}`,
  );
}

async function removedConcurrently(path: string, error: unknown): Promise<boolean> {
  if (process.platform !== 'win32' || !hasCode(error, 'EPERM')) return false;
  return lstat(path).then(
    () => false,
    (probeError: unknown) => hasCode(probeError, 'ENOENT'),
  );
}

async function removeMarker(path: string, operation: CleanupOperation): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return;
    // Windows can return EPERM when another process already deleted this exact UUID marker.
    // Establish absence independently; never retry unlink, or delete a successor's marker.
    if (operation === 'stale-marker-unlink' && (await removedConcurrently(path, error))) return;
    throw filesystemFailure(error, operation, path);
  }
}

async function recoveryState(path: string): Promise<OwnerState & { marker?: string }> {
  if (heldPaths.has(path)) return live();
  try {
    const info = await lstat(path);
    // Old file guards and links are not converted or followed.
    if (!info.isDirectory() || info.isSymbolicLink())
      return unknown('reclamation guard is not a physical directory with one valid owner marker');
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.length === 0) return { state: 'stale' };
    const entry = entries[0];
    const match = entry && markerPattern.exec(entry.name);
    if (entries.length !== 1 || !entry?.isFile() || !match)
      return unknown('reclamation guard is not a physical directory with one valid owner marker');
    const marker = join(path, entry.name);
    const state = await lockFileState(marker, match[1]);
    return state.state === 'held' ? state : { state: 'stale', marker };
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { state: 'absent' };
    if (hasCode(error, 'ENOTDIR'))
      return unknown('reclamation guard is not a physical directory with one valid owner marker');
    throw error;
  }
}

async function removeEmptyRecovery(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    // A newly published owner's marker makes its directory nonempty. Never remove it.
    if (await removedConcurrently(path, error)) return;
    if (!hasCode(error, 'ENOENT') && !hasCode(error, 'ENOTEMPTY') && !hasCode(error, 'EEXIST'))
      throw filesystemFailure(error, 'recovery-directory-remove', path);
  }
}

/** Publish a nonempty guard atomically, so stale readers cannot unlink a replacement owner. */
async function acquireRecovery(path: string, record: string, token: string): Promise<DataDirLock> {
  const staging = `${path}.${token}.tmp`;
  const name = `${token}.json`;
  const stagedMarker = join(staging, name);
  await mkdir(staging, { mode: 0o700 });
  let published = false;
  try {
    await writeFile(stagedMarker, record, { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; attempt < 8; attempt++) {
      const observed = await recoveryState(path);
      if (observed.state === 'held') throw held(path, observed.detail);
      if (observed.marker) {
        // The immutable UUID name belongs only to the observed acquisition, never its successor.
        await removeMarker(observed.marker, 'stale-marker-unlink');
      }
      await removeEmptyRecovery(path);
      try {
        // Both contenders publish NONEMPTY directories: rename cannot overwrite an owner.
        await rename(staging, path);
        published = true;
        heldPaths.add(path);
        let releasing: Promise<void> | undefined;
        return {
          release() {
            releasing ??= (async () => {
              try {
                const marker = join(path, name);
                if ((await readFile(marker, 'utf8')) === record) {
                  await removeMarker(marker, 'recovery-marker-unlink');
                  await removeEmptyRecovery(path);
                }
              } catch (error) {
                if (!hasCode(error, 'ENOENT')) throw error;
              }
              // A failed release still owns its marker. Keep the in-process hold fail-closed.
              heldPaths.delete(path);
            })();
            return releasing;
          },
        };
      } catch (error) {
        if (
          !['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'ENOTDIR'].some((code) =>
            hasCode(error, code),
          )
        )
          throw error;
      }
    }
    throw held(path);
  } catch (error) {
    if (!published) {
      const cleanup: unknown[] = [];
      await removeMarker(stagedMarker, 'staging-marker-unlink').catch((cleanupError: unknown) =>
        cleanup.push(cleanupError),
      );
      await rmdir(staging).catch((cleanupError: unknown) => {
        cleanup.push(filesystemFailure(cleanupError, 'staging-directory-remove', staging));
      });
      if (cleanup.length) throw cleanupFailure(error, cleanup, 'staging cleanup also failed');
    }
    throw error;
  }
}

/**
 * Whether acquiring the data-directory lock now would be refused, without creating, reclaiming or
 * removing anything. `held` names the lock (or its reclamation guard) a live owner holds.
 */
export async function dataDirLockState(
  dataDir: string,
  filename = 'graphgoblin.lock',
): Promise<{ state: 'free' } | { state: 'held'; path: string; detail: string }> {
  const path = resolve(canonicalPath(dataDir), filename);
  const recovery = `${path}.reclaim`;
  if (heldPaths.has(recovery) || acquiringPaths.has(path))
    return {
      ...live(),
      state: 'held',
      path: recovery,
      detail: 'another GraphGoblin process is acquiring this store',
    };
  const guard = await recoveryState(recovery);
  if (guard.state === 'held') return { ...guard, path: recovery };
  const owner = heldPaths.has(path) ? live() : await lockFileState(path);
  if (owner.state === 'held') return { ...owner, path };
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
        }
        heldPaths.delete(path);
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
    const token = randomUUID();
    const record = JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      windowsCreationTime: await ownWindowsProcessIdentity(),
      token,
    });
    // Take the guard even if the main file is missing after a crash during reclamation.
    const recovery = await acquireRecovery(`${path}.reclaim`, record, token);
    const file = await acquireFile(path, record).catch(async (error: unknown) => {
      try {
        await recovery.release();
      } catch (cleanup) {
        throw cleanupFailure(error, [cleanup], 'reclamation cleanup also failed');
      }
      throw error;
    });
    try {
      await recovery.release();
    } catch (cleanup) {
      try {
        await file.release();
      } catch (rollback) {
        throw cleanupFailure(
          cleanup,
          [rollback],
          `main-lock rollback also failed; ownership remains held: ${path}`,
        );
      }
      throw new Error(`Store acquisition rolled back because reclamation cleanup failed: ${path}`, {
        cause: cleanup,
      });
    }
    return file;
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
