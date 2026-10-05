import { useStore, type ReactFlowState } from '@xyflow/react';
import { useState } from 'react';
import {
  createRoutingPlan,
  sameEdge,
  sameNode,
  SearchWorkspace,
  type RoutingEdge,
  type RoutingNode,
  type RoutingPlan,
} from './routing.js';

export const ROUTING_MEASURE = 'gg:backward-routing';
export interface RoutingGeometry {
  nodes: readonly RoutingNode[];
  preparationMs: number;
}

/** A stable value snapshot. An unmeasured new card cannot erase the measured graph. */
export function createGeometrySelector() {
  let previous: RoutingGeometry = { nodes: [], preparationMs: 0 };
  const measured = new Map<string, { node: RoutingNode; handles: unknown }>();
  return ({ nodeLookup }: Pick<ReactFlowState, 'nodeLookup'>): RoutingGeometry => {
    const start = performance.now();
    const nodes: RoutingNode[] = [];
    for (const node of nodeLookup.values()) {
      const { width, height } = node.measured;
      const { handleBounds, positionAbsolute: position } = node.internals;
      if (!width || !height || !handleBounds) continue;
      const cached = measured.get(node.id);
      if (
        cached &&
        cached.node.x === position.x &&
        cached.node.y === position.y &&
        cached.node.width === width &&
        cached.node.height === height &&
        cached.handles === handleBounds
      ) {
        nodes.push(cached.node);
        continue;
      }
      const input = handleBounds.target?.find((handle) => handle.id === 'in');
      const value: RoutingNode = {
        id: node.id,
        ...position,
        width,
        height,
        outputs: Object.fromEntries(
          (handleBounds.source ?? []).map((handle) => [
            handle.id ?? 'out',
            {
              x: position.x + handle.x + handle.width,
              y: position.y + handle.y + handle.height / 2,
            },
          ]),
        ),
        ...(input
          ? { input: { x: position.x + input.x, y: position.y + input.y + input.height / 2 } }
          : {}),
      };
      const before = cached?.node;
      const next = before && sameNode(before, value) ? before : value;
      measured.set(node.id, { node: next, handles: handleBounds });
      nodes.push(next);
    }
    if (measured.size > nodeLookup.size)
      for (const id of measured.keys()) if (!nodeLookup.has(id)) measured.delete(id);
    if (nodes.length === previous.nodes.length && nodes.every((n, i) => n === previous.nodes[i]))
      return previous;
    previous = { nodes, preparationMs: performance.now() - start };
    return previous;
  };
}

/** No JSON round-trip: snapshots and route objects retain their identity across irrelevant changes. */
export function createRoutingCache() {
  let previousGeometry: RoutingGeometry | undefined;
  let previous: RoutingPlan | undefined;
  const workspace = new SearchWorkspace();
  return (geometry: RoutingGeometry, edges: readonly RoutingEdge[]): RoutingPlan => {
    const start = performance.now();
    if (
      geometry === previousGeometry &&
      previous &&
      edges.length === previous.edges.length &&
      // Fixed (manual) routes are part of the key: a dragged segment re-plans the routes it affects.
      edges.every((e, i) => e.id === previous!.edges[i]!.id && sameEdge(e, previous!.edges[i]))
    )
      return previous;
    const preparationMs = geometry === previousGeometry ? 0 : geometry.preparationMs;
    const next = createRoutingPlan(geometry.nodes, edges, undefined, previous, workspace);
    previousGeometry = geometry;
    previous = next;
    // Includes geometry collection/comparison, cache checks, invalidation, routing and identity reuse.
    // Timing phases are summed, excluding time React spent scheduling between the selector and render.
    const duration = performance.now() - start + preparationMs;
    performance.clearMeasures(ROUTING_MEASURE);
    performance.measure(ROUTING_MEASURE, {
      start: Math.max(0, performance.now() - duration),
      duration,
      detail: {
        nodes: geometry.nodes.length,
        edges: edges.length,
        preparationMs,
        ...next.statistics,
      },
    });
    return next;
  };
}

export function useRouting(edges: readonly RoutingEdge[]): RoutingPlan {
  const [selector] = useState(createGeometrySelector);
  const geometry = useStore(selector);
  const [route] = useState(createRoutingCache);
  return route(geometry, edges);
}
