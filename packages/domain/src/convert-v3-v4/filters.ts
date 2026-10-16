import jsonata from 'jsonata';
import {
  ExpressionSchema,
  LoopDefinitionSchema,
  type LoopDefinition,
  type V3LoopDefinition,
} from '@graphgoblin/contracts';
import { checkExpression } from '../expression.js';
import { type DefinitionReview, problem } from './review.js';

type Obj = Record<string, unknown>;
type Fragment = Pick<LoopDefinition, 'nodes' | 'edges'>;

/** The plan's once-only wrapper, completed for infinities: $type throws on +/-Infinity even
 * though JSONata arithmetic can return them and evaluatePredicate accepts them.
 */
export function filterRouteExpression(source: string): string {
  return `(
    $v := $eval(${JSON.stringify(source)}, invocation.trigger.payload);
    $infinite := $v = (1/0) or $v = (-1/0);
    $t := $infinite ? 'number' : $type($v);
    $truth := $exists($v) and (
      $t = 'array' ? $count($v) > 0 :
      $t = 'object' ? $count($keys($v)) > 0 :
      $t = 'string' ? $length($v) > 0 :
      $t = 'number' ? ($v != 0 and $v = $v) :
      $t = 'boolean' ? $v :
      $t = 'function' ? true : false
    );
    $truth ? 'pass' : 'ignore'
  )`;
}

const deterministic = new Set(
  (
    'abs floor ceil round power sqrt formatNumber formatBase number sum min max average count ' +
    'string length substring substringBefore substringAfter lowercase uppercase trim pad split join ' +
    'match contains replace base64encode base64decode encodeUrlComponent encodeUrl decodeUrlComponent ' +
    'decodeUrl boolean not exists append sort reverse distinct zip keys lookup spread merge ' +
    'type assert error map filter single reduce sift each clone toMillis fromMillis'
  ).split(' '),
);

/** Only payload reads and lexically bound/deterministic functions have a generated proposal.
 * $$ retains the outer evaluation root inside $eval, so it needs an authored replacement too.
 */
export function filterNeedsReplacement(source: string): boolean {
  const inspect = (value: unknown, scope: Set<string>): boolean => {
    if (Array.isArray(value)) return value.some((entry) => inspect(entry, scope));
    if (!value || typeof value !== 'object') return false;
    const node = value as Obj;
    if (node.type === 'variable') {
      const name = String(node.value);
      return name !== '' && !scope.has(name) && !deterministic.has(name);
    }
    if (node.type === 'block' && Array.isArray(node.expressions)) {
      const local = new Set(scope);
      for (const entry of node.expressions as Obj[]) {
        if (entry.type === 'bind') {
          if (inspect(entry.rhs, local)) return true;
          local.add(String((entry.lhs as Obj).value));
        } else if (inspect(entry, local)) return true;
      }
      return false;
    }
    if (node.type === 'lambda') {
      const local = new Set(scope);
      for (const arg of node.arguments as Obj[]) local.add(String(arg.value));
      return inspect(node.body, local);
    }
    return Object.values(node).some((entry) => inspect(entry, scope));
  };
  return inspect(jsonata(source).ast(), new Set());
}

/** Bounded deterministic Slug allocation; source and already converted identities stay reserved. */
export function filterId(used: Set<string>, base: string): string | null {
  // At most 500 nodes + 2,000 edges exist; 2,501 candidates cannot all be occupied.
  for (let index = 0; index <= 2500; index++) {
    const suffix = index ? `-${index + 1}` : '';
    const id = base.slice(0, 64 - suffix.length) + suffix;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  return null;
}

export async function convertTriggerFilters(
  source: V3LoopDefinition,
  nodes: Obj[],
  edges: LoopDefinition['edges'],
  review: DefinitionReview,
  versionId: string | undefined,
): Promise<void> {
  const used = new Set([
    ...source.nodes.map((node) => node.id),
    ...source.edges.map((edge) => edge.id),
    ...nodes.map((node) => String(node.id)),
    ...edges.map((edge) => edge.id),
  ]);
  for (const [index, trigger] of source.nodes.entries()) {
    if (trigger.kind !== 'trigger' || !('filter' in trigger.config)) continue;
    const filter = trigger.config.filter;
    if (filter === undefined) continue;
    const path = `/nodes/${index}/config/filter`;
    const outgoing = edges.filter((edge) => edge.from.node === trigger.id);
    const old = outgoing[0];
    const invalidTopology =
      outgoing.length !== 1 ||
      old?.from.port !== 'out' ||
      !nodes.some((node) => node.id === old.to.node);
    const jsonata = filterRouteExpression(filter);
    const unavailable = filterNeedsReplacement(filter);
    let proposal: Fragment | null = null;
    let refusal: string | null = invalidTopology
      ? 'A filtered trigger needs exactly one unambiguous out edge to an existing destination.'
      : null;
    if (!unavailable && !refusal) {
      const ids = ['check', 'restore', 'quiet-exit', 'check-edge', 'pass-edge', 'ignore-edge'].map(
        (part) => filterId(used, `${trigger.id}-${part}`),
      );
      if (ids.some((id) => id === null)) refusal = 'Generated Slug identities are exhausted.';
      else if (!ExpressionSchema.safeParse(jsonata).success || checkExpression(jsonata))
        refusal = 'The guarded predicate wrapper exceeds Expression bounds or fails validation.';
      else {
        const [check, restore, quiet, intake, pass, ignore] = ids as string[];
        const { ui: _route, ...successor } = old!;
        proposal = {
          nodes: [
            {
              id: check!,
              kind: 'decision',
              label: 'Payload check',
              ui: { x: trigger.ui.x + 360, y: trigger.ui.y },
              config: {
                kind: 'expression',
                jsonata,
                routes: [
                  { id: 'pass', label: 'Continue' },
                  { id: 'ignore', label: 'Ignore' },
                ],
              },
            },
            {
              id: restore!,
              kind: 'mutate',
              label: 'Restore trigger output',
              ui: { x: trigger.ui.x + 720, y: trigger.ui.y },
              config: {
                operations: [
                  {
                    op: 'set',
                    path: '/lastOutput',
                    value: {
                      kind: 'expression',
                      jsonata: `$lookup(outputs, ${JSON.stringify(trigger.id)})`,
                    },
                  },
                ],
              },
            },
            {
              id: quiet!,
              kind: 'exit',
              label: 'Quiet exit',
              ui: { x: trigger.ui.x + 720, y: trigger.ui.y + 220 },
              config: { outcome: 'success', returns: 'none', destinations: [] },
            },
          ],
          edges: [
            { ...successor, from: { node: restore!, port: 'out' } },
            {
              id: intake!,
              from: { node: trigger.id, port: 'out' },
              to: { node: check!, port: 'in' },
            },
            { id: pass!, from: { node: check!, port: 'pass' }, to: { node: restore!, port: 'in' } },
            {
              id: ignore!,
              from: { node: check!, port: 'ignore' },
              to: { node: quiet!, port: 'in' },
            },
          ],
        };
      }
    }
    const fragment = await review.change(
      trigger.id,
      path,
      'trigger-filter',
      { versionId: versionId ?? null, source: filter, outgoing },
      proposal,
      'Formerly ignored input now creates a quiet run. Expression errors happen after acknowledgement, inside the admitted run. Keys can be consumed before the downstream check. Extra visits count against maxNodeVisits. ' +
        (old?.ui ? `Invalidated manual route on edge ${old.id} is cleared. ` : '') +
        (unavailable
          ? 'Headers, clock, randomness, dynamic sources or unavailable context require a supplied replacement graph. '
          : '') +
        (refusal ??
          'Approve this exact graph, supply a valid replacement fragment, or remove the filter with an explicit broader-behaviour reason.'),
      true,
      true,
      proposal === null,
      true,
    );
    if (typeof versionId !== 'string' || !versionId.trim())
      review.issues.push(
        problem('V4_FILTER_VERSION_REQUIRED', path, 'Bind filter review to the stored version id.'),
      );
    if (refusal) {
      review.issues.push(problem('V4_FILTER_REFUSED', path, refusal));
      continue;
    }
    const item = review.items.at(-1)!;
    if (fragment === null) {
      if (item.status !== 'resolved')
        review.issues.push(
          problem(
            'V4_FILTER_REPLACEMENT_REQUIRED',
            path,
            'Supply a reviewed graph replacement or explicit removal.',
          ),
        );
      continue;
    }
    const parsed = LoopDefinitionSchema.pick({ nodes: true, edges: true }).safeParse(fragment);
    if (!parsed.success) {
      review.issues.push(
        problem(
          'V4_RESOLUTION_INVALID',
          path,
          'Expected a valid graph fragment with nodes and edges.',
        ),
      );
      continue;
    }
    const graph = parsed.data;
    const ids = new Set(graph.nodes.map((node) => node.id));
    const retained = graph.edges.find((edge) => edge.id === old!.id);
    if (
      ids.size !== graph.nodes.length ||
      graph.nodes.some(
        (node) =>
          source.nodes.some((entry) => entry.id === node.id) ||
          nodes.some((entry) => entry.id === node.id),
      ) ||
      !retained ||
      retained.to.node !== old!.to.node ||
      retained.to.port !== old!.to.port ||
      retained.ui !== undefined ||
      !ids.has(retained.from.node) ||
      graph.edges.some(
        (edge) =>
          (edge.id !== old!.id && edges.some((entry) => entry.id === edge.id)) ||
          (!ids.has(edge.from.node) && edge.from.node !== trigger.id) ||
          (!ids.has(edge.to.node) && edge.id !== old!.id),
      ) ||
      graph.edges.filter((edge) => edge.from.node === trigger.id).length !== 1
    ) {
      review.issues.push(
        problem(
          'V4_RESOLUTION_INVALID',
          path,
          'Fragment must own new nodes/edges, retain the successor edge and destination, and clear its manual route.',
        ),
      );
      continue;
    }
    if (nodes.length + graph.nodes.length > 500 || edges.length - 1 + graph.edges.length > 2000) {
      review.issues.push(
        problem('V4_FILTER_REFUSED', path, 'Filter graph exceeds 500 nodes or 2,000 edges.'),
      );
      continue;
    }
    nodes.push(...graph.nodes);
    edges.splice(edges.indexOf(old!), 1, ...graph.edges);
    for (const id of [...ids, ...graph.edges.map((edge) => edge.id)]) used.add(id);
  }
}
