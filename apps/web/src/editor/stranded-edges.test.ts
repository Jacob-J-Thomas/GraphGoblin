import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { canvasDrawsEdge, newLoopDefinition, validateDraft } from './model.js';
import { useEditorStore } from './store.js';
import { removeStrandedEdge, strandedEdges } from './stranded-edges.js';

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

  it('lists each undrawable edge once, in stored order, and no drawable edge', () => {
    const def = store().definition!;
    const stranded = strandedEdges(def);
    // The stored records themselves.
    expect(stranded).toEqual([def.edges[2], def.edges[3]]);
    expect(stranded[0]).toBe(def.edges[2]);
    // An id two edges hold is not offered (removal by id would take both).
    const doubled = { ...def, edges: [...def.edges, edge('e4', 'start', 'out', 'done')] };
    expect(strandedEdges(doubled).map((e) => e.id)).toEqual(['e3']);
    // Into a trigger, from a node that is gone, and an edge two issues name: each once.
    const more = {
      ...def,
      edges: [
        ...def.edges,
        edge('e5', 'run', 'retry', 'start'),
        edge('e6', 'gone', 'out', 'run'),
        edge('e7', 'run', 'nope', 'ghost'),
      ],
    };
    expect(validateDraft(more).issues.filter((i) => i.edgeId === 'e7')).toHaveLength(2);
    expect(strandedEdges(more).map((e) => e.id)).toEqual(['e3', 'e4', 'e5', 'e6', 'e7']);
    // In a draft that parses, each comes with an error of its own, so Loop issues has a list to
    // open; the list itself does not depend on those issues.
    const { issues, schemaValid } = validateDraft(more);
    expect(schemaValid).toBe(true);
    for (const e of strandedEdges(more))
      expect(issues.some((i) => i.edgeId === e.id && i.severity === 'error')).toBe(true);
  });

  it('reads the draft, not its issues: a blank Decision route ID still lists the edge it owns', () => {
    const def = newLoopDefinition('Blank');
    def.nodes.push(
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          kind: 'expression',
          jsonata: '"yes"',
          routes: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
            { id: 'route-3', label: '7' },
          ],
        },
      },
      {
        id: 'branch',
        kind: 'mutate',
        label: 'Branch',
        config: { operations: [{ op: 'append-message', role: 'note', content: 'Branch ran' }] },
      },
    );
    def.edges.push(
      edge('e2', 'pick', 'yes', 'done'),
      edge('e3', 'pick', 'no', 'done'),
      edge('e5', 'pick', 'route-3', 'branch'),
    );
    store().load('L2', def);
    expect(strandedEdges(store().definition!)).toEqual([]);
    const node = store().definition!.nodes.find((n) => n.id === 'pick')!;
    const config = node.config as { routes: { id: string; label: string }[] };
    store().updateNode(
      'pick',
      {
        config: {
          ...config,
          routes: config.routes.map((row, i) => (i === 2 ? { ...row, id: '' } : row)),
        },
      },
      { path: 'routes.2.id', kind: 'typing', id: 1 },
    );
    const blank = store().definition!;
    // The blank row keeps its edge on the last valid port; the draft does not parse, so its only
    // issue is the schema's, on the node, and names no edge.
    const e5 = blank.edges.find((e) => e.id === 'e5')!;
    expect(e5).toEqual(edge('e5', 'pick', 'route-3', 'branch'));
    const { issues, schemaValid } = validateDraft(blank);
    expect(schemaValid).toBe(false);
    expect(issues.every((i) => i.code === 'SCHEMA' && i.edgeId === undefined)).toBe(true);
    expect(canvasDrawsEdge(blank, e5)).toBe(false);
    expect(strandedEdges(blank)).toEqual([e5]);
    // The edge's recovery removes exactly it, one step; Undo restores the draft and ownership.
    const before = { definition: blank, decisionRoutes: store().decisionRoutes };
    expect(removeStrandedEdge(e5)).toBe(true);
    expect(store().definition!.edges).toEqual(blank.edges.filter((e) => e.id !== 'e5'));
    expect(store().definition!.nodes).toBe(blank.nodes);
    expect(store().past.at(-1)!.label).toBe('remove edge pick route-3 to branch');
    // The blank row's ownership stays on the port its records are on, its last valid ID.
    expect(store().decisionRoutes['pick']!.rows[2]).toMatchObject({ id: 'route-3', edgeIds: [] });
    store().undo();
    expect(store().definition).toEqual(before.definition);
    expect(store().decisionRoutes).toEqual(before.decisionRoutes);
    expect(store().decisionRoutes['pick']!.rows[2]).toMatchObject({
      id: 'route-3',
      edgeIds: ['e5'],
    });
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
