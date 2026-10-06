import { intersectsBox, simplify, type Box, type Point } from './routing-geometry.js';

/**
 * Manual edge routes (#44). An edge stores its route as the positions of its inner segments,
 * alternating the x of a vertical segment and the y of a horizontal one (`x, y, ..., x`, the
 * contract's `edge.ui.route`). The first and last segments are horizontal and run from the ports'
 * own heights, so the stubs are recomputed from the current port tips whenever a card moves.
 * Everything here is pure geometry: no store, DOM, or xyflow.
 */

/** The canvas background's dot spacing: keyboard nudges move a segment to the next grid line. */
export const GRID = 22;
/** Grid lines a Shift+arrow nudge moves. */
export const LARGE_NUDGE = 5;
/** The port stub kept when the first or last segment is dragged off its port's height. */
export const STUB = 24;
/** Smoothstep's own offset, so a forward edge's handles sit on the path xyflow draws. */
const SMOOTHSTEP_OFFSET = 20;

export type Route = readonly number[];

/**
 * The route's corner points in strict alternation: segments horizontal, vertical, ..., horizontal,
 * some possibly of zero length. Segment `s` (1-based) runs from `points[s - 1]` to `points[s]`.
 */
export function pointsOf(route: Route, from: Point, to: Point): Point[] {
  const points = [from];
  let y = from.y;
  for (let i = 0; i < route.length; i += 2) {
    const x = route[i]!;
    points.push({ x, y });
    y = i + 1 < route.length ? route[i + 1]! : to.y;
    points.push({ x, y });
  }
  points.push(to);
  return points;
}

/** The drawn points of a route: duplicates and collinear corners removed. */
export const drawnPoints = (route: Route, from: Point, to: Point): Point[] =>
  simplify(pointsOf(route, from, to));

/**
 * The stored form of any orthogonal path from `from` to `to` (its first point and its last). A
 * vertical first or last segment gets a zero-length horizontal stub, so the result always
 * alternates; a straight horizontal path has no inner segment and gives `[]`.
 */
export function coordinatesOf(points: readonly Point[]): number[] {
  const first = points[0];
  if (!first) return [];
  const strict: Point[] = [first];
  let horizontal = true; // The orientation the next segment must have.
  for (const p of points.slice(1)) {
    const a = strict.at(-1)!;
    if (a.x === p.x && a.y === p.y) continue;
    if ((a.y === p.y) !== horizontal) {
      strict.push(a);
      horizontal = !horizontal;
    }
    strict.push(p);
    horizontal = !horizontal;
  }
  if (horizontal) strict.push(strict.at(-1)!);
  const route: number[] = [];
  for (let s = 2; s < strict.length - 1; s += 1)
    route.push(s % 2 === 0 ? strict[s]!.x : strict[s]!.y);
  return route;
}

/** One route without redundant positions: what an edge stores after an edit. */
export const normalize = (route: Route, from: Point, to: Point): number[] =>
  coordinatesOf(drawnPoints(route, from, to));

export const sameRoute = (a: Route | undefined, b: Route | undefined): boolean =>
  a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));

export interface RouteSegment {
  /** 1-based segment number in `pointsOf` order. */
  index: number;
  a: Point;
  b: Point;
  /** The axis a drag moves the segment along: `x` for a vertical segment, `y` for a horizontal. */
  axis: 'x' | 'y';
  /** First and last segments stay on their port: dragging one splits it, keeping a stub. */
  kind: 'only' | 'first' | 'last' | 'inner';
  /** The position the segment's coordinate has now (its x or its y). */
  value: number;
}

/** Every segment of non-zero length, with how a drag moves it. */
export function segmentsOf(route: Route, from: Point, to: Point): RouteSegment[] {
  const points = pointsOf(route, from, to);
  const last = points.length - 1;
  const segments: RouteSegment[] = [];
  for (let index = 1; index <= last; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    if (a.x === b.x && a.y === b.y) continue;
    const axis = index % 2 === 0 ? 'x' : 'y';
    segments.push({
      index,
      a,
      b,
      axis,
      kind: last === 1 ? 'only' : index === 1 ? 'first' : index === last ? 'last' : 'inner',
      value: axis === 'x' ? a.x : a.y,
    });
  }
  return segments;
}

/** Where a stub ends when a segment from `start` towards `end` is split off its port. */
function stubEnd(start: number, end: number, share: number): number {
  const direction = Math.sign(end - start) || 1;
  return start + direction * Math.min(STUB, Math.abs(end - start) * share);
}

/**
 * Move segment `index` so its x (vertical) or y (horizontal) is `value`. The route stays
 * orthogonal: neighbouring segments stretch. A first or last segment keeps a stub on its port
 * and the rest moves; a lone straight segment keeps a stub at both ends. Returns the new route
 * and the moved segment's new number.
 */
export function moveSegment(
  route: Route,
  index: number,
  value: number,
  from: Point,
  to: Point,
): { route: number[]; index: number } {
  const last = route.length ? route.length + 2 : 1;
  if (last === 1) {
    const start = stubEnd(from.x, to.x, 1 / 3);
    const end = stubEnd(to.x, from.x, 1 / 3);
    return { route: [start, value, end], index: 3 };
  }
  if (index === 1) return { route: [stubEnd(from.x, route[0]!, 1 / 2), value, ...route], index: 3 };
  if (index === last)
    return { route: [...route, value, stubEnd(to.x, route.at(-1)!, 1 / 2)], index: last };
  const next = [...route];
  next[index - 2] = value;
  return { route: next, index };
}

/**
 * The segment of `route` that a moved segment became after normalisation: the one on the same
 * axis at `value` nearest to `near`, if any.
 */
export function findSegment(
  route: Route,
  from: Point,
  to: Point,
  axis: 'x' | 'y',
  value: number,
  near: Point,
): RouteSegment | undefined {
  let best: RouteSegment | undefined;
  let distance = Infinity;
  for (const segment of segmentsOf(route, from, to)) {
    if (segment.axis !== axis || segment.value !== value) continue;
    const middle = midpoint(segment);
    const d = Math.abs(middle.x - near.x) + Math.abs(middle.y - near.y);
    if (d < distance) [best, distance] = [segment, d];
  }
  return best;
}

export const midpoint = ({ a, b }: { a: Point; b: Point }): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** The next grid line from `value` in `direction`, then `steps - 1` lines further. */
export function nudged(value: number, direction: -1 | 1, steps = 1): number {
  const line = direction > 0 ? Math.floor(value / GRID) + 1 : Math.ceil(value / GRID) - 1;
  return (line + direction * (steps - 1)) * GRID;
}

/** Whether any segment of the drawn route enters a card's open interior (touching is fine). */
export function crossesCards(points: readonly Point[], cards: readonly Box[]): boolean {
  for (let i = 1; i < points.length; i += 1)
    if (cards.some((card) => intersectsBox(points[i - 1]!, points[i]!, card))) return true;
  return false;
}

/** The specific cards a route enters, for preserving deliberate intersections during a move. */
export const crossedCardIds = (
  points: readonly Point[],
  cards: readonly Box[],
): ReadonlySet<string> =>
  new Set(cards.filter((card) => crossesCards(points, [card])).map((card) => card.id));

/**
 * The orthogonal points xyflow's smoothstep draws from a right-hand port to a left-hand one, so a
 * forward edge's handles sit on its drawn path and a drag starts from exactly that shape.
 */
export function forwardPoints(from: Point, to: Point): Point[] {
  const start = from.x + SMOOTHSTEP_OFFSET;
  const end = to.x - SMOOTHSTEP_OFFSET;
  if (start < end) {
    const x = (start + end) / 2;
    return simplify([from, { x, y: from.y }, { x, y: to.y }, to]);
  }
  const y = (from.y + to.y) / 2;
  return simplify([
    from,
    { x: start, y: from.y },
    { x: start, y },
    { x: end, y },
    { x: end, y: to.y },
    to,
  ]);
}
