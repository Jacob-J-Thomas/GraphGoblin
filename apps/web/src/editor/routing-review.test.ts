import { describe, expect, it } from 'vitest';
import {
  denseGraph,
  nestedLoops,
  routingInput,
  sixReturnDecision,
} from '../__fixtures__/routing.js';
import {
  backwardDirection,
  createRoutingPlan,
  routeBackwardEdges,
  routeMessage,
  SearchWorkspace,
  type RoutedEdge,
  type RoutingEdge,
  type RoutingNode,
} from './routing.js';
import { SEARCH_LIMIT } from './routing-search.js';

const box = (
  id: string,
  x: number,
  y: number,
  width = 184,
  height = 122,
  tip = 0,
): RoutingNode => ({
  id,
  x,
  y,
  width,
  height,
  input: { x: x - tip, y: y + height / 2 },
  outputs: { out: { x: x + width + tip, y: y + height * 0.75 } },
});
const connection = (source: string, target: string, id = source + '-' + target): RoutingEdge => ({
  id,
  source,
  target,
  port: 'out',
});

function geometry(nodes: readonly RoutingNode[], edge: RoutingEdge, route: RoutedEdge) {
  expect(route.blocked || route.unavailable, edge.id).toBe(false);
  expect(route.points.length).toBeGreaterThan(1);
  for (let i = 1; i < route.points.length; i += 1) {
    const a = route.points[i - 1]!;
    const b = route.points[i]!;
    expect(a.x === b.x || a.y === b.y, edge.id).toBe(true);
    for (const n of nodes) {
      const pad = Math.max(0, route.padding - route.radius);
      const hit =
        a.y === b.y
          ? a.y > n.y - pad &&
            a.y < n.y + n.height + pad &&
            Math.max(a.x, b.x) > n.x - pad &&
            Math.min(a.x, b.x) < n.x + n.width + pad
          : a.x > n.x - pad &&
            a.x < n.x + n.width + pad &&
            Math.max(a.y, b.y) > n.y - pad &&
            Math.min(a.y, b.y) < n.y + n.height + pad;
      if (hit) {
        expect(a.y, edge.id + ' stub').toBe(b.y);
        expect(
          (i === 1 && n.id === edge.source) ||
            (i === route.points.length - 1 && n.id === edge.target),
          edge.id + ' obstacle ' + n.id,
        ).toBe(true);
      }
    }
  }
  const lane = route.lane!;
  for (const n of nodes)
    expect(
      lane.y > n.y - route.lanePadding &&
        lane.y < n.y + n.height + route.lanePadding &&
        lane.left < n.x + n.width + route.lanePadding &&
        lane.right > n.x - route.lanePadding,
      edge.id + ' lane clearance',
    ).toBe(false);
}

function distinctTrunks(routes: Iterable<RoutedEdge>) {
  const columns = new Map<number, { top: number; bottom: number; edge: number }[]>();
  [...routes].forEach((route, edge) => {
    for (let i = 1; i < route.points.length; i += 1) {
      const a = route.points[i - 1]!;
      const b = route.points[i]!;
      if (a.x !== b.x) continue;
      const segment = { top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y), edge };
      for (const before of columns.get(a.x) ?? [])
        if (before.edge !== edge)
          expect(
            Math.min(before.bottom, segment.bottom) - Math.max(before.top, segment.top),
          ).toBeLessThanOrEqual(4);
      columns.set(a.x, [...(columns.get(a.x) ?? []), segment]);
    }
  });
}

function labelGeometry(routes: Iterable<RoutedEdge>, nodes: readonly RoutingNode[]) {
  const labels = [...routes].flatMap((r) => (r.labelBounds ? [r.labelBounds] : []));
  for (const [i, a] of labels.entries())
    for (const b of [
      ...labels.slice(0, i),
      ...nodes.map((n) => ({ left: n.x, right: n.x + n.width, top: n.y, bottom: n.y + n.height })),
    ])
      expect(
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
        JSON.stringify({ a, b }),
      ).toBe(false);
  return labels.length;
}

/** Independent candidate/segment checks: distance must never buy compression of an available lane. */
function lanePriority(nodes: readonly RoutingNode[], routes: Iterable<RoutedEdge>) {
  const previous: RoutedEdge[] = [];
  let checked = 0;
  for (const route of routes) {
    if (route.points.length === 6 && route.laneGap !== 24) {
      const [from, start, , , end, to] = route.points;
      const region = {
        left: Math.min(start!.x, end!.x) - 192,
        right: Math.max(start!.x, end!.x) + 192,
        top: Math.min(from!.y, to!.y) - 192,
        bottom: Math.max(from!.y, to!.y) + 192,
      };
      const ys = [
        ...new Set([
          ...nodes
            .filter(
              (n) =>
                n.x <= region.right + 32 &&
                n.x + n.width >= region.left - 32 &&
                n.y <= region.bottom + 32 &&
                n.y + n.height >= region.top - 32,
            )
            .flatMap((n) => [n.y - 32, n.y + n.height + 32]),
          ...previous.flatMap((r) =>
            r.lane &&
            r.lane.y >= region.top &&
            r.lane.y <= region.bottom &&
            r.lane.left < region.right &&
            r.lane.right > region.left
              ? [r.lane.y - 24, r.lane.y + 24, r.lane.y - 12, r.lane.y + 12]
              : [],
          ),
        ]),
      ]
        .filter((y) => y >= region.top && y <= region.bottom)
        .sort(
          (a, b) =>
            Math.abs(from!.y - a) +
              Math.abs(to!.y - a) -
              Math.abs(from!.y - b) -
              Math.abs(to!.y - b) || b - a,
        )
        .slice(0, 32);
      for (const y of ys) {
        const left = Math.min(start!.x, end!.x);
        const right = Math.max(start!.x, end!.x);
        const horizontalHit = nodes.some(
          (n) =>
            y > n.y - 32 &&
            y < n.y + n.height + 32 &&
            left < n.x + n.width + 32 &&
            right > n.x - 32,
        );
        const verticalHit = [start!, end!].some((p) =>
          nodes.some(
            (n) =>
              p.x > n.x - route.padding &&
              p.x < n.x + n.width + route.padding &&
              Math.min(p.y, y) < n.y + n.height + route.padding &&
              Math.max(p.y, y) > n.y - route.padding,
          ),
        );
        const reserved = previous.some(
          (r) =>
            (r.lane && Math.abs(y - r.lane.y) < 24 && left < r.lane.right && right > r.lane.left) ||
            r.points.some(
              (p, i) =>
                i > 0 &&
                p.x === r.points[i - 1]!.x &&
                [start!, end!].some(
                  (column) =>
                    column.x === p.x &&
                    Math.min(Math.max(column.y, y), Math.max(p.y, r.points[i - 1]!.y)) >
                      Math.max(Math.min(column.y, y), Math.min(p.y, r.points[i - 1]!.y)),
                ),
            ),
        );
        const half = route.labelBounds ? (route.labelWidth + 18) / 2 : 0;
        const middle = (left + right) / 2;
        const labelHit = previous.some(
          (r) =>
            r.labelBounds &&
            Math.abs(r.label.y - y) < 22 &&
            middle - half < r.labelBounds.right &&
            middle + half > r.labelBounds.left,
        );
        checked += 1;
        expect(
          horizontalHit || verticalHit || reserved || labelHit,
          JSON.stringify({ route, freeCandidate: y }),
        ).toBe(true);
      }
    }
    previous.push(route);
  }
  return checked;
}

describe('routing review regressions', () => {
  it('keeps a route throughout the 0–80 px gap sweep, reducing padding without crossing cards', () => {
    const e = connection('source', 'target');
    for (let gap = 0; gap <= 80; gap += 1) {
      const nodes = [box('source', 400, 0), box('target', 0, 0), box('neighbour', 584 + gap, 0)];
      const route = routeBackwardEdges(nodes, [e]).get(e.id)!;
      geometry(nodes, e, route);
      if (gap < 64) expect(route.padding).toBeLessThan(32);
      // Real handles protrude 6 px: only the first six gaps actually cover the measured tip.
      nodes[0] = box('source', 400, 0, 184, 122, 6);
      const measured = routeBackwardEdges(nodes, [e]).get(e.id)!;
      if (gap < 6) expect(measured.blocked).toBe(true);
      else geometry(nodes, e, measured);
    }
  });

  it('allocates the inner return first even when ids put the outer return first', () => {
    const fixture = nestedLoops();
    fixture.edges.find((e) => e.id === 'outer-return')!.id = 'a-outer';
    fixture.edges.find((e) => e.id === 'inner-return')!.id = 'z-inner';
    const { nodes, edges } = routingInput(fixture);
    const routes = routeBackwardEdges(nodes, edges);
    expect(routes.get('a-outer')!.lane!.y - routes.get('z-inner')!.lane!.y).toBeGreaterThanOrEqual(
      24,
    );
    distinctTrunks(routes.values());
  });

  it('prefers free 24 px lanes for six returns, independent of their distance cost', () => {
    const { nodes, edges } = routingInput(sixReturnDecision());
    const routes = routeBackwardEdges(nodes, edges);
    expect(routes.size).toBe(6);
    expect(labelGeometry(routes.values(), nodes)).toBe(6);
    const lanes = [...routes.values()].map((r) => r.lane!);
    for (const [i, a] of lanes.entries())
      for (const b of lanes.slice(0, i)) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(24);
    expect([...routes.values()].every((r) => r.laneGap === 24)).toBe(true);
  });

  it('keeps the lane 32 px clear at 8-16 px neighbour gaps; only endpoint approaches shrink', () => {
    for (let gap = 8; gap <= 16; gap += 1) {
      const source = box('source', 600, 0, 184, 122, 6);
      source.outputs = { back: source.outputs['out']! };
      const nodes = [source, box('target', 0, 0), box('neighbour', 784 + gap, 0)];
      const e = { ...connection('source', 'target'), port: 'back' };
      const route = routeBackwardEdges(nodes, [e]).get(e.id)!;
      geometry(nodes, e, route);
      expect(route.padding).toBeLessThan(32);
      expect(route.lanePadding).toBe(32);
      expect(route.lane!.y >= 154 || route.lane!.y <= -32).toBe(true);
      expect(labelGeometry([route], nodes)).toBe(1);
    }
  });

  it('routes at least forty of eighty crowded returns with distinct trunks and readable labels', () => {
    const source = box('source', 600, 0);
    source.outputs = { loopBack: source.outputs['out']! };
    const nodes = [source, box('target', 0, 0)];
    const edges = Array.from({ length: 80 }, (_, i) => ({
      ...connection('source', 'target', `return-${i}`),
      port: 'loopBack',
    }));
    const routes = [...routeBackwardEdges(nodes, edges).values()].filter((r) => r.points.length);
    expect(routes.length).toBeGreaterThanOrEqual(40);
    expect(labelGeometry(routes, nodes)).toBe(routes.length);
    distinctTrunks(routes);
    expect(routes.some((r) => r.laneGap! < 24)).toBe(true);
  });

  it('separates shared-card vertical trunks in the dense graph and on two decision ports', () => {
    const { nodes, edges } = routingInput(denseGraph());
    const routes = routeBackwardEdges(nodes, edges);
    for (const e of edges) {
      const route = routes.get(e.id);
      if (route) geometry(nodes, e, route);
    }
    distinctTrunks(routes.values());
    const decision = box('decision', 600, 0);
    decision.outputs = { first: { x: 784, y: 80 }, second: { x: 784, y: 100 } };
    const es = ['first', 'second'].map((port) => ({
      ...connection('decision', 'target', port),
      port,
    }));
    const two = routeBackwardEdges([decision, box('target', 0, 0)], es);
    distinctTrunks(two.values());
    expect(two.get('first')!.points[1]!.x).not.toBe(two.get('second')!.points[1]!.x);
  });

  it.each([40, 100, 150])(
    'bounds local travel and computation for a %s-card column with 80 px gaps',
    (count) => {
      const nodes = Array.from({ length: count }, (_, i) => box('n' + i, 0, i * 202));
      const edges = nodes
        .slice(1)
        .flatMap((n, i) => [connection(n.id, nodes[i]!.id), connection(nodes[i]!.id, n.id)]);
      const { routes, statistics } = createRoutingPlan(nodes, edges);
      // Deterministic work bounds are independent of host load and coverage instrumentation.
      // Playwright measures the actual wall-clock cache miss and frame budget separately.
      expect(statistics.rerouted).toBe(edges.length);
      expect(statistics.expansions).toBe(0);
      for (const e of edges) {
        const route = routes.get(e.id)!;
        geometry(nodes, e, route);
        expect(route.bounds.bottom - route.bounds.top).toBeLessThan(400);
      }
      distinctTrunks(routes.values());
    },
  );

  it('uses measured port direction and 8 px hysteresis at the shape boundary', () => {
    const e = connection('a', 'b');
    expect(backwardDirection(e, { x: 196, y: 0 }, { x: 0, y: 0 })).toBe(true);
    for (const delta of [-1, 0, 1]) {
      expect(backwardDirection(e, { x: delta, y: 0 }, { x: 0, y: 0 }, true)).toBe(true);
      expect(backwardDirection(e, { x: delta, y: 0 }, { x: 0, y: 0 }, false)).toBe(false);
    }
    expect(backwardDirection(e, { x: -9, y: 0 }, { x: 0, y: 0 }, true)).toBe(false);
    expect(backwardDirection(e, { x: 9, y: 0 }, { x: 0, y: 0 }, false)).toBe(true);
  });

  it('reroutes only affected spans, including old boxes, added obstacles and removed obstacles', () => {
    const { nodes, edges } = routingInput(denseGraph(300));
    const first = createRoutingPlan(nodes, edges);
    const moved = structuredClone(nodes);
    moved[144]!.x += 10;
    moved[144]!.input!.x += 10;
    for (const p of Object.values(moved[144]!.outputs)) p.x += 10;
    const next = createRoutingPlan(moved, edges, undefined, first);
    expect(next.statistics.rerouted).toBeGreaterThan(0);
    // Rejected alternatives are dependencies too; the broader footprint still keeps this local.
    expect(next.statistics.rerouted).toBeLessThan(30);
    expect(next.routes.get('retry-4')).toBe(first.routes.get('retry-4'));
    for (const e of edges) {
      const route = next.routes.get(e.id);
      if (route) geometry(moved, e, route);
    }
    const obstacle = box('new', 1220, 420, 40, 30);
    const added = createRoutingPlan([...moved, obstacle], edges, undefined, next);
    expect(added.statistics.rerouted).toBeGreaterThan(0);
    expect(createRoutingPlan(moved, edges, undefined, added).statistics.rerouted).toBeGreaterThan(
      0,
    );
    expect(
      createRoutingPlan(moved, edges.slice(1), undefined, next).statistics.rerouted,
    ).toBeGreaterThan(15);
  });

  it('matches a fresh plan after moves, span-order changes, and returning to the original boxes', () => {
    const { nodes, edges } = routingInput(denseGraph(300));
    let previous = createRoutingPlan(nodes, edges);
    for (const [i, dx, dy] of [
      [144, 10, 0],
      [44, -40, 30],
      [144, 80, -70],
      [299, -90, 20],
    ]) {
      const moved = structuredClone(nodes);
      const n = moved[i!]!;
      n.x += dx!;
      n.y += dy!;
      for (const p of [n.input!, ...Object.values(n.outputs)]) {
        p.x += dx!;
        p.y += dy!;
      }
      const next = createRoutingPlan(moved, edges, undefined, previous);
      expect(next.routes).toEqual(createRoutingPlan(moved, edges).routes);
      const returned = createRoutingPlan(nodes, edges, undefined, next);
      expect(returned.routes).toEqual(createRoutingPlan(nodes, edges).routes);
      previous = returned;
    }
  });

  it('bounds an enclosed-target search and reuses its buffers; only real covered ports are blocked', () => {
    const nodes = [
      box('a', 700, 0),
      box('b', 0, 0),
      box('east', 940, -130, 120, 400),
      box('north', 690, -150, 400, 170),
      box('south', 690, 120, 400, 60),
    ];
    const e = connection('a', 'b');
    const workspace = new SearchWorkspace();
    const plan = createRoutingPlan(nodes, [e], undefined, undefined, workspace);
    const route = plan.routes.get(e.id)!;
    expect(route).toMatchObject({ blocked: false, unavailable: true, points: [] });
    expect(routeMessage(route)).toBe('No clear route; move a card');
    expect(plan.statistics.expansions).toBeLessThanOrEqual(3 * SEARCH_LIMIT);
    const buffer = workspace.costs;
    createRoutingPlan(nodes, [e], undefined, undefined, workspace);
    expect(workspace.costs).toBe(buffer);
  });

  it('seeded sparse graphs preserve geometry and keep detours below twelve bends', () => {
    let seed = 0x182026;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let checked = 0;
    let searches = 0;
    let labels = 0;
    let alternatives = 0;
    for (let trial = 0; trial < 300; trial += 1) {
      const nodes: RoutingNode[] = [];
      for (let i = 0; i < 24; i += 1) {
        const n = box(
          'n' + i,
          Math.floor(random() * 1800),
          Math.floor(random() * 1100),
          110 + Math.floor(random() * 70),
          80 + Math.floor(random() * 70),
          6,
        );
        if (
          nodes.some(
            (b) =>
              n.x < b.x + b.width &&
              n.x + n.width > b.x &&
              n.y < b.y + b.height &&
              n.y + n.height > b.y,
          )
        )
          continue;
        nodes.push(n);
      }
      const edges = nodes.slice(1).map((n, i) => ({
        ...connection(n.id, nodes[Math.floor(random() * i)]!.id),
        port: 'back',
      }));
      for (const n of nodes) n.outputs = { back: n.outputs['out']! };
      const plan = createRoutingPlan(nodes, edges);
      searches += plan.statistics.expansions > 0 ? 1 : 0;
      for (const e of edges) {
        const route = plan.routes.get(e.id);
        if (!route || route.blocked) continue;
        expect(
          route.unavailable,
          JSON.stringify({ trial, edge: e.id, statistics: plan.statistics }),
        ).toBe(false);
        geometry(nodes, e, route);
        checked += 1;
        expect(
          route.points.length - 2,
          'seed trial ' + trial + ' edge ' + e.id,
        ).toBeLessThanOrEqual(12);
      }
      distinctTrunks(plan.routes.values());
      labels += labelGeometry(plan.routes.values(), nodes);
      alternatives += lanePriority(nodes, plan.routes.values());
      if (trial % 10 === 0) {
        const moved = structuredClone(nodes);
        const n = moved[Math.floor(moved.length / 2)]!;
        n.y += 30;
        n.input!.y += 30;
        n.outputs['back']!.y += 30;
        const next = createRoutingPlan(moved, edges, undefined, plan);
        expect(next.routes, 'incremental sparse trial ' + trial).toEqual(
          createRoutingPlan(moved, edges).routes,
        );
        expect(
          createRoutingPlan(nodes, edges, undefined, next).routes,
          'returned sparse trial ' + trial,
        ).toEqual(plan.routes);
      }
    }
    expect(checked).toBeGreaterThan(1500);
    expect(searches).toBeGreaterThan(20);
    expect(labels).toBe(checked);
    expect(alternatives).toBeGreaterThan(100);
  }, 60_000);
});
