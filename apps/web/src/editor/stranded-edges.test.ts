import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { newLoopDefinition, validateDraft, type EditorIssue } from './model.js';
import { useEditorStore } from './store.js';
import { removeStrandedEdge, strandedEdgeRows } from './stranded-edges.js';

type Edge = LoopDefinitionInput['edges'][number];
const edge = (id: string, from: string, port: string, to: string): Edge => ({
  id,
  from: { node: from, port },
  to: { node: to, port: 'in' },
});

/** start -> run -> done, a Script with a `retry` label, and stored edges the canvas cannot draw. */
function stranded(): LoopDefinitionInput {
  const def = newLoopDefinition('Stranded');
  def.nodes.push({
    id: 'run',
    kind: 'script',
    label: 'Run',
    config: { command: 'node', exitCodeRoutes: { '1': 'retry' } },
    ui: { x: 300, y: 200 },
  });
  def.edges.push(
    edge('e2', 'run', 'retry', 'done'),
    { ...edge('e3', 'run', 'report', 'done'), ui: { route: [400] } },
    edge('e4', 'run', 'out', 'ghost'),
  );
  return def;
}
const store = () => useEditorStore.getState();

describe('stored edges the canvas cannot draw (#207)', () => {
  beforeEach(() => store().load('L1', stranded()));

  it('offers one removal per undrawable edge, on its first issue row, and none for drawable edges', () => {
    const def = store().definition!;
    const { issues } = validateDraft(def);
    const rows = strandedEdgeRows(issues, def);
    expect([...rows.values()].map((e) => e.id).sort()).toEqual(['e3', 'e4']);
    for (const [index, e] of rows) expect(issues[index]!.edgeId).toBe(e.id);
    // Two issues about one edge: the action is on the first only.
    const twice: EditorIssue[] = [
      { code: 'EDGE_TO_MISSING', severity: 'error', message: 'a', edgeId: 'e4' },
      { code: 'EDGE_PORT_MISSING', severity: 'error', message: 'b', edgeId: 'e4' },
      { code: 'PORT_MULTIPLY_CONNECTED', severity: 'error', message: 'c', edgeId: 'e2' },
      { code: 'NO_EXIT', severity: 'error', message: 'd' },
    ];
    expect([...strandedEdgeRows(twice, def)]).toEqual([[0, def.edges.find((e) => e.id === 'e4')]]);
    // An id two edges hold is not offered (removal by id would take both).
    const doubled = { ...def, edges: [...def.edges, edge('e4', 'start', 'out', 'done')] };
    expect(strandedEdgeRows(twice, doubled).size).toBe(0);
  });

  it('removes exactly the expected edge as one undo step; undo restores it with its route', () => {
    const before = store().definition!;
    const e3 = before.edges.find((e) => e.id === 'e3')!;
    expect(removeStrandedEdge(e3)).toBe(true);
    expect(store().definition!.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e4']);
    expect(store().past.map((step) => step.label)).toEqual(['remove edge run report to done']);
    // The Script's labels are left as they are.
    expect(store().definition!.nodes).toBe(before.nodes);
    store().undo();
    expect(store().definition!.edges).toEqual(before.edges);
  });

  it('removes nothing for a stale action: repaired, gone, recycled id, protected, or no draft', () => {
    const def = store().definition!;
    const e3 = def.edges.find((e) => e.id === 'e3')!;
    // The label came back (the edge is drawable again).
    store().updateNode('run', {
      config: { command: 'node', exitCodeRoutes: { '1': 'retry', '2': 'report' } },
    });
    expect(removeStrandedEdge(e3)).toBe(false);
    store().undo();
    // The id now names another undrawable edge.
    store().removeEdge('e3');
    expect(removeStrandedEdge(e3)).toBe(false);
    useEditorStore.setState({
      definition: {
        ...store().definition!,
        edges: [...store().definition!.edges, edge('e3', 'run', 'gone', 'done')],
      },
    });
    expect(removeStrandedEdge(e3)).toBe(false);
    expect(store().definition!.edges.some((e) => e.id === 'e3')).toBe(true);
    // A protected Chat voice step stays.
    store().load('L2', {
      schemaVersion: 4,
      name: 'Chat',
      nodes: [
        { id: 'chat-input', kind: 'trigger', label: 'In', config: { type: 'manual' } },
        { id: 'chat-normalize', kind: 'mutate', label: 'N', config: { operations: [] } },
      ],
      edges: [edge('v1', 'chat-normalize', 'out', 'gone')],
    } as unknown as LoopDefinitionInput);
    useEditorStore.setState({ systemChat: true });
    const v1 = store().definition!.edges[0]!;
    expect(removeStrandedEdge(v1)).toBe(false);
    expect(store().definition!.edges).toHaveLength(1);
    useEditorStore.setState({ systemChat: false, definition: undefined });
    expect(removeStrandedEdge(v1)).toBe(false);
  });
});
