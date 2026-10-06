import {
  bounds,
  expand,
  simplify,
  handleClearance,
  sorted,
  type Point,
  type BoxIndex,
  type Reservations,
} from './routing-geometry.js';

export const SEARCH_LIMIT = 2048;
const BEND_COST = 48;

class Frontier {
  private entries: { id: number; cost: number }[] = [];
  reset(): void {
    this.entries.length = 0;
  }
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

/** Scratch storage belongs to one canvas. Reused across searches, never part of route semantics. */
export class SearchWorkspace {
  costs = new Float64Array(0);
  previous = new Int32Array(0);
  visited = new Uint8Array(0);
  frontier = new Frontier();
  prepare(size: number): void {
    if (this.costs.length < size) {
      this.costs = new Float64Array(size);
      this.previous = new Int32Array(size);
      this.visited = new Uint8Array(size);
    }
    this.costs.fill(Infinity, 0, size);
    this.previous.fill(-1, 0, size);
    this.visited.fill(0, 0, size);
    this.frontier.reset();
  }
}

/** Direction is part of the A* state, so equal-length staircases lose to routes with fewer bends. */
export function detour(
  start: Point,
  end: Point,
  index: BoxIndex,
  padding: number,
  reservations: Reservations,
  workspace: SearchWorkspace,
  lanePadding = padding,
  laneLength = 0,
): { points: Point[]; expansions: number } {
  const region = expand(bounds([start, end]), 160);
  const found = index.query(expand(region, padding));
  // Grid lines: every card body's padded edges, and the edge of a handle strip's own (smaller)
  // clearance where it reaches beyond them. Collision checks consult the exact boxes.
  const boxes = found.filter((b) => !b.handle).map((b) => expand(b, padding));
  const handleLines = found.flatMap((b) => {
    if (!b.handle) return [];
    const card = found.find((c) => c.id === b.id && !c.handle);
    const reach = handleClearance(padding);
    return [
      ...(!card || b.left - reach < card.left - padding ? [b.left - reach] : []),
      ...(!card || b.right + reach > card.right + padding ? [b.right + reach] : []),
    ];
  });
  // Bound both grid storage and exploration. Collision checks still consult every indexed card.
  const nearest = (values: number[], a: number, b: number) =>
    sorted(values)
      .sort(
        (x, y) =>
          Math.min(Math.abs(x - a), Math.abs(x - b)) - Math.min(Math.abs(y - a), Math.abs(y - b)) ||
          x - y,
      )
      .slice(0, 62);
  const xs = sorted([
    start.x,
    end.x,
    ...nearest(
      [region.left, region.right, ...boxes.flatMap((b) => [b.left, b.right]), ...handleLines],
      start.x,
      end.x,
    ),
  ]);
  const ys = sorted([
    start.y,
    end.y,
    ...nearest(
      [region.top, region.bottom, ...boxes.flatMap((b) => [b.top, b.bottom])],
      start.y,
      end.y,
    ),
  ]);
  const width = xs.length;
  const point = (vertex: number): Point => ({
    x: xs[vertex % width]!,
    y: ys[Math.floor(vertex / width)]!,
  });
  const vertexAt = (p: Point) => ys.indexOf(p.y) * width + xs.indexOf(p.x);
  const jump = (v: number, step: number) => {
    const column = v % width;
    for (let x = column + step; x >= 0 && x < width; x += step)
      if (Math.abs(xs[x]! - xs[column]!) >= laneLength) return [v - column + x];
    return [];
  };
  const neighbours = (v: number) => [
    ...(v % width > 0 ? [v - 1] : []),
    ...((v % width) + 1 < width ? [v + 1] : []),
    ...(v >= width ? [v - width] : []),
    ...(v + width < width * ys.length ? [v + width] : []),
    ...(laneLength ? [...jump(v, -1), ...jump(v, 1)] : []),
  ];
  const freedom = (v: number) =>
    neighbours(v).filter((n) => index.clear(point(v), point(n), padding)).length;
  const reverse = freedom(vertexAt(end)) < freedom(vertexAt(start));
  const first = vertexAt(reverse ? end : start);
  const goal = vertexAt(reverse ? start : end);
  const destination = point(goal);
  const estimate = (p: Point, direction: number) =>
    Math.abs(p.x - destination.x) +
    2 * Math.abs(p.y - destination.y) +
    ((direction === 0 && p.y !== destination.y) || (direction === 1 && p.x !== destination.x)
      ? BEND_COST
      : 0);
  // Direction and whether a full-clearance lane has been reached are both search state.
  // This prevents a narrow endpoint corridor from becoming the entire return lane.
  workspace.prepare(width * ys.length * 4);
  const { costs, previous, visited, frontier } = workspace;
  costs[first * 4] = 0;
  frontier.push(first * 4, estimate(point(first), 0));
  let expansions = 0;
  for (
    let state = frontier.pop();
    state !== undefined && expansions < SEARCH_LIMIT;
    state = frontier.pop()
  ) {
    if (visited[state]) continue;
    const vertex = Math.floor(state / 4);
    if (vertex === goal && state & 2) {
      const path: Point[] = [];
      for (let cursor = state; cursor !== -1; cursor = previous[cursor]!)
        path.push(point(Math.floor(cursor / 4)));
      return { points: simplify(reverse ? path : path.reverse()), expansions };
    }
    visited[state] = 1;
    expansions += 1;
    const a = point(vertex);
    for (const next of neighbours(vertex)) {
      const b = point(next);
      const direction = a.y === b.y ? 0 : 1;
      const parent = previous[state]!;
      if (parent !== -1 && direction === state % 2) {
        const before = point(Math.floor(parent / 4));
        if ((a.x - before.x) * (b.x - a.x) + (a.y - before.y) * (b.y - a.y) < 0) continue;
      }
      const hasLane =
        state & 2 ||
        (direction === 0 && Math.abs(a.x - b.x) >= laneLength && index.clear(a, b, lanePadding));
      const id = next * 4 + direction + (hasLane ? 2 : 0);
      const cost =
        costs[state]! +
        Math.abs(a.x - b.x) +
        2 * Math.abs(a.y - b.y) +
        (direction !== state % 2 ? BEND_COST : 0);
      if (
        visited[id] ||
        cost >= costs[id]! ||
        !index.clear(a, b, padding) ||
        !reservations.verticalFree(a, b)
      )
        continue;
      costs[id] = cost;
      previous[id] = state;
      frontier.push(id, cost + estimate(b, direction));
    }
  }
  return { points: [], expansions };
}
