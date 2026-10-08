import { ChoiceOptionIdSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import type { FormChange } from '../forms/changes.js';

interface RouteRow {
  key: number;
  id: string | undefined;
  edgeIds: readonly string[];
}
interface RouteRows {
  nextKey: number;
  rows: readonly RouteRow[];
}
/** Editor-only answer-port ownership; restored with the definition by undo/redo, never saved. */
export type DecisionRoutes = Readonly<Record<string, RouteRows>>;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

interface AnswerRows {
  collectionPath: string | undefined;
  rows: { id: string | undefined }[];
}

/** The stable route IDs, in the answer's authored order, even while other fields are incomplete. */
function answerRows(config: unknown): AnswerRows | undefined {
  const answer = record(record(config)['answer']);
  const type = answer['type'];
  if (type === 'choice' || type === 'score') {
    const path = type === 'choice' ? 'answer.options' : 'answer.bands';
    const rows = answer[type === 'choice' ? 'options' : 'bands'];
    if (!Array.isArray(rows)) return undefined;
    return {
      collectionPath: path,
      rows: rows.map((value) => {
        const id = record(value)['id'];
        return { id: typeof id === 'string' ? id : undefined };
      }),
    };
  }
  if (type === 'noul') {
    const trueSide = answer['true'];
    const falseSide = answer['false'];
    if (!trueSide || !falseSide) return undefined;
    return {
      collectionPath: undefined,
      rows: [trueSide, falseSide].map((value) => {
        const id = record(value)['id'];
        return { id: typeof id === 'string' ? id : undefined };
      }),
    };
  }
  return undefined;
}

/** The edited stable-ID row, including the fixed true/false slots of Noul. */
function editedIndex(path: string | undefined): number | undefined {
  const collection = /^answer\.(?:options|bands)\.(\d+)\.id$/.exec(path ?? '');
  if (collection) return Number(collection[1]);
  const side = /^answer\.(true|false)\.id$/.exec(path ?? '')?.[1];
  return side === 'true' ? 0 : side === 'false' ? 1 : undefined;
}

function sameRows(a: RouteRows, b: RouteRows): boolean {
  return (
    a.nextKey === b.nextKey &&
    a.rows.length === b.rows.length &&
    a.rows.every((row, i) => {
      const next = b.rows[i]!;
      return (
        row.key === next.key &&
        row.id === next.id &&
        row.edgeIds.length === next.edgeIds.length &&
        row.edgeIds.every((id, j) => id === next.edgeIds[j])
      );
    })
  );
}

/** Keep an edge attached to its option ID through label edits and explicit ID renames. */
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
    const answer = answerRows(node.config);
    const after = answer?.rows.map((row) => row.id);
    let nextKey = before.nextKey;
    let rows = before.rows;
    if (after) {
      let retained: (RouteRow | undefined)[] = [...before.rows];
      const collection = change?.collection;
      if (
        answer !== undefined &&
        change !== undefined &&
        change.path === answer.collectionPath &&
        answer.collectionPath !== undefined &&
        collection?.type === 'remove' &&
        after.length === before.rows.length - 1
      ) {
        retained.splice(collection.index, 1);
      } else if (editedIndex(change?.path) !== undefined && after.length === before.rows.length) {
        // The field path identifies the edited row even while its replacement ID is incomplete.
        retained = [...before.rows];
      } else {
        const available = [...before.rows];
        retained = after.map((id, index) => {
          const match = available.findIndex((row) => row.id === id && id !== undefined);
          if (match >= 0) return available.splice(match, 1)[0];
          // A duplicate makes ID matching ambiguous. Preserve the still-unclaimed row at this
          // position until the user repairs the duplicate; invalid text never transfers or drops
          // the row's connected edge while the editor is showing an error.
          const duplicates =
            id !== undefined && after.filter((candidate) => candidate === id).length > 1;
          if (duplicates) {
            const positional = available.indexOf(before.rows[index]!);
            if (positional >= 0) return available.splice(positional, 1)[0];
          }
          return undefined;
        });
      }
      rows = after.map((id, index) => ({
        ...(retained[index] ?? { key: nextKey++, edgeIds: [] }),
        id,
      }));
      const kept = new Set(rows.map((row) => row.key));
      for (const row of before.rows)
        if (!kept.has(row.key)) for (const edgeId of row.edgeIds) removed.add(edgeId);
    }
    const outgoing = definition.edges.filter((edge) => edge.from.node === node.id);
    const claimed = new Set(before.rows.flatMap((row) => row.edgeIds));
    rows = rows.map((row) => {
      const unique =
        row.id !== undefined && rows.filter((other) => other.id === row.id).length === 1;
      const valid = unique && ChoiceOptionIdSchema.safeParse(row.id).success;
      const edgeIds = outgoing
        .filter(
          (edge) =>
            row.edgeIds.includes(edge.id) ||
            (unique && !claimed.has(edge.id) && edge.from.port === row.id),
        )
        .map((edge) => edge.id);
      if (valid) for (const edgeId of edgeIds) ports.set(edgeId, row.id!);
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
    Object.entries(decisionRoutes).every(([id, optionRows]) => optionRows === previous[id]);
  return {
    definition: unchangedEdges ? definition : { ...definition, edges },
    decisionRoutes: unchangedRows ? previous : decisionRoutes,
  };
}
