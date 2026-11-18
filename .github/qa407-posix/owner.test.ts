import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { reserveApiPort } from '../testing/api-port.js';
import { createApiProcessFixture, listening } from '../testing/api-subprocess.js';
import { checkPeer, close, listen, markers, phase, ports, reserveAttempt, root, waitPhase } from './shared.js';

it('owns the first generation and holds the API lease through ready, restart and settlement', async () => {
  const ownRoot = await root();
  await phase('owner-start', { root: ownRoot });
  await checkPeer('peer-start', ownRoot);

  const old = await reserveApiPort(ports.generation, 1);
  try {
    expect(await markers(ownRoot, ports.generation, 1)).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    await phase('generation-held');
    await waitPhase('generation-refused');
  } finally {
    await old.release();
  }
  await phase('generation-released');
  await waitPhase('generation-next-held');
  const before = await markers(ownRoot, ports.generation, 2);
  await old.release();
  expect(await markers(ownRoot, ports.generation, 2)).toEqual(before);
  expect(await reserveAttempt(ports.generation)).toBe('refused');
  await phase('stale-release-checked');
  await waitPhase('generation-next-released');
  expect(await markers(ownRoot, ports.generation, 2)).toEqual(['released']);

  const foreign = createServer((_request, response) => response.end('gg407 foreign sentinel'));
  try {
    await listen(foreign, ports.wildcard, '0.0.0.0');
    await phase('wildcard-ready', { port: ports.wildcard });
    await waitPhase('wildcard-checked');
    expect(foreign.listening).toBe(true);
  } finally {
    await close(foreign);
  }

  const fixture = await createApiProcessFixture({ portStart: ports.api, portCount: 1, prefix: 'gg407-api-' });
  let disposed = false;
  try {
    expect(fixture.port).toBe(ports.api);
    await phase('api-reserved', { port: fixture.port });
    await waitPhase('api-unbound-refused');
    const key = await fixture.createKey();
    const first = fixture.run();
    await fixture.ready(first, key);
    await phase('api-first-ready', { childPid: first.child.pid ?? null });
    await waitPhase('api-first-refused');
    expect(first.child.kill('SIGKILL')).toBe(true);
    expect(await first.waitForExit()).toEqual({ code: null, signal: 'SIGKILL' });
    expect(await listening(ports.api)).toBe(false);
    await phase('api-stopped');
    await waitPhase('api-stopped-refused');

    const second = fixture.run();
    await fixture.ready(second, key);
    expect(second.child.pid).not.toBe(first.child.pid);
    const releaseMarker = join(ownRoot, String(ports.api), '1', 'released');
    let markerAtClose: boolean | undefined;
    second.child.once('close', () => { markerAtClose = existsSync(releaseMarker); });
    await phase('api-restarted', { childPid: second.child.pid ?? null });
    await waitPhase('api-restart-refused');
    await fixture.dispose();
    disposed = true;
    expect(markerAtClose).toBe(false);
    expect(await listening(ports.api)).toBe(false);
    expect(await markers(ownRoot, ports.api, 1)).toEqual(['released']);
    await phase('api-settled', { closeObserved: markerAtClose !== undefined, markerAtClose: markerAtClose ?? null });
    await waitPhase('api-reacquired');
  } finally {
    // The fixture owns only the captured children and its own store. Dispose on any assertion failure.
    if (!disposed) await fixture.dispose();
  }
});
