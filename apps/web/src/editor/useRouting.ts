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
  /** Source handle ids in DOM order; object keys reorder integer-like draft labels. */
  outputOrder: ReadonlyMap<string, readonly string[]>;
}

type ExpectedPorts = ReadonlyMap<string, { ports: readonly string[] }>;

/** A stable value snapshot. An unmeasured new card cannot erase the measured graph. */
export function createGeometrySelector() {
  let previous: RoutingGeometry = { nodes: [], preparationMs: 0, outputOrder: new Map() };
  const measured = new Map<
    string,
    { node: RoutingNode; handles: unknown; ports: readonly string[] }
  >();
  return ({ nodeLookup }: Pick<ReactFlowState, 'nodeLookup'>): RoutingGeometry => {
    const start = performance.now();
    const nodes: RoutingNode[] = [];
    const outputOrder = new Map<string, readonly string[]>();
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
        outputOrder.set(node.id, cached.ports);
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
      const ports = (handleBounds.source ?? []).map((handle) => handle.id ?? 'out');
      const order =
        cached &&
        ports.length === cached.ports.length &&
        ports.every((port, i) => port === cached.ports[i])
          ? cached.ports
          : ports;
      const next = before && sameNode(before, value) ? before : value;
      measured.set(node.id, { node: next, handles: handleBounds, ports: order });
      nodes.push(next);
      outputOrder.set(node.id, order);
    }
    if (measured.size > nodeLookup.size)
      for (const id of measured.keys()) if (!nodeLookup.has(id)) measured.delete(id);
    if (
      nodes.length === previous.nodes.length &&
      nodes.every(
        (n, i) =>
          n === previous.nodes[i] && outputOrder.get(n.id) === previous.outputOrder.get(n.id),
      )
    )
      return previous;
    previous = { nodes, preparationMs: performance.now() - start, outputOrder };
    return previous;
  };
}

/** No JSON round-trip: snapshots and route objects retain their identity across irrelevant changes. */
export function createRoutingCache() {
  let previousGeometry: RoutingGeometry | undefined;
  let previous: RoutingPlan | undefined;
  const workspace = new SearchWorkspace();
  return (
    geometry: RoutingGeometry,
    edges: readonly RoutingEdge[],
    expected?: ExpectedPorts,
  ): RoutingPlan => {
    const start = performance.now();
    // A config edit and xyflow's handle measurement arrive separately. Keep the previous plan
    // until the measured port ids/order match the committed cards, rather than remove/reinsert
    // a renamed edge's reservations and route its neighbours twice. Initial unmeasured cards
    // still follow the normal path below, so they never erase the measured graph.
    if (
      previous &&
      expected &&
      geometry.nodes.some((node) => {
        const card = expected.get(node.id);
        if (!card) return false;
        const ports = card.ports;
        const measured = geometry.outputOrder.get(node.id)!;
        return ports.length !== measured.length || ports.some((port, i) => port !== measured[i]);
      })
    )
      return previous;
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

export function useRouting(edges: readonly RoutingEdge[], expected?: ExpectedPorts): RoutingPlan {
  const [selector] = useState(createGeometrySelector);
  const geometry = useStore(selector);
  const [route] = useState(createRoutingCache);
  return route(geometry, edges, expected);
}
