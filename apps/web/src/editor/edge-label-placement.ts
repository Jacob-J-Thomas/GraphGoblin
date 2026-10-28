import { distance, expand, type Box, type Point } from './routing-geometry.js';
import { LABEL_CHARACTER_WIDTH, LABEL_HEIGHT, LABEL_PADDING } from './routing-labels.js';

export interface EdgeLabelPath {
  id: string;
  text: string;
  points: readonly Point[];
  preferred: Point;
}
export interface EdgeLabelPosition {
  at: Point;
  box: Box;
  /** A short leader attaches the label if the edge has no interval large enough for it. */
  anchor?: Point;
}

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

/** Place labels together so they can reserve space on their own paths. */
export function placeEdgeLabels(
  paths: readonly EdgeLabelPath[],
  cards: readonly Box[] = [],
): Map<string, EdgeLabelPosition> {
  const placed = new Map<string, EdgeLabelPosition>();
  // IDs give stable priority when the definition's edge array is reordered.
  for (const path of [...paths].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!path.text) continue;
    const obstacles = [...cards, ...[...placed.values()].map((p) => p.box)].map((box) =>
      expand(box, 4),
    );
    const envelope = labelBox(path.id, path.text, { x: 0, y: 0 });
    let best: EdgeLabelPosition | undefined;
    for (let i = 1; i < path.points.length; i += 1) {
      const a = path.points[i - 1]!;
      const b = path.points[i]!;
      if ((a.x === b.x && a.y === b.y) || (a.x !== b.x && a.y !== b.y)) continue;
      const horizontal = a.y === b.y;
      const along = horizontal ? 'x' : 'y';
      const half = horizontal ? envelope.right : envelope.bottom;
      // Stay off the rounded corners (the canvas smoothstep uses radius 10).
      const startCorner = i === 1 ? 0 : 10;
      const endCorner = i === path.points.length - 1 ? 0 : 10;
      const forward = a[along] < b[along];
      const low = Math.min(a[along], b[along]) + half + (forward ? startCorner : endCorner);
      const high = Math.max(a[along], b[along]) - half - (forward ? endCorner : startCorner);
      if (low > high) continue;
      const blocked = obstacles
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
        const box = labelBox(path.id, path.text, at);
        if (!best || distance(at, path.preferred) < distance(best.at, path.preferred))
          best = { at, box };
      };
      let cursor = low;
      for (const [start, end] of blocked) {
        consider(cursor, Math.min(high, start - 1));
        cursor = Math.max(cursor, end + 1);
      }
      consider(cursor, high);
    }
    if (!best) {
      // A tiny or covered path cannot fit a pill. Keep all text, with an explicit leader to
      // its preferred point on the path; place above every occupied box in one bounded step.
      const y = Math.min(path.preferred.y, ...obstacles.map((box) => box.top)) - LABEL_HEIGHT - 4;
      const at = { x: path.preferred.x, y };
      const anchor = nearestPoint(path.points, path.preferred);
      best = { at, box: labelBox(path.id, path.text, at), ...(anchor ? { anchor } : {}) };
    }
    placed.set(path.id, best);
  }
  return placed;
}

function nearestPoint(points: readonly Point[], preferred: Point): Point | undefined {
  let best = points[0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.x !== b.x && a.y !== b.y) continue;
    const at = {
      x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), preferred.x)),
      y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), preferred.y)),
    };
    if (distance(at, preferred) < distance(best!, preferred)) best = at;
  }
  return best;
}
