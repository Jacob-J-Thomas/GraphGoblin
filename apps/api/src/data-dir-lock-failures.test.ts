import { randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireDataDirLock,
  dataDirLockState,
  StoreOwnershipRefusedError,
} from './data-dir-lock.js';
import { shellFailureOutput, startupFailureCause } from './serve.js';
import { StartupCleanupError } from './startup-cleanup.js';
import * as identity from './windows-process-identity.js';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof fs>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    unlink: vi.fn(actual.unlink),
    rmdir: vi.fn(actual.rmdir),
    rename: vi.fn(actual.rename),
    lstat: vi.fn(actual.lstat),
    open: vi.fn(actual.open),
    readdir: vi.fn(actual.readdir),
  };
});
const actual = await vi.importActual<typeof fs>('node:fs/promises');
const platform = process.platform;
let directory: string;
let path: string;
let guard: string;
const creationTime = '134388256826197770';
const foreignPid = process.pid + 1;
const denied = () => Object.assign(new Error('synthetic permission refusal'), { code: 'EPERM' });

beforeEach(async () => {
  directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'gg-lock-failure-'));
  path = join(directory, 'graphgoblin.lock');
  guard = `${path}.reclaim`;
  vi.spyOn(identity, 'ownWindowsProcessIdentity').mockResolvedValue(creationTime);
});
afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: platform });
  vi.restoreAllMocks();
  vi.mocked(fs.readFile).mockReset();
  vi.mocked(fs.unlink).mockReset();
  vi.mocked(fs.rmdir).mockReset();
  vi.mocked(fs.rename).mockReset();
  vi.mocked(fs.lstat).mockReset();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.readdir).mockReset();
  await fs.rm(directory, { recursive: true, force: true });
});

async function seed() {
  const token = randomUUID();
  const marker = join(guard, `${token}.json`);
  await fs.mkdir(guard);
  await fs.writeFile(marker, JSON.stringify({ pid: process.pid, token }));
  return marker;
}

function liveRecord(token: string, fields: Record<string, unknown> = {}) {
  return JSON.stringify({ pid: foreignPid, token, windowsCreationTime: creationTime, ...fields });
}

async function stageSuccessor(contents = liveRecord, token = randomUUID()) {
  const staging = `${guard}.${token}.successor`;
  const name = `${token}.json`;
  const record = contents(token);
  await fs.mkdir(staging);
  await fs.writeFile(join(staging, name), record);
  return { staging, name, record, marker: join(guard, name) };
}

function stubLiveWindowsIdentity() {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  vi.spyOn(process, 'kill').mockReturnValue(true);
  return vi.spyOn(identity, 'windowsProcessIdentity').mockResolvedValue({ identity: creationTime });
}

function refuseGuardRemoval(beforeRefusal?: () => Promise<unknown>) {
  const refusal = denied();
  vi.mocked(fs.rmdir).mockImplementation(async (target) => {
    if (target === guard) {
      if (beforeRefusal) await beforeRefusal();
      throw refusal;
    }
    await actual.rmdir(target);
  });
  return refusal;
}

function refuseWithSuccessor(
  successor: Awaited<ReturnType<typeof stageSuccessor>>,
  afterPublication?: () => void,
) {
  return refuseGuardRemoval(async () => {
    await actual.rmdir(guard);
    await actual.rename(successor.staging, guard);
    afterPublication?.();
  });
}

function directoryFailure(cause: Error) {
  return { cause, code: 'EPERM', operation: 'recovery-directory-remove', markerToken: null };
}

async function expectSuccessorIntact(
  successor: Awaited<ReturnType<typeof stageSuccessor>>,
  entries = ['graphgoblin.lock.reclaim'],
) {
  expect(await actual.readFile(successor.marker, 'utf8')).toBe(successor.record);
  expect((await actual.readdir(directory)).sort()).toEqual([...entries].sort());
  expect(vi.mocked(fs.unlink).mock.calls.map(([target]) => target)).not.toContain(successor.marker);
}

const failure = (message: string, code: unknown) => Object.assign(new Error(message), { code });
const exists = (target: string) =>
  actual.lstat(target).then(
    () => true,
    () => false,
  );
const guardRemovals = () => vi.mocked(fs.rmdir).mock.calls.filter(([target]) => target === guard);

/**
 * A precisely controlled observation: the next `count` successful bigint lstat calls of a matching
 * path return `control` applied to the real result. Every other call is real.
 */
function controlLstat(
  matches: (target: string) => boolean,
  control: (stats: BigIntStats) => BigIntStats,
  count = 1,
) {
  let remaining = count;
  vi.mocked(fs.lstat).mockImplementation((async (
    target: string,
    options?: { bigint?: boolean },
  ) => {
    if (!options?.bigint || remaining === 0 || !matches(target))
      return actual.lstat(target, options);
    const stats = await actual.lstat(target, { bigint: true });
    remaining--;
    return control(stats);
  }) as typeof fs.lstat);
  return { consumed: () => remaining === 0 };
}

/** The same observation with a different physical inode. */
const otherInode = (stats: BigIntStats) => Object.assign(stats, { ino: stats.ino + 1n });

/** The mocked calls' first arguments made after a given invocation order. */
function targetsAfter(
  mocked: { mock: { calls: unknown[][]; invocationCallOrder: number[] } },
  order: number,
): string[] {
  return mocked.mock.calls
    .filter((_, index) => mocked.mock.invocationCallOrder[index]! > order)
    .map(([target]) => String(target));
}

it('publishes after observing absence without trying to remove the shared guard first', async () => {
  const lock = await acquireDataDirLock(directory);
  expect(lock.reclaimed).toEqual({ file: false, guard: false });
  expect(vi.mocked(fs.rmdir).mock.calls).toEqual([[guard]]); // Release of this caller's own guard.
  expect(vi.mocked(fs.rename).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(fs.rmdir).mock.invocationCallOrder[0]!,
  );
  await expect(lock.release()).resolves.toBe('removed');
  expect(await fs.readdir(directory)).toEqual([]);
});

it('preserves a live guard published after observing absence and before atomic publication', async () => {
  stubLiveWindowsIdentity();
  const successor = await stageSuccessor();
  vi.mocked(fs.rename).mockImplementationOnce(async (from, to) => {
    await actual.rename(successor.staging, guard);
    return actual.rename(from, to);
  });
  await expect(acquireDataDirLock(directory)).rejects.toThrow('another GraphGoblin process holds');
  expect(vi.mocked(fs.rmdir).mock.calls.map(([target]) => target)).not.toContain(guard);
  await expectSuccessorIntact(successor);
});

it.each([false, true])(
  'credits a guard removal only if the directory survived the marker read race (other contender also removed the directory: %s)',
  async (removedGuard) => {
    const marker = await seed();
    vi.mocked(fs.readFile).mockImplementationOnce(async (...args) => {
      expect(args[0]).toBe(marker);
      await actual.unlink(marker);
      if (removedGuard) await actual.rmdir(guard);
      return actual.readFile(...args);
    });
    const lock = await acquireDataDirLock(directory);
    expect(lock.reclaimed).toEqual({ file: false, guard: !removedGuard });
    expect(vi.mocked(fs.rmdir).mock.calls).toEqual(removedGuard ? [[guard]] : [[guard], [guard]]);
    expect(vi.mocked(fs.unlink).mock.calls.map(([target]) => target)).not.toContain(marker);
    await expect(lock.release()).resolves.toBe('removed');
    expect(await fs.readdir(directory)).toEqual([]);
  },
);

it('recognizes a Windows recovery marker that disappeared before its owner could be read', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const marker = await seed();
  vi.mocked(fs.readFile).mockImplementationOnce(async (target) => {
    expect(target).toBe(marker);
    await actual.unlink(marker);
    throw denied();
  });
  const lock = await acquireDataDirLock(directory);
  expect(lock.reclaimed).toEqual({ file: false, guard: true });
  await expect(actual.readFile(path, 'utf8')).resolves.toContain(String(process.pid));
  expect(vi.mocked(fs.unlink).mock.calls.some(([target]) => target === marker)).toBe(false);
  await lock.release();
  expect(await fs.readdir(directory)).toEqual([]);
});

it('finds a live successor in a read-only check after the original marker disappears', async () => {
  stubLiveWindowsIdentity();
  const marker = await seed();
  const successor = await stageSuccessor();
  vi.mocked(fs.readFile).mockImplementationOnce(async (...args) => {
    expect(args[0]).toBe(marker);
    await actual.unlink(marker);
    await actual.rmdir(guard);
    await actual.rename(successor.staging, guard);
    return actual.readFile(...args);
  });
  await expect(dataDirLockState(directory)).resolves.toMatchObject({
    state: 'held',
    path: guard,
    detail: expect.stringContaining('another GraphGoblin process holds'),
  });
  expect(vi.mocked(fs.rmdir).mock.calls).toEqual([]);
  expect(vi.mocked(fs.rename).mock.calls).toEqual([]);
  await expectSuccessorIntact(successor);
});

it('refuses read-only ownership after bounded rechecks of repeatedly disappearing markers', async () => {
  let marker = await seed();
  vi.mocked(fs.readFile).mockImplementation(async (...args) => {
    if (args[0] === path) return actual.readFile(...args);
    expect(args[0]).toBe(marker);
    await actual.unlink(marker);
    const token = randomUUID();
    marker = join(guard, `${token}.json`);
    await fs.writeFile(marker, JSON.stringify({ pid: process.pid, token }));
    return actual.readFile(...args);
  });
  await expect(dataDirLockState(directory)).resolves.toMatchObject({
    state: 'held',
    path: guard,
    detail: expect.stringContaining('Store ownership could not be verified'),
  });
  expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(8);
  expect(vi.mocked(fs.rmdir).mock.calls).toEqual([]);
  expect(vi.mocked(fs.unlink).mock.calls).toEqual([]);
  expect(vi.mocked(fs.rename).mock.calls).toEqual([]);
  expect(await fs.readdir(guard)).toHaveLength(1);
});

it.each([8, 7])(
  'reports the final acquisition outcome after %i marker read losses',
  async (markerLosses) => {
    let marker = await seed();
    let reads = 0;
    vi.mocked(fs.readFile).mockImplementation(async (...args) => {
      if (args[0] === path) return actual.readFile(...args);
      expect(args[0]).toBe(marker);
      await actual.unlink(marker);
      await actual.rmdir(guard);
      if (++reads < markerLosses) marker = await seed();
      return actual.readFile(...args);
    });
    if (markerLosses === 7) vi.mocked(fs.rename).mockRejectedValueOnce(denied());

    const acquisition = acquireDataDirLock(directory);
    await expect(acquisition).rejects.toBeInstanceOf(StoreOwnershipRefusedError);
    expect(reads).toBe(markerLosses);
    expect(vi.mocked(fs.rename)).toHaveBeenCalledTimes(8 - markerLosses);
    expect(await fs.readdir(directory)).toEqual([]);
    await expect(dataDirLockState(directory)).resolves.toEqual({ state: 'free' });

    if (markerLosses === 8) {
      await expect(acquisition).rejects.toThrow(
        `Store ownership could not be verified (reclamation guard marker disappeared before verification at the acquisition attempt limit): ${guard}`,
      );
      await expect(acquisition).rejects.not.toThrow('another GraphGoblin process holds');
      await expect(acquisition).rejects.not.toThrow('stop it before retrying');
    } else {
      await expect(acquisition).rejects.toThrow(`another GraphGoblin process holds ${guard}`);
    }
  },
);

it('reports uncertainty after seven marker read losses and a final lost stale-marker unlink', async () => {
  let marker = await seed();
  let reads = 0;
  vi.mocked(fs.readFile).mockImplementation(async (...args) => {
    if (args[0] === path) return actual.readFile(...args);
    expect(args[0]).toBe(marker);
    if (++reads === 8) return actual.readFile(...args);
    await actual.unlink(marker);
    await actual.rmdir(guard);
    marker = await seed();
    return actual.readFile(...args);
  });
  vi.mocked(fs.unlink).mockImplementation(async (target) => {
    if (target === marker) {
      await actual.unlink(marker);
      await actual.rmdir(guard);
    }
    await actual.unlink(target);
  });

  const refusal = await acquireDataDirLock(directory).catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(StoreOwnershipRefusedError);
  expect(reads).toBe(8);
  expect(vi.mocked(fs.unlink).mock.calls.filter(([target]) => target === marker)).toEqual([
    [marker],
  ]);
  expect(vi.mocked(fs.rmdir)).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\.tmp$/));
  expect(vi.mocked(fs.rename)).not.toHaveBeenCalled();
  expect(await fs.readdir(directory)).toEqual([]);
  await expect(dataDirLockState(directory)).resolves.toEqual({ state: 'free' });

  const output = shellFailureOutput(refusal);
  expect(output).toContain(
    `Store ownership could not be verified (reclamation guard marker disappeared during removal at the acquisition attempt limit): ${guard}`,
  );
  expect(output).not.toContain('another GraphGoblin process holds');
  expect(output).not.toContain('stop it before retrying');
  expect(startupFailureCause('store', refusal)).toBe('store-ownership-unverified');
});

it.each([
  ['win32', 'EPERM', 'EPERM'],
  ['linux', 'EACCES', 'EACCES'],
  ['win32', 'not a vetted\ncode', 'UNKNOWN'],
  ['linux', 7, 'UNKNOWN'],
] as const)(
  'labels a refused %s recovery marker read (%j) that still exists, keeping its original cause',
  async (venue, raw, code) => {
    Object.defineProperty(process, 'platform', { value: venue });
    const marker = await seed();
    const token = marker.slice(-41, -5);
    const original = await actual.readFile(marker);
    const refusal = failure('synthetic marker read refusal', raw);
    vi.mocked(fs.readFile).mockRejectedValueOnce(refusal);
    const error = await acquireDataDirLock(directory).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      message: `Store ownership observed-marker-read failed (${code}): ${marker}`,
      operation: 'observed-marker-read',
      code,
      markerToken: token,
      cause: refusal,
    });
    expect(error).not.toBeInstanceOf(StoreOwnershipRefusedError);
    expect(shellFailureOutput(error)).toBe(error);
    expect(startupFailureCause('store', error)).toBe('store-unavailable');
    expect(await actual.readFile(marker)).toEqual(original);
    expect(vi.mocked(fs.rmdir).mock.calls.map(([target]) => target)).not.toContain(guard);
  },
);

it('labels a refused marker read in the read-only ownership check without changing anything', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const marker = await seed();
  const refusal = denied();
  vi.mocked(fs.readFile).mockRejectedValueOnce(refusal);
  await expect(dataDirLockState(directory)).rejects.toMatchObject({
    operation: 'observed-marker-read',
    code: 'EPERM',
    markerToken: marker.slice(-41, -5),
    cause: refusal,
  });
  expect(await actual.readdir(guard)).toEqual([marker.slice(-41)]);
  expect(vi.mocked(fs.unlink).mock.calls).toEqual([]);
});

it('labels a refused read of its own recovery marker and rolls back its main lock', async () => {
  const refusal = failure('synthetic own marker read refusal', 'EACCES');
  vi.mocked(fs.readFile).mockImplementation(async (...args) => {
    if (typeof args[0] === 'string' && dirname(args[0]) === guard) throw refusal;
    return actual.readFile(...args);
  });
  const error = await acquireDataDirLock(directory).catch((caught: unknown) => caught);
  expect(error).toMatchObject({
    message: expect.stringContaining('rolled back'),
    cause: { operation: 'recovery-marker-read', code: 'EACCES', cause: refusal },
  });
  const [marker] = await actual.readdir(guard);
  expect((error as Error & { cause: { markerToken: string } }).cause.markerToken).toBe(
    marker?.slice(0, -5),
  );
  await expect(actual.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  // The unread marker stays, and so does this process's fail-closed hold of its guard.
  expect(await dataDirLockState(directory)).toMatchObject({ state: 'held', path: guard });
});

it('preserves a refused main owner record read even when its path is absent', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const refusal = denied();
  vi.mocked(fs.readFile).mockRejectedValueOnce(refusal);
  await expect(dataDirLockState(directory)).rejects.toBe(refusal);
  expect(await fs.readdir(directory)).toEqual([]);
});

it('accepts Windows EPERM only after the exact stale UUID marker is independently absent', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const marker = await seed();
  vi.mocked(fs.unlink).mockImplementation(async (target) => {
    await actual.unlink(target);
    if (target === marker) {
      await actual.rmdir(guard);
      throw denied();
    }
  });
  const lock = await acquireDataDirLock(directory);
  expect(lock.reclaimed).toEqual({ file: false, guard: false });
  expect(vi.mocked(fs.rmdir).mock.calls).toEqual([[guard]]);
  expect(JSON.parse(await fs.readFile(path, 'utf8'))).toMatchObject({ pid: process.pid });
  await lock.release();
  await expect(fs.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.lstat(`${path}.reclaim`)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('never retries a refused stale-marker deletion or touches a successor marker', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const marker = await seed();
  const successor = join(`${path}.reclaim`, `${randomUUID()}.json`);
  vi.mocked(fs.unlink).mockImplementation(async (target) => {
    if (target === marker) {
      await fs.writeFile(successor, 'keep successor');
      throw denied();
    }
    await actual.unlink(target);
  });
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
    code: 'EPERM',
    operation: 'stale-marker-unlink',
  });
  expect(vi.mocked(fs.unlink).mock.calls.filter(([target]) => target === marker)).toHaveLength(1);
  expect(await fs.readFile(successor, 'utf8')).toBe('keep successor');
  expect(await fs.readdir(directory)).toEqual(['graphgoblin.lock.reclaim']);
});

it('continues after Windows rmdir EPERM when the guard directory is independently absent', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  await seed();
  let removed = false;
  vi.mocked(fs.rmdir).mockImplementation(async (target) => {
    await actual.rmdir(target);
    if (target === `${path}.reclaim` && !removed) {
      removed = true;
      throw denied();
    }
  });
  const lock = await acquireDataDirLock(directory);
  expect(lock.reclaimed).toEqual({ file: false, guard: true }); // This call removed the stale marker.
  await lock.release();
  expect(removed).toBe(true);
  expect(await fs.readdir(directory)).toEqual([]);
});

it('reports an ordinary held refusal when Windows directory EPERM exposes a verified live successor', async () => {
  const probe = stubLiveWindowsIdentity();
  const stale = await seed();
  const successor = await stageSuccessor();
  refuseWithSuccessor(successor);
  const acquisition = acquireDataDirLock(directory);
  await expect(acquisition).rejects.toMatchObject({
    name: 'StoreOwnershipRefusedError',
    message: expect.stringContaining(`another GraphGoblin process holds ${guard}`),
  });
  await expect(acquisition).rejects.not.toHaveProperty('code');
  await expect(acquisition).rejects.not.toHaveProperty('operation');
  await expect(acquisition).rejects.not.toHaveProperty('cause');
  const refusal = await acquisition.catch((error: unknown) => error);
  // Exactly the ordinary held(path) refusal: one line, store-held.
  expect(shellFailureOutput(refusal)).toBe(
    `another GraphGoblin process holds ${guard}; check its port/configuration; wait for the owning process to finish or stop it before retrying`,
  );
  expect(startupFailureCause('store', refusal)).toBe('store-held');
  expect(probe).toHaveBeenCalledExactlyOnceWith(foreignPid);
  expect(vi.mocked(fs.rmdir).mock.calls.filter(([target]) => target === guard)).toHaveLength(1);
  await expect(fs.lstat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
  await expectSuccessorIntact(successor);
});

it('continues without taking reclamation credit for a successor that releases during the identity probe', async () => {
  const probe = stubLiveWindowsIdentity();
  await fs.mkdir(guard); // Another contender removes this stale empty directory during rmdir.
  const successor = await stageSuccessor();
  const refusal = denied();
  vi.mocked(fs.rmdir).mockImplementationOnce(async (target) => {
    expect(target).toBe(guard);
    await actual.rmdir(guard);
    await actual.rename(successor.staging, guard);
    throw refusal;
  });
  probe.mockImplementationOnce(async () => {
    await actual.unlink(successor.marker);
    await actual.rmdir(guard);
    return { identity: creationTime };
  });
  const lock = await acquireDataDirLock(directory);
  expect(probe).toHaveBeenCalledExactlyOnceWith(foreignPid);
  expect(lock.reclaimed).toEqual({ file: false, guard: false });
  expect(vi.mocked(fs.rmdir).mock.calls).toEqual([[guard], [guard]]); // Failed attempt, then own release.
  await expect(lock.release()).resolves.toBe('removed');
  expect(await fs.readdir(directory)).toEqual([]);
});

it('retains the original Windows directory denial for a persistent empty guard', async () => {
  const probe = stubLiveWindowsIdentity();
  await seed();
  const refusal = refuseGuardRemoval();
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
  expect(probe).not.toHaveBeenCalled();
  expect(vi.mocked(fs.rmdir).mock.calls.filter(([target]) => target === guard)).toHaveLength(1);
  expect(await fs.readdir(guard)).toEqual([]);
  expect(await fs.readdir(directory)).toEqual(['graphgoblin.lock.reclaim']);
});

it.each([
  ['malformed JSON', () => 'truncated {'],
  ['mismatched UUID', (token: string) => liveRecord(token, { token: randomUUID() })],
  ['missing identity', (token: string) => liveRecord(token, { windowsCreationTime: undefined })],
  ['own unheld PID', (token: string) => liveRecord(token, { pid: process.pid })],
] as const)(
  'keeps the original Windows directory denial for a successor with %s',
  async (_name, record) => {
    const probe = stubLiveWindowsIdentity();
    await seed();
    const successor = await stageSuccessor(record);
    const refusal = refuseWithSuccessor(successor);
    await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
    expect(probe).not.toHaveBeenCalled();
    await expectSuccessorIntact(successor);
  },
);

it.each([
  [{ reason: 'WMI probe denied' }, [{ operation: 'successor-identity', code: 'UNKNOWN' }]],
  // A different creation identity is a credible mismatch, not a failed probe.
  [{ identity: '134388256826197771' }, undefined],
])(
  'keeps Windows directory EPERM when the successor creation identity is unverified (%j)',
  async (result, probeFailures) => {
    const probe = stubLiveWindowsIdentity().mockResolvedValueOnce(result);
    await seed();
    const successor = await stageSuccessor();
    const refusal = refuseWithSuccessor(successor);
    const error = await acquireDataDirLock(directory).catch((caught: unknown) => caught);
    expect(error).toMatchObject(directoryFailure(refusal));
    expect(probe).toHaveBeenCalledExactlyOnceWith(foreignPid);
    if (probeFailures) {
      expect(error).toMatchObject({ probeFailures });
      expect((error as { probeFailures: { cause: unknown }[] }).probeFailures[0]!.cause).toBe(
        'WMI probe denied',
      );
      // The bounded label and code are printed; the probe's own text is not.
      expect(inspect(error)).toContain("operation: 'successor-identity'");
      expect(inspect(error)).not.toContain('WMI probe denied');
    } else expect(error).not.toHaveProperty('probeFailures');
    expect(shellFailureOutput(error)).toBe(error);
    expect(startupFailureCause('store', error)).toBe('store-unavailable');
    expect(guardRemovals()).toHaveLength(1);
    await expectSuccessorIntact(successor);
  },
);

it('reports a failed successor liveness probe as secondary evidence on the original denial', async () => {
  const probe = stubLiveWindowsIdentity();
  const unknownLiveness = failure('synthetic liveness refusal', 'EPERM');
  vi.mocked(process.kill).mockImplementationOnce(() => {
    throw unknownLiveness;
  });
  await seed();
  const successor = await stageSuccessor();
  const refusal = refuseWithSuccessor(successor);
  const error = await acquireDataDirLock(directory).catch((caught: unknown) => caught);
  expect(error).toMatchObject({
    ...directoryFailure(refusal),
    probeFailures: [{ operation: 'successor-liveness', code: 'EPERM', cause: unknownLiveness }],
  });
  expect(probe).not.toHaveBeenCalled();
  await expectSuccessorIntact(successor);
});

it('reports a failed successor inspection as secondary evidence on the original denial', async () => {
  const probe = stubLiveWindowsIdentity();
  await seed();
  const successor = await stageSuccessor();
  const inspection = failure('synthetic successor listing refusal', 'EACCES');
  const refusal = refuseWithSuccessor(successor, () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(inspection);
  });
  const error = await acquireDataDirLock(directory).catch((caught: unknown) => caught);
  expect(error).toMatchObject({
    ...directoryFailure(refusal),
    probeFailures: [{ operation: 'successor-inspection', code: 'EACCES', cause: inspection }],
  });
  expect(probe).not.toHaveBeenCalled();
  expect(inspect(error)).not.toContain('synthetic successor listing refusal');
  await expectSuccessorIntact(successor);
});

it('preserves a live successor and the original denial when the directory recheck is inaccessible', async () => {
  const probe = stubLiveWindowsIdentity();
  await seed();
  const successor = await stageSuccessor();
  const lookup = denied();
  const refusal = refuseWithSuccessor(successor, () => {
    vi.mocked(fs.lstat).mockRejectedValueOnce(lookup);
  });
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
    ...directoryFailure(refusal),
    probeFailures: [{ operation: 'recovery-directory-lookup', code: 'EPERM', cause: lookup }],
  });
  expect(probe).not.toHaveBeenCalled();
  await expectSuccessorIntact(successor);
});

it('retains Windows directory EPERM for an ambiguous successor directory', async () => {
  const probe = stubLiveWindowsIdentity();
  await seed();
  const successor = await stageSuccessor();
  await fs.writeFile(join(successor.staging, 'other'), 'keep unrelated bytes');
  const refusal = refuseWithSuccessor(successor);
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
  expect(probe).not.toHaveBeenCalled();
  await expectSuccessorIntact(successor);
  expect(await fs.readFile(join(guard, 'other'), 'utf8')).toBe('keep unrelated bytes');
});

it('retains Windows directory EPERM when a link points to a valid successor directory', async () => {
  const probe = stubLiveWindowsIdentity();
  await seed();
  const successor = await stageSuccessor();
  const refusal = refuseGuardRemoval(async () => {
    await actual.rmdir(guard);
    await fs.symlink(successor.staging, guard, 'junction');
  });
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
  expect(probe).not.toHaveBeenCalled();
  expect((await fs.lstat(guard)).isSymbolicLink()).toBe(true);
  expect(await actual.readFile(join(successor.staging, successor.name), 'utf8')).toBe(
    successor.record,
  );
  expect(await fs.readdir(directory)).toEqual(
    [guard, successor.staging].map((entry) => entry.slice(directory.length + 1)).sort(),
  );
});

it('retains Windows directory EPERM when the sole valid-looking marker is a hard link', async () => {
  const probe = stubLiveWindowsIdentity();
  await seed();
  const successor = await stageSuccessor();
  const outside = join(directory, 'outside');
  await fs.link(join(successor.staging, successor.name), outside);
  const refusal = refuseWithSuccessor(successor);
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
  expect(probe).not.toHaveBeenCalled();
  expect(await actual.readFile(successor.marker, 'utf8')).toBe(successor.record);
  expect(await actual.readFile(outside, 'utf8')).toBe(successor.record);
  expect(await fs.readdir(directory)).toEqual(['graphgoblin.lock.reclaim', 'outside']);
});

it('preserves the original denial when a physical successor is replaced during the identity probe', async () => {
  const probe = stubLiveWindowsIdentity();
  await seed();
  const successor = await stageSuccessor();
  const moved = join(directory, 'moved');
  const refusal = refuseWithSuccessor(successor);
  probe.mockImplementationOnce(async () => {
    await actual.rename(guard, moved);
    await fs.mkdir(guard);
    await fs.writeFile(successor.marker, successor.record); // Same token and bytes, different objects.
    await fs.rm(moved, { recursive: true });
    return { identity: creationTime };
  });
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
  expect(probe).toHaveBeenCalledExactlyOnceWith(foreignPid);
  await expectSuccessorIntact(successor);
});

describe('post-probe rechecks after a positive foreign identity lookup (FUP084)', () => {
  it('rejects a successor whose sole marker was replaced in place while its directory stayed', async () => {
    const probe = stubLiveWindowsIdentity();
    await seed();
    const successor = await stageSuccessor();
    const refusal = refuseWithSuccessor(successor);
    let directoryAtProbe: BigIntStats | undefined;
    probe.mockImplementationOnce(async () => {
      directoryAtProbe = await actual.lstat(guard, { bigint: true });
      // Same name, token and bytes; a new marker object. Its replacement exists before the old
      // one is gone, so the filesystem cannot reuse the old inode.
      const replacement = join(guard, 'replacement.tmp');
      await actual.writeFile(replacement, successor.record);
      await actual.rename(replacement, successor.marker);
      return { identity: creationTime };
    });
    await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
    expect(probe).toHaveBeenCalledExactlyOnceWith(foreignPid);
    // The directory itself never changed: only the marker predicate can have refused.
    const after = await actual.lstat(guard, { bigint: true });
    expect([after.dev, after.ino]).toEqual([directoryAtProbe!.dev, directoryAtProbe!.ino]);
    // After the probe: the final listing passed, the marker recheck ran, and the final directory
    // identity check was never reached; the only later guard lstat is the disappearance probe.
    const order = probe.mock.invocationCallOrder[0]!;
    expect(targetsAfter(vi.mocked(fs.readdir), order)).toEqual([guard]);
    expect(targetsAfter(vi.mocked(fs.lstat), order)).toEqual([successor.marker, guard]);
    expect(guardRemovals()).toHaveLength(1);
    await expectSuccessorIntact(successor);
  });

  it('rejects a successor whose final directory identity differs while its marker is unchanged', async () => {
    const probe = stubLiveWindowsIdentity();
    await seed();
    const successor = await stageSuccessor();
    const refusal = refuseWithSuccessor(successor);
    let markerAtProbe: BigIntStats | undefined;
    let control: { consumed(): boolean } | undefined;
    probe.mockImplementationOnce(async () => {
      markerAtProbe = await actual.lstat(successor.marker, { bigint: true });
      // Controlled observation: only the next bigint lstat of the guard path (the final directory
      // identity check) reports a different inode. Nothing on disk changes.
      control = controlLstat((target) => target === guard, otherInode);
      return { identity: creationTime };
    });
    await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
    expect(probe).toHaveBeenCalledExactlyOnceWith(foreignPid);
    expect(control?.consumed()).toBe(true);
    // The marker's identity, times, bytes and token stayed the same across every read.
    const marker = await actual.lstat(successor.marker, { bigint: true });
    expect([marker.dev, marker.ino, marker.mtimeNs, marker.ctimeNs]).toEqual([
      markerAtProbe!.dev,
      markerAtProbe!.ino,
      markerAtProbe!.mtimeNs,
      markerAtProbe!.ctimeNs,
    ]);
    // After the probe: marker recheck, the controlled final directory identity, then the real
    // disappearance probe. The directory predicate alone refused.
    const order = probe.mock.invocationCallOrder[0]!;
    expect(targetsAfter(vi.mocked(fs.readdir), order)).toEqual([guard]);
    expect(targetsAfter(vi.mocked(fs.lstat), order)).toEqual([successor.marker, guard, guard]);
    expect(guardRemovals()).toHaveLength(1);
    await expectSuccessorIntact(successor);
  });
});

it('preserves non-Windows directory EPERM even when a verified live successor is present', async () => {
  const probe = stubLiveWindowsIdentity();
  Object.defineProperty(process, 'platform', { value: 'linux' });
  await seed();
  const successor = await stageSuccessor();
  const refusal = refuseWithSuccessor(successor);
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
  expect(probe).not.toHaveBeenCalled();
  await expectSuccessorIntact(successor);
});

describe("this caller's own Windows guard release (#542)", () => {
  /** Refuse removal of the guard only once the main lock exists: this caller's own release. */
  function refuseOwnRelease(beforeRefusal: () => Promise<unknown> = () => Promise.resolve()) {
    const refusal = denied();
    vi.mocked(fs.rmdir).mockImplementation(async (target) => {
      if (target === guard && (await exists(path))) {
        expect(JSON.parse(await actual.readFile(path, 'utf8'))).toMatchObject({ pid: process.pid });
        await beforeRefusal();
        throw refusal;
      }
      await actual.rmdir(target);
    });
    return refusal;
  }

  const publishSuccessor = (successor: Awaited<ReturnType<typeof stageSuccessor>>) => async () => {
    await actual.rmdir(guard);
    await actual.rename(successor.staging, guard);
  };

  it.each([false, true])(
    'keeps its main lock and claims nothing more when the denial exposes a verified live successor (stale guard first: %s)',
    async (staleGuard) => {
      const probe = stubLiveWindowsIdentity();
      if (staleGuard) await seed();
      const successor = await stageSuccessor();
      refuseOwnRelease(publishSuccessor(successor));
      const lock = await acquireDataDirLock(directory);
      expect(lock.reclaimed).toEqual({ file: false, guard: staleGuard });
      expect(probe).toHaveBeenCalledExactlyOnceWith(foreignPid);
      expect(guardRemovals()).toHaveLength(staleGuard ? 2 : 1);
      // The exclusive main record stays this caller's; the successor keeps its own guard.
      expect(JSON.parse(await actual.readFile(path, 'utf8'))).toMatchObject({ pid: process.pid });
      await expectSuccessorIntact(successor, ['graphgoblin.lock', 'graphgoblin.lock.reclaim']);
      await expect(acquireDataDirLock(directory)).rejects.toThrow(
        `another GraphGoblin process holds ${path}`,
      );
      await expect(lock.release()).resolves.toBe('removed');
      await expectSuccessorIntact(successor);
    },
  );

  it.each<[string, () => Promise<unknown>]>([
    ['an unchanged guard', () => Promise.resolve()],
    [
      'a changed but empty guard',
      async () => {
        await actual.rmdir(guard);
        await actual.mkdir(guard);
      },
    ],
  ])('rolls back its main lock on a persistent denial with %s', async (_name, change) => {
    const probe = stubLiveWindowsIdentity();
    const refusal = refuseOwnRelease(change);
    await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
      message: `Store acquisition rolled back because reclamation cleanup failed: ${path}`,
      cause: directoryFailure(refusal),
    });
    expect(probe).not.toHaveBeenCalled();
    expect(guardRemovals()).toHaveLength(1);
    await expect(actual.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await actual.readdir(guard)).toEqual([]);
    expect(await dataDirLockState(directory)).toMatchObject({ state: 'held', path: guard });
  });

  it.each([
    ['a mismatched UUID record', (token: string) => liveRecord(token, { token: randomUUID() }), 0],
    ['an unverifiable identity', liveRecord, 1],
  ] as const)(
    'rolls back its main lock when a successor has %s',
    async (_name, contents, lookups) => {
      const probe = stubLiveWindowsIdentity();
      probe.mockResolvedValueOnce({ reason: 'WMI probe denied' });
      const successor = await stageSuccessor(contents);
      const refusal = refuseOwnRelease(publishSuccessor(successor));
      await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
        message: expect.stringContaining('rolled back'),
        cause: directoryFailure(refusal),
      });
      expect(probe).toHaveBeenCalledTimes(lookups);
      expect(guardRemovals()).toHaveLength(1);
      await expect(actual.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
      await expectSuccessorIntact(successor);
    },
  );

  it('reports a failed post-denial lookup of its guard as evidence and rolls back', async () => {
    const probe = stubLiveWindowsIdentity();
    const lookup = failure('synthetic guard lookup refusal', 'EACCES');
    const refusal = refuseOwnRelease(() => {
      vi.mocked(fs.lstat).mockRejectedValueOnce(lookup);
      return Promise.resolve();
    });
    await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
      message: expect.stringContaining('rolled back'),
      cause: {
        ...directoryFailure(refusal),
        probeFailures: [{ operation: 'recovery-directory-lookup', code: 'EACCES', cause: lookup }],
      },
    });
    expect(probe).not.toHaveBeenCalled();
    expect(guardRemovals()).toHaveLength(1);
  });

  const staging = (target: string) => target.endsWith('.tmp');
  it.each([
    [
      'its staged identity is unavailable',
      () =>
        controlLstat(staging, () => {
          throw denied();
        }),
    ],
    ['its staged identity differs', () => controlLstat(staging, otherInode)],
    [
      'its published identity is unknown (inode 0)',
      () =>
        controlLstat(
          (target) => target === guard,
          (stats) => Object.assign(stats, { ino: 0n }),
        ),
    ],
    [
      'its published identity is unstable',
      () => {
        // The capture's second guard lstat reports a different inode than its first.
        let observations = 0;
        return controlLstat(
          (target) => target === guard,
          (stats) => (++observations === 2 ? otherInode(stats) : stats),
          2,
        );
      },
    ],
    [
      'its published guard does not list exactly its own marker',
      () => {
        // The capture's listing is the first directory listing of a fresh acquisition.
        let listed = false;
        vi.mocked(fs.readdir).mockImplementationOnce((async (target: string) => {
          listed = true;
          return [...(await actual.readdir(target)), 'unexpected.json'];
        }) as typeof fs.readdir);
        return { consumed: () => listed };
      },
    ],
    [
      'its published guard cannot be listed',
      () => {
        vi.mocked(fs.readdir).mockRejectedValueOnce(denied());
        return { consumed: () => vi.mocked(fs.readdir).mock.calls.length > 0 };
      },
    ],
  ] as const)('cannot prove a successor and rolls back when %s', async (_name, arm) => {
    const probe = stubLiveWindowsIdentity();
    const successor = await stageSuccessor();
    const control = arm();
    const refusal = refuseOwnRelease(publishSuccessor(successor));
    await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
      message: expect.stringContaining('rolled back'),
      cause: directoryFailure(refusal),
    });
    expect(control.consumed()).toBe(true);
    expect(probe).not.toHaveBeenCalled();
    expect(guardRemovals()).toHaveLength(1);
    await expectSuccessorIntact(successor);
  });

  it('does not classify a successor when its own marker was already gone at removal', async () => {
    const probe = stubLiveWindowsIdentity();
    const successor = await stageSuccessor();
    vi.mocked(fs.unlink).mockImplementation(async (target) => {
      await actual.unlink(target);
      // Its exact record was read, but this release did not itself remove the marker.
      if (typeof target === 'string' && dirname(target) === guard)
        throw failure('synthetic concurrent removal', 'ENOENT');
    });
    const refusal = refuseOwnRelease(publishSuccessor(successor));
    await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
      message: expect.stringContaining('rolled back'),
      cause: directoryFailure(refusal),
    });
    expect(probe).not.toHaveBeenCalled();
    expect(guardRemovals()).toHaveLength(1);
    await expectSuccessorIntact(successor);
  });

  it('publishes and releases normally when its guard identity cannot be captured', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const control = controlLstat(
      (target) => target.endsWith('.tmp'),
      () => {
        throw denied();
      },
    );
    const lock = await acquireDataDirLock(directory);
    expect(control.consumed()).toBe(true);
    await expect(lock.release()).resolves.toBe('removed');
    expect(await actual.readdir(directory)).toEqual([]);
  });

  it('keeps its missing outcome without touching the guard when its own marker is already gone', async () => {
    const probe = stubLiveWindowsIdentity();
    vi.mocked(fs.readFile).mockImplementation(async (...args) => {
      if (typeof args[0] === 'string' && dirname(args[0]) === guard) {
        await actual.unlink(args[0]);
        throw failure('synthetic vanished marker', 'ENOENT');
      }
      return actual.readFile(...args);
    });
    const lock = await acquireDataDirLock(directory);
    // The release found nothing of its own: no removal, no classification, the main lock stays.
    expect(guardRemovals()).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
    expect(await actual.readdir(guard)).toEqual([]);
    expect(JSON.parse(await actual.readFile(path, 'utf8'))).toMatchObject({ pid: process.pid });
    await expect(lock.release()).resolves.toBe('removed');
  });

  it.each(['ENOENT', 'ENOTEMPTY'])(
    'keeps its existing release outcome for %s without classifying a successor',
    async (code) => {
      const probe = stubLiveWindowsIdentity();
      vi.mocked(fs.rmdir).mockImplementation(async (target) => {
        if (target === guard && (await exists(path))) {
          if (code === 'ENOENT') await actual.rmdir(guard);
          throw failure(`synthetic ${code}`, code);
        }
        await actual.rmdir(target);
      });
      const lock = await acquireDataDirLock(directory);
      expect(probe).not.toHaveBeenCalled();
      const release = vi.mocked(fs.rmdir).mock.calls.findIndex(([target]) => target === guard);
      const order = vi.mocked(fs.rmdir).mock.invocationCallOrder[release]!;
      expect(targetsAfter(vi.mocked(fs.lstat), order)).not.toContain(guard);
      await expect(lock.release()).resolves.toBe('removed');
    },
  );

  it('preserves non-Windows rollback even when a verified live successor is present', async () => {
    const probe = stubLiveWindowsIdentity();
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const successor = await stageSuccessor();
    const refusal = refuseOwnRelease(publishSuccessor(successor));
    await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
      message: expect.stringContaining('rolled back'),
      cause: directoryFailure(refusal),
    });
    expect(probe).not.toHaveBeenCalled();
    await expectSuccessorIntact(successor);
  });
});

it('retains a genuine guard-directory removal failure and rolls back its main lock', async () => {
  vi.mocked(fs.rmdir).mockImplementation(async (target) => {
    if (target === `${path}.reclaim` && (await fs.readdir(target)).length === 0) throw denied();
    await actual.rmdir(target);
  });
  await expect(acquireDataDirLock(directory)).rejects.toThrow('rolled back');
  await expect(fs.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await dataDirLockState(directory)).toMatchObject({ state: 'held' });
});

it('never removes a successor published before an absent-marker EPERM recheck', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const marker = await seed();
  const successorToken = randomUUID();
  const successor = join(`${path}.reclaim`, `${successorToken}.json`);
  const replacement = JSON.stringify({
    pid: process.pid + 1,
    token: successorToken,
    windowsCreationTime: '134388256826197770',
  });
  vi.spyOn(process, 'kill').mockReturnValue(true);
  vi.spyOn(identity, 'windowsProcessIdentity').mockResolvedValue({
    identity: '134388256826197770',
  });
  vi.mocked(fs.unlink).mockImplementation(async (target) => {
    await actual.unlink(target);
    if (target === marker) {
      await fs.writeFile(successor, replacement);
      throw denied();
    }
  });
  await expect(acquireDataDirLock(directory)).rejects.toThrow('another GraphGoblin process holds');
  expect(vi.mocked(fs.rmdir).mock.calls.map(([target]) => target)).not.toContain(guard);
  expect(await fs.readFile(successor, 'utf8')).toBe(replacement);
  await expect(fs.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves non-Windows EPERM even when a stale marker disappeared', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  const marker = await seed();
  vi.mocked(fs.unlink).mockImplementation(async (target) => {
    await actual.unlink(target);
    if (target === marker) throw denied();
  });
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
    code: 'EPERM',
    operation: 'stale-marker-unlink',
  });
});

it.each(['ordinary', 'attested'] as const)(
  'rolls back a newly acquired %s main lock if its recovery marker cannot be released',
  async (kind) => {
    let matchingOwnerAtFailure = false;
    vi.mocked(fs.unlink).mockImplementation(async (target) => {
      if (String(target).includes('.reclaim') && !String(target).includes('.tmp')) {
        matchingOwnerAtFailure =
          (await actual.readFile(path, 'utf8')) === (await actual.readFile(target, 'utf8'));
        throw denied();
      }
      await actual.unlink(target);
    });
    const acquisition =
      kind === 'attested'
        ? acquireDataDirLock(directory, undefined, { attestLocalArtifact: true })
        : acquireDataDirLock(directory);
    await expect(acquisition).rejects.toMatchObject({
      message: expect.stringContaining('rolled back'),
      cause: { operation: 'recovery-marker-unlink', code: 'EPERM' },
    });
    expect(matchingOwnerAtFailure).toBe(true);
    await expect(fs.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await dataDirLockState(directory)).toMatchObject({
      state: 'held',
      path: `${path}.reclaim`,
    });
    await expect(acquireDataDirLock(directory)).rejects.toThrow(
      'another GraphGoblin process holds',
    );
  },
);

it('explicitly reports retained ownership if both recovery release and main rollback fail', async () => {
  vi.mocked(fs.unlink).mockRejectedValue(denied());
  await expect(acquireDataDirLock(directory)).rejects.toThrow('ownership remains held');
  expect(JSON.parse(await fs.readFile(path, 'utf8'))).toMatchObject({ pid: process.pid });
  expect(await dataDirLockState(directory)).toMatchObject({ state: 'held' });
  await expect(acquireDataDirLock(directory)).rejects.toThrow('another GraphGoblin process holds');
});

it('retains the original ownership refusal alongside recovery cleanup failures', async () => {
  const original = 'malformed original lock';
  await fs.writeFile(path, original);
  vi.mocked(fs.unlink).mockImplementation(async (target) => {
    if (String(target).includes('.reclaim') && !String(target).includes('.tmp')) throw denied();
    await actual.unlink(target);
  });
  const error = await acquireDataDirLock(directory).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AggregateError);
  expect(String(error)).toContain('Store ownership could not be verified');
  expect(String(error)).toContain('reclamation cleanup also failed');
  expect(await fs.readFile(path, 'utf8')).toBe(original);
});

it('retains an acquisition refusal when unpublished staging cleanup also fails', async () => {
  await fs.writeFile(`${path}.reclaim`, 'preserve old file guard');
  vi.mocked(fs.unlink).mockRejectedValue(denied());
  const error = await acquireDataDirLock(directory).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AggregateError);
  expect(String(error)).toContain('Store ownership could not be verified');
  expect(String(error)).toContain('staging cleanup also failed');
  expect(await fs.readFile(`${path}.reclaim`, 'utf8')).toBe('preserve old file guard');
});

describe('exclusive main record setup failures (#560)', () => {
  type Fault = 'write' | 'stat' | 'close' | 'unlink' | 'lookup';
  const codes: Record<Fault, string> = {
    write: 'ENOSPC',
    stat: 'EIO',
    close: 'EIO',
    unlink: 'EACCES',
    lookup: 'EACCES',
  };
  const steps: Record<Exclude<Fault, 'write'>, string> = {
    stat: 'main-record-identity',
    close: 'main-record-close',
    unlink: 'main-record-unlink',
    lookup: 'main-record-lookup',
  };
  /** A PID no supported platform assigns: a record naming it is stale. */
  const deadPid = 2147483644;

  /**
   * Faults on the exclusively created main record's real handle and path. The handle really
   * writes (partially for a write fault) and really closes before an injected close failure.
   */
  function faultMainRecord(
    faults: readonly Fault[],
    options: { guard?: boolean; afterClose?: () => Promise<void> } = {},
  ) {
    const refusal = (fault: Fault) =>
      failure(`synthetic main record ${fault} refusal`, codes[fault]);
    const errors: Record<Fault, Error> = {
      write: refusal('write'),
      stat: refusal('stat'),
      close: refusal('close'),
      unlink: refusal('unlink'),
      lookup: refusal('lookup'),
    };
    const calls: string[] = [];
    vi.mocked(fs.open).mockImplementation(async (target, flags, mode) => {
      const handle = await actual.open(target, flags, mode);
      if (target !== path || flags !== 'wx') return handle;
      return new Proxy(handle, {
        get(real, key) {
          if (key === 'writeFile')
            return async (data: string, encoding: BufferEncoding) => {
              calls.push('write');
              if (!faults.includes('write')) return real.writeFile(data, encoding);
              await real.writeFile('{"pid":');
              throw errors.write;
            };
          if (key === 'stat')
            return async (statOptions: { bigint: true }) => {
              calls.push('stat');
              if (faults.includes('stat')) throw errors.stat;
              return real.stat(statOptions);
            };
          if (key === 'close')
            return async () => {
              calls.push('close');
              await real.close();
              await options.afterClose?.();
              if (faults.includes('close')) throw errors.close;
            };
          const value: unknown = Reflect.get(real, key, real);
          const forwarded: unknown = typeof value === 'function' ? value.bind(real) : value;
          return forwarded;
        },
      });
    });
    vi.mocked(fs.unlink).mockImplementation(async (target) => {
      if (target === path) {
        calls.push('unlink');
        if (faults.includes('unlink')) throw errors.unlink;
      }
      // This caller's own guard marker: its release fails.
      if (options.guard && dirname(String(target)) === guard) throw denied();
      await actual.unlink(target);
    });
    vi.mocked(fs.lstat).mockImplementation((async (target: string, statOptions?: object) => {
      if (target === path) {
        calls.push('lookup');
        if (faults.includes('lookup')) throw errors.lookup;
      }
      return actual.lstat(target, statOptions);
    }) as typeof fs.lstat);
    return { calls, errors };
  }

  const proven = ['write', 'stat', 'close', 'lookup', 'unlink'];
  const cases = [
    { faults: ['write'], cleanup: [], retained: false, calls: proven },
    { faults: ['write', 'close'], cleanup: ['close'], retained: false, calls: proven },
    { faults: ['write', 'unlink'], cleanup: ['unlink'], retained: true, calls: proven },
    {
      faults: ['write', 'close', 'unlink'],
      cleanup: ['close', 'unlink'],
      retained: true,
      calls: proven,
    },
    {
      faults: ['write', 'stat'],
      cleanup: ['stat'],
      retained: true,
      calls: ['write', 'stat', 'close'],
    },
    {
      faults: ['write', 'stat', 'close'],
      cleanup: ['stat', 'close'],
      retained: true,
      calls: ['write', 'stat', 'close'],
    },
    {
      faults: ['write', 'lookup'],
      cleanup: ['lookup'],
      retained: true,
      calls: ['write', 'stat', 'close', 'lookup'],
    },
    {
      faults: ['close'],
      cleanup: [],
      retained: false,
      calls: ['write', 'close', 'lookup', 'unlink'],
    },
    {
      faults: ['close', 'unlink'],
      cleanup: ['unlink'],
      retained: true,
      calls: ['write', 'close', 'lookup', 'unlink'],
    },
  ] as const;

  it.each(cases.flatMap((entry) => [false, true].map((guardFails) => ({ ...entry, guardFails }))))(
    'keeps the first failure among $faults ahead of its cleanup (guard release also fails: $guardFails)',
    async ({ faults: armed, cleanup, retained, calls: expectedCalls, guardFails }) => {
      const faults: readonly Fault[] = armed;
      const { calls, errors } = faultMainRecord(faults, { guard: guardFails });
      const error = await acquireDataDirLock(directory).catch((caught: unknown) => caught);
      const primary = errors[faults[0]!];
      // One close in every case, and at most one cleanup unlink after a proof check.
      expect(calls).toEqual(expectedCalls);
      const expectedSteps = [
        ...cleanup.map((fault) => [steps[fault], codes[fault]]),
        ...(guardFails ? [['recovery-release', 'EPERM']] : []),
      ];
      if (!expectedSteps.length && !retained) {
        expect(error).toBe(primary);
        expect(shellFailureOutput(error)).toBe(error);
      } else {
        expect(error).toBeInstanceOf(StartupCleanupError);
        expect(error).toBeInstanceOf(AggregateError);
        const tagged = error as StartupCleanupError;
        expect(tagged.primary).toBe(primary);
        expect(tagged.errors[0]).toBe(primary);
        expect(tagged.cause).toBe(primary);
        expect(tagged.cleanup.map(({ operation, code }) => [operation, code])).toEqual(
          expectedSteps,
        );
        expect(tagged.errors.slice(1)).toHaveLength(tagged.cleanup.length);
        tagged.cleanup.forEach(({ error: secondary }, index) =>
          expect(tagged.errors[index + 1]).toBe(secondary),
        );
        cleanup.forEach((fault, index) => expect(tagged.cleanup[index]!.error).toBe(errors[fault]));
        if (guardFails)
          expect(tagged.cleanup.at(-1)!.error).toMatchObject({
            operation: 'recovery-marker-unlink',
            code: 'EPERM',
          });
        expect(tagged.retained).toEqual(retained ? [{ resource: 'lock-record', path }] : []);
        const detail = [
          ...(expectedSteps.length
            ? [
                `cleanup also failed: ${expectedSteps.map(([step, code]) => `${step} (${code})`).join(', ')}`,
              ]
            : []),
          ...(retained ? [`ownership retained: lock record ${path}`] : []),
        ].join('; ');
        expect(tagged.detail).toBe(detail);
        expect(tagged.message).toBe(`${primary.message}; ${detail}`);
        // The primary keeps its usual diagnostic; one bounded line follows it.
        const output = shellFailureOutput(error) as string;
        expect(output.split('\n').at(-1)).toBe(detail);
        expect(output).toContain(primary.message);
        for (const { error: secondary } of tagged.cleanup)
          expect(output).not.toContain((secondary as Error).message);
        expect(startupFailureCause('store', error)).toBe('store-unavailable');
      }
      if (retained) {
        const bytes = await actual.readFile(path, 'utf8');
        if (faults.includes('write')) expect(bytes).toBe('{"pid":');
        else expect(JSON.parse(bytes)).toMatchObject({ pid: process.pid });
        // The unresolved record keeps this process's reservation.
        await expect(acquireDataDirLock(directory)).rejects.toThrow(
          `another GraphGoblin process holds ${path}`,
        );
      } else await expect(actual.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await exists(guard)).toBe(guardFails);
      const state = await dataDirLockState(directory);
      if (guardFails) expect(state).toMatchObject({ state: 'held', path: guard });
      else if (retained)
        expect(state).toMatchObject({
          state: 'held',
          path,
          detail: expect.stringContaining('another GraphGoblin process holds this store'),
        });
      else expect(state).toEqual({ state: 'free' });
    },
  );

  it('treats a partial record already gone before its proof lookup as settled', async () => {
    const { calls, errors } = faultMainRecord(['write'], {
      afterClose: () => actual.unlink(path),
    });
    await expect(acquireDataDirLock(directory)).rejects.toBe(errors.write);
    expect(calls).toEqual(['write', 'stat', 'close', 'lookup']);
    expect(await actual.readdir(directory)).toEqual([]);
    await expect(dataDirLockState(directory)).resolves.toEqual({ state: 'free' });
  });

  it('treats a proven record that disappears during its single unlink as settled', async () => {
    const { calls, errors } = faultMainRecord(['write']);
    vi.mocked(fs.unlink).mockImplementation(async (target) => {
      if (target === path) {
        calls.push('unlink');
        await actual.unlink(target);
        throw failure('synthetic concurrent removal', 'ENOENT');
      }
      await actual.unlink(target);
    });
    await expect(acquireDataDirLock(directory)).rejects.toBe(errors.write);
    expect(calls).toEqual(['write', 'stat', 'close', 'lookup', 'unlink']);
    expect(await actual.readdir(directory)).toEqual([]);
    await expect(dataDirLockState(directory)).resolves.toEqual({ state: 'free' });
  });

  it('preserves a foreign file that replaced a partial record and ends only the local reservation', async () => {
    const { calls, errors } = faultMainRecord(['write'], {
      afterClose: async () => {
        // The replacement exists before the original is gone: its identity cannot be reused.
        await actual.writeFile(`${path}.foreign`, 'foreign bytes');
        await actual.rename(`${path}.foreign`, path);
      },
    });
    await expect(acquireDataDirLock(directory)).rejects.toBe(errors.write);
    expect(calls).toEqual(['write', 'stat', 'close', 'lookup']);
    expect(await actual.readFile(path, 'utf8')).toBe('foreign bytes');
    // Read from the file, not from an in-process reservation.
    await expect(dataDirLockState(directory)).resolves.toMatchObject({
      state: 'held',
      path,
      detail: expect.stringContaining('Store ownership could not be verified'),
    });
    expect(await exists(guard)).toBe(false);
  });

  it('preserves a different record that replaced a complete one before a failed close', async () => {
    const foreign = JSON.stringify({ pid: deadPid, token: randomUUID() });
    const { calls, errors } = faultMainRecord(['close'], {
      afterClose: async () => {
        await actual.writeFile(`${path}.foreign`, foreign);
        await actual.rename(`${path}.foreign`, path);
      },
    });
    await expect(acquireDataDirLock(directory)).rejects.toBe(errors.close);
    expect(calls).toEqual(['write', 'close', 'lookup']);
    expect(await actual.readFile(path, 'utf8')).toBe(foreign);
    // A stale foreign record, read from disk: no in-process reservation remains.
    await expect(dataDirLockState(directory)).resolves.toEqual({ state: 'free' });
  });

  it('removes a complete attested record after its attestation fails and keeps that failure', async () => {
    const { calls, errors } = faultMainRecord(['stat']);
    await expect(
      acquireDataDirLock(directory, undefined, { attestLocalArtifact: true }),
    ).rejects.toBe(errors.stat);
    expect(calls).toEqual(['write', 'stat', 'close', 'lookup', 'unlink']);
    expect(await actual.readdir(directory)).toEqual([]);
    await expect(dataDirLockState(directory)).resolves.toEqual({ state: 'free' });
  });

  it('keeps attested acquisition and refuses its proof once release starts', async () => {
    const lock = await acquireDataDirLock(directory, undefined, { attestLocalArtifact: true });
    const { dev, ino } = await actual.lstat(path, { bigint: true });
    expect(await lock.verifyOwnedArtifact()).toEqual(
      process.geteuid ? { path, dev, ino } : undefined,
    );
    const releasing = lock.release();
    expect(await lock.verifyOwnedArtifact()).toBeUndefined();
    await expect(releasing).resolves.toBe('removed');
    expect(await actual.readdir(directory)).toEqual([]);
  });
});
