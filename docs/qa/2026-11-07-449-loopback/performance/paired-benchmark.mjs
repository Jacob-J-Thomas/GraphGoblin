import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const fixturePath = 'C:/Users/98jak/.codex/worktrees/gg-20261107-loopback/GraphGoblin/apps/web/src/__fixtures__/routing.ts';
const [before, after, fixtures] = await Promise.all([
  import(pathToFileURL(join(evidence, 'routing-before.ts')).href),
  import(pathToFileURL(join(evidence, 'routing-after.ts')).href),
  import(pathToFileURL(fixturePath).href),
]);
const { nodes, edges } = fixtures.routingInput(fixtures.denseGraph(300));
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summarize = (values) => ({
  samples: values.length,
  p50Ms: quantile(values, 0.5),
  p95Ms: quantile(values, 0.95),
  minimumMs: Math.min(...values),
  maximumMs: Math.max(...values),
});
const fingerprint = (plan) => JSON.stringify({
  routes: [...plan.routes],
  directions: [...plan.directions],
  suspended: [...plan.suspended],
  statistics: plan.statistics,
});
const beforeHash = createHash('sha256');
const afterHash = createHash('sha256');
const rows = [];
const beforeTimes = [];
const afterTimes = [];
const pairedDifferences = [];
const startedAt = new Date().toISOString();
for (let block = 0; block < 3; block++) {
  const workspaces = [new before.SearchWorkspace(), new after.SearchWorkspace()];
  const routers = [before.createRoutingPlan, after.createRoutingPlan];
  const plans = routers.map((route, i) => route(nodes, edges, undefined, undefined, workspaces[i]));
  const baseline = [];
  const candidate = [];
  const statistics = [];
  for (let step = 0; step < 100; step++) {
    const moved = structuredClone(nodes);
    const card = moved[Math.floor(nodes.length / 2) - 6];
    const phase = (block * 100 + step) / 10;
    const dx = Math.sin(phase) * 10;
    const dy = Math.cos(phase) * 8;
    card.x += dx;
    card.y += dy;
    for (const port of [card.input, ...Object.values(card.outputs)]) {
      port.x += dx;
      port.y += dy;
    }
    const elapsed = [];
    // Each variant runs first equally often; both see exactly the same authored geometry.
    const order = (step + block) % 2 ? [1, 0] : [0, 1];
    for (const variant of order) {
      const start = performance.now();
      plans[variant] = routers[variant](moved, edges, undefined, plans[variant], workspaces[variant]);
      elapsed[variant] = performance.now() - start;
    }
    // Equality/hashing is deliberately outside both measured planner intervals.
    const oldFingerprint = fingerprint(plans[0]);
    const newFingerprint = fingerprint(plans[1]);
    assert.equal(newFingerprint, oldFingerprint, `route/statistics mismatch at block ${block}, step ${step}`);
    beforeHash.update(oldFingerprint);
    afterHash.update(newFingerprint);
    if (step < 20) continue;
    baseline.push(elapsed[0]);
    candidate.push(elapsed[1]);
    beforeTimes.push(elapsed[0]);
    afterTimes.push(elapsed[1]);
    pairedDifferences.push(elapsed[1] - elapsed[0]);
    statistics.push(plans[1].statistics);
  }
  rows.push({
    block: block + 1,
    before: summarize(baseline),
    after: summarize(candidate),
    beforeSamplesMs: baseline,
    afterSamplesMs: candidate,
    statistics,
  });
}
const digest = async (name) => createHash('sha256').update(await readFile(join(evidence, name))).digest('hex');
const report = {
  startedAt,
  completedAt: new Date().toISOString(),
  nodeVersion: process.version,
  kind: 'Node CPU diagnostic; not browser acceptance or an assertion against the browser timing gate',
  head: '01c39c4290cf1884147d73d89a854b9380a01b61',
  fixture: 'production routingInput(denseGraph(300)), same center-card sinusoidal drag as existing routing CPU diagnostic',
  nodes: nodes.length,
  edges: edges.length,
  blocks: 3,
  warmupStepsPerBlock: 20,
  measuredStepsPerBlock: 80,
  variantsInterleavedPerStep: true,
  includes: 'createRoutingPlan with persistent per-variant SearchWorkspace',
  excludes: 'geometry selector, labels, hashing, React, DOM, rendering, CSS animation',
  originalBeforeSha256: await digest('routing-before-original.ts'),
  originalAfterSha256: await digest('routing-after-original.ts'),
  executableImportsRewrittenOnly: true,
  fingerprintComparisons: 300,
  beforeRouteStatisticsFingerprint: beforeHash.digest('hex'),
  afterRouteStatisticsFingerprint: afterHash.digest('hex'),
  before: summarize(beforeTimes),
  after: summarize(afterTimes),
  pairedAfterMinusBefore: summarize(pairedDifferences),
  rows,
};
await writeFile(join(evidence, 'paired-benchmark.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  ...report,
  rows: report.rows.map(({ beforeSamplesMs, afterSamplesMs, statistics, ...row }) => row),
}, null, 2));
