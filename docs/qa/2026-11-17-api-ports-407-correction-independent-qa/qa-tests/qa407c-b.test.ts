// Disposable independent-QA worker B for #407 correction 01. Removed after the QA session.
import { it } from 'vitest';
import { aclCases, d1Local, generations, k9Peer, runD2 } from './qa407c-scenarios.js';

it('B1 D2 two-worker one-port contention (B)', async () => {
  await runD2('B');
}, 120_000);

it('B2 K9 real built API peer: refused while held, wins only after settlement', async () => {
  await k9Peer();
}, 300_000);

it('B3 D1 foreign listeners (K1, K2)', async () => {
  await d1Local();
}, 90_000);

it('B4 generations: stale release, replacement, crashed/incomplete newest, numeric order (K5, K6, K8)', async () => {
  await generations();
}, 60_000);

it('B5 native ACL permission errors stay visible (K7)', async () => {
  await aclCases();
}, 60_000);
