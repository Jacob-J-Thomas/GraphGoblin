import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  acquireDataDirLock,
  dataDirLockState,
  StoreOwnershipRefusedError,
} from './data-dir-lock.js';
import { shellFailureOutput, startupFailureCause } from './serve.js';
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

async function expectSuccessorIntact(successor: Awaited<ReturnType<typeof stageSuccessor>>) {
  expect(await actual.readFile(successor.marker, 'utf8')).toBe(successor.record);
  expect(await fs.readdir(directory)).toEqual(['graphgoblin.lock.reclaim']);
  expect(vi.mocked(fs.unlink).mock.calls.map(([target]) => target)).not.toContain(successor.marker);
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

it('preserves a refused read when the recovery marker still exists', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const marker = await seed();
  const original = await actual.readFile(marker);
  const refusal = denied();
  vi.mocked(fs.readFile).mockRejectedValueOnce(refusal);
  await expect(acquireDataDirLock(directory)).rejects.toBe(refusal);
  expect(await actual.readFile(marker)).toEqual(original);
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

it.each([{ reason: 'WMI probe denied' }, { identity: '134388256826197771' }])(
  'keeps Windows directory EPERM when the successor creation identity is unverified (%j)',
  async (result) => {
    stubLiveWindowsIdentity().mockResolvedValueOnce(result);
    await seed();
    const successor = await stageSuccessor();
    const refusal = refuseWithSuccessor(successor);
    await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
    await expectSuccessorIntact(successor);
  },
);

it('preserves a live successor and the original denial when the directory recheck is inaccessible', async () => {
  const probe = stubLiveWindowsIdentity();
  await seed();
  const successor = await stageSuccessor();
  const refusal = refuseWithSuccessor(successor, () => {
    vi.mocked(fs.lstat).mockRejectedValueOnce(denied());
  });
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject(directoryFailure(refusal));
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
  await expectSuccessorIntact(successor);
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

it('rolls back the main lock when Windows guard release fails while a successor is present', async () => {
  const probe = stubLiveWindowsIdentity();
  const successor = await stageSuccessor();
  const refusal = refuseGuardRemoval(async () => {
    expect(JSON.parse(await actual.readFile(path, 'utf8'))).toMatchObject({ pid: process.pid });
    await actual.rmdir(guard);
    await actual.rename(successor.staging, guard);
  });
  await expect(acquireDataDirLock(directory)).rejects.toMatchObject({
    message: expect.stringContaining('rolled back'),
    cause: directoryFailure(refusal),
  });
  expect(probe).not.toHaveBeenCalled();
  await expectSuccessorIntact(successor);
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
