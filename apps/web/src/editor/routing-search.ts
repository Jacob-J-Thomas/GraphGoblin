import {
  bounds,
  expand,
  simplify,
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
): { points: Point[]; expansions: number } {
  const region = expand(bounds([start, end]), 160);
  const boxes = index.query(expand(region, padding)).map((b) => expand(b, padding));
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
      [region.left, region.right, ...boxes.flatMap((b) => [b.left, b.right])],
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
  const neighbours = (v: number) => [
    ...(v % width > 0 ? [v - 1] : []),
    ...((v % width) + 1 < width ? [v + 1] : []),
    ...(v >= width ? [v - width] : []),
    ...(v + width < width * ys.length ? [v + width] : []),
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
  workspace.prepare(width * ys.length * 2);
  const { costs, previous, visited, frontier } = workspace;
  costs[first * 2] = 0;
  frontier.push(first * 2, estimate(point(first), 0));
  let expansions = 0;
  for (
    let state = frontier.pop();
    state !== undefined && expansions < SEARCH_LIMIT;
    state = frontier.pop()
  ) {
    if (visited[state]) continue;
    const vertex = Math.floor(state / 2);
    if (vertex === goal) {
      const path: Point[] = [];
      for (let cursor = state; cursor !== -1; cursor = previous[cursor]!)
        path.push(point(Math.floor(cursor / 2)));
      return { points: simplify(reverse ? path : path.reverse()), expansions };
    }
    visited[state] = 1;
    expansions += 1;
    const a = point(vertex);
    for (const next of neighbours(vertex)) {
      const b = point(next);
      const direction = a.y === b.y ? 0 : 1;
      const id = next * 2 + direction;
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
