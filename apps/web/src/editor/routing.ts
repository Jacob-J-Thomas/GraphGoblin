import {
  BoxIndex,
  Reservations,
  bounds,
  distance,
  expand,
  overlaps,
  overlapsBox,
  simplify,
  sorted,
  type Box,
  type Lane,
  type Point,
} from './routing-geometry.js';
import { detour, SearchWorkspace } from './routing-search.js';
export { intersectsBox, simplify, type Point } from './routing-geometry.js';
export { SearchWorkspace } from './routing-search.js';

/** Geometry only: no editor store, DOM, clock, or layout mutation. */
export interface RoutingNode extends Point {
  id: string;
  width: number;
  height: number;
  outputs: Readonly<Record<string, Point>>;
  input?: Point;
}
export interface RoutingEdge {
  id: string;
  source: string;
  target: string;
  port: string;
}
export interface RoutedEdge extends Record<string, unknown> {
  /** #44 replaces these ordered points independently of how they were obtained. */
  points: readonly Point[];
  lane?: Lane;
  label: Point;
  labelWidth: number;
  radius: number;
  padding: number;
  bounds: Box;
  /** Only a port inside another real card is blocked. Search failure has a separate explanation. */
  blocked: boolean;
  unavailable: boolean;
}
export interface RoutingPlan {
  clearance: number;
  nodes: readonly RoutingNode[];
  edges: readonly RoutingEdge[];
  routes: ReadonlyMap<string, RoutedEdge>;
  directions: ReadonlyMap<string, boolean>;
  statistics: { rerouted: number; expansions: number };
}
export const ROUTING_CLEARANCE = 24;
export const ROUTING_RADIUS = 8;
export const LANE_GAP = 24;
export const DIRECTION_HYSTERESIS = 8;
const COLUMN_GAP = 12;
const CANDIDATE_LIMIT = 32;

export function backwardDirection(
  edge: RoutingEdge,
  from: Point,
  to: Point,
  previous?: boolean,
): boolean {
  if (edge.port === 'loopBack' || edge.source === edge.target) return true;
  const delta = from.x - to.x;
  return previous === undefined
    ? delta >= 0
    : previous
      ? delta >= -DIRECTION_HYSTERESIS
      : delta > DIRECTION_HYSTERESIS;
}
const nodeBox = (n: RoutingNode): Box => ({
  id: n.id,
  left: n.x,
  right: n.x + n.width,
  top: n.y,
  bottom: n.y + n.height,
});
const samePoint = (a: Point | undefined, b: Point | undefined) => a?.x === b?.x && a?.y === b?.y;
export function sameNode(a: RoutingNode, b: RoutingNode): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    samePoint(a, b) &&
    a.width === b.width &&
    a.height === b.height &&
    samePoint(a.input, b.input) &&
    Object.keys(a.outputs).length === Object.keys(b.outputs).length &&
    Object.entries(a.outputs).every(([port, point]) => samePoint(point, b.outputs[port]))
  );
}
const sameEdge = (a: RoutingEdge, b: RoutingEdge | undefined) =>
  !!b && a.source === b.source && a.target === b.target && a.port === b.port;
export const routeMessage = (route: RoutedEdge): string =>
  route.blocked
    ? 'Port covered by a card; move the card'
    : route.unavailable
      ? 'No clear route; move a card'
      : '';

function describe(
  points: Point[],
  from: Point,
  to: Point,
  padding: number,
  blocked = false,
): RoutedEdge {
  let lane: Lane | undefined;
  for (let i = 2; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.y !== b.y) continue;
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    if (!lane || right - left > lane.right - lane.left) lane = { y: a.y, left, right };
  }
  const radius = Math.min(ROUTING_RADIUS, padding);
  return {
    points,
    ...(lane ? { lane } : {}),
    radius,
    padding,
    blocked,
    unavailable: !blocked && !points.length,
    bounds: expand(bounds([from, to, ...points]), ROUTING_CLEARANCE + ROUTING_RADIUS),
    label: lane ? { x: (lane.left + lane.right) / 2, y: lane.y } : { x: from.x, y: from.y - 48 },
    labelWidth: lane ? Math.max(0, lane.right - lane.left - 2 * radius - 16) : 240,
  };
}

interface Work {
  edge: RoutingEdge;
  source: RoutingNode;
  target: RoutingNode;
  from: Point;
  to: Point;
  span: number;
}

function candidates(
  start: Point,
  end: Point,
  index: BoxIndex,
  padding: number,
  reservations: Reservations,
): number[] {
  const region = expand(bounds([start, end]), 112);
  const nearby = index.query(expand(region, padding));
  return sorted([
    ...nearby.flatMap((b) => [b.top - padding, b.bottom + padding]),
    ...reservations.lanes
      .filter(
        (l) => l.y >= region.top && l.y <= region.bottom && overlaps(region.left, region.right, l),
      )
      .flatMap((l) => [l.y - LANE_GAP, l.y + LANE_GAP, l.y - 12, l.y + 12]),
  ])
    .filter((y) => y >= region.top && y <= region.bottom)
    .sort(
      (a, b) =>
        Math.abs(start.y - a) + Math.abs(end.y - a) - Math.abs(start.y - b) - Math.abs(end.y - b) ||
        b - a,
    )
    .slice(0, CANDIDATE_LIMIT);
}

function routeOne(
  work: Work,
  index: BoxIndex,
  reservations: Reservations,
  sourceRank: number,
  targetRank: number,
  clearance: number,
  workspace: SearchWorkspace,
): { route: RoutedEdge; expansions: number } {
  const { source, target, from, to } = work;
  const fullPadding = Math.max(0, clearance) + ROUTING_RADIUS;
  if (index.covers(from, source.id) || index.covers(to, target.id))
    return { route: describe([], from, to, 0, true), expansions: 0 };
  // Reduce the envelope in tight spaces. Unlike a padded-box test, only a real card can cover a port.
  let room = fullPadding * 2;
  for (const [port, own] of [
    [from, source.id],
    [to, target.id],
  ] as const)
    for (const box of index.query(expand(bounds([port]), room))) {
      if (box.id === own) continue;
      room = Math.min(
        room,
        Math.max(box.left - port.x, port.x - box.right, box.top - port.y, port.y - box.bottom, 0),
      );
    }
  const paddings = [...new Set([fullPadding, Math.min(fullPadding / 2, room / 2), 0])];
  let expansions = 0;
  for (const padding of paddings) {
    const sx = Math.max(source.x + source.width + padding, from.x);
    const tx = Math.min(target.x - padding, to.x);
    // Port/incoming ranks separate shared-card trunks. Alternatives handle columns blocked by a neighbour.
    const offsets = (rank: number) => sorted([Math.min(rank, 7) * COLUMN_GAP, 0, 12, 24, 36, 48]);
    const starts = offsets(sourceRank)
      .map((offset) => ({ x: sx + offset, y: from.y }))
      .filter((p) => index.clear(from, p, padding, source.id));
    const ends = offsets(targetRank)
      .map((offset) => ({ x: tx - offset, y: to.y }))
      .filter((p) => index.clear(p, to, padding, target.id));
    if (!starts.length || !ends.length) continue;
    const ys = candidates(starts[0]!, ends[0]!, index, padding, reservations);
    let best: Point[] = [];
    let bestCost = Infinity;
    for (const gap of [LANE_GAP, 12, 0]) {
      for (const y of ys) {
        const travel =
          2 * (Math.abs(from.y - y) + Math.abs(to.y - y)) +
          (gap === LANE_GAP ? 0 : gap === 12 ? 64 : 128);
        if (travel > bestCost) continue;
        // Test each escape once, not every source/target column permutation.
        const start = starts.find(
          (p) =>
            reservations.verticalFree(p, { x: p.x, y }) && index.clear(p, { x: p.x, y }, padding),
        );
        const end = ends.find(
          (p) =>
            reservations.verticalFree(p, { x: p.x, y }) && index.clear(p, { x: p.x, y }, padding),
        );
        if (!start || !end) continue;
        const a = { x: start.x, y };
        const b = { x: end.x, y };
        const cost = travel + Math.abs(from.x - start.x) + Math.abs(to.x - end.x);
        if (cost >= bestCost || !reservations.laneFree(a, b, gap) || !index.clear(a, b, padding))
          continue;
        best = [from, start, a, b, end, to];
        bestCost = cost;
      }
    }
    if (best.length) return { route: describe(simplify(best), from, to, padding), expansions };
    const search = detour(starts[0]!, ends[0]!, index, padding, reservations, workspace);
    expansions += search.expansions;
    if (search.points.length)
      return {
        route: describe(simplify([from, ...search.points, to]), from, to, padding),
        expansions,
      };
  }
  return { route: describe([], from, to, 0), expansions };
}

/**
 * Pure route planning with an optional prior plan. Changes invalidate only endpoint routes and
 * spans intersecting a card's old/new box. Scratch buffers are an allocation optimisation only.
 */
export function createRoutingPlan(
  nodes: readonly RoutingNode[],
  edges: readonly RoutingEdge[],
  clearance = ROUTING_CLEARANCE,
  previous?: RoutingPlan,
  workspace = new SearchWorkspace(),
): RoutingPlan {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const oldNodes = new Map(previous?.nodes.map((n) => [n.id, n]));
  const changed = new Set<string>();
  const changedBoxes: Box[] = [];
  for (const node of nodes) {
    const old = oldNodes.get(node.id);
    if (!old || !sameNode(old, node)) {
      changed.add(node.id);
      changedBoxes.push(expand(nodeBox(node), clearance + ROUTING_RADIUS));
      if (old) changedBoxes.push(expand(nodeBox(old), clearance + ROUTING_RADIUS));
    }
    oldNodes.delete(node.id);
  }
  for (const old of oldNodes.values()) {
    changed.add(old.id);
    changedBoxes.push(expand(nodeBox(old), clearance + ROUTING_RADIUS));
  }
  const oldEdges = new Map(previous?.edges.map((e) => [e.id, e]));
  const topologyChanged =
    clearance !== previous?.clearance ||
    edges.length !== oldEdges.size ||
    edges.some((e) => !sameEdge(e, oldEdges.get(e.id)));
  const directions = new Map<string, boolean>();
  const work: Work[] = [];
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const from = source?.outputs[edge.port];
    const to = target?.input;
    if (!source || !target || !from || !to) continue;
    const backward = backwardDirection(
      edge,
      from,
      to,
      sameEdge(edge, oldEdges.get(edge.id)) ? previous?.directions.get(edge.id) : undefined,
    );
    directions.set(edge.id, backward);
    if (backward) work.push({ edge, source, target, from, to, span: Math.abs(from.x - to.x) });
  }
  work.sort((a, b) => a.span - b.span || a.edge.id.localeCompare(b.edge.id));
  const routes = new Map<string, RoutedEdge>();
  const reservations = new Reservations();
  for (const item of work) {
    const before = previous?.routes.get(item.edge.id);
    if (
      !topologyChanged &&
      before &&
      !changed.has(item.source.id) &&
      !changed.has(item.target.id) &&
      !changedBoxes.some((b) => overlapsBox(before.bounds, b))
    ) {
      routes.set(item.edge.id, before);
      reservations.add(before.points, before.lane);
    }
  }
  const index = new BoxIndex(nodes.map(nodeBox));
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  const statistics = { rerouted: 0, expansions: 0 };
  for (const item of work) {
    const port = item.source.id + ':' + item.edge.port;
    const sourceRank =
      Object.keys(item.source.outputs).indexOf(item.edge.port) + (outgoing.get(port) ?? 0);
    const targetRank = incoming.get(item.target.id) ?? 0;
    outgoing.set(port, (outgoing.get(port) ?? 0) + 1);
    incoming.set(item.target.id, targetRank + 1);
    if (routes.has(item.edge.id)) continue;
    const { route, expansions } = routeOne(
      item,
      index,
      reservations,
      sourceRank,
      targetRank,
      clearance,
      workspace,
    );
    statistics.rerouted += 1;
    statistics.expansions += expansions;
    const before = previous?.routes.get(item.edge.id);
    const unchanged =
      before &&
      before.padding === route.padding &&
      before.blocked === route.blocked &&
      before.unavailable === route.unavailable &&
      samePoint(before.label, route.label) &&
      before.bounds.left === route.bounds.left &&
      before.bounds.right === route.bounds.right &&
      before.bounds.top === route.bounds.top &&
      before.bounds.bottom === route.bounds.bottom &&
      before.points.length === route.points.length &&
      before.points.every((p, i) => samePoint(p, route.points[i]));
    routes.set(item.edge.id, unchanged ? before : route);
    reservations.add(route.points, route.lane);
  }
  return { nodes, edges, routes, directions, statistics, clearance };
}

export function routeBackwardEdges(
  nodes: readonly RoutingNode[],
  edges: readonly RoutingEdge[],
  clearance = ROUTING_CLEARANCE,
): ReadonlyMap<string, RoutedEdge> {
  return createRoutingPlan(nodes, edges, clearance).routes;
}

/** #44 drawing hook; reduced envelopes reduce corner radius too, down to square corners. */
export function roundedPath(points: readonly Point[], radius = ROUTING_RADIUS): string {
  if (!points.length) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const r = Math.min(radius, distance(a, b) / 2, distance(b, c) / 2);
    const before = { x: b.x + Math.sign(a.x - b.x) * r, y: b.y + Math.sign(a.y - b.y) * r };
    const after = { x: b.x + Math.sign(c.x - b.x) * r, y: b.y + Math.sign(c.y - b.y) * r };
    path += ` L ${before.x} ${before.y} Q ${b.x} ${b.y} ${after.x} ${after.y}`;
  }
  const end = points.at(-1)!;
  return `${path} L ${end.x} ${end.y}`;
}
