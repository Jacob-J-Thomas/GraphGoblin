import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

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

async function removeStale(path: string): Promise<void> {
  let owner: unknown;
  try {
    const existing = await readFile(path, 'utf8');
    try {
      owner = JSON.parse(existing);
    } catch {
      throw held(path);
    }
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return;
    throw error;
  }
  if (
    typeof owner !== 'object' ||
    owner === null ||
    !('pid' in owner) ||
    typeof owner.pid !== 'number' ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    (owner.pid === process.pid ? heldPaths.has(path) : pidIsAlive(owner.pid))
  )
    throw held(path);
  await unlink(path);
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
 * this PID is stale unless held here (container restarts reuse PIDs); other PIDs must be dead.
 * The short-lived recovery guard follows the same rule after interrupted reclamation.
 */
export async function acquireDataDirLock(dataDir: string): Promise<DataDirLock> {
  const path = resolve(dataDir, 'graphgoblin.lock');
  // Reserve pending acquisitions too, before any asynchronous filesystem operation.
  if (heldPaths.has(path) || acquiringPaths.has(path)) throw held(path);
  acquiringPaths.add(path);
  try {
    await mkdir(dataDir, { recursive: true });
    const record = JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
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
