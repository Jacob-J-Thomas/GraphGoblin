import { randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
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
import {
  cleanupStep,
  vettedCode,
  withStartupCleanup,
  type RetainedOwnership,
  type StartupCleanupFailure,
} from './startup-cleanup.js';
import { ownWindowsProcessIdentity, windowsProcessIdentity } from './windows-process-identity.js';

const heldPaths = new Set<string>();
const acquiringPaths = new Set<string>();

/** The data-directory lock's file name. */
export const DATA_DIR_LOCK_FILE = 'graphgoblin.lock';
/** Appended to a lock file's name to name its reclamation guard. */
export const RECLAIM_GUARD_SUFFIX = '.reclaim';
/** The database lock's file name, beside a database file named `databaseFileName`. */
export const databaseLockFileName = (databaseFileName: string): string =>
  `${databaseFileName}.graphgoblin.lock`;

/**
 * What a release found: this acquisition's own record, which it removed; nothing, because the file
 * was already gone; or another record, which it kept.
 */
export type ReleaseOutcome = 'removed' | 'missing' | 'kept';

/** One held lock file or guard: releasing it removes only this acquisition's own record. */
interface Hold {
  /**
   * Release only this acquisition's file. Safe to call more than once; every call resolves to the
   * first call's outcome.
   */
  release(): Promise<ReleaseOutcome>;
}

export interface DataDirLock extends Hold {
  /**
   * The stale entries this acquisition itself removed before taking the lock: a lock file whose
   * owner had exited (`file`), and a `.reclaim` guard's stale owner marker or empty directory
   * (`guard`). An entry another process removed first is never counted.
   */
  readonly reclaimed: { readonly file: boolean; readonly guard: boolean };
}

export interface OwnedWriterArtifact {
  path: string;
  dev: bigint;
  ino: bigint;
}

export interface AttestedDataDirLock extends DataDirLock {
  verifyOwnedArtifact(): Promise<OwnedWriterArtifact | undefined>;
}

interface AttestLocalArtifact {
  attestLocalArtifact: true;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function pidState(
  pid: number,
): { state: 'alive' | 'dead' } | { state: 'unknown'; reason: string; error: unknown } {
  try {
    process.kill(pid, 0);
    return { state: 'alive' };
  } catch (error) {
    // Permission denied and unrecognised errors cannot establish that the owner died.
    if (hasCode(error, 'ESRCH')) return { state: 'dead' };
    const reason = error instanceof Error && 'code' in error ? String(error.code) : 'unknown error';
    return { state: 'unknown', reason: `PID liveness probe failed (${reason})`, error };
  }
}

/** A held or unverifiable store owner: a complete operator explanation. */
export class StoreOwnershipRefusedError extends Error {
  override readonly name = 'StoreOwnershipRefusedError';
}

const held = (path: string, detail?: string): StoreOwnershipRefusedError =>
  new StoreOwnershipRefusedError(
    detail && !detail.startsWith('another GraphGoblin process')
      ? `${detail}: ${path}; inspect the owner record and running GraphGoblin processes; resolve the ownership uncertainty before retrying`
      : `another GraphGoblin process holds ${path}; check its port/configuration; wait for the owning process to finish or stop it before retrying`,
  );
type HeldOwner = { state: 'held'; detail: string };
type OwnerState = { state: 'absent' } | { state: 'stale' } | HeldOwner;
const unknown = (detail: string): HeldOwner => ({
  state: 'held',
  detail: `Store ownership could not be verified (${detail})`,
});
const live = (): HeldOwner => ({
  state: 'held',
  detail:
    'another GraphGoblin process holds this store; check its port/configuration or let startup/shutdown finish',
});

function parseOwnerRecord(record: string, token?: string) {
  let owner: unknown;
  try {
    owner = JSON.parse(record);
  } catch {
    return undefined;
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
    return undefined;
  return {
    pid: owner.pid,
    windowsCreationTime: 'windowsCreationTime' in owner ? owner.windowsCreationTime : undefined,
  };
}

function validWindowsCreationTime(identity: unknown): identity is string {
  return typeof identity === 'string' && /^[1-9][0-9]{16,18}$/.test(identity);
}

/**
 * Who owns a lock file, read-only: `absent`, `stale` (its recorded PID is dead, or is this
 * process's own PID without an in-process hold, or a provably reused Windows PID), or `held`.
 * Malformed records and PIDs that cannot be checked count as held: they cannot establish that
 * the owner died.
 */
async function lockFileState(path: string, token?: string): Promise<OwnerState> {
  let record: string;
  try {
    record = await readFile(path, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { state: 'absent' };
    // Main owner record reads keep their errors: the record can be replaced in place.
    if (token === undefined) throw error;
    // Only recovery markers have immutable names, so only their disappearance is established.
    if (await removedConcurrently(path, error)) return { state: 'absent' };
    throw filesystemFailure(error, 'observed-marker-read', path);
  }
  const owner = parseOwnerRecord(record, token);
  if (!owner) return unknown('malformed or incomplete owner record');
  if (owner.pid === process.pid) return heldPaths.has(path) ? live() : { state: 'stale' };
  const processState = pidState(owner.pid);
  if (processState.state === 'dead') return { state: 'stale' };
  if (validWindowsCreationTime(owner.windowsCreationTime)) {
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

/** Whether this call removed a stale lock file; a held one refuses. */
async function removeStale(path: string): Promise<boolean> {
  const state = await lockFileState(path);
  if (state.state === 'held') throw held(path, state.detail);
  if (state.state !== 'stale') return false;
  await unlink(path);
  return true;
}

const markerPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;

/** Closed labels for recovery filesystem operations whose failure is reported. */
type OwnershipOperation =
  | 'observed-marker-read'
  | 'recovery-marker-read'
  | 'stale-marker-unlink'
  | 'recovery-marker-unlink'
  | 'recovery-directory-remove'
  | 'staging-marker-unlink'
  | 'staging-directory-remove';

/** Read-only checks that can fail while a Windows guard-directory removal failure is classified. */
type RecoveryProbe =
  | 'recovery-directory-lookup'
  | 'successor-inspection'
  | 'successor-liveness'
  | 'successor-identity';

/** A failed probe, not a decision: a credible mismatch or an unverifiable shape adds no entry. */
interface RecoveryProbeFailure {
  readonly operation: RecoveryProbe;
  readonly code: string;
  /** Not enumerable: inspectable in code, but its text stays out of printed output. */
  readonly cause: unknown;
}
type ProbeReport = (failure: RecoveryProbeFailure) => void;

const probeFailure = (
  operation: RecoveryProbe,
  cause: unknown,
  code = vettedCode(cause),
): RecoveryProbeFailure =>
  Object.defineProperty({ operation, code, cause }, 'cause', { enumerable: false });

/**
 * A labelled filesystem failure: the original error is its cause, `code` is vetted, and the marker
 * token comes from the operated path's own name (its original provenance). Probe failures that
 * could not resolve a directory-removal failure are attached as secondary evidence.
 */
function filesystemFailure(
  error: unknown,
  operation: OwnershipOperation,
  path: string,
  probes: readonly RecoveryProbeFailure[] = [],
): Error {
  const code = vettedCode(error);
  return Object.assign(
    new Error(`Store ownership ${operation} failed (${code}): ${path}`, { cause: error }),
    {
      code,
      operation,
      markerToken: markerPattern.exec(basename(path))?.[1] ?? null,
      ...(probes.length ? { probeFailures: probes } : {}),
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

/** Whether this call removed the marker itself, rather than observing its absence. */
async function removeMarker(path: string, operation: OwnershipOperation): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    // Windows can return EPERM when another process already deleted this exact UUID marker.
    // Establish absence independently; never retry unlink, or delete a successor's marker.
    if (operation === 'stale-marker-unlink' && (await removedConcurrently(path, error)))
      return false;
    throw filesystemFailure(error, operation, path);
  }
}

type StaleRecovery = { state: 'stale'; directory: BigIntStats; marker?: string };
type RecoveryObservation = { state: 'absent' | 'marker-absent' } | HeldOwner | StaleRecovery;
const recoveryAttempts = 8;

async function observeRecovery(path: string): Promise<RecoveryObservation> {
  if (heldPaths.has(path)) return live();
  try {
    const info = await lstat(path, { bigint: true });
    // Old file guards and links are not converted or followed.
    if (!info.isDirectory() || info.isSymbolicLink())
      return unknown('reclamation guard is not a physical directory with one valid owner marker');
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.length === 0) return { state: 'stale', directory: info };
    const entry = entries[0];
    const match = entry && markerPattern.exec(entry.name);
    if (entries.length !== 1 || !entry?.isFile() || !match)
      return unknown('reclamation guard is not a physical directory with one valid owner marker');
    const state = await lockFileState(join(path, entry.name), match[1]);
    // The guard can still be present as an empty directory or already hold a new marker.
    if (state.state === 'absent') return { state: 'marker-absent' };
    return state.state === 'stale'
      ? { state: 'stale', directory: info, marker: entry.name }
      : state;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { state: 'absent' };
    if (hasCode(error, 'ENOTDIR'))
      return unknown('reclamation guard is not a physical directory with one valid owner marker');
    throw error;
  }
}

function samePhysicalEntry(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}

/** A guard this caller observed: a stale guard during acquisition, or its own published guard. */
type ObservedGuard = { directory: BigIntStats; marker?: string };

/**
 * Read-only classification of a Windows guard-removal failure. Any uncertainty keeps EPERM. It
 * inspects the physical path, never the in-process `heldPaths` shortcut, so a release can classify
 * the path its own guard occupied. `report` receives failed probes only.
 */
async function hasLiveRecoverySuccessor(
  path: string,
  directory: BigIntStats,
  previous: ObservedGuard,
  ownToken: string,
  report?: ProbeReport,
): Promise<boolean> {
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.ino === 0n ||
    previous.directory.ino === 0n ||
    samePhysicalEntry(directory, previous.directory)
  )
    return false;
  const alive = (pid: number): boolean => {
    const state = pidState(pid);
    if (state.state === 'unknown') report?.(probeFailure('successor-liveness', state.error));
    return state.state === 'alive';
  };
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const entry = entries[0];
    const token = entry && markerPattern.exec(entry.name)?.[1];
    if (
      entries.length !== 1 ||
      !entry?.isFile() ||
      !token ||
      token === ownToken ||
      entry.name === previous.marker
    )
      return false;

    const marker = join(path, entry.name);
    const info = await lstat(marker, { bigint: true });
    if (!info.isFile() || info.ino === 0n || info.nlink !== 1n) return false;
    const matchesMarker = (current: BigIntStats) =>
      current.isFile() &&
      current.nlink === 1n &&
      samePhysicalEntry(info, current) &&
      info.mtimeNs === current.mtimeNs &&
      info.ctimeNs === current.ctimeNs;
    const file = await open(
      marker,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let owner: ReturnType<typeof parseOwnerRecord>;
    try {
      if (!matchesMarker(await file.stat({ bigint: true }))) return false;
      owner = parseOwnerRecord(await file.readFile('utf8'), token);
    } finally {
      await file.close();
    }
    if (
      !owner ||
      owner.pid === process.pid ||
      !validWindowsCreationTime(owner.windowsCreationTime) ||
      !alive(owner.pid)
    )
      return false;
    const current = await windowsProcessIdentity(owner.pid);
    // An unavailable identity is a failed probe; a different identity is a credible mismatch.
    if (current.identity === undefined)
      report?.(probeFailure('successor-identity', current.reason, 'UNKNOWN'));
    if (current.identity !== owner.windowsCreationTime || !alive(owner.pid)) return false;

    // The directory, sole marker and record must survive the asynchronous process identity probe.
    const names = await readdir(path);
    if (
      names.length !== 1 ||
      names[0] !== entry.name ||
      !matchesMarker(await lstat(marker, { bigint: true }))
    )
      return false;
    const finalDirectory = await lstat(path, { bigint: true });
    return (
      finalDirectory.isDirectory() &&
      !finalDirectory.isSymbolicLink() &&
      samePhysicalEntry(directory, finalDirectory)
    );
  } catch (error) {
    report?.(probeFailure('successor-inspection', error));
    return false;
  }
}

function probeRecoveryDirectory(
  path: string,
  report?: ProbeReport,
): Promise<BigIntStats | 'absent' | undefined> {
  return lstat(path, { bigint: true }).catch((error: unknown) => {
    if (hasCode(error, 'ENOENT')) return 'absent';
    report?.(probeFailure('recovery-directory-lookup', error));
    return undefined;
  });
}

/** What a Windows guard-removal `EPERM` may establish about the path this caller observed. */
interface GuardRemoval {
  previous: ObservedGuard;
  token: string;
  /** A verified successor is ordinary contention for acquisition; this caller's release completes. */
  successor: 'held' | 'released';
}

/** Whether this call removed the empty directory at `path`. */
async function removeEmptyRecovery(path: string, removal?: GuardRemoval): Promise<boolean> {
  try {
    await rmdir(path);
    return true;
  } catch (error) {
    // A newly published owner's marker makes its directory nonempty. Never remove it.
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTEMPTY') || hasCode(error, 'EEXIST'))
      return false;
    const probes: RecoveryProbeFailure[] = [];
    if (process.platform === 'win32' && hasCode(error, 'EPERM')) {
      const report: ProbeReport = (failure) => {
        probes.push(failure);
      };
      const directory = await probeRecoveryDirectory(path, report);
      if (directory === 'absent') return false;
      // At most one physical distinction for this removal opportunity; rmdir is never repeated.
      if (directory && removal) {
        if (
          await hasLiveRecoverySuccessor(path, directory, removal.previous, removal.token, report)
        ) {
          if (removal.successor === 'held') throw held(path);
          // The successor holds its own guard. This caller's exclusive main record stays in place.
          return false;
        }
        // A short-lived successor can release while its process creation time is being queried.
        if ((await probeRecoveryDirectory(path, report)) === 'absent') return false;
      }
    }
    throw filesystemFailure(error, 'recovery-directory-remove', path, probes);
  }
}

/** A non-following physical directory with a usable identity, or undefined. */
async function physicalDirectory(path: string): Promise<BigIntStats | undefined> {
  const info = await lstat(path, { bigint: true }).catch(() => undefined);
  return info?.isDirectory() && !info.isSymbolicLink() && info.ino !== 0n ? info : undefined;
}

/**
 * The identity of this caller's just-published guard, observed (lstat, sole own marker, lstat)
 * while its immutable marker is still present. The staged identity is only a consistency check.
 * Unknown, unstable or inconsistent identities give undefined, which never proves a successor.
 * Never throws: publication has already completed.
 */
async function publishedGuard(
  path: string,
  name: string,
  staged: BigIntStats,
): Promise<BigIntStats | undefined> {
  try {
    const before = await physicalDirectory(path);
    if (!before || !samePhysicalEntry(staged, before)) return undefined;
    const names = await readdir(path);
    if (names.length !== 1 || names[0] !== name) return undefined;
    const after = await physicalDirectory(path);
    return after && samePhysicalEntry(before, after) ? after : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Publish a nonempty guard atomically, so stale readers cannot unlink a replacement owner.
 * `reclaimed` says whether this call removed a stale guard's marker or empty directory on the way.
 */
async function acquireRecovery(
  path: string,
  record: string,
  token: string,
): Promise<Hold & { reclaimed: boolean }> {
  const staging = `${path}.${token}.tmp`;
  const name = `${token}.json`;
  const stagedMarker = join(staging, name);
  await mkdir(staging, { mode: 0o700 });
  let published = false;
  let reclaimed = false;
  try {
    await writeFile(stagedMarker, record, { flag: 'wx', mode: 0o600 });
    // Windows only: consistency evidence for the published guard's identity, never a requirement.
    const staged = process.platform === 'win32' ? await physicalDirectory(staging) : undefined;
    for (let attempt = 0; attempt < recoveryAttempts; attempt++) {
      const observed = await observeRecovery(path);
      if (observed.state === 'marker-absent') {
        if (attempt + 1 === recoveryAttempts)
          throw held(
            path,
            unknown(
              'reclamation guard marker disappeared before verification at the acquisition attempt limit',
            ).detail,
          );
        continue;
      }
      if (observed.state === 'held') throw held(path, observed.detail);
      if (observed.state === 'stale') {
        if (observed.marker) {
          // The immutable UUID belongs only to the observed acquisition. If another contender
          // removed it first, re-observe the guard before making any further changes to it.
          if (!(await removeMarker(join(path, observed.marker), 'stale-marker-unlink'))) {
            if (attempt + 1 === recoveryAttempts)
              throw held(
                path,
                unknown(
                  'reclamation guard marker disappeared during removal at the acquisition attempt limit',
                ).detail,
              );
            continue;
          }
          reclaimed = true;
        }
        if (await removeEmptyRecovery(path, { previous: observed, token, successor: 'held' }))
          reclaimed = true;
      }
      try {
        // Both contenders publish NONEMPTY directories: rename cannot overwrite an owner.
        await rename(staging, path);
      } catch (error) {
        if (
          !['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'ENOTDIR'].some((code) =>
            hasCode(error, code),
          )
        )
          throw error;
        continue;
      }
      published = true;
      heldPaths.add(path);
      const own = staged && (await publishedGuard(path, name, staged));
      let releasing: Promise<ReleaseOutcome> | undefined;
      return {
        reclaimed,
        release() {
          releasing ??= (async (): Promise<ReleaseOutcome> => {
            const marker = join(path, name);
            let current: string | undefined;
            try {
              current = await readFile(marker, 'utf8');
            } catch (error) {
              if (!hasCode(error, 'ENOENT'))
                throw filesystemFailure(error, 'recovery-marker-read', marker);
            }
            let outcome: ReleaseOutcome = current === undefined ? 'missing' : 'kept';
            if (current === record) {
              const removed = await removeMarker(marker, 'recovery-marker-unlink');
              outcome = removed ? 'removed' : 'missing';
              // Only after removing its exact marker may this release classify a successor, and
              // only against the identity captured while that marker was present.
              await removeEmptyRecovery(
                path,
                removed && own
                  ? { previous: { directory: own, marker: name }, token, successor: 'released' }
                  : undefined,
              );
            }
            // A failed release still owns its marker. Keep the in-process hold fail-closed.
            heldPaths.delete(path);
            return outcome;
          })();
          return releasing;
        },
      };
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
  filename = DATA_DIR_LOCK_FILE,
): Promise<{ state: 'free' } | { state: 'held'; path: string; detail: string }> {
  const path = resolve(canonicalPath(dataDir), filename);
  const recovery = `${path}${RECLAIM_GUARD_SUFFIX}`;
  if (heldPaths.has(recovery) || acquiringPaths.has(path))
    return {
      ...live(),
      state: 'held',
      path: recovery,
      detail: 'another GraphGoblin process is acquiring this store',
    };
  for (let attempt = 0; attempt < recoveryAttempts; attempt++) {
    const guard = await observeRecovery(recovery);
    if (guard.state === 'marker-absent') continue;
    if (guard.state === 'held') return { ...guard, path: recovery };
    const owner = heldPaths.has(path) ? live() : await lockFileState(path);
    if (owner.state === 'held') return { ...owner, path };
    return { state: 'free' };
  }
  return {
    ...unknown('reclamation guard marker repeatedly disappeared during the check'),
    path: recovery,
  };
}

async function verifyWriterArtifact(
  acquired: OwnedWriterArtifact,
  record: Buffer,
): Promise<OwnedWriterArtifact | undefined> {
  const uid = process.geteuid?.();
  if (uid === undefined) return undefined;
  const { path, dev, ino } = acquired;
  const matches = (stat: BigIntStats) =>
    stat.isFile() &&
    stat.dev === dev &&
    stat.ino === ino &&
    stat.uid === BigInt(uid) &&
    (stat.mode & 0o077n) === 0n &&
    stat.nlink === 1n;
  try {
    if (!matches(await lstat(path, { bigint: true }))) return undefined;
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!matches(await file.stat({ bigint: true }))) return undefined;
      const buffer = Buffer.alloc(record.length + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== record.length || !buffer.subarray(0, bytesRead).equals(record))
        return undefined;
      if (
        !matches(await file.stat({ bigint: true })) ||
        !matches(await lstat(path, { bigint: true }))
      )
        return undefined;
      return { path, dev, ino };
    } finally {
      await file.close();
    }
  } catch {
    return undefined;
  }
}

interface FileHold extends Hold {
  /** Whether this acquisition removed a stale primary file before creating its own. */
  readonly reclaimed: boolean;
  readonly verifyOwnedArtifact?: AttestedDataDirLock['verifyOwnedArtifact'];
}

/** A record write, attestation or close failure after exclusive creation, and its cleanup result. */
interface RecordFailure {
  readonly failure: {
    readonly primary: unknown;
    readonly cleanup: StartupCleanupFailure[];
    readonly retained: RetainedOwnership[];
  };
}

/**
 * Remove this acquisition's own record once, after its setup failed. A complete record is matched
 * by its exact random-token bytes, a partial one by the physical identity its handle reported, at
 * the configured path without following links. The check and unlink are not atomic; the held
 * recovery guard and exclusive creation keep conforming writers off the path meanwhile. True when
 * the record is proven gone or the path proven foreign (and kept); false retains ownership.
 */
async function removeOwnRecord(
  path: string,
  proof: string | BigIntStats | undefined,
  cleanup: StartupCleanupFailure[],
): Promise<boolean> {
  if (proof === undefined || (typeof proof !== 'string' && (!proof.isFile() || proof.ino === 0n)))
    return false;
  try {
    const current = await lstat(path, { bigint: true });
    if (
      !current.isFile() ||
      (typeof proof === 'string'
        ? (await readFile(path, 'utf8')) !== proof
        : !samePhysicalEntry(proof, current))
    )
      return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    cleanup.push(cleanupStep('main-record-lookup', error));
    return false;
  }
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    cleanup.push(cleanupStep('main-record-unlink', error));
    return false;
  }
}

async function acquireFile(
  path: string,
  record: string,
  attestation?: AttestLocalArtifact,
): Promise<FileHold | RecordFailure> {
  let reclaimed = false;
  const file = await open(path, 'wx', 0o600).catch(async (error: unknown) => {
    if (!hasCode(error, 'EEXIST')) throw error;
    reclaimed = await removeStale(path);
    return open(path, 'wx', 0o600).catch((retryError: unknown) => {
      if (hasCode(retryError, 'EEXIST')) throw held(path);
      throw retryError;
    });
  });
  heldPaths.add(path);
  let acquired: OwnedWriterArtifact | undefined;
  let written = false;
  let primary: { error: unknown } | undefined;
  try {
    await file.writeFile(record, 'utf8');
    written = true;
    if (attestation) {
      const { dev, ino } = await file.stat({ bigint: true });
      acquired = { path, dev, ino };
    }
  } catch (error) {
    primary = { error };
  }
  const cleanup: StartupCleanupFailure[] = [];
  // A complete record proves itself by its random token. A partial one can be matched only by the
  // handle's identity, which must be read before the handle closes.
  const identity =
    primary && !written
      ? await file.stat({ bigint: true }).catch((error: unknown) => {
          cleanup.push(cleanupStep('main-record-identity', error));
          return undefined;
        })
      : undefined;
  try {
    await file.close(); // The only close, whatever happened before it.
  } catch (error) {
    if (primary) cleanup.push(cleanupStep('main-record-close', error));
    else primary = { error };
  }
  if (primary) {
    const settled = await removeOwnRecord(path, written ? record : identity, cleanup);
    // Only proven removal, absence or foreign replacement ends the in-process reservation.
    if (settled) heldPaths.delete(path);
    return {
      failure: {
        primary: primary.error,
        cleanup,
        retained: settled ? [] : [{ resource: 'lock-record', path }],
      },
    };
  }
  let releasing: Promise<ReleaseOutcome> | undefined;
  let releaseStarted = false;
  const lease: FileHold = {
    reclaimed,
    release() {
      releaseStarted = true;
      releasing ??= (async (): Promise<ReleaseOutcome> => {
        let outcome: ReleaseOutcome;
        try {
          // The record includes a random ownership token: never remove a replacement lock.
          if ((await readFile(path, 'utf8')) === record) {
            await unlink(path);
            outcome = 'removed';
          } else outcome = 'kept';
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error;
          outcome = 'missing';
        }
        heldPaths.delete(path);
        return outcome;
      })();
      return releasing;
    },
  };
  if (!acquired) return lease;
  const bound = acquired;
  const expected = Buffer.from(record, 'utf8');
  return {
    ...lease,
    async verifyOwnedArtifact() {
      if (releaseStarted) return undefined;
      const verified = await verifyWriterArtifact(bound, expected);
      return releaseStarted ? undefined : verified;
    },
  };
}

/**
 * One API writer per local data directory, before database or recovery work. A lock naming
 * this PID is stale unless held here (container restarts reuse PIDs); other PIDs must be dead
 * or have a different, verified Windows creation identity.
 * The short-lived recovery guard follows the same rule after interrupted reclamation.
 */
export function acquireDataDirLock(
  dataDir: string,
  filename: string | undefined,
  attestation: AttestLocalArtifact,
): Promise<AttestedDataDirLock>;
export function acquireDataDirLock(dataDir: string, filename?: string): Promise<DataDirLock>;
export async function acquireDataDirLock(
  dataDir: string,
  filename = DATA_DIR_LOCK_FILE,
  attestation?: AttestLocalArtifact,
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
    const recovery = await acquireRecovery(`${path}${RECLAIM_GUARD_SUFFIX}`, record, token);
    const created = await acquireFile(path, record, attestation).catch(async (error: unknown) => {
      try {
        await recovery.release();
      } catch (cleanup) {
        throw cleanupFailure(error, [cleanup], 'reclamation cleanup also failed');
      }
      throw error;
    });
    if ('failure' in created) {
      const { primary, cleanup, retained } = created.failure;
      // Release the guard once; a failure follows the record's own cleanup, behind the primary.
      await recovery.release().catch((error: unknown) => {
        cleanup.push(cleanupStep('recovery-release', error));
      });
      throw withStartupCleanup(primary, cleanup, retained);
    }
    const file = created;
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
    const lock: DataDirLock = {
      reclaimed: { file: file.reclaimed, guard: recovery.reclaimed },
      release: () => file.release(),
    };
    if (!file.verifyOwnedArtifact) return lock;
    const attested: AttestedDataDirLock = {
      ...lock,
      verifyOwnedArtifact: file.verifyOwnedArtifact,
    };
    return attested;
  } finally {
    acquiringPaths.delete(path);
  }
}

/**
 * The deliberate refusal of a SQLite file with several hard links: a complete operator explanation
 * naming the canonical database. File-name locks cannot establish one owner across hard-link
 * aliases. It is neither a held nor an unverifiable owner: the refusal comes before the database
 * lock or its guard is inspected or created.
 */
export class HardLinkedDatabaseRefusedError extends Error {
  override readonly name = 'HardLinkedDatabaseRefusedError';
  /** The canonical database path that was refused. */
  readonly database: string;

  constructor(database: string) {
    super(
      `database ${database} has multiple hard links; use one ordinary SQLite file so GraphGoblin can establish exclusive ownership`,
    );
    this.database = database;
  }
}

/** A shared external SQLite file has one owner even when data directories differ. */
export function acquireDatabaseLock(
  databaseFile: string,
  attestation: AttestLocalArtifact,
): Promise<AttestedDataDirLock>;
export function acquireDatabaseLock(databaseFile: string): Promise<DataDirLock>;
export async function acquireDatabaseLock(
  databaseFile: string,
  attestation?: AttestLocalArtifact,
): Promise<DataDirLock> {
  const file = canonicalPath(databaseFile);
  const info = await stat(file).catch((error: unknown) => {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (info && info.nlink > 1) throw new HardLinkedDatabaseRefusedError(file);
  const name = databaseLockFileName(basename(file));
  return attestation
    ? acquireDataDirLock(dirname(file), name, attestation)
    : acquireDataDirLock(dirname(file), name);
}

export function databaseLockState(databaseFile: string): ReturnType<typeof dataDirLockState> {
  const file = canonicalPath(databaseFile);
  return dataDirLockState(dirname(file), databaseLockFileName(basename(file)));
}
