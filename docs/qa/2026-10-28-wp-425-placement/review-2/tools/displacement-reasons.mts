// Reviewer diagnostic (WP-425 scan 2): why forward labels leave xyflow's default position on the
// dense routing fixture. For every label the settled cache moved, check whether its default pill
// (expanded by the solver's 4 px) touches a card, a routed (fixed) label, or another label's
// settled pill; the rest moved only because their default sits on a straight segment too short
// for the pill plus corner allowance (fitsPreferred in edge-label-placement.ts).
// Run: pnpm --filter @graphgoblin/web exec tsx --conditions=development <this file>
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const web = join(root, 'apps', 'web');
const load = async (p: string) => (await import(pathToFileURL(join(web, p)).href)) as any;
const { createRoutingPlan, routeMessage } = await load('src/editor/routing.ts');
const { denseGraph, routingInput } = await load('src/__fixtures__/routing.ts');
const { placeEdgeLabels, labelBox } = await load('src/editor/edge-label-placement.ts');
const { forwardPoints } = await load('src/editor/manual-route.ts');
const { expand, overlapsBox } = await load('src/editor/routing-geometry.ts');
const requireWeb = createRequire(join(web, 'package.json'));
const xyModule: any = await import(pathToFileURL(requireWeb.resolve('@xyflow/react')).href);
const xy = xyModule.Position ? xyModule : xyModule.default;

const out: unknown[] = [];
for (const count of [100, 300]) {
  const { nodes, edges } = routingInput(denseGraph(count));
  const plan = createRoutingPlan(nodes, edges);
  const byId = new Map(nodes.map((n: any) => [n.id, n]));
  const paths = edges.flatMap((edge: any) => {
    const from = byId.get(edge.source)?.outputs[edge.port];
    const to = byId.get(edge.target)?.input;
    if (!from || !to) return [];
    const route = plan.routes.get(edge.id);
    const text = edge.port === 'out' ? '' : edge.port;
    const message = route ? routeMessage(route) : '';
    const full = message ? `${text || 'Connection'}: ${message}` : text;
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
        text: full,
        points: route?.points ?? forwardPoints(from, to),
        preferred: route?.label ?? { x, y },
        fixed: !!route,
      },
    ];
  });
  const cards = nodes.map((n: any) => ({ id: n.id, left: n.x, right: n.x + n.width, top: n.y, bottom: n.y + n.height }));
  const placed: Map<string, any> = placeEdgeLabels(paths, cards);
  const moved = paths.filter(
    (p: any) => p.text && !p.fixed && (placed.get(p.id).at.x !== p.preferred.x || placed.get(p.id).at.y !== p.preferred.y),
  );
  const reasons = { card: 0, routedLabel: 0, otherLabel: 0, fitOnly: 0 };
  const samples: unknown[] = [];
  for (const p of moved) {
    const box = expand(labelBox(p.id, p.text, p.preferred), 4);
    if (cards.some((c: any) => overlapsBox(box, c))) reasons.card += 1;
    else if (paths.some((q: any) => q.fixed && q.text && overlapsBox(box, labelBox(q.id, q.text, q.preferred))))
      reasons.routedLabel += 1;
    else if (paths.some((q: any) => q.id !== p.id && q.text && placed.get(q.id) && overlapsBox(box, placed.get(q.id).box)))
      reasons.otherLabel += 1;
    else {
      reasons.fitOnly += 1;
      if (samples.length < 3)
        samples.push({ id: p.id, text: p.text, preferred: p.preferred, placedAt: placed.get(p.id).at, points: p.points });
    }
  }
  out.push({ nodes: count, forwardLabelled: paths.filter((p: any) => p.text && !p.fixed).length, moved: moved.length, reasons, samples });
}
console.log(JSON.stringify(out, null, 2));
