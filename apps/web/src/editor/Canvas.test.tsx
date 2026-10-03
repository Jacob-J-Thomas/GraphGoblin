import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { act, render } from '@testing-library/react';
import type { ReactFlowProps } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from './Canvas.js';
import type { FlowNode } from './NodeCard.js';
import { useEditorStore } from './store.js';

let props: ReactFlowProps<FlowNode> | undefined;

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ReactFlow: (p: ReactFlowProps<FlowNode>) => {
      props = p;
      return <div data-testid="flow" />;
    },
    useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => p }),
  };
});

const store = () => useEditorStore.getState();
const flow = () => props as ReactFlowProps<FlowNode>;

describe('Canvas handlers', () => {
  beforeEach(() => {
    store().load('L1', kitchenSinkLoop());
  });

  function renderCanvas() {
    const def = store().definition!;
    return render(
      <Canvas
        definition={def}
        issues={[{ code: 'X', severity: 'error', message: 'm', nodeId: 'prep' }]}
      />,
    );
  }

  it('maps the definition to nodes with ports and issue counts, and edges with labels', () => {
    renderCanvas();
    const prep = flow().nodes!.find((n) => n.id === 'prep')!;
    expect(prep.data).toMatchObject({ ports: ['out'], issueCount: 1 });
    const decide = flow().nodes!.find((n) => n.id === 'decide')!;
    expect(decide.data.ports).toEqual(['good', 'bad']);
    const loopBack = flow().edges!.find((e) => e.id === 'e11')!;
    expect(loopBack).toMatchObject({ label: 'loopBack', animated: true, sourceHandle: 'loopBack' });
    expect(flow().edges!.find((e) => e.id === 'e1')!.label).toBeUndefined();
  });

  it('validates connections and forwards them to the store', () => {
    renderCanvas();
    expect(
      flow().isValidConnection!({
        source: 'poll',
        target: 'start',
        sourceHandle: 'out',
        targetHandle: 'in',
      }),
    ).toBe(false);
    expect(
      flow().isValidConnection!({
        source: 'prep',
        target: 'infer',
        sourceHandle: null,
        targetHandle: 'in',
      }),
    ).toBe(false);
    act(() => store().removeEdge('e3'));
    const { rerender } = renderCanvas();
    void rerender;
    expect(
      flow().isValidConnection!({
        source: 'prep',
        target: 'infer',
        sourceHandle: 'out',
        targetHandle: 'in',
      }),
    ).toBe(true);
    act(() =>
      flow().onConnect!({
        source: 'prep',
        target: 'infer',
        sourceHandle: 'out',
        targetHandle: 'in',
      }),
    );
    expect(
      store().definition!.edges.some((e) => e.from.node === 'prep' && e.to.node === 'infer'),
    ).toBe(true);
  });

  it('applies node changes: measurement, selection, dragging, removal, and drag stop', () => {
    renderCanvas();
    act(() =>
      flow().onNodesChange!([
        {
          type: 'dimensions',
          id: 'prep',
          dimensions: { width: 100, height: 40 },
          setAttributes: true,
        },
        { type: 'dimensions', id: 'infer' },
        { type: 'select', id: 'infer', selected: true },
        { type: 'select', id: 'check', selected: false },
      ]),
    );
    expect(store().selectedNodeId).toBe('infer');
    expect(flow().nodes!.find((n) => n.id === 'prep')!.measured).toEqual({
      width: 100,
      height: 40,
    });

    // Mid-drag positions are local; the store only changes when the drag ends.
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'prep', position: { x: 50, y: 60 }, dragging: true },
      ]),
    );
    expect(flow().nodes!.find((n) => n.id === 'prep')!.position).toEqual({ x: 50, y: 60 });
    expect(store().definition!.nodes.find((n) => n.id === 'prep')!.ui).toBeUndefined();
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'prep', position: { x: 70, y: 80 }, dragging: false },
      ]),
    );
    expect(store().definition!.nodes.find((n) => n.id === 'prep')!.ui).toEqual({ x: 70, y: 80 });
    act(() => flow().onNodesChange!([{ type: 'position', id: 'prep' }]));

    act(() =>
      flow().onNodeDragStop!({} as never, { ...flow().nodes![0]!, position: { x: 9, y: 9 } }, []),
    );
    expect(store().definition!.nodes[0]!.ui).toEqual({ x: 9, y: 9 });
    act(() => flow().onNodesChange!([{ type: 'remove', id: 'poll' }]));
    expect(store().definition!.nodes.some((n) => n.id === 'poll')).toBe(false);
    act(() => flow().onPaneClick!({} as never));
    expect(store().selectedNodeId).toBeUndefined();
  });

  it('applies edge changes and removals', () => {
    renderCanvas();
    act(() =>
      flow().onEdgesChange!([
        { type: 'select', id: 'e1', selected: true },
        { type: 'remove', id: 'e2' },
      ]),
    );
    expect(store().definition!.edges.some((e) => e.id === 'e2')).toBe(false);
    expect(flow().edges!.find((e) => e.id === 'e1')!.selected).toBe(true);
    act(() => flow().onEdgesChange!([{ type: 'select', id: 'e1', selected: false }]));
    expect(flow().edges!.find((e) => e.id === 'e1')!.selected).toBe(false);
  });
});
