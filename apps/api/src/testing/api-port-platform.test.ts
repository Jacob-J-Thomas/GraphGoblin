import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { Server } from 'node:net';
import { join } from 'node:path';
import { afterEach, expect, inject, it, vi } from 'vitest';
import { reserveApiPort, setApiPortRoot } from './api-port.js';

// Controlled observations, not native OS evidence: process.platform is overridden in this worker
// and every node:net listen is recorded, so these tests show which hosts the public reserveApiPort
// asks canBind to probe for each reported platform. Unconflicted probes still bind through the
// host's own network stack; native wildcard and listener behaviour stays with api-port.test.ts.
const nativePlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const nativeListen = Server.prototype.listen;
const probes = ['127.0.0.1', '0.0.0.0', '::'];
const refusal = 'Ports are reserved by tests or in use';

afterEach(() => {
  // Each reservation restores its overrides itself; this verifies that none outlives a test.
  expect(Object.getOwnPropertyDescriptor(process, 'platform')).toEqual(nativePlatform);
  expect(Server.prototype.listen).toBe(nativeListen);
});

/**
 * Reserve one known port while process.platform reports `platform`, recording each listen.
 * A `conflict` host reports EADDRINUSE without reaching the network stack.
 */
async function reserveAs(platform: NodeJS.Platform, conflict?: string) {
  // The shared reservation keeps cooperating workers off this port. An owned root lets the
  // observed reservation claim and probe that same port exactly once.
  const shared = inject('apiPortRoot');
  // Each resource enters its own cleanup as soon as it is acquired, so a failure in a later setup
  // step or in another teardown still attempts every acquired resource's teardown.
  const root = await mkdtemp(join(shared, `platform-${platform}-`));
  try {
    const held = await reserveApiPort();
    try {
      const attempts: { port: unknown; host: unknown }[] = [];
      const listen = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
        this: Server,
        ...args: unknown[]
      ) {
        const [port, host] = args;
        attempts.push({ port, host });
        if (host !== conflict) return Reflect.apply(nativeListen, this, args) as Server;
        const error = Object.assign(new Error(`listen EADDRINUSE: simulated ${String(host)}`), {
          code: 'EADDRINUSE',
        });
        process.nextTick(() => this.emit('error', error));
        return this;
      });
      let outcome: PromiseSettledResult<Awaited<ReturnType<typeof reserveApiPort>>>;
      setApiPortRoot(root);
      Object.defineProperty(process, 'platform', { ...nativePlatform, value: platform });
      try {
        [outcome] = await Promise.allSettled([reserveApiPort(held.port, 1)]);
      } finally {
        Object.defineProperty(process, 'platform', nativePlatform);
        listen.mockRestore();
        setApiPortRoot(shared);
      }

      const slot = join(root, String(held.port));
      const generation = join(slot, '1');
      expect(await readdir(slot)).toEqual(['1']);
      if (outcome.status === 'fulfilled') {
        expect(outcome.value.port).toBe(held.port);
        expect(await readdir(generation)).toHaveLength(1);
        expect(await readdir(generation)).not.toContain('released');
        await outcome.value.release();
      }
      // A refused probe releases its own claim; a granted claim is released by its owner above.
      expect(await readdir(generation)).toEqual(['released']);
      return {
        port: held.port,
        attempts,
        error: outcome.status === 'rejected' ? (outcome.reason as Error) : undefined,
      };
    } finally {
      await held.release();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it.for(['win32', 'darwin'] as const)(
  'probes 127.0.0.1, 0.0.0.0 and then :: when process.platform reports %s (controlled)',
  async (platform) => {
    const { port, attempts, error } = await reserveAs(platform);
    expect(error).toBeUndefined();
    expect(attempts).toEqual(probes.map((host) => ({ port, host })));
  },
);

it('probes only 127.0.0.1 when process.platform reports linux (controlled non-wildcard control)', async () => {
  const { port, attempts, error } = await reserveAs('linux');
  expect(error).toBeUndefined();
  expect(attempts).toEqual([{ port, host: '127.0.0.1' }]);
});

it.for([
  ['win32', '0.0.0.0'],
  ['win32', '::'],
  ['darwin', '0.0.0.0'],
  ['darwin', '::'],
] as const)(
  'refuses a port when process.platform reports %s and only its %s probe conflicts (controlled)',
  async ([platform, conflict]) => {
    const { port, attempts, error } = await reserveAs(platform, conflict);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain(`No disposable API port is available in ${port}-${port}`);
    expect(error?.message).toContain(refusal);
    const probed = probes.slice(0, probes.indexOf(conflict) + 1);
    expect(attempts).toEqual(probed.map((host) => ({ port, host })));
  },
);

it('does not probe a wildcard conflict when process.platform reports linux (controlled control)', async () => {
  const { port, attempts, error } = await reserveAs('linux', '0.0.0.0');
  expect(error).toBeUndefined();
  expect(attempts).toEqual([{ port, host: '127.0.0.1' }]);
});
