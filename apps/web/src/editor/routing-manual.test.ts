import { describe, expect, it } from 'vitest';
import { denseGraph, routingInput, simpleLoop } from '../__fixtures__/routing.js';
import { drawnPoints } from './manual-route.js';
import {
  createRoutingPlan,
  describeRoute,
  intersectsBox,
  routeBackwardEdges,
  type RoutingEdge,
  type RoutingNode,
} from './routing.js';

/** simpleLoop's cards and edges: start, work, check, done in a row; done loops back to work. */
function loop() {
  return routingInput(simpleLoop());
}
const moved = (nodes: readonly RoutingNode[], id: string, dx: number, dy: number) =>
  nodes.map((n) =>
    n.id !== id
      ? n
      : {
          ...n,
          x: n.x + dx,
          y: n.y + dy,
          ...(n.input ? { input: { x: n.input.x + dx, y: n.input.y + dy } } : {}),
          outputs: Object.fromEntries(
            Object.entries(n.outputs).map(([port, p]) => [port, { x: p.x + dx, y: p.y + dy }]),
          ),
        },
  );
const withRoute = (
  edges: readonly RoutingEdge[],
  id: string,
  route: number[],
  allowCrossing = false,
) =>
  edges.map((e) =>
    e.id === id ? { ...e, route, ...(allowCrossing ? { allowCrossing } : {}) } : e,
  );

/** A clear endpoint horizontal across the automatic loop-back's preferred return lane. */
function endpointLane(last = false, distant = false) {
  const { nodes, edges } = loop();
  const targetX = last || distant ? 2500 : 1300;
  nodes.push(
    {
      id: 'manual-source',
      x: -164,
      y: last ? 410 : 154,
      width: 184,
      height: 122,
      outputs: { out: { x: 20, y: last ? 510 : 254 } },
    },
    {
      id: 'manual-target',
      x: targetX,
      y: 193,
      width: 184,
      height: 400,
      outputs: {},
      input: { x: targetX, y: last ? 254 : 510 },
    },
  );
  const manual: RoutingEdge = {
    id: 'manual',
    source: 'manual-source',
    target: 'manual-target',
    port: 'out',
    route: [last ? 20 : targetX],
  };
  return { nodes, edges: [...edges, manual] };
}

function expectEndpointSpacing(plan: ReturnType<typeof createRoutingPlan>) {
  const manual = plan.routes.get('manual')!;
  const automatic = plan.routes.get('return')!;
  expect(manual).toMatchObject({ manual: true });
  expect(manual.crossing).toBeUndefined();
  expect(automatic.laneGap).toBe(24);
  for (let i = 1; i < manual.points.length; i += 1) {
    const a = manual.points[i - 1]!;
    const b = manual.points[i]!;
    if (a.y !== b.y) continue;
    const lane = automatic.lane!;
    if (Math.min(a.x, b.x) < lane.right && Math.max(a.x, b.x) > lane.left)
      expect(Math.abs(lane.y - a.y)).toBeGreaterThanOrEqual(automatic.laneGap!);
  }
}

describe('manual routes in the router (#44)', () => {
  it.each([false, true])(
    'reserves the manual endpoint horizontal against automatic overlap (last: %s)',
    (last) => {
      const { nodes, edges } = endpointLane(last);
      const without = createRoutingPlan(
        nodes,
        edges.filter((e) => e.id !== 'manual'),
      );
      expect(without.routes.get('return')!.lane).toMatchObject({ y: 254 });
      const lane = without.routes.get('return')!.lane!;
      expect(lane.right - lane.left).toBe(848);
      expectEndpointSpacing(createRoutingPlan(nodes, edges));
    },
  );

  it.each([false, true])(
    'invalidates automatic routes when only a distant port and its endpoint horizontal move (last: %s)',
    (last) => {
      const { nodes, edges } = endpointLane(last, true);
      const id = last ? 'manual-target' : 'manual-source';
      const away = moved(nodes, id, 0, -30);
      const before = createRoutingPlan(away, edges);
      const reads = before.dependencies.get('return')!;
      // Isolate reservation invalidation: neither endpoint card touches the automatic route's reads.
      const card = nodes.find((n) => n.id === id)!;
      expect(
        reads.boxes.intersects({
          id,
          left: card.x,
          right: card.x + card.width,
          top: card.y,
          bottom: card.y + card.height,
        }),
      ).toBe(false);
      const after = createRoutingPlan(nodes, edges, undefined, before);
      expect(after.routes).toEqual(createRoutingPlan(nodes, edges).routes);
      expectEndpointSpacing(after);
    },
  );
  it('draws a fixed loop-back as given, from the current port tips, labelled on its lane', () => {
    const { nodes, edges } = loop();
    const fixed = withRoute(edges, 'return', [1120, 420, 260]);
    const plan = createRoutingPlan(nodes, fixed);
    const route = plan.routes.get('return')!;
    const done = nodes.find((n) => n.id === 'done')!;
    const work = nodes.find((n) => n.id === 'work')!;
    expect(route.manual).toBe(true);
    expect(route.crossing).toBeUndefined();
    expect(route.points).toEqual(
      drawnPoints([1120, 420, 260], done.outputs['loopBack']!, work.input!),
    );
    expect(route.lane).toEqual({ y: 420, left: 260, right: 1120 });
    expect(route.label.y).toBe(420);
    expect(route.radii).toEqual([0, 8, 8, 8, 8, 0]);
    expect(plan.suspended.size).toBe(0);
    // A fixed forward edge is drawn too, and keeps its forward direction.
    const forward = createRoutingPlan(nodes, withRoute(edges, 'start-work', [240, 40, 270]));
    expect(forward.routes.get('start-work')).toMatchObject({ manual: true });
    expect(forward.directions.get('start-work')).toBe(false);
    // The same description is available for any points.
    const described = describeRoute(route.points, 'loopBack', nodes);
    expect(described).toMatchObject({ lane: route.lane, label: route.label, manual: true });
    expect(describeRoute(route.points, 'loopBack', [])).toMatchObject({ lane: route.lane });
  });

  it('keeps a fixed route attached when a card moves: stubs follow the port, segments stay', () => {
    const { nodes, edges } = loop();
    const fixed = withRoute(edges, 'return', [1120, 420, 260]);
    const before = createRoutingPlan(nodes, fixed);
    const shifted = moved(nodes, 'done', 30, -40);
    const after = createRoutingPlan(shifted, fixed, undefined, before);
    const route = after.routes.get('return')!;
    const done = shifted.find((n) => n.id === 'done')!;
    expect(route.manual).toBe(true);
    expect(route.points[0]).toEqual(done.outputs['loopBack']);
    expect(route.points[1]).toEqual({ x: 1120, y: done.outputs['loopBack']!.y });
    expect(route.lane).toEqual({ y: 420, left: 260, right: 1120 });
    expect(after.routes).toEqual(createRoutingPlan(shifted, fixed).routes);
  });

  it('sets aside a route a moving card lands on: backward falls back, forward goes automatic', () => {
    const { nodes, edges } = loop();
    const fixed = withRoute(withRoute(edges, 'return', [1120, 420, 260]), 'start-work', [240]);
    const first = createRoutingPlan(nodes, fixed);
    expect(first.suspended.size).toBe(0);
    // A card dropped on both routes' paths.
    const blocker = { ...nodes[1]!, id: 'blocker', x: 200, y: 380, width: 900, height: 80 };
    blocker.input = { x: 200, y: 420 };
    blocker.outputs = {};
    const blocked = createRoutingPlan([...nodes, blocker], fixed, undefined, first);
    expect([...blocked.suspended].sort()).toEqual(['return']);
    const fallback = blocked.routes.get('return')!;
    expect(fallback).toMatchObject({ suspended: true, blocked: false, unavailable: false });
    expect(fallback.manual).toBeUndefined();
    for (let i = 1; i < fallback.points.length; i += 1)
      expect(
        intersectsBox(fallback.points[i - 1]!, fallback.points[i]!, {
          id: 'blocker',
          left: 200,
          right: 1100,
          top: 380,
          bottom: 460,
        }),
      ).toBe(false);
    expect(blocked.routes).toEqual(createRoutingPlan([...nodes, blocker], fixed).routes);
    // A forward route through a card: the edge falls back to its automatic (smoothstep) path.
    const wall = {
      ...blocker,
      id: 'wall',
      x: 230,
      y: 0,
      width: 20,
      height: 400,
      input: { x: 230, y: 50 },
    };
    const forward = createRoutingPlan([...nodes, wall], fixed, undefined, blocked);
    expect(forward.suspended.has('start-work')).toBe(true);
    expect(forward.routes.has('start-work')).toBe(false);
    // Moving the card away brings the manual routes back.
    const back = createRoutingPlan(nodes, fixed, undefined, forward);
    expect(back.suspended.size).toBe(0);
    expect(back.routes.get('return')).toMatchObject({ manual: true });
    expect(back.routes.get('start-work')).toMatchObject({ manual: true });
    expect(back.routes).toEqual(first.routes);
    // A route the author put across a card (a stored one, a drag) is drawn there, flagged.
    const preview = createRoutingPlan(
      [...nodes, blocker],
      withRoute(edges, 'return', [1120, 420, 260], true),
    );
    expect(preview.routes.get('return')).toMatchObject({ manual: true, crossing: true });
    expect(preview.suspended.size).toBe(0);
  });

  it('makes automatic routes reserve around a fixed route’s lanes and trunks', () => {
    const { nodes, edges } = loop();
    const twin: RoutingEdge = { ...edges.find((e) => e.id === 'return')!, id: 'twin' };
    const automatic = routeBackwardEdges(nodes, [...edges, twin]).get('twin')!;
    const lane = automatic.lane!;
    // Fix the original return exactly on the twin's automatic lane and trunks.
    const fixedRoute = [automatic.points[1]!.x, lane.y, automatic.points.at(-2)!.x];
    const plan = createRoutingPlan(nodes, [...withRoute(edges, 'return', fixedRoute), twin]);
    const moved = plan.routes.get('twin')!;
    expect(plan.routes.get('return')).toMatchObject({ manual: true });
    expect(moved.manual).toBeUndefined();
    expect(Math.abs(moved.lane!.y - lane.y)).toBeGreaterThanOrEqual(12);
    expect(moved.points[1]!.x).not.toBe(fixedRoute[0]);
    // Every inner horizontal of a manual route is reserved, not only its labelled lane.
    const zigzag = [1120, 420, 700, 520, 260];
    const both = createRoutingPlan(nodes, [...withRoute(edges, 'return', zigzag), twin]);
    const twinLane = both.routes.get('twin')!.lane!;
    for (const y of [420, 520])
      expect(
        Math.abs(twinLane.y - y) >= 12 || twinLane.right <= 700 || twinLane.left >= 1120,
        JSON.stringify({ twinLane, y }),
      ).toBe(true);
  });

  it('keeps the direction across route changes, and replans only routes a moved segment affects', () => {
    const { nodes, edges } = routingInput(denseGraph(300));
    const id = 'retry-144';
    const base = createRoutingPlan(nodes, edges);
    const automatic = base.routes.get(id)!;
    const route = [automatic.points[1]!.x, automatic.lane!.y + 40, automatic.points.at(-2)!.x];
    let previous = createRoutingPlan(nodes, withRoute(edges, id, route), undefined, base);
    expect(previous.directions.get(id)).toBe(base.directions.get(id));
    for (let step = 1; step <= 12; step += 1) {
      const dragged = withRoute(edges, id, [route[0]!, route[1]! + step * 3, route[2]!], true);
      const next = createRoutingPlan(nodes, dragged, undefined, previous);
      expect(next.routes, `segment drag ${step}`).toEqual(createRoutingPlan(nodes, dragged).routes);
      // The manual route itself, plus the automatic routes whose candidate lanes it changed: a
      // lane is a candidate for every route within the 192 px candidate reach (13 to 26 of the 600
      // here), comparable to the 38 a 60 x 48 px card drag may replan in this fixture.
      expect(next.statistics.rerouted).toBeLessThanOrEqual(32);
      expect(next.statistics.expansions).toBe(0);
      expect(next.directions.get(id)).toBe(base.directions.get(id));
      previous = next;
    }
    // A node drag with a manual route present still matches a fresh plan.
    const fixed = withRoute(edges, id, route);
    const shifted = moved(nodes, nodes[150]!.id, 20, 10);
    const plan = createRoutingPlan(shifted, fixed, undefined, createRoutingPlan(nodes, fixed));
    expect(plan.routes).toEqual(createRoutingPlan(shifted, fixed).routes);
  });
});
