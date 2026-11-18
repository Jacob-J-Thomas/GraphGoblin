// Disposable independent-QA scenario S1 for #407 (two Vitest fork workers, real config wiring, built API).
// Range comes only from GG_TEST_PORT_START/GG_TEST_PORT_COUNT (expected 63800/2).
import { expect, inject } from 'vitest';
import { createApiProcessFixture, listening } from '../testing/api-subprocess.js';
import { claimState, qa, tryReserve } from './qa-util.js';

export async function runS1(role: 'A' | 'B') {
  const other = role === 'A' ? 'B' : 'A';
  const q = qa('S1', role);
  const root = inject('apiPortRoot');
  const start = Number(process.env.GG_TEST_PORT_START);
  const count = Number(process.env.GG_TEST_PORT_COUNT);
  expect([start, count]).toEqual([63800, 2]);
  await q.log('start', {
    pid: process.pid,
    poolId: process.env.VITEST_POOL_ID,
    workerId: process.env.VITEST_WORKER_ID,
    root,
    start,
    count,
  });

  const f = await createApiProcessFixture({ prefix: 'gg-qa407-s1-' });
  let disposed = false;
  try {
    const port = f.port;
    expect(port).toBeGreaterThanOrEqual(63800);
    expect(port).toBeLessThanOrEqual(63801);
    const initialClaim = await claimState(root, port);
    // Harness correction after r1: identify this fixture's own marker; a peer may re-claim the port at once.
    const ownMarker = initialClaim.exists ? initialClaim.markers[0] : undefined;
    expect(initialClaim.exists && initialClaim.markers.length).toBe(1);
    await q.log('reserved', {
      port,
      claim: initialClaim,
      ownMarker,
      listeningBeforeChild: await listening(port),
    });
    await q.signal(`${role}-reserved`, { port, root });
    const peer = await q.waitFor(`${other}-reserved`);
    await q.log('peer-reserved', { peer });
    expect(peer.root).toBe(root);
    expect(peer.port).not.toBe(port);

    // Both fixtures hold their reservations and no child has bound yet.
    const third = await tryReserve();
    await q.log('third-reserve-before-any-child-bind', {
      ok: third.ok,
      message: third.ok ? undefined : third.message,
      elapsedMs: third.elapsedMs,
      ownListening: await listening(port),
      peerListening: await listening(peer.port as number),
    });
    if (third.ok) await third.release();
    expect(third.ok).toBe(false);
    await q.signal(`${role}-exhaust-checked`);
    await q.waitFor(`${other}-exhaust-checked`);

    const token = await f.createKey();
    const child = f.run();
    await f.ready(child, token);
    await q.log('ready', { port, childPid: child.child.pid, listening: await listening(port) });
    await q.signal(`${role}-ready`, { port });
    await q.waitFor(`${other}-ready`);

    if (role === 'A') {
      let firstCloseMs = 0;
      child.child.once('close', () => (firstCloseMs = Date.now()));
      await child.dispose();
      await q.log('first-child-stopped', {
        port,
        firstCloseMs,
        listening: await listening(port),
        claim: await claimState(root, port),
      });
      await q.signal('A-down', { port, firstCloseMs });
      const gap = await q.waitFor('B-gap-checked');
      await q.log('peer-gap-result', { gap });

      const second = f.run();
      let secondCloseMs = 0;
      second.child.once('close', () => (secondCloseMs = Date.now()));
      await f.ready(second, token);
      await q.log('restarted', {
        port,
        childPid: second.child.pid,
        listening: await listening(port),
        claim: await claimState(root, port),
      });
      await q.signal('A-restarted', { port });
      await q.waitFor('B-polling');
      const disposeStartMs = Date.now();
      await q.signal('A-dispose-start', { disposeStartMs });
      await f.dispose();
      disposed = true;
      const disposedMs = Date.now();
      const after = {
        port,
        disposeStartMs,
        secondCloseMs,
        disposedMs,
        listening: await listening(port),
        claim: await claimState(root, port),
      };
      const ownMarkerRemains = after.claim.exists && after.claim.markers.includes(ownMarker!);
      await q.log('disposed', { ...after, ownMarker, ownMarkerRemains });
      await q.signal('A-disposed', after);
      expect(ownMarkerRemains).toBe(false);
      // Harness correction after r1b: A's post-dispose connect can hit B's transient bind probe
      // (B polls this port), so after.listening is informational; B asserts the port is unbound.
    } else {
      const down = await q.waitFor('A-down');
      const aPort = down.port as number;
      const aListening = await listening(aPort);
      const gap = await tryReserve();
      const gapResult = {
        aPort,
        aListeningDuringGap: aListening,
        ok: gap.ok,
        port: gap.ok ? gap.port : undefined,
        message: gap.ok ? undefined : gap.message,
        aClaim: await claimState(root, aPort),
      };
      await q.log('gap-reserve-while-A-child-down', gapResult);
      if (gap.ok) await gap.release();
      await q.signal('B-gap-checked', gapResult);
      expect(aListening).toBe(false);
      expect(gap.ok).toBe(false);

      await q.waitFor('A-restarted');
      await q.signal('B-polling');
      let attempts = 0;
      let firstFailMs = 0;
      let lastFailMs = 0;
      let won: Awaited<ReturnType<typeof tryReserve>> | undefined;
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        attempts++;
        const attempt = await tryReserve();
        if (attempt.ok) {
          won = attempt;
          break;
        }
        firstFailMs ||= attempt.ms;
        lastFailMs = attempt.ms;
        if (!attempt.message.startsWith('No disposable API port is available'))
          throw new Error(`Unexpected reservation error while polling: ${attempt.message}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const wonListening = won?.ok ? await listening(won.port) : undefined;
      const aDisposed = await q.waitFor('A-disposed');
      const poll = {
        attempts,
        firstFailMs,
        lastFailMs,
        failedAfterADisposeStart: lastFailMs >= (aDisposed.disposeStartMs as number),
        won: won?.ok ? { port: won.port, ms: won.ms } : undefined,
        wonPortListeningAtWin: wonListening,
        aDisposed,
        winAfterAChildClose: won?.ok ? won.ms >= (aDisposed.secondCloseMs as number) : undefined,
      };
      await q.log('poll-result', poll);
      expect(won?.ok).toBe(true);
      if (won?.ok) {
        expect(won.port).toBe(aPort);
        expect(won.ms).toBeGreaterThanOrEqual(aDisposed.secondCloseMs as number);
        expect(wonListening).toBe(false);
        await won.release();
        await q.log('poll-released', { claim: await claimState(root, won.port) });
      }
    }
  } finally {
    if (!disposed) await f.dispose();
    await q.log('final', {
      ownClaim: await claimState(root, f.port),
      listening: await listening(f.port),
    });
  }
  if (role === 'B') {
    const { readdir } = await import('node:fs/promises');
    await q.log('root-entries-at-end', { entries: await readdir(root) });
  }
}
