import { useStore, type ReactFlowState } from '@xyflow/react';
import { useState } from 'react';
import {
  routeBackwardEdges,
  type RoutedEdge,
  type RoutingEdge,
  type RoutingNode,
} from './routing.js';

export const ROUTING_MEASURE = 'gg:backward-routing';

/**
 * A value key, not node-array identity: selection, validation, pan, zoom and unrelated renders
 * must not route the graph again. xyflow owns measured handle bounds and absolute drag positions.
 */
export function routingGeometryKey({ nodeLookup }: Pick<ReactFlowState, 'nodeLookup'>): string {
  const nodes: RoutingNode[] = [];
  for (const node of nodeLookup.values()) {
    const { width, height } = node.measured;
    const { handleBounds, positionAbsolute: position } = node.internals;
    if (!width || !height || !handleBounds) return '[]';
    const input = handleBounds.target?.find((handle) => handle.id === 'in');
    nodes.push({
      id: node.id,
      ...position,
      width,
      height,
      outputs: Object.fromEntries(
        (handleBounds.source ?? []).map(
          (handle) =>
            [
              handle.id ?? 'out',
              {
                x: position.x + handle.x + handle.width,
                y: position.y + handle.y + handle.height / 2,
              },
            ] as const,
        ),
      ),
      ...(input
        ? { input: { x: position.x + input.x, y: position.y + input.y + input.height / 2 } }
        : {}),
    });
  }
  return JSON.stringify(nodes);
}

/** One-entry cache per canvas; unchanged edge geometry also keeps its data object. */
export function createRoutingCache() {
  let previousKey = '';
  let previous: ReadonlyMap<string, RoutedEdge> = new Map();
  return (geometryKey: string, edgesKey: string): ReadonlyMap<string, RoutedEdge> => {
    const key = `${geometryKey}\n${edgesKey}`;
    if (key === previousKey) return previous;
    const nodes = JSON.parse(geometryKey) as RoutingNode[];
    const edges = JSON.parse(edgesKey) as RoutingEdge[];
    const start = performance.now();
    const routes = routeBackwardEdges(nodes, edges);
    // Keep the Performance timeline bounded; an observing spec receives every measurement.
    performance.clearMeasures(ROUTING_MEASURE);
    performance.measure(ROUTING_MEASURE, {
      start,
      end: performance.now(),
      detail: { nodes: nodes.length, edges: edges.length },
    });
    const next = new Map<string, RoutedEdge>();
    for (const [id, route] of routes) {
      const before = previous.get(id);
      next.set(id, before && JSON.stringify(before) === JSON.stringify(route) ? before : route);
    }
    previousKey = key;
    previous = next;
    return next;
  };
}

export function useRouting(edges: readonly RoutingEdge[]): ReadonlyMap<string, RoutedEdge> {
  const geometry = useStore(routingGeometryKey);
  const [route] = useState(createRoutingCache);
  return route(geometry, JSON.stringify(edges));
}
