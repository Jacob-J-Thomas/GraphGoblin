import { describe, expect, it } from 'vitest';
import { denseGraph, nestedLoops, routingInput } from '../__fixtures__/routing.js';
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
      routeBackwardEdges(nodes, edges); // Warm the JIT before the bounded-work regression measurement.
      const times: number[] = [];
      let routes = routeBackwardEdges(nodes, edges);
      for (let i = 0; i < 3; i += 1) {
        const start = process.cpuUsage();
        routes = routeBackwardEdges(nodes, edges);
        const used = process.cpuUsage(start);
        times.push((used.user + used.system) / 1000);
      }
      // Bound CPU work, excluding time this worker is descheduled by other test processes.
      // Coverage adds overhead; the browser spec separately enforces the tighter wall-clock
      // cache-miss budget during actual dragging. The span assertion catches distant detours.
      expect(times.sort((a, b) => a - b)[1]).toBeLessThan(100);
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
    expect(next.statistics.rerouted).toBeLessThan(15);
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
      const edges = nodes
        .slice(1)
        .map((n, i) => connection(n.id, nodes[Math.floor(random() * i)]!.id));
      const plan = createRoutingPlan(nodes, edges);
      searches += plan.statistics.expansions > 0 ? 1 : 0;
      for (const e of edges) {
        const route = plan.routes.get(e.id);
        if (!route || route.blocked) continue;
        expect(
          route.unavailable,
          JSON.stringify({ trial, nodes, edges, statistics: plan.statistics }),
        ).toBe(false);
        geometry(nodes, e, route);
        checked += 1;
        expect(
          route.points.length - 2,
          'seed trial ' + trial + ' edge ' + e.id,
        ).toBeLessThanOrEqual(12);
      }
      distinctTrunks(plan.routes.values());
    }
    expect(checked).toBeGreaterThan(1500);
    expect(searches).toBeGreaterThan(20);
  }, 30_000);
});
