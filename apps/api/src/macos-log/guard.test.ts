import { constants } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GATEWAY_LOG_ACTIVE,
  GATEWAY_LOG_PREVIOUS,
  openGatewayLog,
} from '../managed-log/gateway-log-writer.js';
import { admitMacosLog, takeMacosLogAdmission, type DarwinLogOperations } from './guard.js';

const canonical = '/private/physical/logs';
const active = join(canonical, GATEWAY_LOG_ACTIVE);
const previous = join(canonical, GATEWAY_LOG_PREVIOUS);
const uid = 501n;
const openedDev = -1n;
const openedIno = -9_223_372_036_854_775_808n;
const error = (code: string) => Object.assign(new Error(code), { code });

function snapshot(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    root: '/alias/logs',
    device: '18446744073709551615',
    inode: '9223372036854775808',
    ...overrides,
  });
}

type Stat = Awaited<ReturnType<DarwinLogOperations['lstat']>>;
const stat = (directory: boolean, values: Partial<Stat> = {}): Stat => ({
  dev: openedDev,
  ino: openedIno,
  mode: directory ? 0o700n : 0o600n,
  uid,
  size: 0n,
  nlink: 1n,
  isFile: () => !directory,
  isDirectory: () => directory,
  isSymbolicLink: () => false,
  ...values,
});

function fixture() {
  let tick = 0;
  let nextInode = openedIno;
  let root = stat(true);
  const slots = new Map<string, Stat>();
  const read = vi.fn(() => Promise.resolve({ bytesRead: 0 }));
  const write = vi.fn((_buffer: Buffer, _offset: number, size: number) =>
    Promise.resolve({ bytesWritten: size }),
  );
  const truncate = vi.fn(() => Promise.resolve());
  const closeSlot = vi.fn(() => Promise.resolve());
  const operations = {
    getEffectiveUid: vi.fn<() => number | undefined>(() => Number(uid)),
    realpath: vi.fn(() => Promise.resolve(canonical)),
    openRoot: vi.fn(() => Promise.resolve(102)),
    statRoot: vi.fn(() => Promise.resolve(root)),
    closeRoot: vi.fn(() => Promise.resolve()),
    lstat: vi.fn((path: string) => {
      if (path === canonical) return Promise.resolve(root);
      const slot = slots.get(path);
      return slot ? Promise.resolve(slot) : Promise.reject(error('ENOENT'));
    }),
    openSlot: vi.fn<DarwinLogOperations['openSlot']>((path, flags, _mode) => {
      let opened = slots.get(path);
      if ((flags & constants.O_CREAT) !== 0) {
        if (opened) return Promise.reject(error('EEXIST'));
        opened = stat(false, { ino: ++nextInode });
        slots.set(path, opened);
      }
      if (!opened) return Promise.reject(error('ENOENT'));
      const handle = opened;
      return Promise.resolve({
        stat: () => Promise.resolve(handle),
        read,
        write,
        truncate,
        close: closeSlot,
      });
    }),
    rename: vi.fn((from: string, to: string) => {
      slots.set(to, slots.get(from)!);
      slots.delete(from);
      return Promise.resolve();
    }),
    now: () => tick,
    delay: vi.fn((ms: number) => {
      tick += ms;
      return Promise.resolve();
    }),
  } satisfies DarwinLogOperations;
  return {
    operations,
    slots,
    write,
    truncate,
    closeSlot,
    setRoot: (value: Stat) => (root = value),
  };
}

it('removes every spelling of the detached child input', () => {
  const env = {
    gg_Macos_Launcher_Log_Admission: 'first',
    GG_MACOS_LAUNCHER_LOG_ADMISSION: 'second',
    GG_PORT: '6404',
  };
  expect(takeMacosLogAdmission(env)).toBe('first');
  expect(env).toEqual({ GG_PORT: '6404' });
  expect(takeMacosLogAdmission(env)).toBeUndefined();
});

describe('Darwin log admission', () => {
  it.each([
    [0n, 0n, '0', '0'],
    [16_777_228n, 9_007_199_254_740_993n, '16777228', '9007199254740993'],
    [2_147_483_647n, 9_223_372_036_854_775_807n, '2147483647', '9223372036854775807'],
    [-2_147_483_648n, openedIno, '18446744071562067968', '9223372036854775808'],
    [openedDev, openedIno + 1n, '18446744073709551615', '9223372036854775809'],
    [openedDev, -1n, '18446744073709551615', '18446744073709551615'],
  ])(
    'compares native device %s and inode %s without precision loss',
    async (dev, ino, device, inode) => {
      const f = fixture();
      f.setRoot(stat(true, { dev, ino }));
      const admitted = await admitMacosLog(snapshot({ device, inode }), f.operations);
      expect(admitted.root).toBe(canonical);
      expect(f.operations.realpath).toHaveBeenCalledWith('/alias/logs');
      expect(f.operations.openRoot).toHaveBeenCalledWith(
        canonical,
        constants.O_RDONLY |
          constants.O_DIRECTORY |
          constants.O_NOFOLLOW |
          0x20 |
          constants.O_NONBLOCK,
      );
      expect(f.operations.closeRoot).not.toHaveBeenCalled();
      await admitted.releaseOnAdmissionFailure();
      await admitted.releaseOnAdmissionFailure();
      expect(f.operations.closeRoot).toHaveBeenCalledExactlyOnceWith(102);
    },
  );

  it.each(['-1', '+1', '01', '1e3', '1\n', '18446744073709551616', 1, '١', ' 1', ''])(
    'rejects noncanonical wire identity %j before opening anything',
    async (value) => {
      const f = fixture();
      for (const name of ['device', 'inode'])
        await expect(
          admitMacosLog(snapshot({ [name]: value }), f.operations),
        ).rejects.toMatchObject({
          reason: 'unavailable',
        });
      expect(f.operations.realpath).not.toHaveBeenCalled();
      expect(f.operations.openRoot).not.toHaveBeenCalled();
    },
  );

  it.each([
    'not JSON',
    'null',
    '[]',
    snapshot({ version: 2 }),
    snapshot({ version: '1' }),
    snapshot({ root: 'relative' }),
    snapshot({ root: '/bad\0root' }),
    snapshot({ other: true }),
    snapshot({ root: '/' + 'é'.repeat(2_048) }),
  ])('rejects an invalid snapshot before resolver admission', async (raw) => {
    const f = fixture();
    await expect(admitMacosLog(raw, f.operations)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.operations.realpath).not.toHaveBeenCalled();
  });

  it.each([
    ['opened device', true, { dev: -2n }],
    ['opened inode', true, { ino: openedIno + 1n }],
    ['named inode', false, { ino: openedIno + 1n }],
    ['root access', false, { mode: 0o755n }],
    ['root owner', true, { uid: 777n }],
    ['root kind', false, { isDirectory: () => false }],
  ] as const)(
    'refuses a different %s and closes the acquired FD',
    async (_name, opened, values) => {
      const f = fixture();
      if (opened) f.operations.statRoot.mockResolvedValueOnce(stat(true, values));
      else f.operations.lstat.mockResolvedValueOnce(stat(true, values));
      await expect(admitMacosLog(snapshot(), f.operations)).rejects.toMatchObject({
        reason: 'unavailable',
      });
      expect(f.operations.closeRoot).toHaveBeenCalledExactlyOnceWith(102);
      expect(f.operations.openSlot).not.toHaveBeenCalled();
    },
  );

  it('retries EAGAIN only until the monotonic 1,500 ms window has elapsed', async () => {
    const f = fixture();
    f.operations.openRoot.mockRejectedValue(error('EAGAIN'));
    await expect(admitMacosLog(snapshot(), f.operations)).rejects.toMatchObject({
      reason: 'in-use',
    });
    expect(f.operations.now()).toBe(1_500);
    expect(f.operations.delay).toHaveBeenCalledTimes(60);
    expect(f.operations.closeRoot).not.toHaveBeenCalled();
    expect(f.operations.openSlot).not.toHaveBeenCalled();
  });

  it('can acquire after a retry and refuses other open errors immediately', async () => {
    const first = fixture();
    first.operations.openRoot.mockRejectedValueOnce(error('EAGAIN'));
    const admitted = await admitMacosLog(snapshot(), first.operations);
    expect(first.operations.openRoot).toHaveBeenCalledTimes(2);
    await admitted.releaseOnAdmissionFailure();

    const second = fixture();
    second.operations.openRoot.mockRejectedValueOnce(error('EPERM'));
    await expect(admitMacosLog(snapshot(), second.operations)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(second.operations.delay).not.toHaveBeenCalled();
    expect(second.operations.closeRoot).not.toHaveBeenCalled();
  });

  it.each([{ isFile: () => false }, { mode: 0o644n }, { uid: 777n }, { nlink: 2n }, { dev: -2n }])(
    'refuses unsafe preexisting slot metadata %o before writer mutation',
    async (values) => {
      const f = fixture();
      f.slots.set(active, stat(false));
      f.slots.set(previous, stat(false, values));
      await expect(admitMacosLog(snapshot(), f.operations)).rejects.toMatchObject({
        reason: 'unavailable',
      });
      expect(f.closeSlot).toHaveBeenCalledOnce();
      expect(f.operations.closeRoot).toHaveBeenCalledExactlyOnceWith(102);
      expect(f.write).not.toHaveBeenCalled();
      expect(f.truncate).not.toHaveBeenCalled();
    },
  );

  it('checks the pre-admitted slot name against the opened high-bit identity', async () => {
    const f = fixture();
    f.slots.set(active, stat(false, { ino: openedIno + 1n }));
    f.operations.openSlot.mockResolvedValueOnce({
      stat: () => Promise.resolve(stat(false)),
      read: () => Promise.resolve({ bytesRead: 0 }),
      write: () => Promise.resolve({ bytesWritten: 0 }),
      truncate: f.truncate,
      close: f.closeSlot,
    });
    await expect(admitMacosLog(snapshot(), f.operations)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(f.closeSlot).toHaveBeenCalledOnce();
    expect(f.operations.closeRoot).toHaveBeenCalledOnce();
  });
});

it('passes full-width normalized slot identities through the shared writer and writes safely', async () => {
  const f = fixture();
  const admitted = await admitMacosLog(snapshot(), f.operations);
  const writer = await openGatewayLog(admitted);
  try {
    const activeStat = await admitted.fs.lstat(active);
    expect(activeStat.dev).toBe(18_446_744_073_709_551_615n);
    expect(activeStat.ino).toBe(9_223_372_036_854_775_809n);
    expect(await writer.writeAcknowledged('{"msg":"private log"}\n')).toBe(true);
    expect(f.write).toHaveBeenCalledOnce();
    expect(f.operations.openSlot).toHaveBeenCalledWith(
      active,
      constants.O_RDWR |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        constants.O_CREAT |
        constants.O_EXCL,
      0o600,
    );
  } finally {
    await writer.close();
    await admitted.releaseOnAdmissionFailure();
  }
});

it('rechecks metadata at writes, truncation, rename and recreation', async () => {
  const f = fixture();
  const admitted = await admitMacosLog(snapshot(), f.operations);
  const handle = await admitted.fs.open(active, 'create');
  try {
    const original = f.slots.get(active)!;
    await handle.truncate(0);
    expect(f.truncate).toHaveBeenCalledOnce();
    f.slots.set(active, { ...original, ino: original.ino + 1n });
    await expect(handle.write(Buffer.from('x'), 0, 1, 0)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(f.write).not.toHaveBeenCalled();
    f.slots.set(active, { ...original, mode: 0o644n });
    await expect(handle.truncate(0)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.truncate).toHaveBeenCalledOnce();
    f.slots.set(active, original);
    f.slots.set(previous, stat(false, { nlink: 2n }));
    await expect(admitted.fs.rename(active, previous)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(f.operations.rename).not.toHaveBeenCalled();
    f.slots.delete(previous);
    await admitted.fs.rename(active, previous);
    expect(f.operations.rename).toHaveBeenCalledExactlyOnceWith(active, previous);
    await expect(admitted.fs.open(join(canonical, 'other.log'), 'create')).rejects.toMatchObject({
      reason: 'unavailable',
    });

    f.setRoot(stat(true, { ino: openedIno + 1n }));
    await expect(admitted.fs.open(active, 'create')).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(f.operations.openSlot).toHaveBeenCalledOnce();
  } finally {
    await handle.close();
    await admitted.releaseOnAdmissionFailure();
  }
});
