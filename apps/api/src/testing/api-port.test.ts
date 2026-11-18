import { access, readdir, rename } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { expect, inject, it, vi } from 'vitest';
import { reserveApiPort } from './api-port.js';
import { createApiProcessFixture, listening } from './api-subprocess.js';

async function activeClaim(port: number) {
  const slot = join(inject('apiPortRoot'), String(port));
  const generation = Math.max(...(await readdir(slot)).map(Number));
  const path = join(slot, String(generation));
  const [owner] = await readdir(path);
  expect(owner).toBeDefined();
  return { owner: join(path, owner!), released: join(path, 'released'), path };
}

it.each([
  [0, 1],
  [65535, 2],
  [5600, 0],
  [5600, -1],
  [5600.5, 1],
  [5600, 1.5],
  [Number.NaN, 1],
])('refuses invalid port allocation %s with count %s', async (start, count) => {
  await expect(reserveApiPort(start, count)).rejects.toThrow('Invalid disposable API port range');
});

it('keeps a port available to its fixture across an unbound interval and a failed startup', async () => {
  const fixture = await createApiProcessFixture();
  const { port } = fixture;
  let claim: Awaited<ReturnType<typeof activeClaim>>;
  try {
    claim = await activeClaim(port);
    expect(await listening(port)).toBe(false);
    await expect(reserveApiPort(port, 1)).rejects.toThrow(
      `No disposable API port is available in ${port}-${port}`,
    );
    const failed = fixture.run([], { GG_PORT: 'invalid' });
    expect(await failed.waitForExit()).toEqual({ code: 1, signal: null });
    expect(failed.stderr).toContain('invalid configuration');
    await expect(reserveApiPort(port, 1)).rejects.toThrow('Ports are reserved by tests or in use');
  } finally {
    await fixture.dispose();
  }
  await expect(access(claim.owner)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(claim.released)).resolves.toBeUndefined();
  await expect(access(fixture.dataDir)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.for(['127.0.0.1', '0.0.0.0', '::'])(
  'preserves an existing %s listener and refuses its otherwise unreserved port',
  async (host, { skip }) => {
    const probe = await reserveApiPort();
    const listener = createServer((_request, response) => response.end('independent listener'));
    try {
      try {
        await new Promise<void>((resolve, reject) => {
          listener.once('error', reject);
          listener.listen(probe.port, host, resolve);
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          host === '::' &&
          ['EAFNOSUPPORT', 'EPROTONOSUPPORT', 'EADDRNOTAVAIL'].includes(code ?? '')
        )
          skip('IPv6 wildcard binding is unavailable');
        throw error;
      }
      await probe.release();
      const attempted = reserveApiPort(probe.port, 1).then(async (unexpected) => {
        await unexpected.release();
        return unexpected.port;
      });
      await expect(attempted).rejects.toThrow('Ports are reserved by tests or in use');
      const response = await fetch(`http://127.0.0.1:${probe.port}/`);
      expect(await response.text()).toBe('independent listener');
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      await probe.release();
    }
  },
);

it('cannot release a replacement claim if the original ownership marker is gone', async () => {
  const old = await reserveApiPort();
  const claim = await activeClaim(old.port);
  const replacement = join(claim.path, 'replacement');
  await rename(claim.owner, replacement);
  try {
    await expect(old.release()).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(replacement)).resolves.toBeUndefined();
    await expect(reserveApiPort(old.port, 1)).rejects.toThrow(
      'Ports are reserved by tests or in use',
    );
  } finally {
    await rename(replacement, claim.released);
  }
});

it('honors the configured range and refuses a count that crosses the last TCP port', async () => {
  vi.stubEnv('GG_TEST_PORT_START', '65535');
  vi.stubEnv('GG_TEST_PORT_COUNT', '2');
  try {
    await expect(reserveApiPort()).rejects.toThrow(
      'GG_TEST_PORT_START=65535, GG_TEST_PORT_COUNT=2',
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
