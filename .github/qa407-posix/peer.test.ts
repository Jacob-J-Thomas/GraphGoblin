import { expect, it } from 'vitest';
import { reserveApiPort } from '../testing/api-port.js';
import { listening } from '../testing/api-subprocess.js';
import { checkPeer, markers, phase, ports, probeLoopback, reserveAttempt, root, waitPhase } from './shared.js';

it('shares the root across forks and can reacquire only after the owner settles', async () => {
  const ownRoot = await root();
  await phase('peer-start', { root: ownRoot });
  await checkPeer('owner-start', ownRoot);
  await waitPhase('generation-held');
  expect(await reserveAttempt(ports.generation)).toBe('refused');
  await phase('generation-refused');
  await waitPhase('generation-released');

  const next = await reserveApiPort(ports.generation, 1);
  try {
    expect(await markers(ownRoot, ports.generation, 1)).toEqual(['released']);
    expect(await markers(ownRoot, ports.generation, 2)).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    await phase('generation-next-held');
    await waitPhase('stale-release-checked');
  } finally {
    await next.release();
  }
  await phase('generation-next-released');

  await waitPhase('wildcard-ready');
  const nativeBind = await probeLoopback(ports.wildcard);
  const reservation = await reserveAttempt(ports.wildcard);
  const response = await fetch('http://127.0.0.1:' + ports.wildcard, {
    signal: AbortSignal.timeout(2_000),
  });
  const foreignAnswered = await response.text() === 'gg407 foreign sentinel';
  await phase('wildcard-checked', { nativeBind, reservation, foreignAnswered });
  expect.soft(reservation).toBe('refused');
  expect.soft(foreignAnswered).toBe(true);

  for (const [name, acknowledgement, isListening] of [
    ['api-reserved', 'api-unbound-refused', false],
    ['api-first-ready', 'api-first-refused', true],
    ['api-stopped', 'api-stopped-refused', false],
    ['api-restarted', 'api-restart-refused', true],
  ] as const) {
    await waitPhase(name);
    const bound = await listening(ports.api);
    const lease = await reserveAttempt(ports.api);
    await phase(acknowledgement, { bound, lease });
    expect.soft(bound).toBe(isListening);
    expect.soft(lease).toBe('refused');
  }
  const settled = await waitPhase('api-settled');
  expect(settled.closeObserved).toBe(true);
  expect(settled.markerAtClose).toBe(false);
  const final = await reserveApiPort(ports.api, 1);
  try {
    expect(await listening(ports.api)).toBe(false);
    expect(await markers(ownRoot, ports.api, 1)).toEqual(['released']);
    expect(await markers(ownRoot, ports.api, 2)).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/)]);
  } finally {
    await final.release();
  }
  expect(await markers(ownRoot, ports.api, 2)).toEqual(['released']);
  await phase('api-reacquired');
});
