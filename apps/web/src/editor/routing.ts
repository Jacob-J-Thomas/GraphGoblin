import {
  BoxIndex,
  Footprint,
  Reservations,
  bounds,
  distance,
  expand,
  overlapsBox,
  simplify,
  sorted,
  type Box,
  type Lane,
  type Point,
} from './routing-geometry.js';
import { detour, SearchWorkspace } from './routing-search.js';
import { placeLabel, type LabelPlacement } from './routing-labels.js';
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
  labelBounds?: Box;
  radius: number;
  padding: number;
  /** Full stand-off of the labelled lane, even when endpoint escapes need less padding. */
  lanePadding: number;
  laneGap?: number;
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
  dependencies: ReadonlyMap<string, { boxes: Box | undefined; reservations: Box | undefined }>;
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
  lanePadding = padding,
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
    lanePadding,
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
  const region = expand(bounds([start, end]), 192);
  const nearby = index.query(expand(region, padding));
  return sorted([
    ...nearby.flatMap((b) => [b.top - padding, b.bottom + padding]),
    ...reservations
      .nearbyLanes(region)
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
  // Only endpoint escapes shrink in tight spaces; horizontal lanes retain the full envelope.
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
  const escapes = new Map<number, { starts: Point[]; ends: Point[] }>();
  const escapeAt = (padding: number) => {
    const cached = escapes.get(padding);
    if (cached) return cached;
    const sx = Math.max(source.x + source.width + padding, from.x);
    const tx = Math.min(target.x - padding, to.x);
    // Port/incoming ranks separate shared-card trunks. Alternatives handle columns blocked by a neighbour.
    const offsets = (rank: number) => sorted([rank * COLUMN_GAP, 0, 12, 24, 36, 48]);
    const starts = offsets(sourceRank)
      .map((offset) => ({ x: sx + offset, y: from.y }))
      .filter((p) => index.clear(from, p, padding, source.id));
    const ends = offsets(targetRank)
      .map((offset) => ({ x: tx - offset, y: to.y }))
      .filter((p) => index.clear(p, to, padding, target.id));
    const escape = { starts, ends };
    escapes.set(padding, escape);
    return escape;
  };
  // Spacing is a strict priority, never a soft distance penalty. Try every full-gap candidate
  // (including narrow endpoint escapes) before considering any compressed or shared lane.
  for (const gap of [LANE_GAP, 12, 0]) {
    let best: Point[] = [];
    let bestCost = Infinity;
    let bestPadding = fullPadding;
    let bestLabel: LabelPlacement | undefined;
    for (const padding of paddings) {
      const { starts, ends } = escapeAt(padding);
      if (!starts.length || !ends.length) continue;
      const ys = candidates(starts[0]!, ends[0]!, index, fullPadding, reservations);
      for (const y of ys) {
        const travel = 2 * (Math.abs(from.y - y) + Math.abs(to.y - y));
        if (travel > bestCost) continue;
        // Columns are ordered by stub length. Prune cost before collision checks; check each
        // remaining vertical once, including wider pairs needed for labels on short spans.
        const endClear: (boolean | undefined)[] = [];
        for (const start of starts) {
          const sourceCost = travel + Math.abs(from.x - start.x);
          if (sourceCost + Math.abs(to.x - ends[0]!.x) >= bestCost) break;
          const a = { x: start.x, y };
          if (!reservations.verticalFree(start, a) || !index.clear(start, a, padding)) continue;
          for (const [i, end] of ends.entries()) {
            const b = { x: end.x, y };
            const cost = sourceCost + Math.abs(to.x - end.x);
            if (cost >= bestCost) break;
            endClear[i] ??= reservations.verticalFree(end, b) && index.clear(end, b, padding);
            if (
              !endClear[i] ||
              !reservations.laneFree(a, b, gap) ||
              !index.clear(a, b, fullPadding)
            )
              continue;
            const label = placeLabel(
              { y, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x) },
              work.edge.port,
              Math.min(ROUTING_RADIUS, padding),
              index,
              reservations,
            );
            if (!label) continue;
            best = [from, start, a, b, end, to];
            bestCost = cost;
            bestPadding = padding;
            bestLabel = label;
          }
        }
      }
      if (best.length) break;
    }
    if (best.length) {
      if (gap === LANE_GAP && bestPadding === fullPadding) {
        // A full-spacing/full-clearance winner cannot be displaced by a more expensive lane.
        // Keep dependencies for every y that could beat its cost, plus the query padding. This
        // avoids invalidating neighbouring rows merely because candidate discovery saw them.
        const extra = (bestCost / 2 - Math.abs(from.y - to.y)) / 2;
        for (const [reads, margin] of [
          [index.reads, fullPadding],
          [reservations.reads, LANE_GAP],
        ] as const) {
          if (!reads.box) continue;
          reads.box.top = Math.max(reads.box.top, Math.min(from.y, to.y) - extra - margin);
          reads.box.bottom = Math.min(reads.box.bottom, Math.max(from.y, to.y) + extra + margin);
        }
      }
      return {
        route: {
          ...describe(simplify(best), from, to, bestPadding, false, fullPadding),
          ...bestLabel!,
          laneGap: gap,
        },
        expansions,
      };
    }
  }
  for (const padding of paddings) {
    const { starts, ends } = escapeAt(padding);
    if (!starts.length || !ends.length) continue;
    const labelEscape = work.edge.port !== 'out' && Math.abs(starts[0]!.x - ends[0]!.x) < 64;
    const search = detour(
      starts[0]!,
      ends[0]!,
      index,
      padding,
      reservations,
      workspace,
      fullPadding,
      labelEscape ? 48 : 0,
    );
    expansions += search.expansions;
    if (!search.points.length) continue;
    const points = simplify([from, ...search.points, to]);
    // A narrow escape can need several bends. Lift its main horizontal segment out to the full
    // envelope; only the approach/departure keep the reduced clearance found by A*.
    const horizontals = points
      .map((a, i) => ({ a, b: points[i + 1], i }))
      .filter(({ a, b, i }) => i > 0 && i < points.length - 2 && b && a.y === b.y)
      .sort((a, b) => Math.abs(b.a.x - b.b!.x) - Math.abs(a.a.x - a.b!.x));
    for (const gap of [LANE_GAP, 12, 0]) {
      for (const { a, b, i } of horizontals) {
        const ys = [
          a.y,
          ...candidates(points[i - 1]!, points[i + 2]!, index, fullPadding, reservations),
        ];
        for (const y of ys) {
          const first = { x: a.x, y };
          const last = { x: b!.x, y };
          if (
            !index.clear(first, last, fullPadding) ||
            !reservations.laneFree(first, last, gap) ||
            !index.clear(points[i - 1]!, first, padding) ||
            !index.clear(last, points[i + 2]!, padding) ||
            !reservations.verticalFree(points[i - 1]!, first) ||
            !reservations.verticalFree(last, points[i + 2]!)
          )
            continue;
          const lane = { y, left: Math.min(a.x, b!.x), right: Math.max(a.x, b!.x) };
          const label = placeLabel(
            lane,
            work.edge.port,
            Math.min(ROUTING_RADIUS, padding),
            index,
            reservations,
          );
          if (!label) continue;
          const lifted = simplify([...points.slice(0, i), first, last, ...points.slice(i + 2)]);
          return {
            route: {
              ...describe(lifted, from, to, padding, false, fullPadding),
              lane,
              ...label,
              laneGap: gap,
            },
            expansions,
          };
        }
      }
      // When an endpoint is enclosed except for a narrow corridor, that corridor is part of its
      // escape. The central lane starts only after leaving the full padded obstacle boundary.
      for (const { a, b } of horizontals) {
        const right = Math.max(a.x, b!.x);
        let left = Math.min(a.x, b!.x);
        const boxes = index
          .query(expand(bounds([a, b!]), fullPadding))
          .map((box) => expand(box, fullPadding))
          .filter((box) => a.y > box.top && a.y < box.bottom)
          .sort((x, y) => x.left - y.left);
        const lanes: Lane[] = [];
        for (const obstacle of [...boxes, { left: right, right }]) {
          const end = Math.min(obstacle.left, right);
          if (end - left > 2 * ROUTING_RADIUS) lanes.push({ y: a.y, left, right: end });
          left = Math.max(left, obstacle.right);
        }
        lanes.sort((x, y) => y.right - y.left - (x.right - x.left));
        for (const lane of lanes) {
          if (
            !reservations.laneFree({ x: lane.left, y: lane.y }, { x: lane.right, y: lane.y }, gap)
          )
            continue;
          const label = placeLabel(
            lane,
            work.edge.port,
            Math.min(ROUTING_RADIUS, padding),
            index,
            reservations,
          );
          if (label)
            return {
              route: {
                ...describe(points, from, to, padding, false, fullPadding),
                lane,
                ...label,
                laneGap: gap,
              },
              expansions,
            };
        }
      }
    }
  }
  return { route: describe([], from, to, 0), expansions };
}

/**
 * Pure route planning with an optional prior plan. Replaying the deterministic order consults
 * the same predecessors as a fresh plan, even when a move changes span order. Recorded query
 * footprints include rejected alternatives, so freeing a better lane invalidates its dependants.
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
      changedBoxes.push(nodeBox(node));
      if (old) changedBoxes.push(nodeBox(old));
    }
    oldNodes.delete(node.id);
  }
  for (const old of oldNodes.values()) {
    changed.add(old.id);
    changedBoxes.push(nodeBox(old));
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
  const dependencies = new Map<string, { boxes: Box | undefined; reservations: Box | undefined }>();
  const reservations = new Reservations();
  const oldOrder = [...(previous?.routes.keys() ?? [])];
  const oldPositions = new Map(oldOrder.map((id, i) => [id, i]));
  const oldPrefix = new Set<string>();
  const reservationChanges = new Map<string, Box[]>();
  let cursor = 0;
  const compareReservation = (id: string) => {
    const before = oldPrefix.has(id) ? previous?.routes.get(id) : undefined;
    const after = routes.get(id);
    if (before === after) reservationChanges.delete(id);
    else
      reservationChanges.set(
        id,
        [before, after].flatMap((r) => (r ? [r.bounds] : [])),
      );
  };
  const index = new BoxIndex(nodes.map(nodeBox));
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  const statistics = { rerouted: 0, expansions: 0 };
  for (const item of work) {
    const id = item.edge.id;
    const oldPosition = oldPositions.get(id) ?? 0;
    while (cursor < oldPosition) {
      const previousId = oldOrder[cursor++]!;
      oldPrefix.add(previousId);
      compareReservation(previousId);
    }
    while (cursor > oldPosition) {
      const previousId = oldOrder[--cursor]!;
      oldPrefix.delete(previousId);
      compareReservation(previousId);
    }
    const port = item.source.id + ':' + item.edge.port;
    const sourceRank =
      Object.keys(item.source.outputs).indexOf(item.edge.port) + (outgoing.get(port) ?? 0);
    const targetRank = incoming.get(item.target.id) ?? 0;
    outgoing.set(port, (outgoing.get(port) ?? 0) + 1);
    incoming.set(item.target.id, targetRank + 1);
    const before = previous?.routes.get(id);
    const reads = previous?.dependencies.get(id);
    if (
      !topologyChanged &&
      before &&
      reads &&
      !changed.has(item.source.id) &&
      !changed.has(item.target.id) &&
      !changedBoxes.some((b) => reads.boxes && overlapsBox(reads.boxes, b)) &&
      ![...reservationChanges.values()].some((boxes) =>
        boxes.some((b) => reads.reservations && overlapsBox(reads.reservations, b)),
      )
    ) {
      routes.set(id, before);
      dependencies.set(id, reads);
      reservations.add(before.points, before.lane, before.labelBounds);
      compareReservation(id);
      continue;
    }
    index.reads = new Footprint();
    reservations.reads = new Footprint();
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
    dependencies.set(id, { boxes: index.reads.box, reservations: reservations.reads.box });
    const unchanged =
      before &&
      before.padding === route.padding &&
      before.lanePadding === route.lanePadding &&
      before.lane?.y === route.lane?.y &&
      before.lane?.left === route.lane?.left &&
      before.lane?.right === route.lane?.right &&
      before.laneGap === route.laneGap &&
      before.labelWidth === route.labelWidth &&
      before.blocked === route.blocked &&
      before.unavailable === route.unavailable &&
      samePoint(before.label, route.label) &&
      before.bounds.left === route.bounds.left &&
      before.bounds.right === route.bounds.right &&
      before.bounds.top === route.bounds.top &&
      before.bounds.bottom === route.bounds.bottom &&
      before.points.length === route.points.length &&
      before.points.every((p, i) => samePoint(p, route.points[i]));
    routes.set(id, unchanged ? before : route);
    reservations.add(route.points, route.lane, route.labelBounds);
    compareReservation(id);
  }
  return { nodes, edges, routes, directions, dependencies, statistics, clearance };
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
