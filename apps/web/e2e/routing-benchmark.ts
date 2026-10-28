/** Local CPU diagnostic, separate from the Edge acceptance measurement in routing.spec.ts.
 * Includes the production lazy label cache in drag timings, with routing/label phases reported
 * separately. labelPreparations must remain one across all 80 pointer steps (unit-test guarded).
 * pnpm --filter @graphgoblin/web exec tsx --conditions=development e2e/routing-benchmark.ts [output.json] [baseline-module.ts]
 * The optional baseline module is an isolated copy from git show; no checkout/branch change.
 * No timing assertions: unit tests gate deterministic work counts instead.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRoutingPlan, type RoutingNode, type RoutingEdge } from '../src/editor/routing.js';
import { denseGraph, routingInput } from '../src/__fixtures__/routing.js';
import { getSmoothStepPath, Position } from '@xyflow/react';
import { createLabelPlacementCache } from '../src/editor/edge-label-placement.js';
import { forwardPoints } from '../src/editor/manual-route.js';

function column(count: number): { nodes: RoutingNode[]; edges: RoutingEdge[] } {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    x: 0,
    y: i * 202,
    width: 184,
    height: 122,
    input: { x: 0, y: i * 202 + 61 },
    outputs: { out: { x: 184, y: i * 202 + 91.5 } },
  }));
  const edge = (source: string, target: string): RoutingEdge => ({
    id: `${source}-${target}`,
    source,
    target,
    port: 'out',
  });
  return {
    nodes,
    edges: nodes.slice(1).flatMap((n, i) => [edge(n.id, nodes[i]!.id), edge(nodes[i]!.id, n.id)]),
  };
}
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!;
const router = process.argv[3]
  ? (
      (await import(pathToFileURL(resolve(process.argv[3])).href)) as {
        createRoutingPlan: typeof createRoutingPlan;
      }
    ).createRoutingPlan
  : createRoutingPlan;
const rows = [];
for (const [name, fixture] of [
  ...[40, 100, 150].map((n) => [`column-${n}`, column(n)] as const),
  ['grid-300', routingInput(denseGraph(300))] as const,
]) {
  const { nodes, edges } = fixture;
  const full: number[] = [];
  const drag: number[] = [];
  const routingDrag: number[] = [];
  const labelDrag: number[] = [];
  const rerouted: number[] = [];
  let plan = router(nodes, edges);
  for (let i = 0; i < 25; i += 1) {
    const start = performance.now();
    plan = router(nodes, edges);
    if (i >= 5) full.push(performance.now() - start);
  }
  const fullStatistics = plan.statistics;
  // A baseline router module represents main, which has no shared forward-label pass.
  const placeLabels = process.argv[3] ? () => undefined : createLabelPlacementCache();
  let labelPreparations = 0;
  const prepareLabels = () => {
    labelPreparations += 1;
    const byId = new Map(plan.nodes.map((n) => [n.id, n]));
    return {
      cards: plan.nodes.map((n) => ({
        id: n.id,
        left: n.x,
        right: n.x + n.width,
        top: n.y,
        bottom: n.y + n.height,
      })),
      paths: edges.flatMap((edge) => {
        const from = byId.get(edge.source)?.outputs[edge.port],
          to = byId.get(edge.target)?.input;
        if (!from || !to) return [];
        const route = plan.routes.get(edge.id);
        const [, x, y] = getSmoothStepPath({
          sourceX: from.x,
          sourceY: from.y,
          targetX: to.x,
          targetY: to.y,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          borderRadius: 10,
        });
        return [
          {
            id: edge.id,
            text: edge.port === 'out' ? '' : edge.port,
            points: route?.points ?? forwardPoints(from, to),
            preferred: route?.label ?? { x, y },
            fixed: !!route,
          },
        ];
      }),
    };
  };
  const labelsStart = performance.now();
  placeLabels(false, prepareLabels);
  const settledLabelsMs = performance.now() - labelsStart;
  for (let step = 0; step < 80; step += 1) {
    const moved = structuredClone(nodes);
    const n = moved[Math.floor(nodes.length / 2) - 6]!;
    const dx = Math.sin(step / 10) * 10;
    const dy = Math.cos(step / 10) * 8;
    n.x += dx;
    n.y += dy;
    for (const p of [n.input!, ...Object.values(n.outputs)]) {
      p.x += dx;
      p.y += dy;
    }
    const start = performance.now();
    plan = router(moved, edges, undefined, plan);
    const routedAt = performance.now();
    placeLabels(true, prepareLabels);
    const finishedAt = performance.now();
    drag.push(finishedAt - start);
    routingDrag.push(routedAt - start);
    labelDrag.push(finishedAt - routedAt);
    rerouted.push(plan.statistics.rerouted);
  }
  const start = performance.now();
  const added = router(nodes, [...edges, { ...edges[0]!, id: 'extra' }], undefined, plan);
  const addMs = performance.now() - start;
  rows.push({
    name,
    fullP50Ms: percentile(full, 0.5),
    fullP95Ms: percentile(full, 0.95),
    steadyDragP50Ms: percentile(drag.slice(10), 0.5),
    steadyDragP95Ms: percentile(drag.slice(10), 0.95),
    allDragP95Ms: percentile(drag, 0.95),
    routingOnlyDragP50Ms: percentile(routingDrag.slice(10), 0.5),
    routingOnlyDragP95Ms: percentile(routingDrag.slice(10), 0.95),
    dragLabelsP50Ms: percentile(labelDrag.slice(10), 0.5),
    dragLabelsP95Ms: percentile(labelDrag.slice(10), 0.95),
    settledLabelsMs,
    labelPreparations,
    addMs,
    reroutedP95: percentile(rerouted.slice(10), 0.95),
    fullStatistics,
    addedStatistics: added.statistics,
    fullSamples: full,
    dragSamples: drag,
  });
}
const report = {
  node: process.version,
  baseline: process.argv[3] ?? null,
  fullWarmup: 5,
  fullSamples: 20,
  dragWarmup: 10,
  dragSamples: 80,
  rows,
};
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) await writeFile(process.argv[2], json);
console.log(
  JSON.stringify(
    rows.map(({ fullSamples: _full, dragSamples: _drag, ...row }) => row),
    null,
    2,
  ),
);
