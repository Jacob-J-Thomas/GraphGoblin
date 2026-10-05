/** Canvas geometry only: no draft/store access, DOM, clock, or layout mutation. */
export interface Point {
  x: number;
  y: number;
}

export interface RoutingNode extends Point {
  id: string;
  width: number;
  height: number;
  /** Absolute, measured port tips (not the centre of the handle). */
  outputs: Readonly<Record<string, Point>>;
  input?: Point;
}

export interface RoutingEdge {
  id: string;
  source: string;
  target: string;
  port: string;
}

export interface Lane {
  y: number;
  left: number;
  right: number;
}

export interface RoutedEdge extends Record<string, unknown> {
  /** #44 can replace these ordered orthogonal points before they reach the renderer. */
  points: readonly Point[];
  lane?: Lane;
  label: Point;
  labelWidth: number;
  /** A covered port has no clearance-preserving route; never draw through the covering card. */
  blocked: boolean;
}

export const ROUTING_CLEARANCE = 24;
export const ROUTING_RADIUS = 8;
export const LANE_GAP = 24;

interface Box {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Boundaries may be touched; the open padded interior may not be entered. */
export function intersectsBox(a: Point, b: Point, box: Box): boolean {
  return a.y === b.y
    ? a.y > box.top &&
        a.y < box.bottom &&
        Math.max(a.x, b.x) > box.left &&
        Math.min(a.x, b.x) < box.right
    : a.x > box.left &&
        a.x < box.right &&
        Math.max(a.y, b.y) > box.top &&
        Math.min(a.y, b.y) < box.bottom;
}

function clear(a: Point, b: Point, boxes: readonly Box[]): boolean {
  return !boxes.some((box) => intersectsBox(a, b, box));
}

function overlaps(left: number, right: number, lane: Lane): boolean {
  return left < lane.right && right > lane.left;
}

function freeLane(a: Point, b: Point, lanes: readonly Lane[]): boolean {
  return !lanes.some(
    (lane) =>
      Math.abs(a.y - lane.y) < LANE_GAP && overlaps(Math.min(a.x, b.x), Math.max(a.x, b.x), lane),
  );
}

/** Remove duplicate/collinear points without changing the geometry. */
export function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    const b = result.at(-1);
    if (b?.x === p.x && b.y === p.y) continue;
    const a = result.at(-2);
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) {
      result[result.length - 1] = p;
    } else result.push(p);
  }
  return result;
}

function distance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Small min-heap for the exceptional, obstructed-escape search. */
class Frontier {
  private entries: { id: number; cost: number }[] = [];

  push(id: number, cost: number): void {
    const entry = { id, cost };
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.entries[parent]!.cost <= cost) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): number | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (this.entries.length && last) {
      let index = 0;
      while (index * 2 + 1 < this.entries.length) {
        let child = index * 2 + 1;
        if (this.entries[child + 1] && this.entries[child + 1]!.cost < this.entries[child]!.cost)
          child += 1;
        if (this.entries[child]!.cost >= last.cost) break;
        this.entries[index] = this.entries[child]!;
        index = child;
      }
      this.entries[index] = last;
    }
    return first?.id;
  }
}

const sorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

/**
 * A* on a lazily visited rectilinear grid of obstacle boundaries. Only used when straight
 * escapes cannot reach a common lane (staggered cards, overlapping obstacle clusters). The
 * outermost coordinates guarantee an outside corridor; no diagonal or unsafe fallback exists.
 */
function detour(start: Point, end: Point, boxes: readonly Box[], lanes: readonly Lane[]): Point[] {
  const xs = sorted([start.x, end.x, ...boxes.flatMap((b) => [b.left, b.right])]);
  const ys = sorted([
    start.y,
    end.y,
    ...boxes.flatMap((b) => [b.top, b.bottom]),
    ...lanes.flatMap((l) => [l.y - LANE_GAP, l.y + LANE_GAP]),
  ]);
  const width = xs.length;
  const point = (id: number): Point => ({ x: xs[id % width]!, y: ys[Math.floor(id / width)]! });
  const first = ys.indexOf(start.y) * width + xs.indexOf(start.x);
  const goal = ys.indexOf(end.y) * width + xs.indexOf(end.x);
  const costs = new Float64Array(width * ys.length).fill(Infinity);
  const previous = new Int32Array(costs.length).fill(-1);
  const visited = new Uint8Array(costs.length);
  const frontier = new Frontier();
  costs[first] = 0;
  frontier.push(first, distance(start, end));
  for (let id = frontier.pop(); id !== undefined; id = frontier.pop()) {
    if (id === goal) {
      const path: Point[] = [];
      for (let cursor = goal; cursor !== -1; cursor = previous[cursor]!) path.push(point(cursor));
      return simplify(path.reverse());
    }
    if (visited[id]) continue;
    visited[id] = 1;
    const a = point(id);
    const x = id % width;
    const neighbours = [
      ...(x > 0 ? [id - 1] : []),
      ...(x + 1 < width ? [id + 1] : []),
      ...(id >= width ? [id - width] : []),
      ...(id + width < costs.length ? [id + width] : []),
    ];
    for (const next of neighbours) {
      if (visited[next]) continue;
      const b = point(next);
      const cost = costs[id]! + distance(a, b);
      if (cost >= costs[next]! || !clear(a, b, boxes)) continue;
      if (a.y === b.y && !freeLane(a, b, lanes)) continue;
      costs[next] = cost;
      previous[next] = id;
      frontier.push(next, cost + distance(b, end));
    }
  }
  return [];
}

/** The longest horizontal interior segment carries the label and reserves the return lane. */
function describe(points: Point[], fallback: Point): RoutedEdge {
  let lane: Lane | undefined;
  for (let i = 2; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.y !== b.y) continue;
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    if (!lane || right - left > lane.right - lane.left) lane = { y: a.y, left, right };
  }
  return {
    points,
    ...(lane ? { lane } : {}),
    label: lane ? { x: (lane.left + lane.right) / 2, y: lane.y } : fallback,
    labelWidth: lane ? Math.max(0, lane.right - lane.left - 2 * ROUTING_RADIUS - 16) : 200,
    blocked: points.length === 0,
  };
}

/**
 * Route only loopBack, self and non-forward (including same-column) edges. Deterministic id order
 * assigns nearby free horizontal lanes to overlapping spans. First try a six-point path around
 * the cards; search a boundary grid only if obstacles block both vertical escapes. Extra radius
 * outside the requested clearance keeps the rounded SVG corners outside the padded boxes too.
 */
export function routeBackwardEdges(
  nodes: readonly RoutingNode[],
  edges: readonly RoutingEdge[],
  clearance = ROUTING_CLEARANCE,
): ReadonlyMap<string, RoutedEdge> {
  const padding = Math.max(0, clearance) + ROUTING_RADIUS;
  const boxes = nodes.map((node): Box => ({
    id: node.id,
    left: node.x - padding,
    right: node.x + node.width + padding,
    top: node.y - padding,
    bottom: node.y + node.height + padding,
  }));
  const byId = new Map(nodes.map((node, index) => [node.id, { node, box: boxes[index]! }]));
  const boundaries = sorted(boxes.flatMap((box) => [box.top, box.bottom]));
  const lanes: Lane[] = [];
  const result = new Map<string, RoutedEdge>();
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || (edge.port !== 'loopBack' && target.node.x > source.node.x)) continue;
    const from = source.node.outputs[edge.port];
    const to = target.node.input;
    if (!from || !to) continue;
    const start = { x: source.box.right, y: from.y };
    const end = { x: target.box.left, y: to.y };
    const fallback = { x: start.x, y: source.box.top - LANE_GAP };
    // A port covered by another padded card cannot escape horizontally without a collision.
    if (
      boxes.some(
        (box) =>
          (box.id !== source.node.id && intersectsBox(from, start, box)) ||
          (box.id !== target.node.id && intersectsBox(end, to, box)),
      )
    ) {
      result.set(edge.id, describe([], fallback));
      continue;
    }
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const candidates = sorted([
      ...boundaries,
      ...lanes
        .filter((lane) => overlaps(left, right, lane))
        .flatMap((lane) => [lane.y - LANE_GAP, lane.y + LANE_GAP]),
    ]).sort(
      (a, b) =>
        Math.abs(start.y - a) +
          Math.abs(end.y - a) -
          (Math.abs(start.y - b) + Math.abs(end.y - b)) || b - a,
    );
    let middle: Point[] = [];
    for (const y of candidates) {
      const a = { x: start.x, y };
      const b = { x: end.x, y };
      if (
        freeLane(a, b, lanes) &&
        clear(start, a, boxes) &&
        clear(a, b, boxes) &&
        clear(b, end, boxes)
      ) {
        middle = [start, a, b, end];
        break;
      }
    }
    if (!middle.length) middle = detour(start, end, boxes, lanes);
    const route = describe(middle.length ? simplify([from, ...middle, to]) : [], fallback);
    if (route.lane) lanes.push(route.lane);
    result.set(edge.id, route);
  }
  return result;
}

/** The drawing hook for #44: it accepts points independently of how they were obtained. */
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
