import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  Frames,
  Timings,
  definition,
  assertSampleCount,
  mapProfileWindow,
  profileSampleTimes,
  root,
} from './common.mjs';
import { HttpBody } from './replay.mjs';
import { summarize } from './summary.mjs';
import { pathToFileURL } from 'node:url';

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

test('raw replay decoder separates HTTP framing across fragmented socket reads', () => {
  const decoder = new HttpBody();
  const received = [];
  const wire = Buffer.from(
    'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n',
  );
  for (let i = 0; i < wire.length; i += 3) received.push(...decoder.push(wire.subarray(i, i + 3)));
  assert.equal(Buffer.concat(received).toString(), 'hello world');
  assert.equal(decoder.done, true);
  assert.throws(() => new HttpBody().push(Buffer.from('HTTP/1.1 503 Unavailable\r\n\r\n')), /503/);
});

test('CPU profile guard rejects empty or out-of-range execution samples', () => {
  assertSampleCount(1, 10);
  assertSampleCount(10, 10);
  assert.throws(() => assertSampleCount(0, 10), /Invalid CPU profile window/);
  assert.throws(() => assertSampleCount(11, 10), /Invalid CPU profile window/);
});

test.each([-1_340_000_000, 0, 1_340_000_000])(
  'CPU windows map an injected %s microsecond clock offset and exclude uncertain boundaries',
  (offset) => {
    // The supported offsets include both signs; move the synthetic clocks above zero.
    const clock = (value) => value * 1000 + 2_000_000_000;
    const profile = { startTime: clock(100), endTime: clock(300) };
    const window = { startUs: clock(1000) - offset, endUs: clock(1100) - offset };
    const anchors = [
      { beforeUs: clock(998) - offset, afterUs: clock(1002) - offset, profileUs: clock(100) },
      { beforeUs: clock(1199) - offset, afterUs: clock(1201) - offset, profileUs: clock(300) },
    ];
    const mapped = mapProfileWindow(window, anchors, profile);
    assert.deepEqual(mapped, { startUs: clock(102), endUs: clock(198), uncertaintyUs: 1000 });
    const samples = [clock(102) - 1, clock(102), clock(198), clock(198) + 1];
    assert.deepEqual(
      samples.filter((at) => at >= mapped.startUs && at <= mapped.endUs),
      [clock(102), clock(198)],
    );
  },
);

test('CPU clock mapping refuses malformed, drifting, collapsed, and out-of-profile bounds', () => {
  const profile = { startTime: 100_000, endTime: 300_000 };
  const window = { startUs: 150_000, endUs: 200_000 };
  const anchors = [
    { beforeUs: 100_000, afterUs: 100_000, profileUs: 100_000 },
    { beforeUs: 300_000, afterUs: 300_000, profileUs: 300_000 },
  ];
  assert.deepEqual(mapProfileWindow(window, anchors, profile), {
    startUs: 151_000,
    endUs: 199_000,
    uncertaintyUs: 1000,
  });
  assert.throws(() => mapProfileWindow(window, [], profile), /calibration/);
  assert.throws(() => mapProfileWindow(null, anchors, profile), /calibration/);
  assert.throws(
    () => mapProfileWindow({ startUs: 200, endUs: 150 }, anchors, profile),
    /calibration/,
  );
  assert.throws(
    () => mapProfileWindow(window, anchors, { startTime: 300, endTime: 100 }),
    /calibration/,
  );
  for (const invalid of [
    null,
    { ...anchors[0], beforeUs: NaN },
    { ...anchors[0], beforeUs: 101_000 },
    { ...anchors[0], profileUs: 99_000 },
    { ...anchors[0], profileUs: 301_000 },
  ])
    assert.throws(() => mapProfileWindow(window, [invalid, anchors[1]], profile), /anchor/);
  assert.throws(
    () =>
      mapProfileWindow(
        window,
        [anchors[0], { ...anchors[1], beforeUs: 303_000, afterUs: 303_000 }],
        profile,
      ),
    /offsets changed/,
  );
  assert.throws(
    () => mapProfileWindow({ startUs: 99_000, endUs: 150_000 }, anchors, profile),
    /outside calibrated/,
  );
  assert.throws(
    () => mapProfileWindow({ startUs: 200_000, endUs: 301_000 }, anchors, profile),
    /outside calibrated/,
  );
  const partial = [
    { beforeUs: 150_000, afterUs: 150_000, profileUs: 150_000 },
    { beforeUs: 250_000, afterUs: 250_000, profileUs: 250_000 },
  ];
  assert.throws(
    () => mapProfileWindow({ startUs: 125_000, endUs: 200_000 }, partial, profile),
    /outside calibrated/,
  );
  assert.throws(
    () => mapProfileWindow({ startUs: 200_000, endUs: 275_000 }, partial, profile),
    /outside calibrated/,
  );
  assert.throws(
    () =>
      mapProfileWindow(
        { startUs: 150_000, endUs: 151_000 },
        [
          { beforeUs: 98_000, afterUs: 102_000, profileUs: 100_000 },
          { beforeUs: 298_000, afterUs: 302_000, profileUs: 300_000 },
        ],
        profile,
      ),
    /outside calibrated/,
  );
});

test('CPU sample timestamps reject missing, nonfinite, negative and out-of-profile deltas', () => {
  const profile = { startTime: 100, endTime: 200, samples: [1, 2, 3], timeDeltas: [0, 50, 50] };
  assert.deepEqual(profileSampleTimes(profile), [100, 150, 200]);
  for (const invalid of [
    { ...profile, samples: null },
    { ...profile, timeDeltas: null },
    { ...profile, timeDeltas: [10] },
    { ...profile, startTime: NaN },
    { ...profile, endTime: 100 },
  ])
    assert.throws(() => profileSampleTimes(invalid), /sample\/delta/);
  for (const delta of [NaN, Infinity, -1, 0.5])
    assert.throws(() => profileSampleTimes({ ...profile, timeDeltas: [delta, 0, 0] }), /delta/);
  assert.throws(() => profileSampleTimes({ ...profile, timeDeltas: [101, 0, 0] }), /outside/);
  assert.throws(
    () =>
      profileSampleTimes({
        startTime: Number.MAX_SAFE_INTEGER - 10,
        endTime: Number.MAX_SAFE_INTEGER,
        samples: [1],
        timeDeltas: [20],
      }),
    /outside/,
  );
});

test('compact summary removes process paths and distinguishes shell from history readiness', () => {
  const raw = {
    schema: 2,
    workload: 'browser',
    aged: 0,
    output: 'C:/private/output',
    dataDir: 'C:/private/store',
    command: ['private'],
    environment: { commit: 'abc' },
    cases: [
      {
        specification: { passes: 100 },
        timings: { 'events.read': { count: 1, totalMs: 12.34567 } },
        checkpoints: [],
        correctness: { ok: true },
        cpuSamples: {
          count: 10,
          top: [[pathToFileURL(root).href + 'packages/engine/dist/run-manager.js:1 execute', 8]],
        },
        browser: {
          pages: [
            {
              name: 'inspector',
              shellReadyMs: 10,
              historyReadyMs: 30,
              firstRowsMs: 20,
              metrics: [],
              beforeRun: { lastEventSeq: 200 },
              afterRun: { lastEventSeq: 300 },
            },
          ],
        },
      },
    ],
  };
  const compact = summarize([raw]);
  const encoded = JSON.stringify(compact);
  assert.ok(!/private|file:|[a-z]:\//i.test(encoded));
  assert.equal(compact.browserPages[0].historyReadyMs, 30);
  assert.equal(compact.browserPages[0].firstRowsMs, 20);
  const [locationIndex, samples] = compact.cases[0].topCpuFrames[0];
  assert.equal(
    compact.cpuLocations[locationIndex],
    'packages/engine/dist/run-manager.js:1 execute',
  );
  assert.equal(samples, 8);
  assert.ok(Buffer.byteLength(encoded) < 4000);
});

test('measurement graphs preserve inference-only and explicit return-control modes', () => {
  const plain = definition(4, { passes: 2 });
  assert.equal(plain.variables, undefined);
  assert.equal(
    plain.nodes.some((node) => node.id === 'init'),
    false,
  );
  assert.equal(
    plain.nodes.find((node) => node.id === 'work').config.output.captureTranscript,
    'none',
  );
  const returns = definition(4, { passes: 2, returnControl: true });
  assert.deepEqual(returns.nodes.find((node) => node.id === 'done').config.destinations, [
    { kind: 'caller' },
    { kind: 'log' },
  ]);
});

test('portable summaries bound sparse browser/replay samples and strip external CPU paths', () => {
  const r = {
    timings: {},
    checkpoints: [],
    cpuSamples: { top: [['C:/private/native.js', 1]] },
    browser: {
      pages: [
        { name: 'empty', ttiMs: 3, metrics: [{ elapsedMs: 1, nodes: 0, sessionStorageBytes: 0 }] },
      ],
    },
    replays: {
      first: {},
      late: {},
      slow: {},
      reconnect: { ok: true, interrupted: {}, reconnected: {} },
    },
  };
  const output = summarize([{ workload: 'sparse', cases: [r, r, { cli: { exitCode: 1 } }] }]);
  assert.deepEqual(output.cpuLocations, ['external/native.js']);
  assert.equal(output.browserPages[0].shellReadyMs, 3);
  assert.equal(output.browserPages[0].historyReadyMs, null);
  assert.equal(
    output.replays[0].sampleScope,
    'round-1 post-replay samples; lag buffering unmeasured',
  );
  assert.equal(output.cases[2].preflight.databaseReady, false);
  assert.ok(!JSON.stringify(output).includes('private'));
});
