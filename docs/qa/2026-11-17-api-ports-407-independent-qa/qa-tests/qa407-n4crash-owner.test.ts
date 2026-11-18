// Disposable independent-QA N4 (real crash): this worker reserves 63812 and is killed without releasing.
import { expect, inject, it } from 'vitest';
import { reserveApiPort } from '../testing/api-port.js';
import { claimState, qa } from './qa-util.js';

it('QA407 N4 crash owner (expected to kill its own worker)', async () => {
  const q = qa('N4c', 'owner');
  const r = await reserveApiPort(63812, 1);
  expect(r.port).toBe(63812);
  await q.log('reserved', { pid: process.pid, claim: await claimState(inject('apiPortRoot'), 63812) });
  await q.signal('owner-reserved', { pid: process.pid });
  await q.waitFor('observer-ready');
  await q.log('killing-self', { pid: process.pid });
  process.kill(process.pid, 'SIGKILL');
  await new Promise(() => undefined);
}, 60_000);
