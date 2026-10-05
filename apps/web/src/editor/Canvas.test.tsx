import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactFlowProps } from '@xyflow/react';
import { createPortal } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closePopovers, Popover } from '../components/ui/index.js';
import { buildCardData, Canvas, canvasFocusTarget } from './Canvas.js';
import type { EditorIssue } from './model.js';
import type { FlowNode } from './NodeCard.js';
import { useEditorStore } from './store.js';
import { decisionBackRoute, routingInput, simpleLoop } from '../__fixtures__/routing.js';
import { BackwardEdge } from './BackwardEdge.js';

let props: ReactFlowProps<FlowNode> | undefined;
let geometry = '[]';

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ReactFlow: (p: ReactFlowProps<FlowNode>) => {
      props = p;
      return <div data-testid="flow" />;
    },
    useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => p }),
    useStore: () => geometry,
  };
});

const store = () => useEditorStore.getState();
const flow = () => props as ReactFlowProps<FlowNode>;

describe('Canvas handlers', () => {
  beforeEach(() => {
    geometry = '[]';
    store().load('L1', kitchenSinkLoop());
  });

  const ISSUE: EditorIssue = { code: 'X', severity: 'error', message: 'm', nodeId: 'prep' };

  function renderCanvas(issues: EditorIssue[] = [ISSUE]) {
    const def = store().definition!;
    return render(<Canvas definition={def} issues={issues} />);
  }

  const data = (id: string) => flow().nodes!.find((n) => n.id === id)!.data;

  it('maps the definition to nodes with ports and issues, and edges with labels', () => {
    renderCanvas();
    const prep = flow().nodes!.find((n) => n.id === 'prep')!;
    expect(prep.data).toMatchObject({ ports: ['out'], issues: [ISSUE] });
    expect(data('infer').issues).toEqual([]);
    const decide = flow().nodes!.find((n) => n.id === 'decide')!;
    expect(decide.data.ports).toEqual(['good', 'bad']);
    const loopBack = flow().edges!.find((e) => e.id === 'e11')!;
    expect(loopBack).toMatchObject({ label: 'loopBack', animated: true, sourceHandle: 'loopBack' });
    expect(flow().edgeTypes).toEqual({ backward: BackwardEdge });
    expect(flow().edges!.find((e) => e.id === 'e1')!.label).toBeUndefined();
  });

  it('uses routed geometry only for backward edges and deletes loopBack with its config', () => {
    const definition = simpleLoop();
    geometry = JSON.stringify(routingInput(definition).nodes);
    store().load('L1', definition);
    const view = renderCanvas([]);
    const back = flow().edges!.find((e) => e.id === 'return')!;
    expect(back).toMatchObject({
      type: 'backward',
      label: 'loopBack',
      animated: true,
      ariaLabel: 'done loopBack to work',
      data: { blocked: false },
    });
    expect(flow().edges!.find((e) => e.id === 'start-work')!.type).toBe('smoothstep');
    const forward = flow().edges!.find((e) => e.id === 'start-work');
    act(() => flow().onEdgesChange!([{ type: 'select', id: 'return', selected: true }]));
    expect(flow().edges!.find((e) => e.id === 'return')!.selected).toBe(true);
    expect(flow().edges!.find((e) => e.id === 'return')!.data).toBe(back.data);
    expect(flow().edges!.find((e) => e.id === 'start-work')).toBe(forward);
    fireEvent.keyDown(view.getByTestId('canvas'), { key: 'Delete' });
    expect(store().definition!.edges.some((e) => e.id === 'return')).toBe(false);
    expect(store().definition!.nodes.find((n) => n.id === 'done')!.config).not.toHaveProperty(
      'loopBack',
    );
    expect(store().past).toHaveLength(1);
    act(() => store().undo());
    expect(store().definition!.nodes.find((n) => n.id === 'done')!.config).toHaveProperty(
      'loopBack.targetNodeId',
      'work',
    );
  });

  it('names an obstructed edge for keyboard users', () => {
    const definition = simpleLoop();
    const { nodes } = routingInput(definition);
    nodes.push({ ...nodes[0]!, id: 'cover', x: 1000 });
    geometry = JSON.stringify(nodes);
    store().load('L1', definition);
    renderCanvas([]);
    expect(flow().edges!.find((e) => e.id === 'return')!.ariaLabel).toContain(
      'move overlapping nodes apart',
    );
  });

  it('waits for measurements of decision returns and self-loops without drawing a crossing fallback', () => {
    store().load('L1', decisionBackRoute());
    renderCanvas([]);
    expect(flow().edges!.find((e) => e.id === 'retry')).toMatchObject({ type: 'backward' });
    expect(flow().edges!.find((e) => e.id === 'self')).toMatchObject({ type: 'backward' });
    expect(flow().edges!.find((e) => e.id === 'finish')!.type).toBe('smoothstep');
    // A horizontal move may change direction before the next handle measurement arrives.
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'decide', position: { x: 200, y: 100 }, dragging: true },
      ]),
    );
    expect(flow().edges!.find((e) => e.id === 'retry')!.type).toBe('smoothstep');
  });

  it('keeps a node’s data while its node and issues are unchanged, so its card does not re-render', () => {
    const view = renderCanvas();
    const prep = data('prep');
    const infer = data('infer');
    const unchangedNode = flow().nodes!.find((n) => n.id === 'check');
    const unchangedEdges = flow().edges;
    // Validation ran again: new but equal issue objects, and a new issue on another node.
    const other: EditorIssue = { ...ISSUE, nodeId: 'infer' };
    view.rerender(<Canvas definition={store().definition!} issues={[{ ...ISSUE }, other]} />);
    expect(data('prep')).toBe(prep);
    expect(data('infer')).not.toBe(infer);
    expect(data('infer').issues).toEqual([other]);
    expect(flow().nodes!.find((n) => n.id === 'check')).toBe(unchangedNode);
    expect(flow().edges).toBe(unchangedEdges);
    // An edit to one node gives only that node new data.
    const check = data('check');
    act(() => store().updateNode('prep', { label: 'Prepare it' }));
    view.rerender(<Canvas definition={store().definition!} issues={[{ ...ISSUE }, other]} />);
    expect(data('prep')).not.toBe(prep);
    expect(data('prep').node.label).toBe('Prepare it');
    expect(data('check')).toBe(check);
    expect(flow().nodes!.find((n) => n.id === 'check')).toBe(unchangedNode);

    // The cache itself: the previous object when node and issues match, a new one otherwise.
    const def = store().definition!;
    const first = buildCardData(def, [ISSUE], new Map());
    const second = buildCardData(def, [{ ...ISSUE }], first);
    expect(second.get('prep')).toBe(first.get('prep'));
    expect(buildCardData(def, [], first).get('prep')!.issues).toEqual([]);
  });

  it('closes the popovers on the canvas when it pans or zooms and when a node drag starts', () => {
    const view = renderCanvas();
    const canvas = view.getByTestId('canvas');
    const probe = (name: string) => (
      <Popover
        label={name}
        trigger={(props) => (
          <button type="button" {...props}>
            {name}
          </button>
        )}
      >
        <p>{name} body</p>
      </Popover>
    );
    render(
      <>
        {createPortal(probe('Inside'), canvas)}
        {probe('Outside')}
      </>,
    );
    const toggle = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
    const isOpen = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-expanded') === 'true';
    // A popover elsewhere (the toolbar's) stays open: nothing it hangs from moved.
    toggle('Outside');
    act(() => flow().onMove!(null, { x: 10, y: 0, zoom: 1 }));
    expect(isOpen('Outside')).toBe(true);
    toggle('Inside');
    expect(isOpen('Inside')).toBe(true);
    act(() => flow().onMove!(null, { x: 20, y: 0, zoom: 1 }));
    expect(isOpen('Inside')).toBe(false);
    toggle('Inside');
    const node = flow().nodes!.find((n) => n.id === 'prep')!;
    act(() => flow().onNodeDragStart!({} as never, node, [node]));
    expect(isOpen('Inside')).toBe(false);
    act(() => closePopovers());
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

  it('records each drag as one undo step, though its stop reports the position twice', () => {
    renderCanvas();
    const prepUi = () => store().definition!.nodes.find((n) => n.id === 'prep')!.ui;
    const drag = (end: { x: number; y: number }) => {
      const prep = flow().nodes!.find((n) => n.id === 'prep')!;
      act(() => flow().onNodeDragStart!({} as never, prep, []));
      act(() =>
        flow().onNodesChange!([{ type: 'position', id: 'prep', position: end, dragging: true }]),
      );
      act(() =>
        flow().onNodesChange!([{ type: 'position', id: 'prep', position: end, dragging: false }]),
      );
      act(() => flow().onNodeDragStop!({} as never, { ...prep, position: end }, []));
    };
    drag({ x: 120, y: 140 });
    expect(store().past.map((step) => step.label)).toEqual(['move prep']);
    // A second drag right after the first is a step of its own.
    drag({ x: 200, y: 140 });
    expect(store().past.map((step) => step.label)).toEqual(['move prep', 'move prep']);
    act(() => store().undo());
    expect(prepUi()).toEqual({ x: 120, y: 140 });
    act(() => store().undo());
    expect(prepUi()).toBeUndefined();
  });

  it('deletes the selection with Delete or Backspace only while focus is on the canvas', () => {
    const view = renderCanvas();
    const canvas = view.getByTestId('canvas');
    act(() => store().select('prep'));
    // Keys typed into a field inside the canvas, and other keys, change nothing.
    const input = document.createElement('input');
    canvas.appendChild(input);
    fireEvent.keyDown(input, { key: 'Delete' });
    fireEvent.keyDown(canvas, { key: 'a' });
    // Nor do keys from a node's issue badge or its popover (xyflow's `nokey`).
    const badge = canvas.appendChild(document.createElement('button'));
    badge.className = 'nokey';
    fireEvent.keyDown(badge, { key: 'Delete' });
    fireEvent.keyDown(badge, { key: 'Enter' });
    expect(store().nodeDialogOpen).toBe(false);
    expect(store().definition!.nodes.some((n) => n.id === 'prep')).toBe(true);
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(store().definition!.nodes.some((n) => n.id === 'prep')).toBe(false);
    // Nothing selected: nothing happens.
    const count = store().definition!.nodes.length;
    fireEvent.keyDown(canvas, { key: 'Backspace' });
    expect(store().definition!.nodes).toHaveLength(count);
    // A selected edge goes first.
    act(() => flow().onEdgesChange!([{ type: 'select', id: 'e1', selected: true }]));
    fireEvent.keyDown(canvas, { key: 'Backspace' });
    expect(store().definition!.edges.some((e) => e.id === 'e1')).toBe(false);
    expect(flow().deleteKeyCode).toBeNull();
  });

  it('opens a node on a click, but not on a click on one of its port handles', () => {
    renderCanvas();
    expect(flow()).toMatchObject({ nodeClickDistance: 3, nodeDragThreshold: 3 });
    const node = flow().nodes!.find((n) => n.id === 'infer')!;
    expect(node.ariaLabel).toBe('Inference Infer (infer)');
    const handle = document.createElement('div');
    handle.className = 'react-flow__handle';
    const dot = handle.appendChild(document.createElement('span'));
    act(() => flow().onNodeClick!({ target: dot } as never, node));
    expect(store().nodeDialogOpen).toBe(false);
    act(() => flow().onNodeClick!({ target: document.createElement('div') } as never, node));
    expect(store()).toMatchObject({ selectedNodeId: 'infer', nodeDialogOpen: true });
  });

  it('opens the focused node on Enter, and ignores keys from a dialog', () => {
    const view = renderCanvas();
    const canvas = view.getByTestId('canvas');
    const card = document.createElement('div');
    card.className = 'react-flow__node';
    card.dataset['id'] = 'prep';
    canvas.appendChild(card);
    const nameless = document.createElement('div');
    nameless.className = 'react-flow__node';
    canvas.appendChild(nameless);
    fireEvent.keyDown(nameless, { key: 'Enter' });
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(store().nodeDialogOpen).toBe(false);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(store()).toMatchObject({ selectedNodeId: 'prep', nodeDialogOpen: true });

    // Delete from inside a dialog (were one rendered in the canvas) never removes the node.
    const dialog = canvas.appendChild(document.createElement('dialog'));
    const button = dialog.appendChild(document.createElement('button'));
    fireEvent.keyDown(button, { key: 'Delete' });
    expect(store().definition!.nodes.some((n) => n.id === 'prep')).toBe(true);
  });

  it('finds where focus returns after the node editor: the node, else the canvas', () => {
    const view = renderCanvas();
    const canvas = view.getByTestId('canvas');
    expect(canvasFocusTarget('prep')).toBe(canvas);
    expect(canvasFocusTarget(undefined)).toBe(canvas);
    const card = canvas.appendChild(document.createElement('div'));
    card.className = 'react-flow__node';
    card.dataset['id'] = 'prep';
    expect(canvasFocusTarget('prep')).toBe(card);
    view.unmount();
    expect(canvasFocusTarget('prep')).toBeNull();
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
