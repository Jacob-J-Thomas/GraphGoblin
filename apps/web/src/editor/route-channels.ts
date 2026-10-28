import type { RoutedEdge } from './routing.js';
import type { EdgeLabelPosition } from './edge-label-placement.js';

export interface RouteChannel extends Record<string, unknown> {
  getSnapshot: () => RoutedEdge | undefined;
  getLabelSnapshot: () => EdgeLabelPosition | undefined;
  subscribe: (listener: () => void) => () => void;
}
interface Entry {
  channel: RouteChannel;
  route: RoutedEdge | undefined;
  label: EdgeLabelPosition | undefined;
  listeners: Set<() => void>;
}

/**
 * Geometry view channels, separate from both editor history and xyflow's connection index.
 * Moving a path updates its subscribers without making xyflow reindex every connection.
 */
export function createRouteChannels() {
  const entries = new Map<string, Entry>();
  return {
    edge(id: string, initial: RoutedEdge | undefined, label?: EdgeLabelPosition): RouteChannel {
      let entry = entries.get(id);
      if (!entry) {
        const listeners = new Set<() => void>();
        const created: Entry = {
          route: initial,
          label,
          listeners,
          channel: {
            getSnapshot: () => created.route,
            getLabelSnapshot: () => created.label,
            subscribe: (listener: () => void) => {
              listeners.add(listener);
              return () => {
                listeners.delete(listener);
              };
            },
          },
        };
        entries.set(id, created);
        entry = created;
      }
      return entry.channel;
    },
    publish(
      routes: ReadonlyMap<string, RoutedEdge>,
      activeIds: ReadonlySet<string>,
      labels: ReadonlyMap<string, EdgeLabelPosition> = new Map(),
    ): void {
      for (const [id, entry] of entries) {
        const route = routes.get(id);
        const label = labels.get(id);
        const before = entry.label;
        const sameLabel =
          label === before ||
          (!!label &&
            !!before &&
            label.at.x === before.at.x &&
            label.at.y === before.at.y &&
            label.box.left === before.box.left &&
            label.box.right === before.box.right &&
            label.box.top === before.box.top &&
            label.box.bottom === before.box.bottom &&
            label.anchor?.x === before.anchor?.x &&
            label.anchor?.y === before.anchor?.y &&
            label.attachment?.segment === before.attachment?.segment &&
            label.attachment?.fraction === before.attachment?.fraction &&
            label.attachment?.offset.x === before.attachment?.offset.x &&
            label.attachment?.offset.y === before.attachment?.offset.y);
        if (route !== entry.route || !sameLabel) {
          entry.route = route;
          entry.label = label;
          for (const listener of entry.listeners) listener();
        }
        if (!activeIds.has(id)) entries.delete(id);
      }
    },
  };
}
