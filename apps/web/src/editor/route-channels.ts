import type { RoutedEdge } from './routing.js';

export interface RouteChannel extends Record<string, unknown> {
  getSnapshot: () => RoutedEdge | undefined;
  subscribe: (listener: () => void) => () => void;
}
interface Entry {
  channel: RouteChannel;
  route: RoutedEdge | undefined;
  listeners: Set<() => void>;
}

/**
 * Geometry view channels, separate from both editor history and xyflow's connection index.
 * Moving a path updates its subscribers without making xyflow reindex every connection.
 */
export function createRouteChannels() {
  const entries = new Map<string, Entry>();
  return {
    edge(id: string, initial: RoutedEdge | undefined): RouteChannel {
      let entry = entries.get(id);
      if (!entry) {
        const listeners = new Set<() => void>();
        const created: Entry = {
          route: initial,
          listeners,
          channel: {
            getSnapshot: () => created.route,
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
    publish(routes: ReadonlyMap<string, RoutedEdge>, activeIds: ReadonlySet<string>): void {
      for (const [id, entry] of entries) {
        const route = routes.get(id);
        if (route !== entry.route) {
          entry.route = route;
          for (const listener of entry.listeners) listener();
        }
        if (!activeIds.has(id)) entries.delete(id);
      }
    },
  };
}
