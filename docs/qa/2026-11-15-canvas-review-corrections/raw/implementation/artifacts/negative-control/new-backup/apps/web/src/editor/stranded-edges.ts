import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { isProtectedVoiceEdge } from './chat-protection.js';
import { canvasDrawsEdge, onlyEdge } from './model.js';
import { useEditorStore } from './store.js';

type Edge = LoopDefinitionInput['edges'][number];

const sameEnds = (a: Edge, b: Edge) =>
  a.id === b.id &&
  a.from.node === b.from.node &&
  a.from.port === b.from.port &&
  a.to.node === b.to.node &&
  (a.to.port ?? 'in') === (b.to.port ?? 'in');

/**
 * The stored edges the canvas cannot draw (#207), in stored order: from a missing node or from a
 * port that is not a handle on its card, into a missing node or into a trigger. They have no path
 * to select on the canvas, so Loop issues lists each with its ends and offers its removal. This
 * reads the draft itself, not its issues: while the draft does not parse (a Decision route's ID
 * left blank, say) validation reports only the schema error, yet the edge the blank row owns is
 * still stored and is not drawn. An id more than one edge holds is left out, since removal by id
 * would take both.
 */
export function strandedEdges(definition: LoopDefinitionInput): Edge[] {
  const holders = new Map<string, number>();
  for (const edge of definition.edges) holders.set(edge.id, (holders.get(edge.id) ?? 0) + 1);
  return definition.edges.filter(
    (edge) => holders.get(edge.id) === 1 && !canvasDrawsEdge(definition, edge),
  );
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
