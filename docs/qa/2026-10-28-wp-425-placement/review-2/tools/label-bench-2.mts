// Reviewer measurement (WP-425 scan 2): the label work Canvas.tsx does per drag step and per
// settlement, on the routing fixtures, beside the router's own drag-step cost. The drag motion
// is scan 1's (review/tools/label-bench.mts). main has no label pass, so main's per-step cost
// is the router's; routing.ts is unchanged by the branch (git diff a4fee9a9 HEAD).
// Run: pnpm --filter @graphgoblin/web exec tsx --conditions=development <this file>
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const web = join(root, 'apps', 'web');
const load = async <T,>(p: string) => (await import(pathToFileURL(join(web, p)).href)) as T;
type Pt = { x: number; y: number };
const { createRoutingPlan, routeMessage } = await load<{
  createRoutingPlan: (n: any[], e: any[], o?: unknown, p?: any) => any;
  routeMessage: (r: any) => string;
}>('src/editor/routing.ts');
const { denseGraph, routingInput } = await load<{
  denseGraph: (n: number) => unknown;
  routingInput: (d: unknown) => { nodes: any[]; edges: any[] };
}>('src/__fixtures__/routing.ts');
const { createLabelPlacementCache, placeEdgeLabels } = await load<{
  createLabelPlacementCache: () => (
    moving: boolean,
    prepare: () => { paths: any[]; cards: any[] },
  ) => Map<string, any>;
  placeEdgeLabels: (paths: any[], cards: any[]) => Map<string, any>;
}>('src/editor/edge-label-placement.ts');
const { createRouteChannels } = await load<{ createRouteChannels: () => any }>(
  'src/editor/route-channels.ts',
);
const { forwardPoints } = await load<{ forwardPoints: (a: Pt, b: Pt) => Pt[] }>(
  'src/editor/manual-route.ts',
);
const { LABEL_CHARACTER_WIDTH } = await load<{ LABEL_CHARACTER_WIDTH: number }>(
  'src/editor/routing-labels.ts',
);
const requireWeb = createRequire(join(web, 'package.json'));
const xyModule: any = await import(pathToFileURL(requireWeb.resolve('@xyflow/react')).href);
const xy = (xyModule.Position ? xyModule : xyModule.default) as {
  getSmoothStepPath: (o: object) => [string, number, number];
  Position: { Right: string; Left: string };
};

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!;
const r3 = (n: number) => +n.toFixed(4);

/** Canvas.tsx's prepare() for the label cache, on routing-fixture nodes. */
function prepare(nodes: any[], edges: any[], plan: { routes: Map<string, any> }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    paths: edges.flatMap((edge) => {
      const from = byId.get(edge.source)?.outputs[edge.port];
      const to = byId.get(edge.target)?.input;
      if (!from || !to) return [];
      const route = plan.routes.get(edge.id);
      const text = edge.port === 'out' ? '' : edge.port;
      const message = route ? routeMessage(route) : '';
      let fullLabel = message ? `${text || 'Connection'}: ${message}` : text;
      if (route && !message) {
        const capacity = Math.floor(route.labelWidth / LABEL_CHARACTER_WIDTH);
        if (fullLabel.length > capacity)
          fullLabel = `${fullLabel.slice(0, Math.max(0, capacity - 1))}…`;
      }
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
          fixed: !!route,
        },
      ];
    }),
    cards: nodes.map((n) => ({
      id: n.id,
      left: n.x,
      right: n.x + n.width,
      top: n.y,
      bottom: n.y + n.height,
    })),
  };
}

const rows = [];
for (const count of [100, 300]) {
  const { nodes, edges } = routingInput(denseGraph(count));
  let plan = createRoutingPlan(nodes, edges);
  // Settlement (no drag): what an edit, an undo/redo, a keyboard nudge or a drop costs.
  const settle: number[] = [];
  let settled = new Map<string, any>();
  for (let i = 0; i < 25; i += 1) {
    const cache = createLabelPlacementCache();
    const start = performance.now();
    settled = cache(false, () => prepare(nodes, edges, plan));
    if (i >= 5) settle.push(performance.now() - start);
  }
  const inputs = prepare(nodes, edges, plan).paths;
  const placed = placeEdgeLabels(inputs, prepare(nodes, edges, plan).cards);
  const labelled = inputs.filter((p) => p.text).length;
  const forward = inputs.filter((p) => p.text && !p.fixed).length;
  const callouts = [...placed.values()].filter((p) => p.anchor).length;
  const subPixel = [...settled.entries()].filter(([id, p]) => {
    const input = inputs.find((i) => i.id === id)!;
    return Math.hypot(p.at.x - input.preferred.x, p.at.y - input.preferred.y) < 0.5;
  }).length;
  // Drag: the router plus the label cache while moving, as Canvas does per plan change.
  const cache = createLabelPlacementCache();
  cache(false, () => prepare(nodes, edges, plan));
  const channels = createRouteChannels();
  for (const e of edges) channels.edge(e.id, plan.routes.get(e.id));
  const active = new Set(edges.map((e: any) => e.id));
  let prepared = 0;
  const routing: number[] = [];
  const labels: number[] = [];
  const publishMain: number[] = [];
  const publishHead: number[] = [];
  let moved: any[] = nodes;
  let current = cache(true, () => ({ paths: [], cards: [] }));
  for (let step = 0; step < 90; step += 1) {
    moved = structuredClone(nodes);
    const n = moved[Math.floor(nodes.length / 2) - 6]!;
    const dx = Math.sin(step / 10) * 10;
    const dy = Math.cos(step / 10) * 8;
    n.x += dx;
    n.y += dy;
    for (const p of [n.input!, ...(Object.values(n.outputs) as any[])]) {
      p.x += dx;
      p.y += dy;
    }
    let start = performance.now();
    plan = createRoutingPlan(moved, edges, undefined, plan as any);
    if (step >= 10) routing.push(performance.now() - start);
    start = performance.now();
    current = cache(true, () => {
      prepared += 1;
      return prepare(moved, edges, plan);
    });
    if (step >= 10) labels.push(performance.now() - start);
    start = performance.now();
    channels.publish(plan.routes, active);
    if (step >= 10) publishMain.push(performance.now() - start);
    start = performance.now();
    channels.publish(plan.routes, active, current);
    if (step >= 10) publishHead.push(performance.now() - start);
  }
  const releaseStart = performance.now();
  const released = cache(false, () => prepare(moved, edges, plan));
  const releaseMs = performance.now() - releaseStart;
  rows.push({
    nodes: count,
    edges: edges.length,
    labelled,
    forwardLabelled: forward,
    displacedAfterSettle: settled.size,
    displacedBySubPixelOnly: subPixel,
    callouts,
    settleP50Ms: r3(percentile(settle, 0.5)),
    settleP95Ms: r3(percentile(settle, 0.95)),
    dragRoutingP50Ms: r3(percentile(routing, 0.5)),
    dragRoutingP95Ms: r3(percentile(routing, 0.95)),
    dragLabelCacheP50Ms: r3(percentile(labels, 0.5)),
    dragLabelCacheP95Ms: r3(percentile(labels, 0.95)),
    dragPreparations: prepared,
    publishRoutesOnlyP50Ms: r3(percentile(publishMain, 0.5)),
    publishWithLabelsP50Ms: r3(percentile(publishHead, 0.5)),
    publishWithLabelsP95Ms: r3(percentile(publishHead, 0.95)),
    releaseSettleMs: r3(releaseMs),
    displacedAfterRelease: released.size,
  });
}
console.log(JSON.stringify({ node: process.version, rows }, null, 2));
