/**
 * Stored definitions that predate ADR-0044. An exit could publish an Event (`destinations` entry
 * `{ kind: "event" }`); the current contract refuses that destination, but a definition saved
 * before the change can still hold one. Callers refuse such a definition before serving or
 * executing it, rather than dropping the destination silently.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The retired channel exactly as the earlier contract stored it: `{ kind: 'event', eventType }`. */
function isRetiredEventChannel(destination: unknown): boolean {
  return (
    isRecord(destination) &&
    destination['kind'] === 'event' &&
    typeof destination['eventType'] === 'string' &&
    Object.keys(destination).length === 2
  );
}

/**
 * A copy of the stored JSON without its retired Event destinations (in the shape the earlier
 * contract stored), for validation only: a store-level check uses it to tell a definition whose
 * only departure from the current contract is such a destination (refused per loop,
 * `LOOP_UPGRADE_REQUIRED`) from one in an unsupported format. Never written back: stored
 * definitions are not rewritten (ADR-0044).
 */
export function withoutRetiredEventDestinations(definition: unknown): unknown {
  if (!isRecord(definition) || !Array.isArray(definition['nodes'])) return definition;
  return {
    ...definition,
    nodes: definition['nodes'].map((node: unknown) => {
      if (!isRecord(node) || node['kind'] !== 'exit' || !isRecord(node['config'])) return node;
      const destinations = node['config']['destinations'];
      if (!Array.isArray(destinations)) return node;
      return {
        ...node,
        config: {
          ...node['config'],
          destinations: destinations.filter(
            (destination: unknown) => !isRetiredEventChannel(destination),
          ),
        },
      };
    }),
  };
}

/**
 * JSON Pointers to every exit destination that publishes an Event, in node then destination
 * order; empty for a current definition. Accepts the stored JSON as it is, whatever its shape.
 */
export function retiredEventDestinations(definition: unknown): string[] {
  const nodes = isRecord(definition) ? definition['nodes'] : undefined;
  if (!Array.isArray(nodes)) return [];
  const paths: string[] = [];
  nodes.forEach((node: unknown, nodeIndex) => {
    if (!isRecord(node) || node['kind'] !== 'exit' || !isRecord(node['config'])) return;
    const destinations = node['config']['destinations'];
    if (!Array.isArray(destinations)) return;
    destinations.forEach((destination: unknown, index) => {
      if (isRecord(destination) && destination['kind'] === 'event')
        paths.push(`/nodes/${nodeIndex}/config/destinations/${index}`);
    });
  });
  return paths;
}
