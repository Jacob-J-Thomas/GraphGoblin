import {
  DecisionConfigSchema,
  type LoopDefinitionInput,
  type NodeInput,
} from '@graphgoblin/contracts';

type Edges = LoopDefinitionInput['edges'];

function labels(config: unknown): (string | undefined)[] | undefined {
  const routes = (config as { routes?: unknown } | null)?.routes;
  if (!Array.isArray(routes)) return undefined;
  return routes.map((route: unknown) => {
    const label = (route as { label?: unknown } | null)?.label;
    return typeof label === 'string' ? label : undefined;
  });
}

/** Keep connections with their decision routes, as part of the config edit's history snapshot. */
export function decisionRouteEdges(node: NodeInput, config: unknown, edges: Edges): Edges {
  if (node.kind !== 'decision') return edges;
  const before = labels(node.config);
  const after = labels(config);
  if (!before || !after) return edges;
  if (before.length === after.length && before.every((label, i) => label === after[i]))
    return edges;
  const unique = (list: typeof before, label: string | undefined) =>
    list.filter((value) => value === label).length === 1;
  const renamed = new Map<string, string>();
  if (before.length === after.length) {
    before.forEach((label, index) => {
      const next = after[index];
      if (
        label === next ||
        typeof next !== 'string' ||
        !DecisionConfigSchema.shape.routes.element.shape.label.safeParse(next).success ||
        !unique(after, next) ||
        before.includes(next)
      )
        return;
      // Reordering preserves labels and their edges. A rename changes one row's unique label.
      if (
        label &&
        unique(before, label) &&
        DecisionConfigSchema.shape.routes.element.shape.label.safeParse(label).success
      ) {
        if (!after.includes(label)) renamed.set(label, next);
      } else {
        // Raw invalid input stays in the draft and blocks publishing. Its edge keeps the last
        // valid port; completing an invalid row can recover one unambiguous connection.
        const orphaned = edges.filter(
          (edge) =>
            edge.from.node === node.id &&
            !before.includes(edge.from.port) &&
            !after.includes(edge.from.port),
        );
        const unresolved = before.filter(
          (port) =>
            !unique(before, port) ||
            !DecisionConfigSchema.shape.routes.element.shape.label.safeParse(port).success,
        );
        // Two incomplete rows, or a collision between rows, cannot identify which row owns the
        // missing port. Keep those connections intact rather than assign one to the wrong row.
        if (orphaned.length === 1 && unresolved.length === 1)
          renamed.set(orphaned[0]!.from.port, next);
      }
    });
  }
  const result = edges.flatMap((edge) => {
    if (edge.from.node !== node.id) return [edge];
    if (
      after.length < before.length &&
      before.includes(edge.from.port) &&
      !after.includes(edge.from.port)
    )
      return [];
    const port = renamed.get(edge.from.port);
    return [port ? { ...edge, from: { ...edge.from, port } } : edge];
  });
  return result.length === edges.length && result.every((edge, i) => edge === edges[i])
    ? edges
    : result;
}
