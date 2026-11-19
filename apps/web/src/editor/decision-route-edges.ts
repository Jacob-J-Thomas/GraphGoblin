import { hasRepeatRoute } from './decision-gates.js';
import { ChoiceOptionIdSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import type { FormChange } from '../forms/changes.js';

interface RouteRow {
  key: number;
  /**
   * The port this row's records are on: its authored ID as of its last edit that left the ID valid
   * (unique in its Decision and a valid route ID), since only such an edit moves them. While the ID
   * is blank, a duplicate or otherwise invalid the records stay where they are, and so does this; the
   * typed text is no evidence of which records the row owns (#481).
   */
  id: string | undefined;
  edgeIds: readonly string[];
}
interface RouteRows {
  nextKey: number;
  rows: readonly RouteRow[];
}
/** Editor-only port ownership; restored by history and device drafts, never part of a definition. */
export type DecisionRoutes = Readonly<Record<string, RouteRows>>;

type StoredEdge = LoopDefinitionInput['edges'][number];

/** The ids of `edges`, each once, in stored order: a row owns an id once however many share it. */
const idsOf = (edges: readonly StoredEdge[]): string[] => [
  ...new Set(edges.map((edge) => edge.id)),
];

/** A Decision's own route connections: every edge leaving it except its Limit reached output. */
function routeConnections(definition: LoopDefinitionInput, nodeId: string): StoredEdge[] {
  return definition.edges.filter(
    (edge) => edge.from.node === nodeId && edge.from.port !== 'limit-reached',
  );
}

/**
 * The one stored record a row names by `edgeId` among its Decision's own connections (`outgoing`),
 * for a row whose records were on `port` before this edit (`RouteRow.id`, #481). A current-format
 * draft can give two edges one id (`DUPLICATE_EDGE_ID`), so an id alone may name more than one
 * record: it names the Decision's only connection with that id, or, when more of them share it, the
 * only one of those still on `port`. Otherwise it names none, and no record is rewritten or removed
 * for it. An edge of another node is never one of them, whatever its id.
 */
function ownedRecord(
  outgoing: readonly StoredEdge[],
  edgeId: string,
  port: string | undefined,
): StoredEdge | undefined {
  const holders = outgoing.filter((edge) => edge.id === edgeId);
  if (holders.length === 1) return holders[0];
  const onPort = holders.filter((edge) => edge.from.port === port);
  return onPort.length === 1 ? onPort[0] : undefined;
}

/**
 * A Decision's `rows` without the claims that name no owner (#481). A row's claim is an edge id
 * read on the row's port (`ownedRecord`), and a record the claims of more than one row name is
 * owned by none of them: a device copy an earlier editor left can give two rows one port with one
 * shared id, and section JSON can give two rows one ID. Nothing stored says which row authored
 * such a record, so no row moves or removes it, and the claims are dropped so that none of them
 * can later act as if it alone named it. The record is then one no row has claimed, as on a load
 * without device metadata: a row takes it up only through its own unique ID being the record's
 * port. Every other claim, and `rows` itself when there is no such record, stays as it is.
 */
function trustedRows(stored: RouteRows, outgoing: readonly StoredEdge[]): RouteRows {
  const claimants = new Map<StoredEdge, Set<RouteRow>>();
  for (const row of stored.rows)
    for (const edgeId of row.edgeIds) {
      const edge = ownedRecord(outgoing, edgeId, row.id);
      if (edge) claimants.set(edge, (claimants.get(edge) ?? new Set()).add(row));
    }
  const contested = (row: RouteRow, edgeId: string) => {
    const edge = ownedRecord(outgoing, edgeId, row.id);
    return edge !== undefined && claimants.get(edge)!.size > 1;
  };
  if (!stored.rows.some((row) => row.edgeIds.some((edgeId) => contested(row, edgeId))))
    return stored;
  return {
    nextKey: stored.nextKey,
    rows: stored.rows.map((row) => ({
      ...row,
      edgeIds: row.edgeIds.filter((edgeId) => !contested(row, edgeId)),
    })),
  };
}

/**
 * The stored connections that removing row `index` of Decision `nodeId` takes with it, in stored
 * order: each record the row alone owns (`trustedRows`) that it names alone (`ownedRecord`), as
 * `decisionRouteEdges` removes them. The removal review lists exactly these.
 */
export function rowConnections(
  definition: LoopDefinitionInput,
  decisionRoutes: DecisionRoutes,
  nodeId: string,
  index: number,
): StoredEdge[] {
  const stored = Object.hasOwn(decisionRoutes, nodeId) ? decisionRoutes[nodeId] : undefined;
  if (!stored?.rows[index]) return [];
  const outgoing = routeConnections(definition, nodeId);
  const row = trustedRows(stored, outgoing).rows[index]!;
  const owned = new Set(row.edgeIds.map((edgeId) => ownedRecord(outgoing, edgeId, row.id)));
  return outgoing.filter((edge) => owned.has(edge));
}

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
  const raw = record(config);
  if ((raw['kind'] === 'expression' || raw['kind'] === 'llm') && Array.isArray(raw['routes']))
    return {
      collectionPath: 'routes',
      rows: raw['routes'].map((value) => {
        const id = record(value)['id'];
        return { id: typeof id === 'string' ? id : undefined };
      }),
    };
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

/**
 * Whether the authored ID at `index` of a Decision's `ids` carries its row's records to its port:
 * unique among them and a valid route ID. Any other (blank, a duplicate, invalid) names neither the
 * row nor where its records are.
 */
function validAt(ids: readonly (string | undefined)[], index: number): boolean {
  const id = ids[index];
  return (
    id !== undefined &&
    ids.filter((other) => other === id).length === 1 &&
    ChoiceOptionIdSchema.safeParse(id).success
  );
}

/** The edited stable-ID row, including the fixed true/false slots of Noul. */
function editedIndex(path: string | undefined): number | undefined {
  const collection = /^(?:answer\.(?:options|bands)|routes)\.(\d+)\.id$/.exec(path ?? '');
  if (collection) return Number(collection[1]);
  const side = /^answer\.(true|false)\.id$/.exec(path ?? '')?.[1];
  return side === 'true' ? 0 : side === 'false' ? 1 : undefined;
}

/** JSON replacements keep connections by route ID, never by a row's old position. */
export function removedAnswerConnections(
  edges: LoopDefinitionInput['edges'],
  nodeId: string,
  answer: unknown,
): LoopDefinitionInput['edges'] {
  const ids = new Set(
    answerRows(
      Array.isArray(answer) ? { kind: 'expression', routes: answer } : { answer },
    )?.rows.map((row) => row.id),
  );
  if (hasRepeatRoute(Array.isArray(answer) ? { kind: 'expression', routes: answer } : { answer }))
    ids.add('limit-reached');
  return edges.filter((edge) => edge.from.node === nodeId && !ids.has(edge.from.port));
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

/**
 * Keep an edge attached to its option ID through label edits and explicit ID renames. Rows own
 * edges by id, but each port change and removal applies to a stored record the row names alone
 * (`ownedRecord`) and no other row names (`trustedRows`), never to every edge with that id (#481).
 */
export function decisionRouteEdges(
  definition: LoopDefinitionInput,
  previous: DecisionRoutes,
  change?: FormChange,
  renamed?: { from: string; to: string },
  editedNodeId?: string,
): { definition: LoopDefinitionInput; decisionRoutes: DecisionRoutes } {
  const decisionRoutes: Record<string, RouteRows> = {};
  const removed = new Set<StoredEdge>();
  const ports = new Map<StoredEdge, string>();
  for (const node of definition.nodes) {
    if (node.kind !== 'decision') continue;
    const nodeChange = node.id === editedNodeId ? change : undefined;
    const oldId = renamed?.to === node.id ? renamed.from : node.id;
    const stored = (Object.hasOwn(previous, oldId) ? previous[oldId] : undefined) ?? {
      nextKey: 0,
      rows: [],
    };
    const outgoing = routeConnections(definition, node.id);
    const before = trustedRows(stored, outgoing);
    const answer = answerRows(node.config);
    const after = answer?.rows.map((row) => row.id);
    let nextKey = before.nextKey;
    let rows = before.rows;
    const collection = nodeChange?.collection;
    const jsonReplacement =
      nodeChange !== undefined &&
      collection?.type === 'replace' &&
      (nodeChange.path === 'answer' || nodeChange.path === answer?.collectionPath);
    if (after) {
      let retained: (RouteRow | undefined)[] = [...before.rows];
      if (
        answer !== undefined &&
        nodeChange !== undefined &&
        nodeChange.path === answer.collectionPath &&
        answer.collectionPath !== undefined &&
        collection?.type === 'remove' &&
        after.length === before.rows.length - 1
      ) {
        retained.splice(collection.index, 1);
      } else if (nodeChange?.path === answer?.collectionPath && collection?.type === 'move') {
        retained.splice(collection.to, 0, retained.splice(collection.from, 1)[0]);
      } else if (
        editedIndex(nodeChange?.path) !== undefined &&
        after.length === before.rows.length
      ) {
        // The field path identifies the edited row even while its replacement ID is incomplete.
        retained = [...before.rows];
      } else {
        const available = [...before.rows];
        retained = after.map((id, index) => {
          // A valid ID names the row on its port. Any other names no row: preserve the
          // still-unclaimed row at this position until the user repairs it, so invalid text never
          // transfers or drops the row's connected edge while the editor is showing an error.
          const match = validAt(after, index)
            ? available.findIndex((row) => row.id === id)
            : available.indexOf(before.rows[index]!);
          return match >= 0 ? available.splice(match, 1)[0] : undefined;
        });
      }
      rows = after.map((id, index) => ({
        ...(retained[index] ?? { key: nextKey++, edgeIds: [] }),
        id,
        ...(jsonReplacement
          ? { edgeIds: idsOf(outgoing.filter((edge) => edge.from.port === id)) }
          : {}),
      }));
      const kept = new Set(rows.map((row) => row.key));
      if (jsonReplacement) {
        // The records on a port the JSON no longer declares: identified by their stored ends.
        for (const edge of removedAnswerConnections(
          definition.edges,
          node.id,
          record(node.config)['routes'] ?? record(node.config)['answer'],
        ))
          removed.add(edge);
      } else {
        for (const row of before.rows)
          if (!kept.has(row.key))
            for (const edgeId of row.edgeIds) {
              const edge = ownedRecord(outgoing, edgeId, row.id);
              if (edge) removed.add(edge);
            }
      }
    }
    // The records a row's claim names. A row with a unique ID takes up the others on its port: by
    // record, since another record sharing an id that a row owns is not that row's.
    const claimed = new Set(
      before.rows.flatMap((row) =>
        row.edgeIds.map((edgeId) => ownedRecord(outgoing, edgeId, row.id)),
      ),
    );
    // A kept row's records are on its port before this edit (`RouteRow.id`).
    const previousIds = new Map(before.rows.map((row) => [row.key, row.id]));
    rows = rows.map((row) => {
      const unique =
        row.id !== undefined && rows.filter((other) => other.id === row.id).length === 1;
      const valid = unique && ChoiceOptionIdSchema.safeParse(row.id).success;
      const edgeIds = idsOf(
        outgoing.filter(
          (edge) =>
            row.edgeIds.includes(edge.id) ||
            (unique && !claimed.has(edge) && edge.from.port === row.id),
        ),
      );
      const existing = previousIds.has(row.key);
      const port = existing ? previousIds.get(row.key) : row.id;
      // Only the records the row owned before this edit move with it. One it takes up now through
      // its ID is on that port already, and read on its old port, its id could name another
      // record; section JSON names every row's records by the port of its ID.
      if (valid && existing && !jsonReplacement)
        for (const edgeId of row.edgeIds) {
          const edge = ownedRecord(outgoing, edgeId, port);
          if (edge) ports.set(edge, row.id!);
        }
      // Only a valid ID moves the row's records, so only it moves the row's port. Section JSON
      // names each row's records by the port of its ID, valid or not.
      return { ...row, id: valid || !existing || jsonReplacement ? row.id : port, edgeIds };
    });
    const next = { nextKey, rows };
    decisionRoutes[node.id] = sameRows(stored, next) ? stored : next;
  }
  const edges = definition.edges.flatMap((edge) => {
    if (removed.has(edge)) return [];
    const port = ports.get(edge);
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
