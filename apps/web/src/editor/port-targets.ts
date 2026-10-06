import { BoxIndex, type Point } from './routing-geometry.js';
import type { RoutingNode } from './routing.js';

// The absolute hit box may grow to 44 / 0.5 px, but never changes the measured 12 px handle.
const MAX_WIDTH = 88.03125;
const HALF_PITCH = 23;

/** Geometry-only limits, independent of viewport zoom. Nearby cards share their gap safely. */
export function portWidthLimits(nodes: readonly RoutingNode[]) {
  const boxes = new BoxIndex(
    nodes.map((node) => ({
      id: node.id,
      left: node.x,
      right: node.x + node.width,
      top: node.y,
      bottom: node.y + node.height,
    })),
  );
  const width = (node: RoutingNode, center: Point, right: boolean) => {
    let limit = MAX_WIDTH;
    for (const box of boxes.query({
      id: node.id,
      left: right ? center.x : center.x - MAX_WIDTH * 2,
      right: right ? center.x + MAX_WIDTH * 2 : center.x,
      top: center.y - HALF_PITCH,
      bottom: center.y + HALF_PITCH,
    })) {
      if (box.id === node.id) continue;
      const gap = right ? box.left - (node.x + node.width) : node.x - box.right;
      limit = Math.min(limit, Math.max(0, gap / 2));
    }
    return limit;
  };
  return new Map(
    nodes.map((node) => [
      node.id,
      {
        input: node.input ? width(node, { ...node.input, x: node.input.x + 6 }, false) : undefined,
        outputs: Object.fromEntries(
          Object.entries(node.outputs).map(([port, tip]) => [
            port,
            width(node, { ...tip, x: tip.x - 6 }, true),
          ]),
        ),
      },
    ]),
  );
}
