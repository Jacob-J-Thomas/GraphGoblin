import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acquireDataDirLock, dataDirLockState } from './data-dir-lock.js';
import * as identity from './windows-process-identity.js';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof fs>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    unlink: vi.fn(actual.unlink),
    rmdir: vi.fn(actual.rmdir),
  };
});
const actual = await vi.importActual<typeof fs>('node:fs/promises');
const platform = process.platform;
let directory: string;
let path: string;
const denied = () => Object.assign(new Error('synthetic permission refusal'), { code: 'EPERM' });

beforeEach(async () => {
  directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'gg-lock-failure-'));
  path = join(directory, 'graphgoblin.lock');
  vi.spyOn(identity, 'ownWindowsProcessIdentity').mockResolvedValue('134388256826197770');
});
afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: platform });
  vi.restoreAllMocks();
  vi.mocked(fs.readFile).mockReset();
  vi.mocked(fs.unlink).mockImplementation(actual.unlink);
  vi.mocked(fs.rmdir).mockImplementation(actual.rmdir);
  await fs.rm(directory, { recursive: true, force: true });
});

async function seed() {
  const token = randomUUID();
  const guard = `${path}.reclaim`;
  const marker = join(guard, `${token}.json`);
  await fs.mkdir(guard);
  await fs.writeFile(marker, JSON.stringify({ pid: process.pid, token }));
  return marker;
}

it('recognizes a Windows recovery marker that disappeared before its owner could be read', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const marker = await seed();
  vi.mocked(fs.readFile).mockImplementationOnce(async (target) => {
    expect(target).toBe(marker);
    await actual.unlink(marker);
    throw denied();
  });
  const lock = await acquireDataDirLock(directory);
  await expect(actual.readFile(path, 'utf8')).resolves.toContain(String(process.pid));
  expect(vi.mocked(fs.unlink).mock.calls.some(([target]) => target === marker)).toBe(false);
  await lock.release();
  expect(await fs.readdir(directory)).toEqual([]);
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
    if (target === marker) throw denied();
  });
  const lock = await acquireDataDirLock(directory);
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

it('accepts Windows rmdir EPERM only after the guard directory is independently absent', async () => {
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
  await lock.release();
  expect(removed).toBe(true);
  expect(await fs.readdir(directory)).toEqual([]);
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
