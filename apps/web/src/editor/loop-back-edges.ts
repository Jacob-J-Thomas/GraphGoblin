import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { canvasPorts } from './model.js';

/**
 * Connections whose destination must already have been visited when their source is reached.
 * Every authored trigger is an entry, including an unarmed schedule or poller. A destination
 * dominates a reachable source exactly when removing it makes that source unreachable from
 * all entries. This identifies natural back edges without marking every edge in a cycle.
 * Detached components have no known entry; only their valid self-loops give the guarantee.
 *
 * Work is O(V * (V + E)) with O(V + E) storage, bounded by the editor's 500 nodes/2000 edges.
 * Callers should memoise on authored nodes/edges, independently of measured canvas geometry.
 */
export function loopBackEdgeIds(
  definition: Pick<LoopDefinitionInput, 'nodes' | 'edges'>,
): ReadonlySet<string> {
  const nodes = new Map<string, NodeInput>();
  const duplicateNodes = new Set<string>();
  for (const node of definition.nodes) {
    if (nodes.has(node.id)) duplicateNodes.add(node.id);
    nodes.set(node.id, node);
  }
  // An invalid draft must not combine two different nodes into an invented execution path.
  for (const id of duplicateNodes) nodes.delete(id);

  const ports = new Map([...nodes].map(([id, node]) => [id, new Set(canvasPorts(node))]));
  const edgeCounts = new Map<string, number>();
  for (const edge of definition.edges) edgeCounts.set(edge.id, (edgeCounts.get(edge.id) ?? 0) + 1);
  const edges = definition.edges.filter((edge) => {
    const from = nodes.get(edge.from.node);
    const to = nodes.get(edge.to.node);
    return (
      edgeCounts.get(edge.id) === 1 &&
      from !== undefined &&
      to !== undefined &&
      to.kind !== 'trigger' &&
      ports.get(from.id)!.has(edge.from.port)
    );
  });
  const entries = [...nodes.values()].filter((node) => node.kind === 'trigger').map((n) => n.id);
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const destinations = outgoing.get(edge.from.node);
    if (destinations) destinations.push(edge.to.node);
    else outgoing.set(edge.from.node, [edge.to.node]);
  }
  const reachableWithout = (omitted?: string): Set<string> => {
    const reached = new Set<string>();
    const pending = [...entries];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (id === omitted || reached.has(id)) continue;
      reached.add(id);
      for (const destination of outgoing.get(id) ?? []) pending.push(destination);
    }
    return reached;
  };

  const reachable = reachableWithout();
  const result = new Set<string>();
  const byDestination = new Map<string, typeof edges>();
  for (const edge of edges) {
    if (edge.from.node === edge.to.node) {
      result.add(edge.id);
    } else if (reachable.has(edge.from.node)) {
      const incoming = byDestination.get(edge.to.node);
      if (incoming) incoming.push(edge);
      else byDestination.set(edge.to.node, [edge]);
    }
  }
  for (const [destination, incoming] of byDestination) {
    const withoutDestination = reachableWithout(destination);
    for (const edge of incoming) if (!withoutDestination.has(edge.from.node)) result.add(edge.id);
  }
  return result;
}
