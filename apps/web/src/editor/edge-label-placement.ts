import {
  bounds,
  contains,
  distance,
  expand,
  intersectsBox,
  overlapsBox,
  type Box,
  type Point,
} from './routing-geometry.js';
import { LABEL_CHARACTER_WIDTH, LABEL_HEIGHT, LABEL_PADDING } from './routing-labels.js';

export interface EdgeLabelPath {
  id: string;
  text: string;
  points: readonly Point[];
  preferred: Point;
  /** Routed labels already have reserved space and shortened text. */
  fixed?: boolean;
}
export interface EdgeLabelPosition {
  at: Point;
  box: Box;
  /** A bounded, card-free leader when no straight interval can hold the pill. */
  anchor?: Point;
  /** Follow the same fraction of this segment while its endpoints move. */
  attachment?: { segment: number; fraction: number; offset: Point };
}
export const LABEL_CALLOUT_REACH = 96;

export function labelBox(id: string, text: string, at: Point): Box {
  const half = (text.length * LABEL_CHARACTER_WIDTH + LABEL_PADDING) / 2;
  return {
    id,
    left: at.x - half,
    right: at.x + half,
    top: at.y - LABEL_HEIGHT / 2,
    bottom: at.y + LABEL_HEIGHT / 2,
  };
}

/** Expanded once, indexed once. Labels join the same grid as they reserve their space. */
class Obstacles {
  private cells = new Map<string, Box[]>();
  constructor(boxes: readonly Box[]) {
    for (const box of boxes) this.add(box);
  }
  private visit(box: Box, visit: (key: string) => void) {
    for (let x = Math.floor(box.left / 256); x <= Math.floor(box.right / 256); x += 1)
      for (let y = Math.floor(box.top / 256); y <= Math.floor(box.bottom / 256); y += 1)
        visit(`${x},${y}`);
  }
  add(box: Box) {
    this.visit(box, (key) => {
      const cell = this.cells.get(key);
      if (cell) cell.push(box);
      else this.cells.set(key, [box]);
    });
  }
  query(box: Box): Box[] {
    const found = new Set<Box>();
    this.visit(box, (key) => {
      for (const candidate of this.cells.get(key) ?? [])
        if (overlapsBox(box, candidate)) found.add(candidate);
    });
    return [...found];
  }
}

/** Place only on settlement, leaving xyflow's default position alone when it is clear. */
export function placeEdgeLabels(
  paths: readonly EdgeLabelPath[],
  cards: readonly Box[] = [],
): Map<string, EdgeLabelPosition> {
  const placed = new Map<string, EdgeLabelPosition>();
  const obstacles = new Obstacles(cards.map((box) => expand(box, 4)));
  const leaders = new Obstacles(cards.map((box) => expand(box, 1)));
  const lanes = new Obstacles(
    paths.flatMap((path) =>
      path.points.slice(1).map((p, i) => ({
        ...expand(bounds([path.points[i]!, p]), 2),
        id: path.id,
      })),
    ),
  );
  // Router reservations first, then stable id priority for forward labels.
  for (const path of [...paths].sort(
    (a, b) => Number(!!b.fixed) - Number(!!a.fixed) || a.id.localeCompare(b.id),
  )) {
    if (!path.text) continue;
    const envelope = labelBox(path.id, path.text, { x: 0, y: 0 });
    const preferredBox = labelBox(path.id, path.text, path.preferred);
    let best: EdgeLabelPosition | undefined;
    // A short jog or a rounded corner alone is not a reason to move xyflow's label.
    if (
      path.fixed ||
      (!obstacles.query(preferredBox).length &&
        !lanes.query(preferredBox).some((lane) => lane.id !== path.id))
    )
      best = { at: path.preferred, box: preferredBox };
    else
      for (let i = 1; i < path.points.length; i += 1) {
        const a = path.points[i - 1]!;
        const b = path.points[i]!;
        if ((a.x === b.x && a.y === b.y) || (a.x !== b.x && a.y !== b.y)) continue;
        const horizontal = a.y === b.y;
        const along = horizontal ? 'x' : 'y';
        const half = horizontal ? envelope.right : envelope.bottom;
        const startCorner = i === 1 ? 0 : 10;
        const endCorner = i === path.points.length - 1 ? 0 : 10;
        const forward = a[along] < b[along];
        const low = Math.min(a[along], b[along]) + half + (forward ? startCorner : endCorner);
        const high = Math.max(a[along], b[along]) - half - (forward ? endCorner : startCorner);
        if (low > high) continue;
        const region = expand(bounds([a, b]), Math.max(envelope.right, envelope.bottom));
        const blocked = [
          ...obstacles.query(region),
          ...lanes.query(region).filter((lane) => lane.id !== path.id),
        ]
          .filter((box) =>
            horizontal
              ? a.y + envelope.bottom >= box.top && a.y - envelope.bottom <= box.bottom
              : a.x + envelope.right >= box.left && a.x - envelope.right <= box.right,
          )
          .map((box) =>
            horizontal
              ? ([box.left - half, box.right + half] as const)
              : ([box.top - half, box.bottom + half] as const),
          )
          .sort((p, q) => p[0] - q[0]);
        const consider = (start: number, end: number) => {
          if (start > end) return;
          const value = Math.max(start, Math.min(end, path.preferred[along]));
          const at = horizontal ? { x: value, y: a.y } : { x: a.x, y: value };
          if (!best || distance(at, path.preferred) < distance(best.at, path.preferred))
            best = { at, box: labelBox(path.id, path.text, at) };
        };
        let cursor = low;
        for (const [start, end] of blocked) {
          consider(cursor, Math.min(high, start - 1));
          cursor = Math.max(cursor, end + 1);
        }
        consider(cursor, high);
      }
    best ??= callout(path, obstacles, leaders, lanes);
    // No legal callout (e.g. the entire path is inside a card): keep the normal label rather
    // than drawing a misleading leader through a card or escaping to another part of the graph.
    best ??= { at: path.preferred, box: preferredBox };
    placed.set(path.id, best);
    obstacles.add(expand(best.box, 4));
  }
  return placed;
}

function callout(
  path: EdgeLabelPath,
  obstacles: Obstacles,
  cards: Obstacles,
  lanes: Obstacles,
): EdgeLabelPosition | undefined {
  let best: EdgeLabelPosition | undefined;
  let cost = Infinity;
  for (let i = 1; i < path.points.length; i += 1) {
    const a = path.points[i - 1]!;
    const b = path.points[i]!;
    if (a.x !== b.x && a.y !== b.y) continue;
    const near = {
      x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), path.preferred.x)),
      y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), path.preferred.y)),
    };
    for (const anchor of [near, a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]) {
      if (cards.query(bounds([anchor])).some((box) => contains(box, anchor))) continue;
      // A finite local search: the nearest free candidate wins; every leader is axis-aligned.
      for (let offset = 16; offset <= LABEL_CALLOUT_REACH; offset += 4) {
        for (const [dx, dy] of [
          [0, offset],
          [0, -offset],
          [offset, 0],
          [-offset, 0],
        ] as const) {
          const at = { x: anchor.x + dx, y: anchor.y + dy };
          const score = offset + distance(anchor, path.preferred);
          if (score >= cost) continue;
          const box = labelBox(path.id, path.text, at);
          if (obstacles.query(box).length || lanes.query(box).some((lane) => lane.id !== path.id))
            continue;
          if (cards.query(bounds([anchor, at])).some((card) => intersectsBox(anchor, at, card)))
            continue;
          cost = score;
          best = { at, box, anchor };
        }
      }
    }
  }
  return best;
}

/** A moved label follows its own edge during a drag; solving neighbours waits for release. */
export function followEdgeLabel(
  position: EdgeLabelPosition,
  points: readonly Point[],
): EdgeLabelPosition {
  const attachment = position.attachment;
  if (!attachment) return position;
  const a = points[attachment.segment];
  const b = points[attachment.segment + 1];
  if (!a || !b) return position;
  const anchor = {
    x: a.x + (b.x - a.x) * attachment.fraction,
    y: a.y + (b.y - a.y) * attachment.fraction,
  };
  const at = { x: anchor.x + attachment.offset.x, y: anchor.y + attachment.offset.y };
  const dx = at.x - position.at.x,
    dy = at.y - position.at.y;
  return {
    ...position,
    at,
    box: {
      ...position.box,
      left: position.box.left + dx,
      right: position.box.right + dx,
      top: position.box.top + dy,
      bottom: position.box.bottom + dy,
    },
    ...(position.anchor ? { anchor } : {}),
  };
}

/** Lazy preparation is essential: no card/edge collection, expansion or search on drag frames. */
export function createLabelPlacementCache() {
  let previous = new Map<string, EdgeLabelPosition>();
  return (
    moving: boolean,
    prepare: () => { paths: readonly EdgeLabelPath[]; cards: readonly Box[] },
  ) => {
    if (moving) return previous;
    const { paths, cards } = prepare();
    const placements = placeEdgeLabels(paths, cards);
    previous = new Map();
    for (const path of paths) {
      const position = placements.get(path.id);
      if (
        !position ||
        path.fixed ||
        (position.at.x === path.preferred.x && position.at.y === path.preferred.y)
      )
        continue;
      const target = position.anchor ?? position.at;
      let segment = -1,
        fraction = 0,
        nearest = Infinity;
      for (let i = 1; i < path.points.length; i += 1) {
        const a = path.points[i - 1]!,
          b = path.points[i]!;
        const length = distance(a, b);
        if (!length || (a.x !== b.x && a.y !== b.y)) continue;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((target.x - a.x) * (b.x - a.x) + (target.y - a.y) * (b.y - a.y)) / (length * length),
          ),
        );
        const projected = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const d = distance(projected, target);
        if (d < nearest) {
          nearest = d;
          segment = i - 1;
          fraction = t;
        }
      }
      const a = path.points[segment],
        b = path.points[segment + 1];
      if (a && b) {
        const anchor = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
        position.attachment = {
          segment,
          fraction,
          offset: { x: position.at.x - anchor.x, y: position.at.y - anchor.y },
        };
      }
      previous.set(path.id, position);
    }
    return previous;
  };
}
