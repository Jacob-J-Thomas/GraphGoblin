import { access, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { expect, inject, it, vi } from 'vitest';
import { reserveApiPort, setApiPortRoot } from './api-port.js';
import { createApiProcessFixture, listening } from './api-subprocess.js';

async function activeClaim(port: number) {
  const slot = join(inject('apiPortRoot'), String(port));
  const generation = Math.max(...(await readdir(slot)).map(Number));
  const path = join(slot, String(generation));
  const [owner] = await readdir(path);
  expect(owner).toBeDefined();
  return { owner: join(path, owner!), released: join(path, 'released'), path };
}

/** Each generation's markers: a live owner marker, or the released marker its owner moved. */
async function claimState(slot: string) {
  const state: Record<string, string[]> = {};
  for (const generation of await readdir(slot)) {
    state[generation] = (await readdir(join(slot, generation))).map((marker) =>
      marker === 'released' || !/^[0-9a-f-]{36}$/.test(marker) ? marker : 'owner',
    );
  }
  return state;
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
    const failed = fixture.run([], { GG_PORT: 'invalid', GG_OLLAMA_ENABLED: 'false' });
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

it('grants one of many simultaneous cooperating claims of a port until its owner releases it', async () => {
  // The shared reservation keeps cooperating workers off this bindable port. An owned root gives
  // the contenders a fresh slot, so every grant below comes from this test's own claims.
  const shared = inject('apiPortRoot');
  // Each resource enters its own cleanup as soon as it is acquired, so a failure in a later setup
  // step or in another teardown still attempts every acquired resource's teardown.
  let heldClaim: Awaited<ReturnType<typeof activeClaim>>;
  let root: string;
  const held = await reserveApiPort();
  try {
    heldClaim = await activeClaim(held.port);
    root = await mkdtemp(join(shared, 'contended-'));
    try {
      const slot = join(root, String(held.port));
      const contenders = 8;
      const refusal = `No disposable API port is available in ${held.port}-${held.port}. Ports are reserved by tests or in use`;
      // Every claim starts before any is awaited; exclusive directory creation must pick the winner.
      const claimants = () =>
        Array.from({ length: contenders }, () => reserveApiPort(held.port, 1));
      const settle = async (attempts: ReturnType<typeof reserveApiPort>[]) => {
        const granted: Awaited<ReturnType<typeof reserveApiPort>>[] = [];
        for (const result of await Promise.allSettled(attempts)) {
          if (result.status === 'fulfilled') granted.push(result.value);
          else {
            expect(result.reason).toBeInstanceOf(Error);
            expect((result.reason as Error).message).toContain(refusal);
          }
        }
        return granted;
      };
      const contend = async () => {
        const granted = await settle(claimants());
        expect(granted.map(({ port }) => port)).toEqual([held.port]);
        return granted[0]!;
      };
      setApiPortRoot(root);
      try {
        const first = await contend();
        expect(await claimState(slot)).toEqual({ 1: ['owner'] });
        await expect(reserveApiPort(held.port, 1)).rejects.toThrow(refusal);

        await first.release();
        expect(await claimState(slot)).toEqual({ 1: ['released'] });
        const second = await contend();
        expect(await claimState(slot)).toEqual({ 1: ['released'], 2: ['owner'] });

        // A stale release racing new claimants is idempotent and cannot free the replacement.
        const [stale, blocked] = await Promise.all([first.release(), settle(claimants())]);
        expect(stale).toBeUndefined();
        expect(blocked).toEqual([]);
        expect(await claimState(slot)).toEqual({ 1: ['released'], 2: ['owner'] });

        await second.release();
        await expect(second.release()).resolves.toBeUndefined();
        expect(await claimState(slot)).toEqual({ 1: ['released'], 2: ['released'] });
      } finally {
        setApiPortRoot(shared);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  } finally {
    await held.release();
  }
  await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(heldClaim.owner)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(heldClaim.released)).resolves.toBeUndefined();
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
