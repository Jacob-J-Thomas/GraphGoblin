import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { isProtectedVoiceEdge } from './chat-protection.js';
import { canvasDrawsEdge, type EditorIssue } from './model.js';
import { useEditorStore } from './store.js';

type Edge = LoopDefinitionInput['edges'][number];

/** The one stored edge with `id`, or undefined when there is none or the id is not unique. */
function onlyEdge(definition: LoopDefinitionInput, id: string): Edge | undefined {
  const matches = definition.edges.filter((edge) => edge.id === id);
  return matches.length === 1 ? matches[0] : undefined;
}

const sameEnds = (a: Edge, b: Edge) =>
  a.id === b.id &&
  a.from.node === b.from.node &&
  a.from.port === b.from.port &&
  a.to.node === b.to.node &&
  (a.to.port ?? 'in') === (b.to.port ?? 'in');

/**
 * The stored edges the canvas cannot draw that an issue list names (#207), each on its first issue
 * row, by row index: an edge from a missing node or port, into a missing node or a trigger. Such an
 * edge has no path to select on the canvas, so its issue row offers its removal; an edge the canvas
 * draws, or an id more than one edge holds, gets no row action.
 */
export function strandedEdgeRows(
  issues: readonly EditorIssue[],
  definition: LoopDefinitionInput,
): Map<number, Edge> {
  const rows = new Map<number, Edge>();
  const seen = new Set<string>();
  issues.forEach((issue, index) => {
    if (issue.edgeId === undefined || seen.has(issue.edgeId)) return;
    seen.add(issue.edgeId);
    const edge = onlyEdge(definition, issue.edgeId);
    if (edge && !canvasDrawsEdge(definition, edge)) rows.set(index, edge);
  });
  return rows;
}

/**
 * Remove `expected` from the editor's draft as one undo step, only if it is still exactly the stored
 * edge with its id and ends, the canvas still cannot draw it, and it is no protected Chat voice step.
 * An action rendered for an edge that was since repaired, removed, or whose id another edge now
 * holds removes nothing. Returns whether the edge was removed.
 */
export function removeStrandedEdge(expected: Edge): boolean {
  const state = useEditorStore.getState();
  const definition = state.definition;
  if (!definition) return false;
  const edge = onlyEdge(definition, expected.id);
  if (
    !edge ||
    !sameEnds(edge, expected) ||
    canvasDrawsEdge(definition, edge) ||
    isProtectedVoiceEdge(definition, state.systemChat, edge)
  )
    return false;
  state.removeEdge(edge.id);
  return useEditorStore.getState().definition !== definition;
}
