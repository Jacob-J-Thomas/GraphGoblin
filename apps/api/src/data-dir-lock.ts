import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

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

/**
 * One API writer per local data directory, before database or recovery work. A PID that cannot
 * be verified dead is never displaced. PID reuse therefore refuses safely. The short-lived
 * recovery guard serializes stale-file replacement so contenders cannot unlink a new owner.
 */
export async function acquireDataDirLock(dataDir: string): Promise<DataDirLock> {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, 'graphgoblin.lock');
  const record = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: randomUUID(),
  });
  const held = (file = path): Error => new Error(`another GraphGoblin process holds ${file}`);
  const create = async (): Promise<DataDirLock> => {
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(record, 'utf8');
    } catch (error) {
      await file.close();
      await unlink(path);
      throw error;
    }
    await file.close();
    let releasing: Promise<void> | undefined;
    return {
      release() {
        releasing ??= (async () => {
          try {
            // A delayed or repeated release must not remove a replacement lock.
            if ((await readFile(path, 'utf8')) === record) await unlink(path);
          } catch (error) {
            if (!hasCode(error, 'ENOENT')) throw error;
          }
        })();
        return releasing;
      },
    };
  };
  try {
    return await create();
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }

  const recoveryPath = `${path}.reclaim`;
  const recovery = await open(recoveryPath, 'wx', 0o600).catch((error: unknown) => {
    if (hasCode(error, 'EEXIST')) throw held(recoveryPath);
    throw error;
  });
  try {
    await recovery.writeFile(record, 'utf8');
    let existing: string | undefined;
    try {
      existing = await readFile(path, 'utf8');
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    if (existing !== undefined) {
      let owner: unknown;
      try {
        owner = JSON.parse(existing);
      } catch {
        throw held();
      }
      if (
        typeof owner !== 'object' ||
        owner === null ||
        !('pid' in owner) ||
        typeof owner.pid !== 'number' ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid <= 0 ||
        pidIsAlive(owner.pid)
      )
        throw held();
      await unlink(path);
    }
    return await create().catch((error: unknown) => {
      if (hasCode(error, 'EEXIST')) throw held();
      throw error;
    });
  } finally {
    await recovery.close();
    await unlink(recoveryPath);
  }
}
