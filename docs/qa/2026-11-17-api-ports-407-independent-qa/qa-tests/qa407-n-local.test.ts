// Disposable independent-QA local negative cases for #407 (real config wiring). Ports used: 63810-63816, 63818.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it, vi } from 'vitest';
import { reserveApiPort } from '../testing/api-port.js';
import { createApiProcessFixture } from '../testing/api-subprocess.js';
import { claimState, qa, tryReserve } from './qa-util.js';

const root = () => inject('apiPortRoot');

it('N1 invalid env ranges fail clearly before any claim or fixture directory', async () => {
  const q = qa('N', 'N1');
  const cases: Array<[string, string]> = [
    ['abc', '1'],
    ['', '1'],
    [' ', '1'],
    ['63810x', '1'],
    ['-63810', '1'],
    ['70000', '1'],
    ['65535', '2'],
    ['63810.5', '1'],
    ['Infinity', '1'],
    ['63810', 'abc'],
    ['63810', ''],
    ['63810', '0'],
    ['63810', '-1'],
    ['63810', '1.5'],
  ];
  const rootBefore = await readdir(root());
  const tmpBefore = (await readdir(tmpdir())).filter((n) => n.startsWith('gg-qa407-n1-'));
  const results = [];
  try {
    for (const [start, count] of cases) {
      vi.stubEnv('GG_TEST_PORT_START', start);
      vi.stubEnv('GG_TEST_PORT_COUNT', count);
      const direct = await tryReserve();
      const fixture = await createApiProcessFixture({ prefix: 'gg-qa407-n1-' }).then(
        async (f) => {
          await f.dispose();
          return `CREATED:${f.port}`;
        },
        (error: Error) => error.message,
      );
      results.push({ start, count, direct: direct.ok ? `GRANTED:${direct.port}` : direct.message, fixture });
      if (direct.ok) await direct.release();
    }
  } finally {
    vi.unstubAllEnvs();
  }
  const rootAfter = await readdir(root());
  const tmpAfter = (await readdir(tmpdir())).filter((n) => n.startsWith('gg-qa407-n1-'));
  await q.log('invalid-env', { results, rootBefore, rootAfter, tmpBefore, tmpAfter });
  for (const r of results) {
    expect.soft(r.direct, `${JSON.stringify([r.start, r.count])}`).toContain('Invalid disposable API port range');
    expect.soft(r.fixture, `${JSON.stringify([r.start, r.count])}`).toContain('Invalid disposable API port range');
  }
  expect(rootAfter).toEqual(rootBefore);
  expect(tmpAfter).toEqual(tmpBefore);

  // Lenient but in-assignment spellings of 63810 (observation only).
  const lenient = [];
  try {
    for (const start of [' 63810 ', '6.381e4', '0xF942']) {
      vi.stubEnv('GG_TEST_PORT_START', start);
      vi.stubEnv('GG_TEST_PORT_COUNT', '1');
      const r = await tryReserve();
      lenient.push({ start, result: r.ok ? `GRANTED:${r.port}` : r.message });
      if (r.ok) await r.release();
    }
  } finally {
    vi.unstubAllEnvs();
  }
  await q.log('lenient-env-observation', { lenient });
});

it('N2 exhaustion is clear and bounded for single and multi-port ranges', async () => {
  const q = qa('N', 'N2');
  const a = await reserveApiPort(63810, 2);
  const b = await reserveApiPort(63810, 2);
  try {
    const multi = await tryReserve(63810, 2);
    const single = await tryReserve(a.port, 1);
    await q.log('exhausted', {
      held: [a.port, b.port],
      multi: multi.ok ? `GRANTED:${multi.port}` : multi.message,
      multiElapsedMs: multi.elapsedMs,
      single: single.ok ? `GRANTED:${single.port}` : single.message,
      singleElapsedMs: single.elapsedMs,
    });
    expect(new Set([a.port, b.port]).size).toBe(2);
    expect(multi.ok).toBe(false);
    expect(multi.ok ? '' : multi.message).toContain('No disposable API port is available in 63810-63811');
    expect(multi.elapsedMs).toBeLessThan(2_000);
    expect(single.ok).toBe(false);
  } finally {
    await a.release();
    await b.release();
  }
});

it('N3 stale releases cannot delete replacement claims', async () => {
  const q = qa('N', 'N3');
  const path = join(root(), '63811');
  // (a) memoised second release after a replacement claim
  const r1 = await reserveApiPort(63811, 1);
  const m1 = await readdir(path);
  await r1.release();
  const r2 = await reserveApiPort(63811, 1);
  const m2 = await readdir(path);
  const again = await r1.release().then(
    () => 'resolved',
    (e: NodeJS.ErrnoException) => `rejected:${e.code}`,
  );
  const afterA = await claimState(root(), 63811);
  const blockedA = await tryReserve(63811, 1);
  await q.log('a-memoised-double-release', { m1, m2, again, afterA, blocked: !blockedA.ok });
  expect(afterA).toEqual({ exists: true, markers: m2 });
  expect(blockedA.ok).toBe(false);
  await r2.release();
  expect(existsSync(path)).toBe(false);

  // (b) whole claim removed externally, replaced by a new owner, then old owner releases
  const o1 = await reserveApiPort(63811, 1);
  const n1 = await readdir(path);
  await rm(path, { recursive: true });
  const o2 = await reserveApiPort(63811, 1);
  const n2 = await readdir(path);
  const stale = await o1.release().then(
    () => 'resolved',
    (e: NodeJS.ErrnoException) => `rejected:${e.code}`,
  );
  const afterB = await claimState(root(), 63811);
  const blockedB = await tryReserve(63811, 1);
  await q.log('b-external-removal-then-replacement', { n1, n2, stale, afterB, blocked: !blockedB.ok });
  expect(n2).not.toEqual(n1);
  expect(afterB).toEqual({ exists: true, markers: n2 });
  expect(blockedB.ok).toBe(false);
  await o2.release();

  // (c) concurrent duplicate release
  const c = await reserveApiPort(63811, 1);
  const both = await Promise.allSettled([c.release(), c.release()]);
  await q.log('c-concurrent-release', { both: both.map((s) => s.status), after: await claimState(root(), 63811) });
  expect(both.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(existsSync(path)).toBe(false);
});

it('N4 a claim left by a dead owner (simulated marker) is never reclaimed during the run', async () => {
  const q = qa('N', 'N4');
  const path = join(root(), '63812');
  await mkdir(path);
  await mkdir(join(path, 'dead-owner-simulated'));
  try {
    const first = await tryReserve(63812, 1);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const later = await tryReserve(63812, 1);
    await q.log('dead-marker', {
      first: first.ok ? 'GRANTED' : first.message,
      laterAfter1s: later.ok ? 'GRANTED' : later.message,
    });
    if (first.ok) await first.release();
    if (later.ok) await later.release();
    expect(first.ok).toBe(false);
    expect(later.ok).toBe(false);
  } finally {
    await rmdir(join(path, 'dead-owner-simulated'));
    await rmdir(path);
  }
});

it('N5 foreign listener variants in separate processes', async () => {
  const q = qa('N', 'N5');
  const script = join(process.env.QA407_SCRIPTS!, 'foreign-listener.mjs');
  const variants: Array<[number, string]> = [
    [63813, '127.0.0.1'],
    [63814, '0.0.0.0'],
    [63815, '::'],
    [63816, '::1'],
  ];
  const results = [];
  for (const [port, host] of variants) {
    const child = spawn(process.execPath, [script, String(port), host], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    try {
      await new Promise((resolve, reject) => {
        child.stdout.once('data', resolve);
        child.once('exit', () => reject(new Error(`foreign ${host}:${port} exited`)));
      });
      const target = host.includes(':') ? `http://[::1]:${port}/` : `http://127.0.0.1:${port}/`;
      const r = await tryReserve(port, 1);
      let emulatedChildBind = 'not-granted';
      let loopbackWhileFixture: string | undefined;
      if (r.ok) {
        const mine = createServer((_q, res) => res.end('fixture'));
        emulatedChildBind = await new Promise<string>((resolve) => {
          mine.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
          mine.listen(port, '127.0.0.1', () => resolve('ok'));
        });
        loopbackWhileFixture = await fetch(`http://127.0.0.1:${port}/`).then((x) => x.text(), (e) => `ERR:${e.cause?.code}`);
        if (emulatedChildBind === 'ok') await new Promise<void>((resolve) => mine.close(() => resolve()));
        await r.release();
      }
      const foreignAfter = await fetch(target).then((x) => x.text(), (e) => `ERR:${e.cause?.code}`);
      results.push({
        port,
        host,
        reserve: r.ok ? 'GRANTED' : r.message,
        emulatedChildBind,
        loopbackWhileFixture,
        foreignAfter,
      });
    } finally {
      child.stdin.end();
      await exited;
    }
  }
  await q.log('foreign-variants', { results });
  const by = Object.fromEntries(results.map((r) => [r.host, r]));
  expect.soft(by['127.0.0.1']!.reserve, '127.0.0.1 foreign refused').toContain('Ports are reserved by tests or in use');
  expect.soft(by['0.0.0.0']!.reserve, '0.0.0.0 foreign refused').toContain('Ports are reserved by tests or in use');
  expect.soft(by['::']!.reserve, ':: foreign refused').toContain('Ports are reserved by tests or in use');
  for (const r of results) expect.soft(r.foreignAfter, `${r.host} preserved`).toBe(`foreign:${r.host}`);
});

it('N7 no-setup module instance and fixture directory failure release cleanly', async () => {
  const q = qa('N', 'N7');
  vi.resetModules();
  const fresh = await import('../testing/api-port.js');
  const unwired = await fresh.reserveApiPort(63818, 1).then(
    (r) => `GRANTED:${r.port}`,
    (e: Error) => e.message,
  );
  const claimAfterUnwired = await claimState(root(), 63818);
  const badPrefix = await createApiProcessFixture({ prefix: 'qa407-bad-<>|', portStart: 63818, portCount: 1 }).then(
    async (f) => {
      await f.dispose();
      return `CREATED:${f.port}`;
    },
    (e: NodeJS.ErrnoException) => `${e.code}:${e.message.slice(0, 80)}`,
  );
  const claimAfterBad = await claimState(root(), 63818);
  const reusable = await tryReserve(63818, 1);
  await q.log('n7', {
    unwired,
    claimAfterUnwired,
    badPrefix,
    claimAfterBad,
    reusable: reusable.ok ? `GRANTED:${reusable.port}` : reusable.message,
  });
  if (reusable.ok) await reusable.release();
  expect(unwired).toBe('Disposable API ports require the API Vitest setup');
  expect(claimAfterUnwired.exists).toBe(false);
  expect(badPrefix.startsWith('CREATED')).toBe(false);
  expect(claimAfterBad.exists).toBe(false);
  expect(reusable.ok).toBe(true);
});
