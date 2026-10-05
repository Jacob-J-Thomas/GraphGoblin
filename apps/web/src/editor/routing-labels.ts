import {
  type Box,
  type BoxIndex,
  type Lane,
  type Point,
  type Reservations,
} from './routing-geometry.js';

// The 11 px code font fits within 7 px per character. Include padding, stroke and breathing room.
export const LABEL_HEIGHT = 22;
export const LABEL_CHARACTER_WIDTH = 7;
const LABEL_PADDING = 18;

export interface LabelPlacement {
  label: Point;
  labelWidth: number;
  labelBounds?: Box;
}

/** Choose a free interval on the straight lane, preferring full text and then its midpoint. */
export function placeLabel(
  lane: Lane,
  port: string,
  radius: number,
  index: BoxIndex,
  reservations: Reservations,
): LabelPlacement | undefined {
  const middle = (lane.left + lane.right) / 2;
  if (port === 'out') return { label: { x: middle, y: lane.y }, labelWidth: 0 };
  const region: Box = {
    id: '',
    left: lane.left + radius,
    right: lane.right - radius,
    top: lane.y - LABEL_HEIGHT / 2,
    bottom: lane.y + LABEL_HEIGHT / 2,
  };
  const occupied = [...reservations.nearbyLabels(region), ...index.query(region)].sort(
    (a, b) => a.left - b.left,
  );
  let left = region.left;
  let best: LabelPlacement | undefined;
  for (const obstacle of [...occupied, { ...region, left: region.right, right: region.right }]) {
    const right = Math.min(obstacle.left, region.right);
    const capacity = Math.min(
      port.length,
      Math.floor((right - left - LABEL_PADDING) / LABEL_CHARACTER_WIDTH),
    );
    if (capacity >= 1) {
      const labelWidth = capacity * LABEL_CHARACTER_WIDTH;
      const half = (labelWidth + LABEL_PADDING) / 2;
      const x = Math.max(left + half, Math.min(right - half, middle));
      if (
        !best ||
        labelWidth > best.labelWidth ||
        (labelWidth === best.labelWidth && Math.abs(x - middle) < Math.abs(best.label.x - middle))
      )
        best = {
          label: { x, y: lane.y },
          labelWidth,
          labelBounds: { ...region, left: x - half, right: x + half },
        };
    }
    left = Math.max(left, obstacle.right + 2);
  }
  return best;
}
