export interface Point {
  x: number;
  y: number;
}
export interface Box {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const expand = (b: Box, padding: number): Box => ({
  id: b.id,
  left: b.left - padding,
  right: b.right + padding,
  top: b.top - padding,
  bottom: b.bottom + padding,
});
export const overlapsBox = (a: Box, b: Box): boolean =>
  a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
export const contains = (b: Box, p: Point): boolean =>
  p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom;

/** Touching the boundary is legal; entering the open interior is not. */
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
export const bounds = (points: readonly Point[]): Box => ({
  id: '',
  left: Math.min(...points.map((p) => p.x)),
  right: Math.max(...points.map((p) => p.x)),
  top: Math.min(...points.map((p) => p.y)),
  bottom: Math.max(...points.map((p) => p.y)),
});
export const distance = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const sorted = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

/** A fixed-cell index of real card boxes, queried with the current route's padding. */
export class BoxIndex {
  private cells = new Map<string, Box[]>();
  constructor(readonly boxes: readonly Box[]) {
    for (const box of boxes)
      this.cellsFor(box, (key) => {
        const cell = this.cells.get(key);
        if (cell) cell.push(box);
        else this.cells.set(key, [box]);
      });
  }
  private cellsFor(box: Box, visit: (key: string) => void): void {
    for (let x = Math.floor(box.left / 256); x <= Math.floor(box.right / 256); x += 1)
      for (let y = Math.floor(box.top / 256); y <= Math.floor(box.bottom / 256); y += 1)
        visit(`${x},${y}`);
  }
  query(box: Box): Box[] {
    const found = new Set<Box>();
    this.cellsFor(box, (key) => {
      for (const candidate of this.cells.get(key) ?? [])
        if (overlapsBox(box, candidate)) found.add(candidate);
    });
    return [...found];
  }
  clear(a: Point, b: Point, padding: number, own?: string): boolean {
    return !this.query(expand(bounds([a, b]), padding)).some(
      (box) => box.id !== own && intersectsBox(a, b, expand(box, padding)),
    );
  }
  covers(p: Point, own: string): boolean {
    return this.query(bounds([p])).some((box) => box.id !== own && contains(box, p));
  }
}

/** Remove duplicates and collinear points without changing the route. */
export function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    const b = result.at(-1);
    if (b?.x === p.x && b.y === p.y) continue;
    const a = result.at(-2);
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)))
      result[result.length - 1] = p;
    else result.push(p);
  }
  return result;
}

export interface Lane {
  y: number;
  left: number;
  right: number;
}
export const overlaps = (left: number, right: number, lane: Lane): boolean =>
  left < lane.right && right > lane.left;

/** Horizontal lanes may compress in crowded gaps; long shared vertical trunks never do. */
export class Reservations {
  readonly lanes: Lane[] = [];
  private laneCells = new Map<number, Lane[]>();
  private verticals = new Map<number, { top: number; bottom: number }[]>();
  add(points: readonly Point[], lane?: Lane): void {
    if (lane) {
      this.lanes.push(lane);
      const key = Math.floor(lane.y / 24);
      const cell = this.laneCells.get(key);
      if (cell) cell.push(lane);
      else this.laneCells.set(key, [lane]);
    }
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!;
      const b = points[i]!;
      if (a.x !== b.x) continue;
      const segment = { top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
      const at = this.verticals.get(a.x);
      if (at) at.push(segment);
      else this.verticals.set(a.x, [segment]);
    }
  }
  verticalFree(a: Point, b: Point): boolean {
    return (
      a.x !== b.x ||
      !(this.verticals.get(a.x) ?? []).some(
        (s) => Math.min(Math.max(a.y, b.y), s.bottom) - Math.max(Math.min(a.y, b.y), s.top) > 0.01,
      )
    );
  }
  laneFree(a: Point, b: Point, gap: number): boolean {
    if (!gap) return true;
    for (let key = Math.floor((a.y - gap) / 24); key <= Math.floor((a.y + gap) / 24); key += 1)
      if (
        (this.laneCells.get(key) ?? []).some(
          (l) => Math.abs(a.y - l.y) < gap && overlaps(Math.min(a.x, b.x), Math.max(a.x, b.x), l),
        )
      )
        return false;
    return true;
  }
}
