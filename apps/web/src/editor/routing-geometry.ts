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
  /**
   * A card's protruding port handles. Routes keep their clearance from it, but it neither covers
   * a port nor seeds lane candidates (it never reaches past its card's top or bottom).
   */
  handle?: boolean;
}

/**
 * Handles are part of their card for clearance, but a route need not stay as far from a 12 px dot
 * as from a card: a few pixels already keep it from reading as joined to the port. Bodies keep the
 * full padding, which covers the 6 px protrusion whenever the padding is generous.
 */
export const HANDLE_CLEARANCE = 12;
export const handleClearance = (padding: number): number => Math.min(padding, HANDLE_CLEARANCE);
export const clearanceOf = (box: Box, padding: number): number =>
  box.handle ? handleClearance(padding) : padding;

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
export function bounds(points: readonly Point[]): Box {
  const box = { id: '', left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const p of points) {
    box.left = Math.min(box.left, p.x);
    box.right = Math.max(box.right, p.x);
    box.top = Math.min(box.top, p.y);
    box.bottom = Math.max(box.bottom, p.y);
  }
  return box;
}
export const distance = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const sorted = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

/** The region actually consulted by a route, including rejected alternatives. */
export class Footprint {
  box: Box | undefined;
  private regions: Box[] = [];
  private discoveries: Box[] = [];
  touch(box: Box, discovery = false): void {
    (discovery ? this.discoveries : this.regions).push(box);
    if (!this.box) this.box = { ...box };
    else {
      this.box.left = Math.min(this.box.left, box.left);
      this.box.right = Math.max(this.box.right, box.right);
      this.box.top = Math.min(this.box.top, box.top);
      this.box.bottom = Math.max(this.box.bottom, box.bottom);
    }
  }
  restrict(top: number, bottom: number, ranges: readonly (readonly [number, number])[]): void {
    const clipped: Box[] = [];
    const keep = (box: Box, low: number, high: number) => {
      low = Math.max(box.top, low);
      high = Math.min(box.bottom, high);
      if (low <= high)
        clipped.push(
          low === box.top && high === box.bottom ? box : { ...box, top: low, bottom: high },
        );
    };
    for (const box of this.regions) keep(box, top, bottom);
    for (const box of this.discoveries) for (const [low, high] of ranges) keep(box, low, high);
    this.regions = clipped;
    this.discoveries = [];
  }
  intersects(box: Box): boolean {
    return (
      !!this.box &&
      overlapsBox(this.box, box) &&
      (this.regions.some((r) => overlapsBox(r, box)) ||
        this.discoveries.some((r) => overlapsBox(r, box)))
    );
  }
}

/** A fixed-cell index of real card boxes, queried with the current route's padding. */
export class BoxIndex {
  reads = new Footprint();
  checks = 0;
  /**
   * Whether handle strips count. A route that finds no way with them gets one last attempt without
   * them, so a connection squeezed along touching cards is still drawn rather than lost.
   */
  handles = true;
  /** The cards whose own handles the current route ignores: its ports sit on them. */
  exempt: readonly string[] = [];
  private cells = new Map<string, Box[]>();
  /** Whether any card has protruding handles (otherwise a handle-less retry changes nothing). */
  readonly hasHandles: boolean;
  constructor(readonly boxes: readonly Box[]) {
    this.hasHandles = boxes.some((box) => box.handle);
    for (const box of boxes)
      this.cellsFor(box, (key) => {
        const cell = this.cells.get(key);
        if (cell) cell.push(box);
        else this.cells.set(key, [box]);
      });
  }
  private counts(box: Box): boolean {
    return !box.handle || (this.handles && !this.exempt.includes(box.id));
  }
  private cellsFor(box: Box, visit: (key: string) => void): void {
    for (let x = Math.floor(box.left / 256); x <= Math.floor(box.right / 256); x += 1)
      for (let y = Math.floor(box.top / 256); y <= Math.floor(box.bottom / 256); y += 1)
        visit(`${x},${y}`);
  }
  query(box: Box, discovery = false): Box[] {
    this.checks += 1;
    this.reads.touch(box, discovery);
    const found = new Set<Box>();
    this.cellsFor(box, (key) => {
      for (const candidate of this.cells.get(key) ?? [])
        if (this.counts(candidate) && overlapsBox(box, candidate)) found.add(candidate);
    });
    return [...found];
  }
  clear(a: Point, b: Point, padding: number, own?: string): boolean {
    const segment = bounds([a, b]);
    const region = expand(segment, padding);
    this.checks += 1;
    this.reads.touch(region);
    for (let x = Math.floor(region.left / 256); x <= Math.floor(region.right / 256); x += 1)
      for (let y = Math.floor(region.top / 256); y <= Math.floor(region.bottom / 256); y += 1)
        for (const box of this.cells.get(`${x},${y}`) ?? []) {
          if (box.id === own || !this.counts(box)) continue;
          const pad = clearanceOf(box, padding);
          if (
            segment.left - pad < box.right &&
            segment.right + pad > box.left &&
            segment.top - pad < box.bottom &&
            segment.bottom + pad > box.top
          )
            return false;
        }
    return true;
  }
  covers(p: Point, own: string): boolean {
    return this.query(bounds([p])).some((box) => box.id !== own && !box.handle && contains(box, p));
  }
  /** Maximal clear vertical interval through a column, calculated once per escape. */
  verticalRange(p: Point, top: number, bottom: number, padding: number): [number, number] {
    for (const box of this.query({
      id: '',
      left: p.x - padding,
      right: p.x + padding,
      top: top - padding,
      bottom: bottom + padding,
    })) {
      const pad = clearanceOf(box, padding);
      if (p.x <= box.left - pad || p.x >= box.right + pad) continue;
      if (p.y >= box.bottom + pad) top = Math.max(top, box.bottom + pad);
      else if (p.y <= box.top - pad) bottom = Math.min(bottom, box.top - pad);
      else return [1, 0];
    }
    return [top, bottom];
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
  readonly labels: Box[] = [];
  reads = new Footprint();
  private laneCells = new Map<number, Lane[]>();
  private verticals = new Map<number, { top: number; bottom: number }[]>();
  add(points: readonly Point[], lane?: Lane, label?: Box): void {
    if (label) this.labels.push(label);
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
    this.reads.touch(bounds([a, b]));
    return (
      a.x !== b.x ||
      !(this.verticals.get(a.x) ?? []).some(
        (s) => Math.min(Math.max(a.y, b.y), s.bottom) - Math.max(Math.min(a.y, b.y), s.top) > 0.01,
      )
    );
  }
  verticalRange(p: Point, top: number, bottom: number): [number, number] {
    this.reads.touch({ id: '', left: p.x, right: p.x, top, bottom });
    for (const segment of this.verticals.get(p.x) ?? []) {
      if (p.y >= segment.bottom) top = Math.max(top, segment.bottom);
      else if (p.y <= segment.top) bottom = Math.min(bottom, segment.top);
      else return [p.y, p.y];
    }
    return [top, bottom];
  }
  laneFree(a: Point, b: Point, gap: number): boolean {
    if (!gap) return true;
    this.reads.touch(expand(bounds([a, b]), gap));
    for (let key = Math.floor((a.y - gap) / 24); key <= Math.floor((a.y + gap) / 24); key += 1)
      if (
        (this.laneCells.get(key) ?? []).some(
          (l) => Math.abs(a.y - l.y) < gap && overlaps(Math.min(a.x, b.x), Math.max(a.x, b.x), l),
        )
      )
        return false;
    return true;
  }
  nearbyLanes(region: Box): Lane[] {
    this.reads.touch(region, true);
    return this.lanes.filter(
      (l) => l.y >= region.top && l.y <= region.bottom && overlaps(region.left, region.right, l),
    );
  }
  nearbyLabels(region: Box): Box[] {
    this.reads.touch(region);
    return this.labels.filter((b) => overlapsBox(b, region));
  }
}
