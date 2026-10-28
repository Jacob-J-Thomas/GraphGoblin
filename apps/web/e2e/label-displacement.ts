/** Node diagnostic for the production label solver on the repository's dense fixtures. */
import { writeFile } from 'node:fs/promises';
import { getSmoothStepPath, Position } from '@xyflow/react';
import { denseGraph, routingInput } from '../src/__fixtures__/routing.js';
import { edgeLabelText } from '../src/editor/edge-label-text.js';
import {
  labelBox,
  placeEdgeLabels,
  type EdgeLabelPath,
} from '../src/editor/edge-label-placement.js';
import { forwardPoints } from '../src/editor/manual-route.js';
import { bounds, expand, overlapsBox } from '../src/editor/routing-geometry.js';
import { createRoutingPlan } from '../src/editor/routing.js';

const rows = [100, 300].map((count) => {
  const { nodes, edges } = routingInput(denseGraph(count));
  const plan = createRoutingPlan(nodes, edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const paths: EdgeLabelPath[] = edges.flatMap((edge) => {
    const from = byId.get(edge.source)?.outputs[edge.port],
      to = byId.get(edge.target)?.input;
    if (!from || !to) return [];
    const route = plan.routes.get(edge.id);
    const [, x, y] = getSmoothStepPath({
      sourceX: from.x,
      sourceY: from.y,
      targetX: to.x,
      targetY: to.y,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      borderRadius: 10,
    });
    return [
      {
        id: edge.id,
        text: edgeLabelText(edge.port === 'out' ? '' : edge.port, route).visible,
        points: route?.points ?? forwardPoints(from, to),
        preferred: route?.label ?? { x, y },
        fixed: !!route,
      },
    ];
  });
  const cards = nodes.map((node) => ({
    id: node.id,
    left: node.x,
    right: node.x + node.width,
    top: node.y,
    bottom: node.y + node.height,
  }));
  const placed = placeEdgeLabels(paths, cards);
  const forward = paths.filter((path) => path.text && !path.fixed);
  const moved = forward.filter((path) => {
    const position = placed.get(path.id)!;
    return position.at.x !== path.preferred.x || position.at.y !== path.preferred.y;
  });
  // Counts can overlap: a default pill can touch more than one kind of obstacle.
  const collisions = { card: 0, earlierLabel: 0, otherSegment: 0, unexplained: 0 };
  for (const path of moved) {
    const box = labelBox(path.id, path.text, path.preferred);
    const card = cards.some((card) => overlapsBox(box, expand(card, 4)));
    const label = paths.some(
      (other) =>
        other.text &&
        other.id !== path.id &&
        (other.fixed || other.id.localeCompare(path.id) < 0) &&
        overlapsBox(box, expand(placed.get(other.id)!.box, 4)),
    );
    const segment = paths.some(
      (other) =>
        other.id !== path.id &&
        other.points
          .slice(1)
          .some((p, i) => overlapsBox(box, expand(bounds([other.points[i]!, p]), 2))),
    );
    if (card) collisions.card += 1;
    if (label) collisions.earlierLabel += 1;
    if (segment) collisions.otherSegment += 1;
    if (!card && !label && !segment) collisions.unexplained += 1;
  }
  return {
    nodes: count,
    edges: edges.length,
    forwardLabels: forward.length,
    moved: moved.length,
    retained: forward.length - moved.length,
    collisions,
  };
});
const json = JSON.stringify({ node: process.version, rows }, null, 2) + '\n';
if (process.argv[2]) await writeFile(process.argv[2], json);
console.log(json);
