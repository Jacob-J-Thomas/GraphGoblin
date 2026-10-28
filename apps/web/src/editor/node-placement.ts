import type { NodeInput } from '@graphgoblin/contracts';
import { canvasPorts } from './model.js';
import { NODE_CARD_SIZE, nodeCardHeight, type Point } from './routing-geometry.js';

/** Position a pressed palette entry below the existing cards. */
export function palettePosition(
  nodes: readonly NodeInput[],
  heights: ReadonlyMap<string, number> = new Map(),
): Point {
  let y = 40;
  for (const node of nodes) {
    // An earlier DOM measurement may precede a just-committed port-list growth.
    const height = Math.max(heights.get(node.id) ?? 0, nodeCardHeight(canvasPorts(node).length));
    y = Math.max(y, (node.ui?.y ?? 0) + height + NODE_CARD_SIZE.clearance);
  }
  return { x: 40, y };
}
