// Disposable independent-QA N4 (real crash): observe the dead worker's claim on 63812 in the same run.
import { expect, inject, it } from 'vitest';
import { claimState, qa, tryReserve } from './qa-util.js';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

it('QA407 N4 observer of a crashed owner', async () => {
  const q = qa('N4c', 'observer');
  const owner = await q.waitFor('owner-reserved');
  const pid = owner.pid as number;
  await q.signal('observer-ready');
  const deadline = Date.now() + 30_000;
  while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  const dead = !alive(pid);
  const first = await tryReserve(63812, 1);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const later = await tryReserve(63812, 1);
  await q.log('after-owner-death', {
    ownerPid: pid,
    ownerDead: dead,
    claim: await claimState(inject('apiPortRoot'), 63812),
    first: first.ok ? 'GRANTED' : first.message,
    later: later.ok ? 'GRANTED' : later.message,
  });
  if (first.ok) await first.release();
  if (later.ok) await later.release();
  expect(dead).toBe(true);
}, 60_000);
