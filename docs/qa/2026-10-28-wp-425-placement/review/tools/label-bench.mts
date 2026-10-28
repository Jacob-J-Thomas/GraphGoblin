// Reviewer measurement (WP-425): cost of placeEdgeLabels as Canvas.tsx calls it, on the routing
// fixtures, beside the router's own drag-step cost. Mirrors e2e/routing-benchmark.ts's drag.
// Run: pnpm --filter @graphgoblin/web exec tsx --conditions=development <this file> <worktree>
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.argv[2]!;
const web = join(root, 'apps', 'web');
const url = (p: string) => pathToFileURL(join(web, p)).href;
const { createRoutingPlan, routeMessage } = (await import(
  url('src/editor/routing.ts')
)) as typeof import('../../../../source/repos/GraphGoblin/apps/web/src/editor/routing.js');
const { denseGraph, routingInput } = (await import(url('src/__fixtures__/routing.ts'))) as {
  denseGraph: (n: number) => unknown;
  routingInput: (d: unknown) => { nodes: any[]; edges: any[] };
};
const { placeEdgeLabels } = (await import(url('src/editor/edge-label-placement.ts'))) as {
  placeEdgeLabels: (paths: any[], cards: any[]) => Map<string, any>;
};
const { forwardPoints } = (await import(url('src/editor/manual-route.ts'))) as {
  forwardPoints: (a: any, b: any) => any[];
};
const requireWeb = createRequire(join(web, 'package.json'));
const xyModule: any = await import(pathToFileURL(requireWeb.resolve("@xyflow/react")).href);
const xy = (xyModule.Position ? xyModule : xyModule.default) as {
  getSmoothStepPath: (o: object) => [string, number, number];
  Position: { Right: string; Left: string };
};

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!;

function labelInputs(nodes: any[], edges: any[], plan: { routes: Map<string, any> }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.flatMap((edge) => {
    const from = byId.get(edge.source)?.outputs[edge.port];
    const to = byId.get(edge.target)?.input;
    if (!from || !to) return [];
    const route = plan.routes.get(edge.id);
    const text = edge.port === 'out' ? '' : edge.port;
    const message = route ? routeMessage(route) : '';
    const fullLabel = message ? `${text || 'Connection'}: ${message}` : text;
    if (!fullLabel) return [];
    const [, x, y] = xy.getSmoothStepPath({
      sourceX: from.x,
      sourceY: from.y,
      targetX: to.x,
      targetY: to.y,
      sourcePosition: xy.Position.Right,
      targetPosition: xy.Position.Left,
      borderRadius: 10,
    });
    return [
      {
        id: edge.id,
        text: fullLabel,
        points: route?.points ?? forwardPoints(from, to),
        preferred: route?.label ?? { x, y },
      },
    ];
  });
}
const cardBoxes = (nodes: any[]) =>
  nodes.map((n) => ({ id: n.id, left: n.x, right: n.x + n.width, top: n.y, bottom: n.y + n.height }));

const rows = [];
for (const count of [100, 300]) {
  const { nodes, edges } = routingInput(denseGraph(count));
  let plan = createRoutingPlan(nodes, edges);
  const full: number[] = [];
  for (let i = 0; i < 25; i += 1) {
    const start = performance.now();
    placeEdgeLabels(labelInputs(nodes, edges, plan), cardBoxes(nodes));
    if (i >= 5) full.push(performance.now() - start);
  }
  const routing: number[] = [];
  const labels: number[] = [];
  let fallbacks = 0;
  let labelled = 0;
  let moved: any[] = nodes;
  for (let step = 0; step < 90; step += 1) {
    moved = structuredClone(nodes);
    const n = moved[Math.floor(nodes.length / 2) - 6]!;
    const dx = Math.sin(step / 10) * 10;
    const dy = Math.cos(step / 10) * 8;
    n.x += dx;
    n.y += dy;
    for (const p of [n.input!, ...Object.values(n.outputs) as any[]]) {
      p.x += dx;
      p.y += dy;
    }
    let start = performance.now();
    plan = createRoutingPlan(moved, edges, undefined, plan as any);
    if (step >= 10) routing.push(performance.now() - start);
    start = performance.now();
    const inputs = labelInputs(moved, edges, plan);
    const placed = placeEdgeLabels(inputs, cardBoxes(moved));
    if (step >= 10) labels.push(performance.now() - start);
    labelled = inputs.length;
    fallbacks = [...placed.values()].filter((p) => p.anchor).length;
  }
  rows.push({
    nodes: count,
    edges: edges.length,
    labelled,
    fallbackCallouts: fallbacks,
    labelsFullP50Ms: +percentile(full, 0.5).toFixed(3),
    labelsFullP95Ms: +percentile(full, 0.95).toFixed(3),
    dragRoutingP50Ms: +percentile(routing, 0.5).toFixed(3),
    dragRoutingP95Ms: +percentile(routing, 0.95).toFixed(3),
    dragLabelsP50Ms: +percentile(labels, 0.5).toFixed(3),
    dragLabelsP95Ms: +percentile(labels, 0.95).toFixed(3),
  });
}
console.log(JSON.stringify({ node: process.version, rows }, null, 2));
