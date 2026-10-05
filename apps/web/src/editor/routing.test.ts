import { describe, expect, it } from 'vitest';
import {
  decisionBackRoute,
  denseGraph,
  nestedLoops,
  routingInput,
  simpleLoop,
} from '../__fixtures__/routing.js';
import {
  intersectsBox,
  LANE_GAP,
  roundedPath,
  routeBackwardEdges,
  ROUTING_CLEARANCE,
  simplify,
  type Point,
  type RoutingEdge,
  type RoutingNode,
} from './routing.js';

const box = (id: string, x: number, y: number, width = 184, height = 122): RoutingNode => ({
  id,
  x,
  y,
  width,
  height,
  input: { x, y: y + height / 2 },
  outputs: {
    out: { x: x + width, y: y + height * 0.75 },
    loopBack: { x: x + width, y: y + height * 0.75 },
  },
});
const edge = (source: string, target: string, port = 'out'): RoutingEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  port,
});

/** Independently check the public clearance, including own boxes except the two straight stubs. */
function assertGeometry(nodes: RoutingNode[], edges: RoutingEdge[], clearance = ROUTING_CLEARANCE) {
  const routes = routeBackwardEdges(nodes, edges, clearance);
  for (const [id, route] of routes) {
    expect(route.blocked, id).toBe(false);
    const e = edges.find((entry) => entry.id === id)!;
    const source = nodes.find((n) => n.id === e.source)!;
    const target = nodes.find((n) => n.id === e.target)!;
    expect(route.points[0]).toEqual(source.outputs[e.port]);
    expect(route.points.at(-1)).toEqual(target.input);
    for (let i = 1; i < route.points.length; i += 1) {
      const a = route.points[i - 1]!;
      const b = route.points[i]!;
      expect(a.x === b.x || a.y === b.y, `${id}: diagonal`).toBe(true);
      expect(a).not.toEqual(b);
      for (const node of nodes) {
        if (
          (i === 1 && node.id === e.source) ||
          (i === route.points.length - 1 && node.id === e.target)
        ) {
          expect(a.y).toBe(b.y);
          continue;
        }
        // Use an independent bounding-range calculation, not the router's intersection helper.
        const left = node.x - clearance;
        const right = node.x + node.width + clearance;
        const top = node.y - clearance;
        const bottom = node.y + node.height + clearance;
        const hit =
          a.y === b.y
            ? a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right
            : a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom;
        expect(hit, `${id}, segment ${i}, obstacle ${node.id}`).toBe(false);
      }
    }
    expect(roundedPath(route.points)).toContain(' Q ');
    expect(route.lane).toBeDefined();
    expect(route.label.y).toBe(route.lane!.y);
    expect(route.label.x).toBeGreaterThan(route.lane!.left);
    expect(route.label.x).toBeLessThan(route.lane!.right);
  }
  const lanes = [...routes.values()].flatMap((r) => (r.lane ? [r.lane] : []));
  lanes.forEach((a, i) =>
    lanes.slice(i + 1).forEach((b) => {
      if (a.left < b.right && a.right > b.left)
        expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(LANE_GAP);
    }),
  );
  return routes;
}

describe('backward routing geometry', () => {
  it.each([simpleLoop, nestedLoops, decisionBackRoute, denseGraph])(
    '%s: orthogonal, padded, distinct lanes and straight labels',
    (fixture) => {
      const { nodes, edges } = routingInput(fixture());
      const routes = assertGeometry(nodes, edges);
      expect(routes.size).toBeGreaterThan(0);
      expect(routes).toEqual(routeBackwardEdges([...nodes].reverse(), [...edges].reverse()));
    },
  );

  it('keeps forward edges unchanged, including a script out, but always routes loopBack', () => {
    const nodes = [box('a', 0, 0), box('b', 400, 0)];
    expect(routeBackwardEdges(nodes, [edge('a', 'b')]).size).toBe(0);
    expect(assertGeometry(nodes, [edge('a', 'b', 'loopBack')]).size).toBe(1);
    expect(routeBackwardEdges(nodes, [edge('missing', 'b'), edge('a', 'missing')]).size).toBe(0);
    expect(routeBackwardEdges(nodes, [edge('b', 'a', 'unknown')]).size).toBe(0);
    const { input: _input, ...noInput } = nodes[0]!;
    expect(routeBackwardEdges([noInput, nodes[1]!], [edge('b', 'a')]).size).toBe(0);
  });

  it.each([-320, 320])('handles targets directly above/below (%s), plus self-loops', (y) => {
    assertGeometry([box('a', 0, 0), box('b', 0, y)], [edge('a', 'b'), edge('a', 'a')]);
  });

  it('avoids overlapping obstacle clusters and detours around a blocked escape column', () => {
    const nodes = [
      box('a', 700, 0),
      box('b', 0, 0),
      box('block', 870, 140, 184, 200),
      box('block-2', 820, -190, 184, 200),
      box('overlap', 840, 220),
      box('middle', 320, 30),
    ];
    const routes = assertGeometry(nodes, [edge('a', 'b')]);
    expect(routes.get('a-b')!.points.length).toBeGreaterThan(6);
  });

  it('reports a covered source or target port without inventing a colliding route', () => {
    for (const overlap of [box('cover', 850, 0), box('cover', -60, 0)]) {
      const routes = routeBackwardEdges(
        [box('a', 700, 0), box('b', 0, 0), overlap],
        [edge('a', 'b')],
      );
      expect(routes.get('a-b')).toMatchObject({ blocked: true, points: [] });
    }
  });

  it('handles an enclosed free port and many competing lanes without crossing obstacles', () => {
    const nodes = [
      box('a', 700, 0),
      box('b', 0, 0),
      box('east', 960, -130, 120, 400),
      box('north', 690, -150, 400, 150),
      box('south', 690, 152, 400, 60),
    ];
    expect(routeBackwardEdges(nodes, [edge('a', 'b')]).get('a-b')).toMatchObject({
      blocked: true,
      points: [],
    });
    const { nodes: simple } = routingInput(simpleLoop());
    const edges = Array.from({ length: 12 }, (_, i) => ({
      ...edge('done', 'work', 'loopBack'),
      id: `e${i}`,
    }));
    expect(assertGeometry(simple, edges).size).toBe(12);
  });

  it('supports another clearance without mutating the inputs', () => {
    const input = routingInput(nestedLoops());
    const before = structuredClone(input);
    assertGeometry(input.nodes, input.edges, 40);
    expect(input).toEqual(before);
    expect(routeBackwardEdges([], [], -1).size).toBe(0);
  });

  it('rounds corners with bounded radii and simplifies redundant points', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: -4 },
      { x: 10, y: -10 },
    ];
    expect(simplify(points)).toEqual([points[0], points[3], points[5]]);
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
        ],
        8,
      ),
    ).toBe('M 0 0 L 2 0 Q 4 0 4 2 L 4 4');
    expect(roundedPath([])).toBe('');
    expect(roundedPath([{ x: 1, y: 2 }])).toBe('M 1 2 L 1 2');
    const obstacle = { id: 'b', left: 0, right: 10, top: 0, bottom: 10 };
    expect(intersectsBox({ x: -1, y: 5 }, { x: 20, y: 5 }, obstacle)).toBe(true);
    expect(intersectsBox({ x: 5, y: -1 }, { x: 5, y: 20 }, obstacle)).toBe(true);
    expect(intersectsBox({ x: 0, y: -1 }, { x: 0, y: 20 }, obstacle)).toBe(false);
  });
});
