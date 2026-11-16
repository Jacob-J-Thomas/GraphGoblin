import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { canonicalPath } from './canonical-path.js';
import type { AttestedDataDirLock } from './data-dir-lock.js';

export class MacosKeySourceError extends Error {
  constructor() {
    super('The Mac launcher requires a local store and its own master.key.');
  }
}

function isAbsent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** The detached launch supports only the default SQLite file, without URI options. */
export async function macosDatabaseFile(
  dataDir: string,
  dbUrl: string,
  databaseFile: string | undefined,
): Promise<string> {
  if (
    databaseFile !== join(dataDir, 'graphgoblin.db') ||
    !dbUrl.startsWith('file:') ||
    /[?#]/u.test(dbUrl)
  )
    throw new MacosKeySourceError();
  try {
    if (!(await lstat(databaseFile)).isFile()) throw new MacosKeySourceError();
  } catch (error) {
    if (!isAbsent(error)) throw new MacosKeySourceError();
  }
  return databaseFile;
}

/** Check only metadata until both writer leases prove a fresh store or an existing local key. */
export async function requireMacosLocalKey(
  dataDir: string,
  directoryLease: AttestedDataDirLock,
  databaseLease: AttestedDataDirLock,
  hasKeyOverride: boolean,
): Promise<void> {
  const uid = process.geteuid?.();
  if (hasKeyOverride || uid === undefined) throw new MacosKeySourceError();
  try {
    const key = await lstat(join(dataDir, 'master.key'));
    if (key.isFile() && key.uid === uid) return;
    throw new MacosKeySourceError();
  } catch (error) {
    if (!isAbsent(error)) throw new MacosKeySourceError();
  }

  try {
    const physicalDir = canonicalPath(dataDir);
    const entries = new Set(await readdir(physicalDir));
    // Verify acquisitions after enumerating. A substituted file with an identical record still
    // fails its lease proof and neither name, on its own, is a freshness exemption.
    const directory = await directoryLease.verifyOwnedArtifact();
    const database = await databaseLease.verifyOwnedArtifact();
    for (const proof of [directory, database]) {
      if (!proof || dirname(proof.path) !== physicalDir || !entries.delete(basename(proof.path)))
        throw new MacosKeySourceError();
    }
    if (entries.size !== 0) throw new MacosKeySourceError();
  } catch {
    throw new MacosKeySourceError();
  }
}
