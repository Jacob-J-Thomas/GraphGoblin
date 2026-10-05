import {
  BoxIndex,
  Footprint,
  Reservations,
  bounds,
  clearanceOf,
  distance,
  expand,
  simplify,
  sorted,
  type Box,
  type Lane,
  type Point,
} from './routing-geometry.js';
import { detour, SearchWorkspace } from './routing-search.js';
import {
  LABEL_CHARACTER_WIDTH,
  LABEL_PADDING,
  placeLabel,
  type LabelPlacement,
} from './routing-labels.js';
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
  /** The label's corner allowance: the escape padding's radius, at most `ROUTING_RADIUS`. */
  radius: number;
  /**
   * The drawn radius at each point (0 at both ends): the full `ROUTING_RADIUS` wherever the corner
   * has room, smaller only where the rounded curve would otherwise enter a card or its handles.
   */
  radii: readonly number[];
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
  dependencies: ReadonlyMap<string, RouteDependencies>;
  statistics: { rerouted: number; expansions: number; checks: number };
}
interface RouteDependencies {
  boxes: Footprint;
  reservations: Footprint;
  sourceRank: number;
  targetRank: number;
}
export const ROUTING_CLEARANCE = 24;
export const ROUTING_RADIUS = 8;
export const LANE_GAP = 24;
export const DIRECTION_HYSTERESIS = 8;
const COLUMN_GAP = 12;
// Inside the endpoint interval the distance is constant, including at fractional drag coordinates.
const verticalTravel = (from: number, to: number, y: number) =>
  Math.abs(from - to) + 2 * Math.max(Math.min(from, to) - y, y - Math.max(from, to), 0);

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
/** Port handles are 12 px dots centred on the card's edge; the measured tip is their outer edge. */
export const HANDLE_SIZE = 12;
const nodeBox = (n: RoutingNode): Box => ({
  id: n.id,
  left: n.x,
  right: n.x + n.width,
  top: n.y,
  bottom: n.y + n.height,
});
/**
 * A card and the strips of handles protruding from its sides. Clearance counts from the handles
 * too, so no lane or column passes a few pixels from another card's port and reads as joined to
 * it. Handles inside the card body (unit fixtures put tips on the edge) add nothing.
 */
function nodeBoxes(n: RoutingNode): Box[] {
  const body = nodeBox(n);
  const boxes = [body];
  const outputs = Object.values(n.outputs);
  const strip = (left: number, right: number, ys: number[]) => {
    if (left < body.left || right > body.right)
      boxes.push({
        id: n.id,
        left,
        right,
        top: Math.min(...ys) - HANDLE_SIZE / 2,
        bottom: Math.max(...ys) + HANDLE_SIZE / 2,
        handle: true,
      });
  };
  if (outputs.length)
    strip(
      Math.min(...outputs.map((p) => p.x)) - HANDLE_SIZE,
      Math.max(...outputs.map((p) => p.x)),
      outputs.map((p) => p.y),
    );
  if (n.input) strip(n.input.x, n.input.x + HANDLE_SIZE, [n.input.y]);
  return boxes;
}
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
export const routeMessage = (route: Pick<RoutedEdge, 'blocked' | 'unavailable'>): string =>
  route.blocked
    ? 'Port covered by a card; move the card'
    : route.unavailable
      ? 'No clear route; move a card'
      : '';
/** The text drawn in a route's pill: the port's name, and the warning of a route that has none. */
export function routeText(port: string, route: Pick<RoutedEdge, 'blocked' | 'unavailable'>) {
  const name = port === 'out' ? '' : port;
  const message = routeMessage(route);
  return message ? `${name || 'Connection'}: ${message}` : name;
}

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
    radii: points.map((_, i) => (i && i < points.length - 1 ? radius : 0)),
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

/** Decoration cannot invalidate a path. Use another horizontal, then a clear fallback pill. */
function labelRoute(
  route: RoutedEdge,
  port: string,
  from: Point,
  index: BoxIndex,
  reservations: Reservations,
): RoutedEdge {
  const lanes = route.points
    .flatMap((a, i) => {
      const b = route.points[i + 1];
      return b && a.y === b.y
        ? [{ y: a.y, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x) }]
        : [];
    })
    .sort((a, b) => b.right - b.left - (a.right - a.left));
  if (route.lane) lanes.unshift(route.lane);
  let label: LabelPlacement | undefined;
  for (const lane of lanes) {
    label = placeLabel(lane, port, route.radius, index, reservations);
    if (label) break;
  }
  for (let y = from.y - 48; !label; y -= 24)
    label = placeLabel(
      { y, left: from.x - 140, right: from.x + 140 },
      port,
      route.radius,
      index,
      reservations,
    );
  return withLabel(route, label);
}

function withLabel(route: RoutedEdge, label: LabelPlacement): RoutedEdge {
  const b = label.labelBounds;
  return {
    ...route,
    ...label,
    bounds: b
      ? {
          id: '',
          left: Math.min(route.bounds.left, b.left),
          right: Math.max(route.bounds.right, b.right),
          top: Math.min(route.bounds.top, b.top),
          bottom: Math.max(route.bounds.bottom, b.bottom),
        }
      : route.bounds,
  };
}

/**
 * A connection without a path still shows its name and warning in a pill. Its envelope is the whole
 * text (the edge never shortens a warning), searched upward from above the port until it clears
 * every card, handle, and earlier label, so no card paints over the explanation.
 */
function messageRoute(
  work: Work,
  blocked: boolean,
  index: BoxIndex,
  reservations: Reservations,
): RoutedEdge {
  const { from, to } = work;
  const route = describe([], from, to, 0, blocked);
  const text = routeText(work.edge.port, route);
  const full = text.length * LABEL_CHARACTER_WIDTH;
  const half = (full + LABEL_PADDING) / 2;
  let label: LabelPlacement | undefined;
  for (let y = from.y - 48; !label || label.labelWidth < full; y -= 24)
    label = placeLabel(
      { y, left: from.x - half - 140, right: from.x + half + 140 },
      text,
      0,
      index,
      reservations,
    );
  return withLabel(route, label);
}

function candidates(
  start: Point,
  end: Point,
  index: BoxIndex,
  padding: number,
  reservations: Reservations,
): number[] {
  const region = expand(bounds([start, end]), 192);
  const nearby = index.query(expand(region, padding), true);
  return [
    ...new Set([
      ...nearby.flatMap((b) => (b.handle ? [] : [b.top - padding, b.bottom + padding])),
      ...reservations
        .nearbyLanes(region)
        .flatMap((l) => [l.y - LANE_GAP, l.y + LANE_GAP, l.y - 12, l.y + 12]),
    ]),
  ]
    .filter((y) => y >= region.top && y <= region.bottom)
    .map((y) => ({ y, travel: verticalTravel(start.y, end.y, y) }))
    .sort((a, b) => a.travel - b.travel || b.y - a.y)
    .map(({ y }) => y);
}

function routeOne(
  work: Work,
  index: BoxIndex,
  reservations: Reservations,
  sourceRank: number,
  targetRank: number,
  clearance: number,
  workspace: SearchWorkspace,
  squeeze = false,
): { route: RoutedEdge; expansions: number } {
  const { source, target, from, to } = work;
  const fullPadding = Math.max(0, clearance) + ROUTING_RADIUS;
  if (index.covers(from, source.id) || index.covers(to, target.id))
    return { route: messageRoute(work, true, index, reservations), expansions: 0 };
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
  // A squeeze (handles ignored) is the zero-clearance last resort: no other padding applies.
  const paddings = squeeze
    ? [0]
    : [...new Set([fullPadding, Math.min(fullPadding / 2, room / 2), 0])];
  let expansions = 0;
  type Column = { point: Point; range?: [number, number] };
  const columnClear = (column: Column, y: number, padding: number) => {
    column.range ??= reservations.verticalRange(
      column.point,
      ...index.verticalRange(
        column.point,
        Math.min(from.y, to.y) - 192,
        Math.max(from.y, to.y) + 192,
        padding,
      ),
    );
    return y >= column.range[0] && y <= column.range[1];
  };
  const escapes = new Map<number, { starts: Point[]; ends: Point[] }>();
  const prepared = new Map<
    number,
    {
      ys: number[];
      starts: Column[];
      ends: Column[];
      clear: Map<number, boolean>;
    }
  >();
  const escapeAt = (padding: number) => {
    const cached = escapes.get(padding);
    if (cached) return cached;
    const sx = Math.max(source.x + source.width + padding, from.x);
    const tx = Math.min(target.x - padding, to.x);
    // Port/incoming ranks separate shared-card trunks. Alternatives handle columns blocked by a neighbour.
    const offsets = (rank: number) => sorted([rank * COLUMN_GAP, 0, 12, 24, 36, 48]);
    const stubs = (port: Point, points: Point[], own: string) =>
      index.clear(port, points.at(-1)!, padding, own)
        ? points
        : points.filter((p) => index.clear(port, p, padding, own));
    const starts = stubs(
      from,
      offsets(sourceRank).map((offset) => ({ x: sx + offset, y: from.y })),
      source.id,
    );
    const ends = stubs(
      to,
      offsets(targetRank).map((offset) => ({ x: tx - offset, y: to.y })),
      target.id,
    );
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
    let unlabelled: RoutedEdge | undefined;
    let unlabelledCost = Infinity;
    for (const padding of paddings) {
      const { starts, ends } = escapeAt(padding);
      if (!starts.length || !ends.length) continue;
      let row = prepared.get(padding);
      if (!row) {
        const ys = candidates(starts[0]!, ends[0]!, index, fullPadding, reservations);
        const column = (point: Point): Column => ({ point });
        row = { ys, starts: starts.map(column), ends: ends.map(column), clear: new Map() };
        prepared.set(padding, row);
      }
      const { ys } = row;
      for (const y of ys) {
        const travel = 2 * verticalTravel(from.y, to.y, y);
        if (travel + Math.abs(from.x - starts[0]!.x) + Math.abs(to.x - ends[0]!.x) >= bestCost)
          break;
        const firstStart = row.starts.find((c) => columnClear(c, y, padding));
        const firstEnd = row.ends.find((c) => columnClear(c, y, padding));
        if (
          !firstStart ||
          !firstEnd ||
          travel + Math.abs(from.x - firstStart.point.x) + Math.abs(to.x - firstEnd.point.x) >=
            bestCost
        )
          continue;
        // Every column pair crosses this common horizontal span. Reject it once, not once
        // for every escape pair and spacing tier (the hot path in a tall column of cards).
        const left = Math.min(starts[0]!.x, ends.at(-1)!.x);
        const right = Math.max(ends[0]!.x, starts.at(-1)!.x);
        const innerLeft = Math.min(starts.at(-1)!.x, ends[0]!.x);
        const innerRight = Math.max(ends.at(-1)!.x, starts[0]!.x);
        const common = innerLeft <= innerRight;
        const a0 = { x: innerLeft, y };
        const b0 = { x: innerRight, y };
        if (common) {
          if (!row.clear.has(y)) row.clear.set(y, index.clear(a0, b0, fullPadding));
          if (!row.clear.get(y) || !reservations.laneFree(a0, b0, gap)) continue;
        }
        const obstacles = index
          .query({
            id: '',
            left: left - fullPadding,
            right: right + fullPadding,
            top: y - fullPadding,
            bottom: y + fullPadding,
          })
          .filter(
            (b) =>
              y > b.top - clearanceOf(b, fullPadding) && y < b.bottom + clearanceOf(b, fullPadding),
          );
        // Columns are ordered by stub length. Prune cost before collision checks; check each
        // remaining vertical once, including wider pairs needed for labels on short spans.
        for (const startColumn of row.starts) {
          const start = startColumn.point;
          const sourceCost = travel + Math.abs(from.x - start.x);
          if (sourceCost + Math.abs(to.x - ends[0]!.x) >= bestCost) break;
          const a = { x: start.x, y };
          if (!columnClear(startColumn, y, padding)) continue;
          for (const endColumn of row.ends) {
            const end = endColumn.point;
            const b = { x: end.x, y };
            const cost = sourceCost + Math.abs(to.x - end.x);
            if (cost >= bestCost) break;
            if (
              !columnClear(endColumn, y, padding) ||
              !reservations.laneFree(a, b, gap) ||
              obstacles.some(
                (box) =>
                  Math.min(a.x, b.x) < box.right + clearanceOf(box, fullPadding) &&
                  Math.max(a.x, b.x) > box.left - clearanceOf(box, fullPadding),
              )
            )
              continue;
            const label = placeLabel(
              { y, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x) },
              work.edge.port,
              Math.min(ROUTING_RADIUS, padding),
              index,
              reservations,
            );
            if (!label) {
              if (cost < unlabelledCost) {
                unlabelled = {
                  ...describe(
                    simplify([from, start, a, b, end, to]),
                    from,
                    to,
                    padding,
                    false,
                    fullPadding,
                  ),
                  laneGap: gap,
                };
                unlabelledCost = cost;
              }
              continue;
            }
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
        const possible: [number, number][] = [];
        const row = prepared.get(fullPadding)!;
        // Short spans already have a small dependency region. Refine only long trunks,
        // where merging their two strips would otherwise invalidate whole columns of cards.
        if (Math.abs(from.y - to.y) <= 384)
          possible.push([Math.min(from.y, to.y) - extra, Math.max(from.y, to.y) + extra]);
        else
          for (const start of row.starts)
            for (const end of row.ends) {
              const stubs = Math.abs(from.x - start.point.x) + Math.abs(to.x - end.point.x);
              const slack = (bestCost - stubs - 2 * Math.abs(from.y - to.y)) / 4;
              if (slack < 0) continue;
              columnClear(start, from.y, fullPadding);
              columnClear(end, to.y, fullPadding);
              const low = Math.max(
                start.range![0],
                end.range![0],
                Math.min(from.y, to.y) - slack,
                slack === 0 ? best[2]!.y : -Infinity,
              );
              const high = Math.min(start.range![1], end.range![1], Math.max(from.y, to.y) + slack);
              if (low <= high) possible.push([low, high]);
            }
        const merged: [number, number][] = [];
        for (const interval of possible.sort((a, b) => a[0] - b[0])) {
          const last = merged.at(-1);
          if (last && last[1] >= interval[0]) last[1] = Math.max(last[1], interval[1]);
          else merged.push([...interval]);
        }
        for (const [reads, margin] of [
          [index.reads, fullPadding],
          [reservations.reads, LANE_GAP],
        ] as const) {
          // Equal-cost candidates prefer the greater y. Once the minimum stub/travel cost
          // wins, lower candidate boundaries cannot change that choice. Collision reads
          // remain separate strips: empty space between the two trunks is not a dependency.
          const top = Math.min(from.y, to.y) - extra - margin;
          const bottom = Math.max(from.y, to.y) + extra + margin;
          reads.restrict(
            top,
            bottom,
            merged.map(([low, high]) => [low - margin, high + margin]),
          );
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
    if (unlabelled)
      return {
        route: labelRoute(unlabelled, work.edge.port, from, index, reservations),
        expansions,
      };
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
    let fallbackLane: Lane | undefined;
    // A narrow escape can need several bends. Lift its main horizontal segment out to the full
    // envelope; only the approach/departure keep the reduced clearance found by A*.
    const horizontals = points
      .map((a, i) => ({ a, b: points[i + 1], i }))
      .filter(({ a, b }) => b && a.y === b.y)
      .sort((a, b) => Math.abs(b.a.x - b.b!.x) - Math.abs(a.a.x - a.b!.x));
    for (const gap of [LANE_GAP, 12, 0]) {
      let unlabelled: RoutedEdge | undefined;
      for (const { a, b, i } of horizontals) {
        if (i === 0 || i >= points.length - 2) continue;
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
          const lifted = simplify([...points.slice(0, i), first, last, ...points.slice(i + 2)]);
          if (!label) {
            unlabelled ??= {
              ...describe(lifted, from, to, padding, false, fullPadding),
              lane,
              laneGap: gap,
            };
            continue;
          }
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
          .map((box) => expand(box, clearanceOf(box, fullPadding)))
          .filter((box) => a.y > box.top && a.y < box.bottom)
          .sort((x, y) => x.left - y.left);
        const lanes: Lane[] = [];
        for (const obstacle of [...boxes, { left: right, right }]) {
          const end = Math.min(obstacle.left, right);
          if (end > left) lanes.push({ y: a.y, left, right: end });
          left = Math.max(left, obstacle.right);
        }
        lanes.sort((x, y) => y.right - y.left - (x.right - x.left));
        for (const lane of lanes) {
          if (
            !reservations.laneFree({ x: lane.left, y: lane.y }, { x: lane.right, y: lane.y }, gap)
          )
            continue;
          fallbackLane ??= lane;
          const label = placeLabel(
            lane,
            work.edge.port,
            Math.min(ROUTING_RADIUS, padding),
            index,
            reservations,
          );
          unlabelled ??= {
            ...describe(points, from, to, padding, false, fullPadding),
            lane,
            laneGap: gap,
          };
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
      if (unlabelled)
        return {
          route: labelRoute(unlabelled, work.edge.port, from, index, reservations),
          expansions,
        };
    }
    // A valid Z/step path can have only endpoint horizontals. Label placement must never
    // erase it. Prefer its longest horizontal; otherwise use a clear fallback above the path.
    const route = describe(points, from, to, padding, false, fullPadding);
    if (fallbackLane) route.lane = fallbackLane;
    else delete route.lane;
    return { route: labelRoute(route, work.edge.port, from, index, reservations), expansions };
  }
  return { route: messageRoute(work, false, index, reservations), expansions };
}

/**
 * The largest radius, up to `ROUTING_RADIUS`, at which each corner's curve stays out of every card
 * and handle. A corner's quadratic curve bulges into the corner's inner quadrant, along the
 * parabola √s + √t = √r from the corner (s and t measured along its two segments), so a box whose
 * nearest point in that quadrant is (s, t) allows r up to (√s + √t)². Corners with room keep the
 * full radius even when another part of the route squeezed through a tight escape.
 */
function cornerRadii(points: readonly Point[], index: BoxIndex): number[] {
  return points.map((b, i) => {
    const a = points[i - 1];
    const c = points[i + 1];
    if (!a || !c) return 0;
    let radius = Math.min(ROUTING_RADIUS, distance(a, b) / 2, distance(b, c) / 2);
    if (radius <= 0) return 0;
    // Each segment's own unit direction away from the corner, in screen axes.
    const u = { x: Math.sign(a.x - b.x), y: Math.sign(a.y - b.y) };
    const v = { x: Math.sign(c.x - b.x), y: Math.sign(c.y - b.y) };
    const along = (box: Box, d: Point): [number, number] => {
      const low = d.x ? (box.left - b.x) * d.x : (box.top - b.y) * d.y;
      const high = d.x ? (box.right - b.x) * d.x : (box.bottom - b.y) * d.y;
      return [Math.min(low, high), Math.max(low, high)];
    };
    for (const box of index.query(expand(bounds([b]), radius))) {
      const [s0, s1] = along(box, u);
      const [t0, t1] = along(box, v);
      if (s1 <= 0 || t1 <= 0) continue;
      radius = Math.min(radius, (Math.sqrt(Math.max(0, s0)) + Math.sqrt(Math.max(0, t0))) ** 2);
    }
    return radius;
  });
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
      changedBoxes.push(...nodeBoxes(node));
      if (old) changedBoxes.push(...nodeBoxes(old));
    }
    oldNodes.delete(node.id);
  }
  for (const old of oldNodes.values()) {
    changed.add(old.id);
    changedBoxes.push(...nodeBoxes(old));
  }
  const oldEdges = new Map(previous?.edges.map((e) => [e.id, e]));
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
  const dependencies = new Map<string, RouteDependencies>();
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
  const index = new BoxIndex(nodes.flatMap(nodeBoxes));
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  const statistics = { rerouted: 0, expansions: 0, checks: 0 };
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
      clearance === previous?.clearance &&
      sameEdge(item.edge, oldEdges.get(id)) &&
      before &&
      reads &&
      sourceRank === reads.sourceRank &&
      targetRank === reads.targetRank &&
      !changed.has(item.source.id) &&
      !changed.has(item.target.id) &&
      !changedBoxes.some((b) => reads.boxes.intersects(b)) &&
      ![...reservationChanges.values()].some((boxes) =>
        boxes.some((b) => reads.reservations.intersects(b)),
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
    const attempt = (squeeze = false) => {
      // A route starts and ends on its own cards' handles: only other cards' handles need room.
      index.exempt = [item.source.id, item.target.id];
      const result = routeOne(
        item,
        index,
        reservations,
        sourceRank,
        targetRank,
        clearance,
        workspace,
        squeeze,
      );
      index.exempt = [];
      return result;
    };
    let { route: routed, expansions } = attempt();
    if (routed.unavailable && index.hasHandles) {
      // Last resort: squeeze past protruding handles at zero clearance (never through a card)
      // rather than lose a connection that runs along touching cards.
      index.handles = false;
      const squeezed = attempt(true);
      index.handles = true;
      expansions += squeezed.expansions;
      routed = squeezed.route;
    }
    // A route with at least the full radius of padding cannot curve into a card. A tighter one
    // reads the boxes beside each corner, as part of this route's dependencies.
    const route =
      routed.padding >= ROUTING_RADIUS
        ? routed
        : { ...routed, radii: cornerRadii(routed.points, index) };
    statistics.rerouted += 1;
    statistics.expansions += expansions;
    dependencies.set(id, {
      boxes: index.reads,
      reservations: reservations.reads,
      sourceRank,
      targetRank,
    });
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
      before.points.every((p, i) => samePoint(p, route.points[i])) &&
      before.radii.every((r, i) => r === route.radii[i]);
    routes.set(id, unchanged ? before : route);
    reservations.add(route.points, route.lane, route.labelBounds);
    compareReservation(id);
  }
  statistics.checks = index.checks;
  return { nodes, edges, routes, directions, dependencies, statistics, clearance };
}

export function routeBackwardEdges(
  nodes: readonly RoutingNode[],
  edges: readonly RoutingEdge[],
  clearance = ROUTING_CLEARANCE,
): ReadonlyMap<string, RoutedEdge> {
  return createRoutingPlan(nodes, edges, clearance).routes;
}

/** Draw ordered orthogonal points with rounded corners: one radius, or one per point. */
export function roundedPath(
  points: readonly Point[],
  radius: number | readonly number[] = ROUTING_RADIUS,
): string {
  if (!points.length) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const r = Math.min(
      typeof radius === 'number' ? radius : (radius[i] ?? 0),
      distance(a, b) / 2,
      distance(b, c) / 2,
    );
    const before = { x: b.x + Math.sign(a.x - b.x) * r, y: b.y + Math.sign(a.y - b.y) * r };
    const after = { x: b.x + Math.sign(c.x - b.x) * r, y: b.y + Math.sign(c.y - b.y) * r };
    path += ` L ${before.x} ${before.y} Q ${b.x} ${b.y} ${after.x} ${after.y}`;
  }
  const end = points.at(-1)!;
  return `${path} L ${end.x} ${end.y}`;
}
