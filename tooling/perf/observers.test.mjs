import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Frames, Timings, definition } from './common.mjs';

test('SSE observer preserves fragmented frames and detects cursor gaps', () => {
  const frames = new Frames(10);
  frames.push(': connected\n\nid: 11\nevent: node.progress\ndata: {"seq":11,');
  frames.push('"value":"測定"}\n\nid: 12\ndata: {"seq":12}\n\n');
  assert.equal(frames.count, 2);
  assert.equal(frames.last, 12);
  assert.equal(frames.gaps, 0);
  frames.push('id: 14\ndata: {"seq":14}\n\n');
  assert.equal(frames.gaps, 1);
  assert.throws(() => frames.push('id: 15\ndata: {"seq":16}\n\n'), /mismatch/);
});
test('bounded timing histogram has truthful counts, totals and percentile bounds', () => {
  const timing = new Timings();
  assert.equal(timing.json().meanMs, null);
  for (let index = 1; index <= 10000; index++) timing.add(index / 100);
  const result = timing.json();
  assert.equal(result.count, 10000);
  assert.ok(Math.abs(result.totalMs - 500050) < 1e-7);
  assert.equal(result.maxMs, 100);
  assert.ok(result.p50UpperMs >= 50 && result.p50UpperMs <= 55);
  assert.ok(result.p95UpperMs >= 95 && result.p95UpperMs <= 104.5);
  assert.ok(timing.bins.size < 150);
});
test('cyclic fixture uses per-node visit cap, gate limit and an initialization outside the cycle', () => {
  const loop = definition(4, { passes: 10000, inference: false, contextBytes: 128 });
  assert.equal(loop.settings.maxNodeVisits, 10000);
  assert.equal(loop.nodes.find((node) => node.id === 'gate').config.maxPasses, 10000);
  assert.equal(
    loop.edges.find((edge) => edge.from.node === 'gate' && edge.from.port === 'again').to.node,
    'work',
  );
  assert.equal(loop.edges.find((edge) => edge.from.node === 'start').to.node, 'init');
  assert.equal(
    loop.nodes.find((node) => node.id === 'init').config.operations[0].path,
    '/vars/history',
  );
});

test('payload hashing survives reconnect without hashing transport comments', () => {
  const shared = createHash('sha256');
  const prefix = new Frames(0, shared);
  prefix.push(': connected\n\nid: 1\ndata: {"seq":1,"value":"exact"}\n\n');
  const partial = prefix.digest();
  const suffix = new Frames(1, shared);
  suffix.push(': reconnected\n\nid: 2\ndata: {"seq":2,"value":[1,2]}\n\n');
  const expected = createHash('sha256')
    .update('{"seq":1,"value":"exact"}\n{"seq":2,"value":[1,2]}\n')
    .digest('hex');
  assert.equal(suffix.digest(), expected);
  assert.notEqual(partial, suffix.digest());
  assert.equal(suffix.gaps, 0);
});
