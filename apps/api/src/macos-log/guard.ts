import { close, constants, fstat, open as openFd, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, rename } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import {
  GATEWAY_LOG_ACTIVE,
  GATEWAY_LOG_PREVIOUS,
  type LogFileHandle,
  type LogFileIdentity,
  type LogFileStats,
  type LogFileSystem,
} from '../managed-log/gateway-log-writer.js';
import {
  LogDestinationRefusedError,
  takeLauncherVariable,
  type ManagedLogAdmission,
} from '../managed-log/guard.js';

export const MACOS_LOG_ADMISSION_VARIABLE = 'GG_MACOS_LAUNCHER_LOG_ADMISSION';
const ADMISSION_BYTES = 4_096;
const RESERVATION_MS = 1_500;
const RETRY_MS = 25;
const UINT64_MAX = (1n << 64n) - 1n;
// Darwin fcntl.h. The Node constants binding does not export O_EXLOCK.
const O_EXLOCK = 0x20;
const ROOT_FLAGS =
  constants.O_RDONLY |
  constants.O_DIRECTORY |
  constants.O_NOFOLLOW |
  O_EXLOCK |
  constants.O_NONBLOCK;
const SLOT_FLAGS = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK;

interface Snapshot extends LogFileIdentity {
  root: string;
}

export function takeMacosLogAdmission(env: NodeJS.ProcessEnv): string | undefined {
  return takeLauncherVariable(env, MACOS_LOG_ADMISSION_VARIABLE);
}

function parseUint64(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || /^(0|[1-9][0-9]{0,19})$/u.exec(value)?.[0] !== value)
    return undefined;
  const id = BigInt(value);
  return id <= UINT64_MAX ? id : undefined;
}

function parseSnapshot(raw: string): Snapshot {
  if (Buffer.byteLength(raw) > ADMISSION_BYTES) throw new LogDestinationRefusedError('unavailable');
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).length !== 4 ||
    !('version' in value) ||
    value.version !== 1 ||
    !('root' in value) ||
    typeof value.root !== 'string' ||
    !posix.isAbsolute(value.root) ||
    value.root.includes('\0') ||
    !('device' in value) ||
    !('inode' in value)
  )
    throw new LogDestinationRefusedError('unavailable');
  const dev = parseUint64(value.device);
  const ino = parseUint64(value.inode);
  if (dev === undefined || ino === undefined) throw new LogDestinationRefusedError('unavailable');
  return { root: value.root, dev, ino };
}

type DarwinStat = Pick<
  BigIntStats,
  'dev' | 'ino' | 'uid' | 'mode' | 'size' | 'nlink' | 'isFile' | 'isDirectory' | 'isSymbolicLink'
>;
type DarwinSlot = Omit<LogFileHandle, 'stat'> & { stat(): Promise<DarwinStat> };

export interface DarwinLogOperations {
  getEffectiveUid(): number | undefined;
  realpath(path: string): Promise<string>;
  openRoot(path: string, flags: number): Promise<number>;
  statRoot(fd: number): Promise<DarwinStat>;
  closeRoot(fd: number): Promise<void>;
  lstat(path: string): Promise<DarwinStat>;
  openSlot(path: string, flags: number, mode: number): Promise<DarwinSlot>;
  rename(from: string, to: string): Promise<void>;
  now(): number;
  delay(ms: number): Promise<void>;
}

const nodeOperations: DarwinLogOperations = {
  getEffectiveUid: () => process.geteuid?.(),
  realpath,
  openRoot: promisify(openFd),
  statRoot: (fd) =>
    new Promise((resolve, reject) =>
      fstat(fd, { bigint: true }, (error, stats) => (error ? reject(error) : resolve(stats))),
    ),
  closeRoot: promisify(close),
  lstat: (path) => lstat(path, { bigint: true }),
  async openSlot(path, flags, mode) {
    const handle = await open(path, flags, mode);
    return {
      stat: () => handle.stat({ bigint: true }),
      read: (...args) => handle.read(...args),
      write: (...args) => handle.write(...args),
      truncate: (length) => handle.truncate(length),
      close: () => handle.close(),
    };
  },
  rename,
  now: () => performance.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function identity(stat: LogFileIdentity): LogFileIdentity {
  return { dev: BigInt.asUintN(64, stat.dev), ino: BigInt.asUintN(64, stat.ino) };
}

function sameIdentity(expected: LogFileIdentity, stat: DarwinStat): boolean {
  const actual = identity(stat);
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

function isPrivate(stat: DarwinStat, uid: bigint): boolean {
  return stat.uid === uid && (stat.mode & 0o077n) === 0n;
}

async function reserveRoot(root: string, operations: DarwinLogOperations): Promise<number> {
  const deadline = operations.now() + RESERVATION_MS;
  for (;;) {
    try {
      return await operations.openRoot(root, ROOT_FLAGS);
    } catch (error) {
      if (!hasCode(error, 'EAGAIN')) throw error;
      const remaining = deadline - operations.now();
      if (remaining <= 0) throw new LogDestinationRefusedError('in-use');
      await operations.delay(Math.min(RETRY_MS, remaining));
      if (operations.now() >= deadline) throw new LogDestinationRefusedError('in-use');
    }
  }
}

// Raw descriptors are owned by the module, independent of any writer or GC-managed FileHandle.
const reservations = new Set<{ fd: number }>();

/** Reserve the Swift-verified physical directory and recheck both slots before writer adoption. */
export async function admitMacosLog(
  raw: string,
  operations: DarwinLogOperations = nodeOperations,
): Promise<ManagedLogAdmission> {
  let release: (() => Promise<void>) | undefined;
  try {
    const expected = parseSnapshot(raw);
    const effectiveUid = operations.getEffectiveUid();
    if (effectiveUid === undefined) throw new LogDestinationRefusedError('unavailable');
    const root = await operations.realpath(expected.root);
    const reservation = { fd: await reserveRoot(root, operations) };
    reservations.add(reservation);
    let closing: Promise<void> | undefined;
    release = () => {
      closing ??= operations.closeRoot(reservation.fd).then(() => {
        reservations.delete(reservation);
      });
      return closing;
    };

    const uid = BigInt(effectiveUid);
    const active = join(root, GATEWAY_LOG_ACTIVE);
    const previous = join(root, GATEWAY_LOG_PREVIOUS);
    const safeRoot = (stat: DarwinStat) =>
      stat.isDirectory() && isPrivate(stat, uid) && sameIdentity(expected, stat);

    async function verifyRoot(): Promise<void> {
      if (!reservations.has(reservation)) throw new LogDestinationRefusedError('unavailable');
      const opened = await operations.statRoot(reservation.fd);
      const named = await operations.lstat(root);
      if (!safeRoot(opened) || !safeRoot(named))
        throw new LogDestinationRefusedError('unavailable');
    }

    const safeSlot = (stat: DarwinStat) =>
      stat.isFile() &&
      isPrivate(stat, uid) &&
      stat.nlink === 1n &&
      identity(stat).dev === expected.dev;

    async function slotStat(path: string): Promise<DarwinStat> {
      if (path !== active && path !== previous) throw new LogDestinationRefusedError('unavailable');
      const stat = await operations.lstat(path);
      if (!safeSlot(stat)) throw new LogDestinationRefusedError('unavailable');
      return stat;
    }

    async function slotIfPresent(path: string): Promise<DarwinStat | undefined> {
      try {
        return await slotStat(path);
      } catch (error) {
        if (hasCode(error, 'ENOENT')) return undefined;
        throw error;
      }
    }

    function writerStat(stat: DarwinStat): LogFileStats {
      return {
        ...identity(stat),
        nlink: stat.nlink,
        size: stat.size,
        isFile: () => stat.isFile(),
        isSymbolicLink: () => stat.isSymbolicLink(),
      };
    }

    async function openSlot(path: string, mode: 'existing' | 'create'): Promise<LogFileHandle> {
      await verifyRoot();
      const named = await slotIfPresent(path);
      // Leave an existing private entry in place. O_EXCL also catches a new arrival.
      const flags =
        mode === 'create' ? SLOT_FLAGS | constants.O_CREAT | constants.O_EXCL : SLOT_FLAGS;
      const handle = await operations.openSlot(path, flags, 0o600);
      try {
        const opened = await handle.stat();
        const slotIdentity = identity(opened);
        async function openedStat(): Promise<LogFileStats> {
          const current = await handle.stat();
          if (!safeSlot(current) || !sameIdentity(slotIdentity, current))
            throw new LogDestinationRefusedError('unavailable');
          return writerStat(current);
        }
        async function verifyBoundSlot(): Promise<void> {
          await verifyRoot();
          await openedStat();
          if (!sameIdentity(slotIdentity, await slotStat(path)))
            throw new LogDestinationRefusedError('unavailable');
        }
        if (named && !sameIdentity(slotIdentity, named))
          throw new LogDestinationRefusedError('unavailable');
        await verifyBoundSlot();
        return {
          stat: openedStat,
          read: (...args) => handle.read(...args),
          async write(...args) {
            await verifyBoundSlot();
            return handle.write(...args);
          },
          async truncate(length) {
            await verifyBoundSlot();
            await handle.truncate(length);
          },
          close: () => handle.close(),
        };
      } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
      }
    }

    const fs: LogFileSystem = {
      async lstat(path) {
        await verifyRoot();
        return writerStat(await slotStat(path));
      },
      open: openSlot,
      async rename(from, to) {
        await verifyRoot();
        await slotStat(from);
        await slotIfPresent(to);
        await operations.rename(from, to);
      },
    };
    await verifyRoot();
    for (const path of [active, previous]) {
      if (await slotIfPresent(path)) {
        const handle = await openSlot(path, 'existing');
        await handle.close();
      }
    }
    return { root, fs, releaseOnAdmissionFailure: release };
  } catch (error) {
    await release?.().catch(() => undefined);
    if (error instanceof LogDestinationRefusedError) throw error;
    throw new LogDestinationRefusedError('unavailable');
  }
}
