import { DecisionConfigSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import type { FormChange } from '../forms/changes.js';

interface RouteRow {
  key: number;
  label: string | undefined;
  edgeIds: readonly string[];
}
interface RouteRows {
  nextKey: number;
  rows: readonly RouteRow[];
}
/** Editor-only row ownership; restored with the definition by undo/redo, never saved in config. */
export type DecisionRoutes = Readonly<Record<string, RouteRows>>;
const labelSchema = DecisionConfigSchema.shape.routes.element.shape.label;

function labels(config: unknown): (string | undefined)[] | undefined {
  const routes = (config as { routes?: unknown } | null)?.routes;
  if (!Array.isArray(routes)) return undefined;
  return routes.map((route: unknown) => {
    const label = (route as { label?: unknown } | null)?.label;
    return typeof label === 'string' ? label : undefined;
  });
}
function sameRows(a: RouteRows, b: RouteRows): boolean {
  return (
    a.nextKey === b.nextKey &&
    a.rows.length === b.rows.length &&
    a.rows.every((row, i) => {
      const next = b.rows[i]!;
      return (
        row.key === next.key &&
        row.label === next.label &&
        row.edgeIds.length === next.edgeIds.length &&
        row.edgeIds.every((id, j) => id === next.edgeIds[j])
      );
    })
  );
}

/** Reconcile immutable row ownership and edges as one editor/history edit. */
export function decisionRouteEdges(
  definition: LoopDefinitionInput,
  previous: DecisionRoutes,
  change?: FormChange,
  renamed?: { from: string; to: string },
): { definition: LoopDefinitionInput; decisionRoutes: DecisionRoutes } {
  const decisionRoutes: Record<string, RouteRows> = {};
  const removed = new Set<string>();
  const ports = new Map<string, string>();
  for (const node of definition.nodes) {
    if (node.kind !== 'decision') continue;
    const oldId = renamed?.to === node.id ? renamed.from : node.id;
    const before = (Object.hasOwn(previous, oldId) ? previous[oldId] : undefined) ?? {
      nextKey: 0,
      rows: [],
    };
    const after = labels(node.config);
    let nextKey = before.nextKey;
    let rows = before.rows;
    if (after) {
      let retained = [...before.rows];
      // The form describes removal by index, so even two identical blank rows stay distinct.
      if (
        change?.path === 'routes' &&
        change.collection?.type === 'remove' &&
        after.length === before.rows.length - 1
      ) {
        retained.splice(change.collection.index, 1);
      } else if (
        after.length < before.rows.length ||
        (after.length === before.rows.length &&
          new Set(after).size === after.length &&
          after.every((label) => before.rows.some((row) => row.label === label)))
      ) {
        // Complete-list replacements preserve existing labels through reorder/removal.
        const available = [...before.rows];
        retained = after.flatMap((label) => {
          const index = available.findIndex((row) => row.label === label);
          return index < 0 ? [] : available.splice(index, 1);
        });
      }
      rows = after.map((label, i) => ({
        ...(retained[i] ?? { key: nextKey++, edgeIds: [] }),
        label,
      }));
      const kept = new Set(rows.map((row) => row.key));
      for (const row of before.rows)
        if (!kept.has(row.key)) for (const id of row.edgeIds) removed.add(id);
    }
    const outgoing = definition.edges.filter((edge) => edge.from.node === node.id);
    const claimed = new Set(before.rows.flatMap((row) => row.edgeIds));
    rows = rows.map((row) => {
      const unique = rows.filter((other) => other.label === row.label).length === 1;
      const valid = labelSchema.safeParse(row.label).success && unique;
      // Newly connected edges acquire the row's ownership. Already owned edges never move to
      // another row, even when their last valid port matches that row's temporary input.
      const edgeIds = outgoing
        .filter(
          (edge) =>
            row.edgeIds.includes(edge.id) ||
            (unique && !claimed.has(edge.id) && edge.from.port === row.label),
        )
        .map((edge) => edge.id);
      if (valid) for (const id of edgeIds) ports.set(id, row.label!);
      return { ...row, edgeIds };
    });
    const next = { nextKey, rows };
    decisionRoutes[node.id] = sameRows(before, next) ? before : next;
  }
  const edges = definition.edges.flatMap((edge) => {
    if (removed.has(edge.id)) return [];
    const port = ports.get(edge.id);
    return [
      port !== undefined && port !== edge.from.port
        ? { ...edge, from: { ...edge.from, port } }
        : edge,
    ];
  });
  const unchangedEdges =
    edges.length === definition.edges.length &&
    edges.every((edge, i) => edge === definition.edges[i]);
  const unchangedRows =
    Object.keys(previous).length === Object.keys(decisionRoutes).length &&
    Object.entries(decisionRoutes).every(([id, rows]) => rows === previous[id]);
  return {
    definition: unchangedEdges ? definition : { ...definition, edges },
    decisionRoutes: unchangedRows ? previous : decisionRoutes,
  };
}
