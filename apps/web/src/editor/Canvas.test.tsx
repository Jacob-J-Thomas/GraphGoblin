import { EdgeRouteSchema, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Position, type ReactFlowProps } from '@xyflow/react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePopovers, Popover } from '../components/ui/index.js';
import { buildCardData, Canvas, canvasFocusTarget } from './Canvas.js';
import type { EditorIssue } from './model.js';
import type { FlowNode } from './NodeCard.js';
import { historyClock } from './history.js';
import { useEditorStore } from './store.js';
import { decisionBackRoute, routingInput, simpleLoop } from '../__fixtures__/routing.js';
import { OrthogonalEdge, type OrthogonalEdgeData } from './OrthogonalEdge.js';
import type { RoutingGeometry } from './useRouting.js';
import { drawnPoints, crossesCards, moveSegment, normalize } from './manual-route.js';

let props: ReactFlowProps<FlowNode> | undefined;
let geometry: RoutingGeometry = { nodes: [], preparationMs: 0 };
/** Render the orthogonal edges too (the real component, in a stand-in wrapper), for #44. */
let drawEdges = false;

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ReactFlow: (p: ReactFlowProps<FlowNode>) => {
      props = p;
      return <div data-testid="flow">{drawEdges ? <EdgeLayer flow={p} /> : null}</div>;
    },
    useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => p }),
    // The edge's handles read the zoom; everything else here reads the routing geometry.
    useStore: (selector?: { name?: string }) => (selector?.name === 'zoomOf' ? 1 : geometry),
  };
});

/** xyflow's edge wrappers, reduced to what the orthogonal edge reads: ports and focus. */
function EdgeLayer({ flow: p }: { flow: ReactFlowProps<FlowNode> }) {
  const Edge = p.edgeTypes!['orthogonal'] as typeof OrthogonalEdge;
  return (
    <svg>
      {p
        .edges!.filter((e) => e.type === 'orthogonal')
        .map((e) => {
          const from = geometry.nodes.find((n) => n.id === e.source)!.outputs[e.sourceHandle!]!;
          const to = geometry.nodes.find((n) => n.id === e.target)!.input!;
          return (
            <g key={e.id} className="react-flow__edge" tabIndex={0} data-id={e.id}>
              <Edge
                id={e.id}
                source={e.source}
                target={e.target}
                sourceX={from.x}
                sourceY={from.y}
                targetX={to.x}
                targetY={to.y}
                sourcePosition={Position.Right}
                targetPosition={Position.Left}
                data={e.data as OrthogonalEdgeData}
                label={e.label}
                selected={!!e.selected}
                selectable
                deletable
              />
            </g>
          );
        })}
    </svg>
  );
}

const store = () => useEditorStore.getState();
const flow = () => props as ReactFlowProps<FlowNode>;

describe('Canvas handlers', () => {
  beforeEach(() => {
    geometry = { nodes: [], preparationMs: 0 };
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
    expect(flow().edgeTypes).toEqual({ orthogonal: OrthogonalEdge });
    expect(flow().edges!.find((e) => e.id === 'e1')!.label).toBeUndefined();
  });

  it('uses routed geometry only for backward edges and deletes loopBack with its config', () => {
    const definition = simpleLoop();
    geometry = { nodes: routingInput(definition).nodes, preparationMs: 0 };
    store().load('L1', definition);
    const view = renderCanvas([]);
    const back = flow().edges!.find((e) => e.id === 'return')!;
    expect(back).toMatchObject({
      type: 'orthogonal',
      label: 'loopBack',
      animated: true,
      ariaLabel: 'done loopBack to work',
      data: { forward: false, suspended: false },
    });
    const { channel } = back.data as OrthogonalEdgeData;
    expect(channel.getSnapshot()).toMatchObject({ blocked: false });
    const previousPath = channel.getSnapshot();
    const measured = structuredClone(geometry.nodes);
    measured[3]!.outputs['loopBack']!.y += 10;
    geometry = { nodes: measured, preparationMs: 0 };
    const previousEdges = flow().edges;
    view.rerender(<Canvas definition={store().definition!} issues={[]} />);
    expect(channel.getSnapshot()).not.toBe(previousPath);
    expect(flow().edges).toBe(previousEdges);
    expect(flow().edges!.find((e) => e.id === 'start-work')!.type).toBe('smoothstep');
    const forward = flow().edges!.find((e) => e.id === 'start-work');
    act(() => flow().onEdgesChange!([{ type: 'select', id: 'return', selected: true }]));
    expect(flow().edges!.find((e) => e.id === 'return')).toMatchObject({
      selected: true,
      zIndex: 2000,
    });
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
    geometry = { nodes, preparationMs: 0 };
    store().load('L1', definition);
    renderCanvas([]);
    expect(flow().edges!.find((e) => e.id === 'return')!.ariaLabel).toContain(
      'Port covered by a card',
    );
  });

  it('waits for measurements of decision returns and self-loops without drawing a crossing fallback', () => {
    store().load('L1', decisionBackRoute());
    renderCanvas([]);
    expect(flow().edges!.find((e) => e.id === 'retry')).toMatchObject({ type: 'orthogonal' });
    expect(flow().edges!.find((e) => e.id === 'self')).toMatchObject({ type: 'orthogonal' });
    expect(flow().edges!.find((e) => e.id === 'finish')!.type).toBe('smoothstep');
    // A horizontal move may change direction before the next handle measurement arrives.
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'decide', position: { x: 80, y: 100 }, dragging: true },
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
    const clickNode = flow().onNodeClick;
    const clickPane = flow().onPaneClick;
    // Validation ran again: new but equal issue objects, and a new issue on another node.
    const other: EditorIssue = { ...ISSUE, nodeId: 'infer' };
    view.rerender(<Canvas definition={store().definition!} issues={[{ ...ISSUE }, other]} />);
    expect(data('prep')).toBe(prep);
    expect(data('infer')).not.toBe(infer);
    expect(data('infer').issues).toEqual([other]);
    expect(flow().nodes!.find((n) => n.id === 'check')).toBe(unchangedNode);
    expect(flow().edges).toBe(unchangedEdges);
    expect(flow().onNodeClick).toBe(clickNode);
    expect(flow().onPaneClick).toBe(clickPane);
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

  it.each([false, true])(
    'keeps the replacement edge selected in either callback order (replacement first: %s)',
    (replacementFirst) => {
      renderCanvas();
      act(() => flow().onEdgesChange!([{ type: 'select', id: 'e11', selected: true }]));
      const changes = [
        { type: 'select' as const, id: 'e1', selected: true },
        { type: 'select' as const, id: 'e11', selected: false },
      ];
      act(() => flow().onEdgesChange!(replacementFirst ? changes : [...changes].reverse()));
      expect(
        flow()
          .edges!.filter((e) => e.selected)
          .map((e) => e.id),
      ).toEqual(['e1']);
      // A deselection for some other edge cannot clear the current one.
      act(() => flow().onEdgesChange!([{ type: 'select', id: 'e11', selected: false }]));
      expect(flow().edges!.find((e) => e.id === 'e1')!.selected).toBe(true);
      act(() => flow().onEdgesChange!([{ type: 'select', id: 'e1', selected: false }]));
      expect(flow().edges!.some((e) => e.selected)).toBe(false);
    },
  );
});

describe('manual edge routes (#44)', () => {
  let clock = 0;
  beforeEach(() => {
    // jsdom does not lay out SVG text; xyflow measures label pills with getBBox.
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 56, height: 11 }),
    });
    drawEdges = true;
    clock = 0;
    vi.spyOn(historyClock, 'now').mockImplementation(() => clock);
    const definition = simpleLoop();
    geometry = { nodes: routingInput(definition).nodes, preparationMs: 0 };
    store().load('L1', definition);
  });
  afterEach(() => {
    drawEdges = false;
    vi.restoreAllMocks();
  });

  /** The canvas as the editor page renders it: on the store's current definition. */
  function Live() {
    const definition = useEditorStore((s) => s.definition)!;
    return <Canvas definition={definition} issues={[]} />;
  }
  const route = (id: string) => store().definition!.edges.find((e) => e.id === id)!.ui?.route;
  const select = (id: string) =>
    act(() => flow().onEdgesChange!([{ type: 'select', id, selected: true }]));
  const handle = (name: string) => screen.getByRole('button', { name });
  const labels = () => store().past.map((entry) => entry.label);
  const edge = (id: string) => flow().edges!.find((e) => e.id === id)!;
  /** Move a card in the routing geometry (xyflow's measurement) and in the store (the drop). */
  const moveCard = (id: string, x: number, y: number) => {
    geometry = {
      nodes: geometry.nodes.map((n) => {
        if (n.id !== id) return n;
        const shift = (p: { x: number; y: number }) => ({ x: p.x + x - n.x, y: p.y + y - n.y });
        return {
          ...n,
          x,
          y,
          outputs: Object.fromEntries(Object.entries(n.outputs).map(([k, p]) => [k, shift(p)])),
          ...(n.input ? { input: shift(n.input) } : {}),
        };
      }),
      preparationMs: 0,
    };
  };

  it('drags a forward edge segment into a manual route in one undo step, and resets it', () => {
    render(<Live />);
    expect(edge('start-work').type).toBe('smoothstep');
    select('start-work');
    // Selected, the forward edge shows its smoothstep path's segments: stub, trunk, stub.
    expect(edge('start-work').type).toBe('orthogonal');
    const trunk = handle('Route segment 2 of 3, vertical');
    // The press closes the open step, so the drag is a step of its own (as for a node drag).
    act(() => store().moveNode('check', { x: 610, y: 100 }));
    expect(store().openStep).toBeDefined();
    fireEvent.pointerDown(trunk, { button: 0, clientX: 10, clientY: 10 });
    expect(store().openStep).toBeUndefined();
    fireEvent.pointerMove(window, { clientX: 25, clientY: 90 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 90 });
    // The preview is routed (and drawn) while the store waits for the release.
    expect(route('start-work')).toBeUndefined();
    expect(edge('start-work').ariaLabel).toBe('start out to work, manual route');
    fireEvent.pointerUp(window);
    expect(route('start-work')).toEqual([272]);
    expect(labels()).toEqual(['move check', 'reroute start to work']);
    expect(screen.getByText('Route changed.')).toBeInTheDocument();
    // A later move of the released pointer changes nothing.
    fireEvent.pointerMove(window, { clientX: 400, clientY: 10 });
    expect(route('start-work')).toEqual([272]);

    fireEvent.click(handle('Reset route'));
    expect(route('start-work')).toBeUndefined();
    expect(labels()).toEqual([
      'move check',
      'reroute start to work',
      'reset route of start to work',
    ]);
    expect(
      screen.getByText('Route reset: the connection routes automatically.'),
    ).toBeInTheDocument();
    act(() => store().undo());
    expect(route('start-work')).toEqual([272]);
    act(() => store().redo());
    expect(route('start-work')).toBeUndefined();
  });

  it('nudges a loop-back lane by grid lines as one step, through cards when the author wants', () => {
    render(<Live />);
    select('return');
    const lane = () => handle('Route segment 3 of 5, horizontal');
    expect((edge('return').data as OrthogonalEdgeData).forward).toBe(false);
    fireEvent.keyDown(lane(), { key: 'ArrowDown' });
    expect(route('return')).toEqual([1116, 264, 268]);
    expect(screen.getByText('Segment at y 264.')).toBeInTheDocument();
    clock += 100;
    fireEvent.keyDown(lane(), { key: 'ArrowUp' });
    expect(route('return')![1]).toBe(242);
    // Up again runs the lane through the row of cards: kept, drawn dotted, and announced.
    clock += 100;
    fireEvent.keyDown(lane(), { key: 'ArrowUp' });
    expect(route('return')![1]).toBe(220);
    expect(screen.getByText('Segment at y 220. It crosses a card.')).toBeInTheDocument();
    expect(edge('return').ariaLabel).toBe('done loopBack to work, manual route, crosses a card');
    expect(screen.getByText('Crosses a card')).toBeInTheDocument();
    // Shift moves five grid lines: out above the cards again.
    clock += 100;
    fireEvent.keyDown(lane(), { key: 'ArrowUp', shiftKey: true });
    expect(route('return')![1]).toBe(110);
    clock += 100;
    fireEvent.keyDown(lane(), { key: 'ArrowUp' });
    expect(route('return')![1]).toBe(88);
    // Arrows across the segment do nothing; the whole run of nudges is one step.
    fireEvent.keyDown(lane(), { key: 'ArrowLeft' });
    expect(labels()).toEqual(['reroute done loopBack to work']);
    act(() => store().undo());
    expect(route('return')).toBeUndefined();
  });

  it('keeps a drag where it is released, even across a card, and Escape cancels a drag', () => {
    render(<Live />);
    select('return');
    const press = () =>
      fireEvent.pointerDown(handle('Route segment 3 of 5, horizontal'), {
        button: 0,
        clientX: 0,
        clientY: 0,
      });
    press();
    fireEvent.pointerMove(window, { clientX: 0, clientY: 60 });
    fireEvent.keyDown(window, { key: 'Shift' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window);
    expect(route('return')).toBeUndefined();
    // A press that never moves is not an edit, and a cancelled pointer keeps nothing.
    press();
    fireEvent.pointerUp(window);
    press();
    fireEvent.pointerMove(window, { clientX: 0, clientY: 60 });
    fireEvent.pointerCancel(window);
    expect(store().past).toHaveLength(0);
    press();
    fireEvent.pointerMove(window, { clientX: 0, clientY: -90 });
    // The preview across the cards is drawn dotted while it is held there.
    expect(document.querySelector('.gg-route-crossing')).not.toBeNull();
    fireEvent.pointerUp(window);
    expect(route('return')).toEqual([1116, 164, 268]);
    expect(screen.getByText('Route changed. It crosses a card.')).toBeInTheDocument();
  });

  it.each([false, true])(
    'resets a moved-card crossing only when the forward replacement is clear (obstacle: %s)',
    (obstacle) => {
      const definition = simpleLoop();
      const positions = [
        { x: 0, y: 0 },
        { x: 700, y: 0 },
        { x: 330, y: obstacle ? 0 : -200 },
        { x: 330, y: 500 },
      ];
      definition.nodes.forEach((n, i) => {
        n.ui = positions[i]!;
      });
      const stored = [250, 300, 650];
      definition.edges.find((e) => e.id === 'start-work')!.ui = { route: stored };
      geometry = {
        preparationMs: 0,
        nodes: definition.nodes.map((n) => ({
          id: n.id,
          ...n.ui!,
          width: 184,
          height: 122,
          outputs: {
            out: { x: n.ui!.x + 190, y: n.ui!.y + 61 },
            loopBack: { x: n.ui!.x + 190, y: n.ui!.y + 61 },
          },
          input: { x: n.ui!.x - 6, y: n.ui!.y + 61 },
        })),
      };
      store().load('L1', definition);
      render(<Live />);
      expect(edge('start-work').ariaLabel).toBe('start out to work, manual route');
      const mover = flow().nodes!.find((n) => n.id === 'done')!;
      act(() => flow().onNodeDragStart!({} as never, mover, [mover]));
      moveCard('done', 330, 250);
      act(() =>
        flow().onNodesChange!([
          { type: 'position', id: 'done', position: { x: 330, y: 250 }, dragging: false },
        ]),
      );
      expect(route('start-work')).toEqual(obstacle ? stored : undefined);
      expect(labels()).toEqual(['move done']);
      if (obstacle) {
        expect(edge('start-work').ariaLabel).toContain('manual route, crosses a card');
        expect(document.querySelector('.gg-route-crossing')).not.toBeNull();
        select('start-work');
        expect(screen.getByText('Crosses a card')).toBeInTheDocument();
        expect(
          screen.getByText(/kept because the automatic replacement crosses a card/),
        ).toBeInTheDocument();
      } else expect(edge('start-work').type).toBe('smoothstep');
      act(() => store().undo());
      expect(route('start-work')).toEqual(stored);
      expect(store().definition!.nodes.find((n) => n.id === 'done')!.ui).toEqual({
        x: 330,
        y: 500,
      });
    },
  );

  it('lets a moved card take a manual route back to automatic, in the move’s own undo step', () => {
    const definition = simpleLoop();
    definition.edges.find((e) => e.id === 'return')!.ui = { route: [1116, 290, 268] };
    store().load('L1', definition);
    render(<Live />);
    expect(edge('return').ariaLabel).toBe('done loopBack to work, manual route');
    // Dragging `check` down onto the lane: the route is set aside while the card is over it.
    const check = flow().nodes!.find((n) => n.id === 'check')!;
    act(() => flow().onNodeDragStart!({} as never, check, [check]));
    moveCard('check', 600, 240);
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'check', position: { x: 600, y: 240 }, dragging: true },
      ]),
    );
    expect(edge('return').ariaLabel).toBe(
      'done loopBack to work, manual route set aside under a moving card',
    );
    expect(edge('return').data).toMatchObject({ suspended: true });
    // Released there: the route is removed in the move's step and the edge routes automatically.
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'check', position: { x: 600, y: 240 }, dragging: false },
      ]),
    );
    act(() => flow().onNodeDragStop!({} as never, { ...check, position: { x: 600, y: 240 } }, []));
    expect(route('return')).toBeUndefined();
    expect(labels()).toEqual(['move check']);
    expect(
      screen.getByText('A manual route would cross a card and now routes automatically.'),
    ).toBeInTheDocument();
    act(() => store().undo());
    expect(route('return')).toEqual([1116, 290, 268]);
    expect(store().definition!.nodes.find((n) => n.id === 'check')!.ui).toEqual({ x: 600, y: 100 });
    // A move that keeps the route clear keeps the route (the stubs follow the ports).
    moveCard('check', 600, 100);
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'done', position: { x: 920, y: 120 }, dragging: false },
      ]),
    );
    expect(route('return')).toEqual([1116, 290, 268]);
  });

  it.each([false, true])(
    'protects a deliberately crossing route against a new source-card crossing (new: %s)',
    (addsCrossing) => {
      const definition = simpleLoop();
      const stored = [240, 80, 650, 240, 270];
      definition.edges.find((e) => e.id === 'start-work')!.ui = { route: stored };
      store().load('L1', definition);
      const crossed = () => {
        const from = geometry.nodes.find((n) => n.id === 'start')!.outputs['out']!;
        const to = geometry.nodes.find((n) => n.id === 'work')!.input!;
        const points = drawnPoints(stored, from, to);
        return geometry.nodes
          .filter((n) =>
            crossesCards(points, [
              {
                id: n.id,
                left: n.x,
                right: n.x + n.width,
                top: n.y,
                bottom: n.y + n.height,
              },
            ]),
          )
          .map((n) => n.id);
      };
      expect(crossed()).toEqual(['check']);
      render(<Live />);
      const start = flow().nodes!.find((n) => n.id === 'start')!;
      act(() => flow().onNodeDragStart!({} as never, start, [start]));
      const position = { x: addsCrossing ? 80 : -20, y: 100 };
      moveCard('start', position.x, position.y);
      expect(crossed()).toEqual(addsCrossing ? ['start', 'check'] : ['check']);
      act(() =>
        flow().onNodesChange!([{ type: 'position', id: 'start', position, dragging: true }]),
      );
      expect(edge('start-work').type).toBe(addsCrossing ? 'smoothstep' : 'orthogonal');
      expect(route('start-work')).toEqual(stored);
      expect(edge('start-work').ariaLabel).toContain(
        addsCrossing
          ? 'manual route set aside under a moving card'
          : 'manual route, crosses a card',
      );
      act(() =>
        flow().onNodesChange!([{ type: 'position', id: 'start', position, dragging: false }]),
      );
      act(() => flow().onNodeDragStop!({} as never, { ...start, position }, []));
      expect(route('start-work')).toEqual(addsCrossing ? undefined : stored);
      expect(labels()).toEqual(['move start']);
      act(() => store().undo());
      expect(route('start-work')).toEqual(stored);
      expect(store().definition!.nodes.find((n) => n.id === 'start')!.ui).toEqual({ x: 0, y: 100 });
    },
  );

  it.each(['drag', 'nudge'])(
    'refuses a %s that splits a 63-coordinate route, keeping the valid draft',
    (edit) => {
      const from = geometry.nodes[0]!.outputs['out']!;
      const to = geometry.nodes[1]!.input!;
      let stored = [240];
      for (let i = 0; i < 31; i += 1)
        stored = normalize(moveSegment(stored, 1, i % 2 ? 242 : 220, from, to).route, from, to);
      expect(stored).toHaveLength(63);
      expect(normalize(moveSegment(stored, 1, 264, from, to).route, from, to)).toHaveLength(65);
      store().setEdgeRoute('start-work', stored);
      render(<Live />);
      select('start-work');
      const before = store();
      const first = handle('Route segment 1 of 65, horizontal');
      if (edit === 'drag') {
        fireEvent.pointerDown(first, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(window, { clientX: 0, clientY: 64 });
        fireEvent.pointerUp(window);
      } else {
        first.focus();
        fireEvent.keyDown(first, { key: 'ArrowUp' });
        expect(first).toHaveFocus();
      }
      expect(route('start-work')).toEqual(stored);
      expect(store().revision).toBe(before.revision);
      expect(store().past).toEqual(before.past);
      expect(LoopDefinitionSchema.safeParse(store().definition).success).toBe(true);
      expect(
        screen.getByText('This route has as many segments as a route can hold'),
      ).toBeInTheDocument();
    },
  );

  it('keeps the store valid through 32 alternating edits of the first stub from one coordinate', () => {
    store().setEdgeRoute('start-work', [240]);
    render(<Live />);
    select('start-work');
    let lastValid: number[] | undefined;
    for (let i = 0; i < 32; i += 1) {
      fireEvent.keyDown(
        handle(`Route segment 1 of ${route('start-work')!.length + 2}, horizontal`),
        {
          key: i % 2 ? 'ArrowUp' : 'ArrowDown',
        },
      );
      expect(route('start-work')).toHaveLength(1 + 2 * Math.min(i + 1, 31));
      expect(EdgeRouteSchema.safeParse(route('start-work')).success).toBe(true);
      expect(LoopDefinitionSchema.safeParse(store().definition).success).toBe(true);
      if (i === 30) lastValid = route('start-work');
    }
    expect(route('start-work')).toEqual(lastValid);
    expect(
      screen.getByText('This route has as many segments as a route can hold'),
    ).toBeInTheDocument();
  });

  it('keeps a nudge immediately after a route drag in its own undo step', () => {
    render(<Live />);
    select('return');
    const lane = () => handle('Route segment 3 of 5, horizontal');
    fireEvent.pointerDown(lane(), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40 });
    fireEvent.pointerUp(window);
    const dragged = route('return');
    expect(dragged).toBeDefined();
    expect(store().openStep).toBeUndefined();
    clock += 100;
    fireEvent.keyDown(lane(), { key: 'ArrowDown' });
    expect(route('return')).not.toEqual(dragged);
    expect(labels()).toEqual(['reroute done loopBack to work', 'reroute done loopBack to work']);
    act(() => store().undo());
    expect(route('return')).toEqual(dragged);
    act(() => store().undo());
    expect(route('return')).toBeUndefined();
  });
});
