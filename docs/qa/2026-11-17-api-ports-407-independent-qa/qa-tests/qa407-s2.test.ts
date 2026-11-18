// Disposable independent-QA scenario S2 for #407 (real config wiring, built API).
// Env range 63804-63806. The driver starts foreign listeners OUTSIDE Vitest before the run:
//   127.0.0.1:63806 (specific) and 0.0.0.0:63805 (wildcard); both answer "foreign:<host>".
import { createServer } from 'node:http';
import { access } from 'node:fs/promises';
import { expect, inject, it } from 'vitest';
import { createApiProcessFixture, listening } from '../testing/api-subprocess.js';
import { claimState, qa, tryReserve } from './qa-util.js';

const text = async (url: string) => {
  try {
    const r = await fetch(url);
    return `${r.status}:${(await r.text()).slice(0, 60)}`;
  } catch (error) {
    return `ERR:${String((error as { cause?: { code?: string } }).cause?.code ?? error)}`;
  }
};

it('S2a pre-existing foreign listeners are not handed out to fixtures', async () => {
  const q = qa('S2', 'a');
  expect([process.env.GG_TEST_PORT_START, process.env.GG_TEST_PORT_COUNT]).toEqual(['63804', '3']);
  const before = { f806: await text('http://127.0.0.1:63806/'), f805: await text('http://127.0.0.1:63805/') };
  await q.log('foreign-before', before);
  expect(before).toEqual({ f806: '200:foreign:127.0.0.1', f805: '200:foreign:0.0.0.0' });
  const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
  const grants: number[] = [];
  let exhausted: string | undefined;
  try {
    for (let i = 0; i < 3; i++) {
      try {
        const f = await createApiProcessFixture({ prefix: 'gg-qa407-s2-' });
        fixtures.push(f);
        grants.push(f.port);
      } catch (error) {
        exhausted = (error as Error).message;
        break;
      }
    }
    await q.log('grants', { grants, exhausted });
    for (const f of fixtures) {
      const token = await f.createKey();
      const child = f.run();
      const ready = await f.ready(child, token).then(
        () => 'ready',
        (error: Error) => `failed:${error.message.slice(0, 160)}`,
      );
      await q.log('fixture-child', {
        port: f.port,
        ready,
        loopbackAnswer: await text(`http://127.0.0.1:${f.port}/`),
        foreign806Answer: await text('http://127.0.0.1:63806/'),
        foreign805Answer: await text('http://127.0.0.1:63805/'),
      });
    }
  } finally {
    for (const f of fixtures) await f.dispose();
  }
  const after = { f806: await text('http://127.0.0.1:63806/'), f805: await text('http://127.0.0.1:63805/') };
  await q.log('foreign-after-dispose', after);
  expect(after).toEqual({ f806: '200:foreign:127.0.0.1', f805: '200:foreign:0.0.0.0' });
  expect.soft(grants, 'specific-address foreign 63806 must not be granted').not.toContain(63806);
  expect.soft(grants, 'wildcard foreign 63805 must not be granted').not.toContain(63805);
  expect.soft(exhausted ?? '').toContain('No disposable API port is available in 63804-63806');
}, 180_000);

it('S2b failed startup after a post-probe steal keeps the reservation until fixture cleanup', async () => {
  const q = qa('S2', 'b');
  const root = inject('apiPortRoot');
  const f = await createApiProcessFixture({ prefix: 'gg-qa407-s2-', portStart: 63804, portCount: 1 });
  const steal = createServer((_q, r) => r.end('steal'));
  let stealOpen = false;
  try {
    const own = await claimState(root, 63804);
    await new Promise<void>((resolve, reject) => {
      steal.once('error', reject);
      steal.listen(63804, '127.0.0.1', () => resolve());
    });
    stealOpen = true;
    const token = await f.createKey();
    const child = f.run();
    const readiness = await f.ready(child, token).then(
      () => 'ready',
      (error: Error) => error.message.replace(/[A-Za-z]:\\[^\s"]+/g, '<path>').slice(0, 300),
    );
    const exit = await child.waitForExit();
    const stderrHasAddrInUse = /EADDRINUSE/.test(child.stderr + child.stdout);
    const whileStolen = await tryReserve(63804, 1);
    await q.log('failed-startup', {
      ownBefore: own,
      readiness,
      exit,
      stderrHasAddrInUse,
      claimAfterFailure: await claimState(root, 63804),
      reserveWhileStolen: whileStolen.ok ? 'GRANTED' : whileStolen.message,
      stealAnswer: await text('http://127.0.0.1:63804/'),
    });
    if (whileStolen.ok) await whileStolen.release();
    expect(readiness).not.toBe('ready');
    expect(exit.code).not.toBe(0);
    expect(whileStolen.ok).toBe(false);
    await new Promise<void>((resolve) => steal.close(() => resolve()));
    stealOpen = false;
    const tcpFree = !(await listening(63804));
    const afterStealClosed = await tryReserve(63804, 1);
    await q.log('after-steal-closed-before-dispose', {
      tcpFree,
      reserve: afterStealClosed.ok ? 'GRANTED' : afterStealClosed.message,
      claim: await claimState(root, 63804),
    });
    if (afterStealClosed.ok) await afterStealClosed.release();
    expect(afterStealClosed.ok).toBe(false);
    const retry = f.run();
    await f.ready(retry, token);
    await q.log('recovered-in-same-fixture', { port: f.port, listening: await listening(63804) });
  } finally {
    if (stealOpen) await new Promise<void>((resolve) => steal.close(() => resolve()));
    await f.dispose();
  }
  const afterDispose = await tryReserve(63804, 1);
  await q.log('after-dispose', {
    reserve: afterDispose.ok ? `GRANTED:${afterDispose.port}` : afterDispose.message,
    dataDirGone: await access(f.dataDir).then(() => false, () => true),
  });
  expect(afterDispose.ok).toBe(true);
  if (afterDispose.ok) await afterDispose.release();
}, 180_000);

it('S2c a failed child cleanup keeps the reservation; a successful retry releases it', async () => {
  const q = qa('S2', 'c');
  const root = inject('apiPortRoot');
  const f = await createApiProcessFixture({ prefix: 'gg-qa407-s2-', portStart: 63804, portCount: 1 });
  const token = await f.createKey();
  const child = f.run();
  await f.ready(child, token);
  const original = child.dispose;
  child.dispose = () => Promise.reject(new Error('QA forced child cleanup failure'));
  const first = await f.dispose().then(
    () => 'resolved',
    (error: Error) => `rejected:${error.message}`,
  );
  const held = await tryReserve(63804, 1);
  const state = {
    first,
    claim: await claimState(root, 63804),
    childExited: child.exited,
    listening: await listening(63804),
    reserve: held.ok ? 'GRANTED' : held.message,
    dataDirExistsAfterFailedDispose: await access(f.dataDir).then(() => true, () => false),
  };
  await q.log('after-failed-cleanup', state);
  if (held.ok) await held.release();
  child.dispose = original;
  await f.dispose();
  const released = await tryReserve(63804, 1);
  await q.log('after-retry-cleanup', {
    childExited: child.exited,
    listening: await listening(63804),
    claim: await claimState(root, 63804),
    reserve: released.ok ? `GRANTED:${released.port}` : released.message,
  });
  if (released.ok) await released.release();
  expect(first).toBe('rejected:QA forced child cleanup failure');
  expect(held.ok).toBe(false);
  expect(state.listening).toBe(true);
  expect(released.ok).toBe(true);
}, 180_000);
