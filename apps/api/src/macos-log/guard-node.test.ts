import * as nodeFs from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  GATEWAY_LOG_ACTIVE,
  GATEWAY_LOG_PREVIOUS,
  openGatewayLog,
} from '../managed-log/gateway-log-writer.js';
import { admitMacosLog } from './guard.js';

const rootOpen = vi.hoisted(() => {
  const requests: { path: string; flags: number }[] = [];
  return { requests, reportContentionOnce: false, fd: undefined as number | undefined };
});

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof nodeFs>();
  return {
    ...fs,
    open(
      path: string,
      flags: number,
      callback: (error: NodeJS.ErrnoException | null, fd: number) => void,
    ) {
      rootOpen.requests.push({ path, flags });
      if (rootOpen.reportContentionOnce) {
        rootOpen.reportContentionOnce = false;
        queueMicrotask(() =>
          callback(Object.assign(new Error('simulated Darwin contention'), { code: 'EAGAIN' }), -1),
        );
        return;
      }
      // Only this callback boundary translates Darwin O_EXLOCK for Linux. Root and slot
      // descriptors, metadata, writes, truncation and close use the real filesystem.
      fs.open(path, flags & ~0x20, (error, fd) => {
        if (!error) rootOpen.fd = fd;
        callback(error, fd);
      });
    },
  };
});

const fixtures: string[] = [];
afterEach(async () => {
  rootOpen.requests.length = 0;
  rootOpen.reportContentionOnce = false;
  rootOpen.fd = undefined;
  for (const path of fixtures.splice(0)) await rm(path, { recursive: true, force: true });
});

async function fixture() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'gg-mac-adapter-')));
  fixtures.push(parent);
  const root = join(parent, 'logs');
  await mkdir(root, { mode: 0o700 });
  const alias = join(parent, 'log-alias');
  await symlink(root, alias, 'dir');
  const { dev, ino } = await lstat(root, { bigint: true });
  const snapshot = JSON.stringify({
    version: 1,
    root: alias,
    device: BigInt.asUintN(64, dev).toString(),
    inode: BigInt.asUintN(64, ino).toString(),
  });
  return {
    parent,
    root,
    snapshot,
    active: join(root, GATEWAY_LOG_ACTIVE),
    previous: join(root, GATEWAY_LOG_PREVIOUS),
  };
}

const onLinux = it.runIf(process.platform === 'linux');

onLinux(
  'retries simulated contention, repairs and writes real log slots using the default Node adapter',
  async () => {
    const { root, snapshot, active, previous } = await fixture();
    await writeFile(active, 'complete active\ninterrupted tail', { mode: 0o600 });
    await writeFile(previous, 'complete previous\n', { mode: 0o600 });
    rootOpen.reportContentionOnce = true;

    const admission = await admitMacosLog(snapshot);
    const fd = rootOpen.fd!;
    try {
      const request = {
        path: root,
        flags:
          nodeFs.constants.O_RDONLY |
          nodeFs.constants.O_DIRECTORY |
          nodeFs.constants.O_NOFOLLOW |
          nodeFs.constants.O_NONBLOCK |
          0x20,
      };
      expect(rootOpen.requests).toEqual([request, request]);
      expect(admission.root).toBe(root);
      expect(nodeFs.fstatSync(fd, { bigint: true }).isDirectory()).toBe(true);

      const writer = await openGatewayLog(admission);
      try {
        expect(await readFile(active, 'utf8')).toBe('complete active\n');
        expect(await writer.writeAcknowledged('new complete record\n')).toBe(true);
        expect(await readFile(active, 'utf8')).toBe('complete active\nnew complete record\n');
        expect(await readFile(previous, 'utf8')).toBe('complete previous\n');
        expect(nodeFs.fstatSync(fd, { bigint: true }).isDirectory()).toBe(true);
      } finally {
        await writer.close();
      }
    } finally {
      await admission.releaseOnAdmissionFailure();
    }
    expect(() => nodeFs.fstatSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }));
  },
);

onLinux(
  'closes the real root descriptor when an unsafe previous slot refuses admission',
  async () => {
    const { parent, snapshot, active, previous } = await fixture();
    const sentinel = join(parent, 'sentinel');
    await writeFile(active, 'active before admission\ninterrupted tail', { mode: 0o600 });
    await writeFile(sentinel, 'preserved outside the log root\n', { mode: 0o600 });
    await symlink(sentinel, previous);

    const admission = admitMacosLog(snapshot);
    try {
      await expect(admission).rejects.toMatchObject({ reason: 'unavailable' });
      expect(rootOpen.fd).toBeDefined();
      expect(() => nodeFs.fstatSync(rootOpen.fd!)).toThrow(
        expect.objectContaining({ code: 'EBADF' }),
      );
      expect(await readFile(active, 'utf8')).toBe('active before admission\ninterrupted tail');
      expect(await readlink(previous)).toBe(sentinel);
      expect(await readFile(sentinel, 'utf8')).toBe('preserved outside the log root\n');
    } finally {
      await admission.then(
        (accepted) => accepted.releaseOnAdmissionFailure(),
        () => undefined,
      );
    }
  },
);
