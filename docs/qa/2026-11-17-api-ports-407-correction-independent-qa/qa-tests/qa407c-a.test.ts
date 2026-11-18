// Disposable independent-QA worker A for #407 correction 01. Removed after the QA session.
import { expect, it } from 'vitest';
import { analyzeD2, k9Owner, runD2 } from './qa407c-scenarios.js';
import { brief, signal, tryReserve, waitFor, writeJson } from './qa407c-util.js';

it('A1 D2 two-worker one-port contention (A) + merged analysis', async () => {
  await runD2('A');
  await analyzeD2();
}, 120_000);

it('A2 K3+K9 real built API owner: wildcard skip, held before bind, restart, settlement', async () => {
  await k9Owner();
}, 300_000);

it('A3 K6a cross-process: abandoned lease in worker B stays reserved for worker A', async () => {
  await waitFor('K6a-abandoned', 'B', 280_000);
  const a = await tryReserve(63814, 1);
  if (a.ok) await a.release();
  await writeJson('K6a-A-result.json', { pid: process.pid, attempt: brief(a) });
  await signal('K6a-A-checked', brief(a));
  expect(a.ok === false && a.exhausted).toBe(true);
}, 300_000);
