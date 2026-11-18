// Disposable independent-QA N6: two workers contend for the single port 63817 for a bounded period.
// Double-grant detector: exclusive create of a QA marker file while holding (EEXIST = both held the same port).
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import { qa, qaEnv, tryReserve } from './qa-util.js';

export async function runN6(role: 'A' | 'B', durationMs = 8_000) {
  const other = role === 'A' ? 'B' : 'A';
  const q = qa('N6', role);
  const held = join(qaEnv().sync, 'held-63817');
  await q.signal(`${role}-ready`, { pid: process.pid });
  await q.waitFor(`${other}-ready`);
  const counts = { iterations: 0, granted: 0, exhausted: 0, doubleGrant: 0 };
  const reserveErrors: Record<string, number> = {};
  const releaseErrors: Record<string, number> = {};
  const detectorNoise: Record<string, number> = {};
  const samples: string[] = [];
  const began = Date.now();
  const until = began + durationMs;
  while (Date.now() < until) {
    counts.iterations++;
    const r = await tryReserve(63817, 1);
    if (r.ok) {
      counts.granted++;
      let mine = false;
      try {
        await writeFile(held, role, { flag: 'wx' });
        mine = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
        if (code === 'EEXIST') counts.doubleGrant++;
        else detectorNoise[`wx:${code}`] = (detectorNoise[`wx:${code}`] ?? 0) + 1;
      }
      if (mine)
        await unlink(held).catch((error: NodeJS.ErrnoException) => {
          detectorNoise[`unlink:${error.code}`] = (detectorNoise[`unlink:${error.code}`] ?? 0) + 1;
        });
      try {
        await r.release();
      } catch (error) {
        const e = error as NodeJS.ErrnoException;
        releaseErrors[e.code ?? 'unknown'] = (releaseErrors[e.code ?? 'unknown'] ?? 0) + 1;
        if (samples.length < 10) samples.push(`release:${e.code}:${e.message}`);
      }
    } else if (r.message.startsWith('No disposable API port is available')) counts.exhausted++;
    else {
      const key = r.code ?? r.message.slice(0, 60);
      reserveErrors[key] = (reserveErrors[key] ?? 0) + 1;
      if (samples.length < 10) samples.push(`reserve:${r.code}:${r.message}`);
    }
  }
  const result = { pid: process.pid, began, ended: Date.now(), ...counts, reserveErrors, releaseErrors, detectorNoise, samples };
  await q.log('result', result);
  await q.signal(`${role}-done`, result);
  await q.waitFor(`${other}-done`);
  expect(counts.granted).toBeGreaterThan(0);
  expect(counts.exhausted).toBeGreaterThan(0);
  expect.soft(counts.doubleGrant, 'double grants').toBe(0);
  expect.soft(reserveErrors, 'non-exhaustion reservation errors').toEqual({});
  expect.soft(releaseErrors, 'release errors').toEqual({});
}
