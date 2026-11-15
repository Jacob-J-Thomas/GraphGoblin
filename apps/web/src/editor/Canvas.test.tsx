import {
  EdgeRouteSchema,
  LoopDefinitionSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Position, type ReactFlowProps } from '@xyflow/react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePopovers, Popover } from '../components/ui/index.js';
import { buildCardData, Canvas, canvasFocusTarget, createLoopBackCache } from './Canvas.js';
import type { EditorIssue } from './model.js';
import type { FlowNode } from './NodeCard.js';
import { useEditorStore } from './store.js';
import {
  decisionBackRoute,
  forwardLoopBack,
  routingInput,
  simpleLoop,
} from '../__fixtures__/routing.js';
import { OrthogonalEdge, type OrthogonalEdgeData } from './OrthogonalEdge.js';
import { ForwardEdge } from './ForwardEdge.js';
import type { RoutingGeometry } from './useRouting.js';
import type { RoutingNode } from './routing.js';
import { drawnPoints, crossesCards, moveSegment, normalize } from './manual-route.js';
import { strandedEdges } from './stranded-edges.js';

let props: ReactFlowProps<FlowNode> | undefined;
const geometryOf = (nodes: readonly RoutingNode[]): RoutingGeometry => ({
  nodes,
  preparationMs: 0,
  outputOrder: new Map(nodes.map((node) => [node.id, Object.keys(node.outputs)])),
});
let geometry: RoutingGeometry = geometryOf([]);
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
    geometry = geometryOf([]);
    store().load('L1', kitchenSinkLoop());
  });

  const ISSUE: EditorIssue = { code: 'X', severity: 'error', message: 'm', nodeId: 'prep' };

  function renderCanvas(issues: EditorIssue[] = [ISSUE]) {
    const def = store().definition!;
    return render(<Canvas definition={def} issues={issues} />);
  }

  const data = (id: string) => flow().nodes!.find((n) => n.id === id)!.data;

  it('does not resettle labels for a committed card position or an issue refresh', () => {
    const definition = decisionBackRoute();
    geometry = geometryOf(routingInput(definition).nodes);
    store().load('L1', definition);
    const view = renderCanvas([]);
    const measure = vi.spyOn(performance, 'measure');
    const committed = {
      ...definition,
      nodes: definition.nodes.map((node) => ({
        ...node,
        ui: { x: (node.ui?.x ?? 0) + 10, y: node.ui?.y ?? 0 },
      })),
    };
    view.rerender(<Canvas definition={committed} issues={[]} />);
    view.rerender(<Canvas definition={committed} issues={[{ ...ISSUE, nodeId: 'done' }]} />);
    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
  });

  it('maps the definition to nodes with ports and issues, and edges with labels', () => {
    renderCanvas();
    const prep = flow().nodes!.find((n) => n.id === 'prep')!;
    expect(prep.data).toMatchObject({ ports: ['out'], issues: [ISSUE] });
    expect(data('infer').issues).toEqual([]);
    const decide = flow().nodes!.find((n) => n.id === 'decide')!;
    expect(decide.data.ports).toEqual(['good', 'bad']);
    expect(flow().edgeTypes).toEqual({ orthogonal: OrthogonalEdge, smoothstep: ForwardEdge });
    expect(flow().edges!.find((e) => e.id === 'e1')!.label).toBeUndefined();
  });

  it('uses routed geometry for backward edges and preserves gate settings on edge deletion', () => {
    const definition = simpleLoop();
    geometry = geometryOf(routingInput(definition).nodes);
    store().load('L1', definition);
    const view = renderCanvas([]);
    const back = flow().edges!.find((e) => e.id === 'return')!;
    expect(back).toMatchObject({
      type: 'orthogonal',
      label: 'Repeat',
      animated: true,
      ariaLabel: 'done Repeat (repeat) to work',
      data: { forward: false, suspended: false },
    });
    const { channel } = back.data as OrthogonalEdgeData;
    expect(channel.getSnapshot()).toMatchObject({ blocked: false });
    const previousPath = channel.getSnapshot();
    const measured = structuredClone(geometry.nodes);
    measured[3]!.outputs['repeat']!.y += 10;
    geometry = geometryOf(measured);
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
    expect(store().definition!.nodes.find((n) => n.id === 'done')!.config).toHaveProperty(
      'maxPasses',
      3,
    );
    expect(store().past).toHaveLength(1);
    act(() => store().undo());
    expect(store().definition!.nodes.find((n) => n.id === 'done')!.config).toHaveProperty(
      'maxPasses',
      3,
    );
  });

  it('names an obstructed edge for keyboard users', () => {
    const definition = simpleLoop();
    const { nodes } = routingInput(definition);
    nodes.push({ ...nodes[0]!, id: 'cover', x: 1000 });
    geometry = geometryOf(nodes);
    store().load('L1', definition);
    renderCanvas([]);
    expect(flow().edges!.find((e) => e.id === 'return')!.ariaLabel).toContain(
      'Port covered by a card',
    );
  });

  it('waits for measurements of decision returns and self-loops without drawing a crossing fallback', () => {
    store().load('L1', decisionBackRoute());
    renderCanvas([]);
    // Neither route is marked Repeat: both are loop-backs by topology (#449).
    for (const id of ['retry', 'self'])
      expect(flow().edges!.find((e) => e.id === id)).toMatchObject({
        type: 'orthogonal',
        animated: true,
        className: 'gg-edge-loop',
      });
    expect(flow().edges!.find((e) => e.id === 'finish')!.type).toBe('smoothstep');
    const drag = (x: number) =>
      act(() =>
        flow().onNodesChange!([
          { type: 'position', id: 'decide', position: { x, y: 100 }, dragging: true },
        ]),
      );
    // A loop-back keeps its return shape wherever its cards are drawn.
    drag(80);
    expect(flow().edges!.find((e) => e.id === 'retry')!.type).toBe('orthogonal');
    // An ordinary connection may change direction before the next handle measurement arrives,
    // and is routed backward without taking the loop-back style.
    drag(1000);
    const finish = flow().edges!.find((e) => e.id === 'finish')!;
    expect(finish.type).toBe('orthogonal');
    expect(finish).not.toHaveProperty('animated');
    expect(finish).not.toHaveProperty('className');
  });

  it('keeps a measured labelled forward connection smoothstep', () => {
    const definition = decisionBackRoute();
    geometry = geometryOf(routingInput(definition).nodes);
    store().load('L1', definition);
    renderCanvas([]);
    const finish = flow().edges!.find((e) => e.id === 'finish')!;
    expect(finish.label).toBeTruthy();
    expect(finish.type).toBe('smoothstep');
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
    // A mouse pan's move closes them too (#207 adds the toolbar gate to the same callback).
    toggle('Inside');
    act(() => flow().onMove!(new MouseEvent('mousemove'), { x: 30, y: 0, zoom: 1 }));
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

  describe('a refused drop says why (#207)', () => {
    type EndState = Parameters<NonNullable<ReactFlowProps['onConnectEnd']>>[1];
    const end = (nodeId: string, id: string | null, type: 'source' | 'target') => ({
      nodeId,
      id,
      type,
      x: 0,
      y: 0,
      position: type === 'source' ? Position.Right : Position.Left,
      width: 8,
      height: 8,
    });
    const drop = (
      from: ReturnType<typeof end> | null,
      to: ReturnType<typeof end> | null,
      isValid: boolean | null,
    ) =>
      act(() =>
        flow().onConnectEnd!(new MouseEvent('mouseup'), {
          isValid,
          fromHandle: from,
          toHandle: to,
        } as unknown as EndState),
      );
    const occupied = /^port "out" of "prep" is already connected\. To connect it elsewhere/;
    const notice = () => store().connectionError;
    beforeEach(() => useEditorStore.setState({ connectionError: undefined }));

    it('names the reason for a drop on a port, whichever end the drag started from', () => {
      renderCanvas();
      drop(end('prep', 'out', 'source'), end('done', 'in', 'target'), false);
      expect(notice()).toMatch(occupied);
      act(() => useEditorStore.setState({ connectionError: undefined }));
      // Dragged from the input to the output: the real tuple is still prep.out -> done.
      drop(end('done', 'in', 'target'), end('prep', 'out', 'source'), false);
      expect(notice()).toMatch(occupied);
      // xyflow reports a port under the pointer but outside its radius as neither valid nor not.
      act(() => useEditorStore.setState({ connectionError: undefined }));
      drop(end('prep', 'out', 'source'), end('done', 'in', 'target'), null);
      expect(notice()).toMatch(occupied);
      // A handle with no id is the default output.
      act(() => useEditorStore.setState({ connectionError: undefined }));
      drop(end('prep', null, 'source'), end('done', 'in', 'target'), false);
      expect(notice()).toMatch(occupied);
      expect(store().definition!.edges.filter((e) => e.from.node === 'prep')).toHaveLength(1);
    });

    it('says nothing for the pane, a port of the same type, or a drop that connected', () => {
      renderCanvas();
      act(() => useEditorStore.setState({ connectionError: 'an earlier refusal' }));
      drop(end('prep', 'out', 'source'), null, null);
      drop(end('prep', 'out', 'source'), end('infer', 'out', 'source'), false);
      drop(end('infer', 'in', 'target'), end('done', 'in', 'target'), false);
      drop(end('prep', 'out', 'source'), end('done', 'in', 'target'), true);
      // The earlier notice is neither replaced nor repeated by an unrelated reason.
      expect(notice()).toBe('an earlier refusal');
      expect(store().definition!.edges.filter((e) => e.from.node === 'prep')).toHaveLength(1);
      expect(store().past).toHaveLength(0);
    });

    it('reports a stale or unknown end the canvas offers no handle for (controlled callback)', () => {
      renderCanvas();
      // No rendered handle exists for these; the callback is driven directly, defensively.
      drop(end('gone', 'out', 'source'), end('done', 'in', 'target'), false);
      expect(notice()).toBe('unknown node');
      drop(end('start', 'out', 'source'), end('nightly', 'in', 'target'), false);
      expect(notice()).toBe('triggers have no input');
    });

    it('explains a refused click-connect from the handles clicked, and not one that connected', () => {
      renderCanvas();
      const handle = (nodeId: string, id: string, type: 'source' | 'target') => {
        const element = document.createElement('div');
        element.className = `react-flow__handle ${type}`;
        element.dataset['nodeid'] = nodeId;
        element.dataset['handleid'] = id;
        const inner = element.appendChild(document.createElement('span'));
        return inner;
      };
      const click = (target: Element) =>
        act(() =>
          flow().onClickConnectEnd!(
            { target } as unknown as MouseEvent,
            {
              isValid: null,
              fromHandle: null,
              toHandle: null,
            } as unknown as EndState,
          ),
        );
      const start = (nodeId: string, handleId: string, handleType: 'source' | 'target') =>
        act(() =>
          flow().onClickConnectStart!(new MouseEvent('click'), { nodeId, handleId, handleType }),
        );
      // Output then an input: occupied.
      start('prep', 'out', 'source');
      click(handle('done', 'in', 'target'));
      expect(notice()).toMatch(occupied);
      // Input then output (reversed), and again with no start: no new notice.
      act(() => useEditorStore.setState({ connectionError: undefined }));
      start('done', 'in', 'target');
      click(handle('prep', 'out', 'source'));
      expect(notice()).toMatch(occupied);
      act(() => useEditorStore.setState({ connectionError: undefined }));
      click(handle('prep', 'out', 'source'));
      start('prep', 'out', 'source');
      click(handle('infer', 'out', 'source'));
      start('prep', 'out', 'source');
      click(document.createElement('div'));
      expect(notice()).toBeUndefined();
      // A handle without an id is the default output; a start without a node, or a click that is
      // not on an element, says nothing.
      const bare = handle('done', 'in', 'target');
      delete bare.parentElement!.dataset['handleid'];
      start('prep', 'out', 'source');
      click(bare);
      expect(notice()).toMatch(occupied);
      act(() => useEditorStore.setState({ connectionError: undefined }));
      act(() =>
        flow().onClickConnectStart!(new MouseEvent('click'), {
          nodeId: null,
          handleId: null,
          handleType: null,
        }),
      );
      click(handle('done', 'in', 'target'));
      start('prep', 'out', 'source');
      act(() =>
        flow().onClickConnectEnd!(
          { target: null } as unknown as MouseEvent,
          {
            isValid: null,
            fromHandle: null,
            toHandle: null,
          } as unknown as EndState,
        ),
      );
      expect(notice()).toBeUndefined();
      // A click that connected (xyflow called onConnect first) refuses nothing afterwards.
      act(() => store().removeEdge('e3'));
      renderCanvas();
      start('prep', 'out', 'source');
      act(() =>
        // xyflow may name the default output by no id at all.
        flow().onConnect!({
          source: 'prep',
          sourceHandle: null,
          target: 'infer',
          targetHandle: 'in',
        }),
      );
      click(handle('infer', 'in', 'target'));
      expect(notice()).toBeUndefined();
      expect(store().definition!.edges.filter((e) => e.from.node === 'prep')).toHaveLength(1);
    });
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

describe('loop-back edges from the graph topology (#449)', () => {
  beforeEach(() => {
    geometry = geometryOf([]);
  });

  function Live() {
    const definition = useEditorStore((s) => s.definition)!;
    return <Canvas definition={definition} issues={[]} />;
  }
  const edge = (id: string) => flow().edges!.find((e) => e.id === id)!;
  const isLoopBack = (id: string) => {
    const e = edge(id);
    expect(!!e.animated, id).toBe(e.className === 'gg-edge-loop');
    return !!e.animated;
  };
  const routed = (id: string) => (edge(id).data as OrthogonalEdgeData | undefined)?.channel;
  const config = (id: string) => store().definition!.nodes.find((n) => n.id === id)!.config;
  /** A Simple loop whose gate has no Repeat marker, maximum passes or Limit reached port. */
  function unmarked() {
    const definition = simpleLoop();
    const gate = definition.nodes.find((n) => n.id === 'done')!;
    gate.config = {
      kind: 'expression',
      jsonata: '"repeat"',
      routes: [
        { id: 'repeat', label: 'Repeat' },
        { id: 'finish', label: 'Finish' },
      ],
    };
    return definition;
  }

  it('styles and routes a return by topology, with or without Repeat, and never a forward edge', () => {
    for (const definition of [simpleLoop(), unmarked()]) {
      geometry = geometryOf(routingInput(definition).nodes);
      store().load('L1', definition);
      const view = render(<Live />);
      expect(isLoopBack('return')).toBe(true);
      expect(edge('return')).toMatchObject({ type: 'orthogonal', data: { forward: false } });
      expect(routed('return')!.getSnapshot()).toMatchObject({ blocked: false, unavailable: false });
      for (const id of ['start-work', 'work-check', 'check-done']) {
        expect(isLoopBack(id), id).toBe(false);
        expect(edge(id).type).toBe('smoothstep');
      }
      view.unmount();
    }
    // A return from an ordinary node (a script's exit-code port) is a loop-back too.
    const script = unmarked();
    script.nodes.find((n) => n.id === 'check')!.config = {
      command: 'node',
      exitCodeRoutes: { '1': 'again' },
    };
    script.edges.push({
      id: 'again',
      from: { node: 'check', port: 'again' },
      to: { node: 'work' },
    });
    geometry = geometryOf(routingInput(script).nodes);
    store().load('L1', script);
    render(<Live />);
    expect(isLoopBack('again')).toBe(true);
    expect(edge('again').type).toBe('orthogonal');
  });

  it('routes a return drawn forward, and draws a backward forward step without the loop style', () => {
    const definition = forwardLoopBack();
    geometry = geometryOf(routingInput(definition).nodes);
    store().load('L1', definition);
    render(<Live />);
    // `return` points right on the canvas yet goes back to `work`, which every path visits first.
    expect(isLoopBack('return')).toBe(true);
    expect(edge('return')).toMatchObject({ type: 'orthogonal', data: { forward: false } });
    expect(routed('return')!.getSnapshot()!.points.length).toBeGreaterThan(2);
    // `work-done` points left: routed backward by the canvas direction (#18), styled as ordinary.
    expect(isLoopBack('work-done')).toBe(false);
    expect(edge('work-done')).toMatchObject({ type: 'orthogonal', data: { forward: false } });
    expect(routed('work-done')!.getSnapshot()!.points.length).toBeGreaterThan(2);
    expect(isLoopBack('begin')).toBe(false);
    expect(edge('begin').type).toBe('smoothstep');
  });

  it('restyles and reroutes after a bypass is added, removed, undone and redone, keeping the definition', () => {
    const definition = forwardLoopBack();
    geometry = geometryOf(routingInput(definition).nodes);
    store().load('L1', definition);
    const gate = structuredClone(config('done'));
    render(<Live />);
    const begin = edge('begin');
    const loop = edge('return');
    expect(isLoopBack('return')).toBe(true);

    // A second entry straight into the gate: `work` is no longer on every path to `done`.
    act(() => {
      const side = store().addNode('trigger', { x: -300, y: -300 });
      store().connect({ source: side, sourceHandle: 'out', target: 'done' });
    });
    const bypass = store().definition!.edges.find(
      (e) => e.to.node === 'done' && e.id !== 'work-done',
    )!.id;
    const ordinary = edge('return');
    expect(ordinary).not.toBe(loop);
    expect(isLoopBack('return')).toBe(false);
    // The geometry follows: drawn forward and no longer a loop-back, it leaves the router.
    expect(ordinary.type).toBe('smoothstep');
    expect(edge('begin')).toBe(begin);

    act(() => store().removeEdge(bypass));
    expect(isLoopBack('return')).toBe(true);
    expect(edge('return')).toMatchObject({ type: 'orthogonal', data: { forward: false } });
    expect(edge('return')).not.toBe(ordinary);
    expect(routed('return')!.getSnapshot()!.points.length).toBeGreaterThan(2);

    act(() => store().undo());
    expect(store().definition!.edges.some((e) => e.id === bypass)).toBe(true);
    expect(isLoopBack('return')).toBe(false);
    expect(edge('return').type).toBe('smoothstep');
    act(() => store().redo());
    expect(isLoopBack('return')).toBe(true);
    expect(edge('return').type).toBe('orthogonal');

    // Styling never writes to the definition: the gate keeps exactly its authored settings.
    expect(config('done')).toEqual(gate);
    expect(store().definition!.edges.find((e) => e.id === 'return')).toEqual(
      definition.edges.find((e) => e.id === 'return'),
    );
  });

  it('keeps a loop-back through moves and selection, and restores it with an undone deletion', () => {
    const definition = unmarked();
    geometry = geometryOf(routingInput(definition).nodes);
    store().load('L1', definition);
    const view = render(<Live />);
    act(() => store().moveNode('check', { x: 600, y: 400 }));
    expect(isLoopBack('return')).toBe(true);
    act(() => flow().onEdgesChange!([{ type: 'select', id: 'return', selected: true }]));
    expect(edge('return')).toMatchObject({ selected: true, animated: true, type: 'orthogonal' });
    fireEvent.keyDown(view.getByTestId('canvas'), { key: 'Delete' });
    expect(store().definition!.edges.some((e) => e.id === 'return')).toBe(false);
    act(() => store().undo());
    expect(isLoopBack('return')).toBe(true);
    // Removing the cycle's forward step leaves `done` unreachable: its edge is ordinary.
    act(() => store().removeEdge('check-done'));
    expect(isLoopBack('return')).toBe(false);
  });

  it('classifies again only when node ids, kinds, ports or edge ends change', () => {
    const cache = createLoopBackCache();
    const definition = unmarked();
    const data = buildCardData(definition, [], new Map());
    const first = cache(definition, data);
    expect([...first]).toEqual(['return']);
    // A committed move, a label edit, a config edit that keeps the ports and an issue refresh
    // keep the same set.
    const moved = structuredClone(definition);
    for (const n of moved.nodes) {
      n.label = `${n.label}!`;
      n.ui = { x: n.ui!.x + 40, y: n.ui!.y };
    }
    moved.nodes.find((n) => n.id === 'done')!.config = {
      kind: 'expression',
      jsonata: '"finish"',
      routes: [
        { id: 'repeat', label: 'Repeat' },
        { id: 'finish', label: 'Finish' },
      ],
    };
    const issue: EditorIssue = { code: 'X', severity: 'error', message: 'm', nodeId: 'work' };
    expect(cache(moved, buildCardData(moved, [issue], data))).toBe(first);
    // Marking Repeat adds the Limit reached port: classified again, with the same result.
    const marked = simpleLoop();
    const again = cache(marked, buildCardData(marked, [], new Map()));
    expect(again).not.toBe(first);
    expect([...again]).toEqual(['return']);
    // Without card data the ports come from the node itself; a new edge end is a new topology.
    const rewired = {
      ...marked,
      edges: marked.edges.map((e) => (e.id === 'return' ? { ...e, to: { node: 'check' } } : e)),
    };
    expect([...cache(rewired, new Map())]).toEqual(['return']);
    const bypassed = {
      ...rewired,
      nodes: [...rewired.nodes, { ...rewired.nodes[0]!, id: 'side' }],
      edges: [
        ...rewired.edges,
        { id: 'side-done', from: { node: 'side', port: 'out' }, to: { node: 'done' } },
      ],
    };
    expect([...cache(bypassed, new Map())]).toEqual([]);
  });
});

describe('manual edge routes (#44)', () => {
  beforeEach(() => {
    // jsdom does not lay out SVG text; xyflow measures label pills with getBBox.
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 56, height: 11 }),
    });
    drawEdges = true;
    vi.useFakeTimers({ toFake: ['performance'] });
    const definition = simpleLoop();
    geometry = geometryOf(routingInput(definition).nodes);
    store().load('L1', definition);
  });
  afterEach(() => {
    drawEdges = false;
    vi.useRealTimers();
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
      outputOrder: geometry.outputOrder,
    };
  };

  it('removes the selected connection from its toolbar in one undo step, then focuses Undo (#207)', () => {
    const undo = document.body.appendChild(document.createElement('button'));
    undo.dataset['history'] = 'undo';
    try {
      render(<Live />);
      select('start-work');
      fireEvent.click(handle('Remove connection'));
      expect(store().definition!.edges.some((e) => e.id === 'start-work')).toBe(false);
      expect(labels()).toEqual(['remove edge start to work']);
      expect(undo).toHaveFocus();
      expect(flow().edges!.some((e) => e.selected)).toBe(false);
      // Undo brings the same record back, unselected.
      act(() => store().undo());
      expect(edge('start-work').selected).toBe(false);
      expect(screen.queryByRole('button', { name: 'Remove connection' })).toBeNull();
    } finally {
      undo.remove();
    }
  });

  it('keeps the selection when the store refuses the removal, and focuses the canvas without a toolbar', () => {
    const view = render(<Live />);
    const removeEdge = store().removeEdge;
    const refused = vi.fn();
    try {
      act(() => useEditorStore.setState({ removeEdge: refused }));
      select('start-work');
      fireEvent.click(handle('Remove connection'));
      expect(refused).toHaveBeenCalledWith('start-work');
      expect(edge('start-work').selected).toBe(true);
    } finally {
      act(() => useEditorStore.setState({ removeEdge }));
    }
    // Select again so the canvas renders with the store's own action.
    act(() => flow().onEdgesChange!([{ type: 'select', id: 'start-work', selected: false }]));
    select('start-work');
    fireEvent.click(handle('Remove connection'));
    expect(store().definition!.edges.some((e) => e.id === 'start-work')).toBe(false);
    expect(view.getByTestId('canvas')).toHaveFocus();
  });

  it('makes the toolbar unavailable from a mouse pan’s move until its release settles, and detaches on unmount (#207)', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const view = render(<Live />);
    // One passive capture listener for releases, added at mount.
    const releases = add.mock.calls.filter(([type]) => type === 'mouseup');
    expect(releases).toHaveLength(1);
    expect(releases[0]![2]).toEqual({ capture: true, passive: true });
    select('start-work');
    const remove = handle('Remove connection');
    const viewport = { x: 0, y: 0, zoom: 1 };
    // A new canvas is ready; a wheel, a touch pan and a fit never make it unavailable.
    act(() => {
      flow().onMove!(new WheelEvent('wheel'), viewport);
      flow().onMove!(new TouchEvent('touchmove'), viewport);
      flow().onMove!(null, viewport);
    });
    expect(remove).not.toHaveAttribute('aria-disabled');
    act(() => flow().onMove!(new MouseEvent('mousemove'), viewport));
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).toHaveAttribute('data-gesture', 'panning');
    fireEvent.click(remove);
    expect(store().definition!.edges.some((e) => e.id === 'start-work')).toBe(true);
    expect(edge('start-work').selected).toBe(true);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(remove).toHaveAttribute('data-gesture', 'settling');
    await waitFor(() => expect(remove).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(remove);
    expect(store().definition!.edges.some((e) => e.id === 'start-work')).toBe(false);
    expect(labels()).toEqual(['remove edge start to work']);
    view.unmount();
    expect(removeListener).toHaveBeenCalledWith('mouseup', releases[0]![1], { capture: true });
  });

  it('forgets a selection whose connection is gone, so an edge reusing its id is not selected (#207)', () => {
    render(<Live />);
    select('start-work');
    expect(edge('start-work').selected).toBe(true);
    act(() => store().removeEdge('start-work'));
    act(() => store().undo());
    expect(edge('start-work').selected).toBe(false);
  });

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
    vi.advanceTimersByTime(100);
    fireEvent.keyDown(lane(), { key: 'ArrowUp' });
    expect(route('return')![1]).toBe(242);
    // Up again runs the lane through the row of cards: kept, drawn dotted, and announced.
    vi.advanceTimersByTime(100);
    fireEvent.keyDown(lane(), { key: 'ArrowUp' });
    expect(route('return')![1]).toBe(220);
    expect(screen.getByText('Segment at y 220. It crosses a card.')).toBeInTheDocument();
    expect(edge('return').ariaLabel).toBe(
      'done Repeat (repeat) to work, manual route, crosses a card',
    );
    expect(screen.getByText('Crosses a card')).toBeInTheDocument();
    // Shift moves five grid lines: out above the cards again.
    vi.advanceTimersByTime(100);
    fireEvent.keyDown(lane(), { key: 'ArrowUp', shiftKey: true });
    expect(route('return')![1]).toBe(110);
    vi.advanceTimersByTime(100);
    fireEvent.keyDown(lane(), { key: 'ArrowUp' });
    expect(route('return')![1]).toBe(88);
    // Arrows across the segment do nothing; the whole run of nudges is one step.
    fireEvent.keyDown(lane(), { key: 'ArrowLeft' });
    expect(labels()).toEqual(['reroute done repeat to work']);
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
        outputOrder: new Map(
          definition.nodes.map((node) => [
            node.id,
            node.id === 'done' ? ['repeat', 'finish', 'limit-reached'] : ['out'],
          ]),
        ),
        nodes: definition.nodes.map((n) => ({
          id: n.id,
          ...n.ui!,
          width: 184,
          height: 122,
          outputs: {
            out: { x: n.ui!.x + 190, y: n.ui!.y + 61 },
            repeat: { x: n.ui!.x + 190, y: n.ui!.y + 61 },
            finish: { x: n.ui!.x + 190, y: n.ui!.y + 41 },
            'limit-reached': { x: n.ui!.x + 190, y: n.ui!.y + 21 },
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
          { type: 'position', id: 'done', position: { x: 330, y: 250 }, dragging: true },
        ]),
      );
      if (obstacle) {
        expect(edge('start-work').data).toMatchObject({ suspended: false });
        expect(edge('start-work').ariaLabel).toContain('manual route, crosses a card');
        expect(document.querySelector('.gg-route-crossing')).not.toBeNull();
      } else {
        expect(edge('start-work').type).toBe('smoothstep');
        expect(edge('start-work').ariaLabel).toContain('set aside under a moving card');
      }
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

  it('announces both a reset and a kept route from one node move in one live message', () => {
    const definition = simpleLoop();
    definition.edges.find((e) => e.id === 'start-work')!.ui = { route: [240, 290, 270] };
    definition.edges.find((e) => e.id === 'return')!.ui = { route: [1116, 290, 268] };
    // The forward fallback crosses this stationary card, while the loop-back can avoid it.
    definition.nodes.push({
      id: 'wall',
      kind: 'exit',
      label: 'Wall',
      config: {},
      ui: { x: 220, y: 120 },
    });
    geometry = {
      nodes: routingInput(definition).nodes.map((n) =>
        n.id === 'wall' ? { ...n, width: 20, outputs: {} } : n,
      ),
      preparationMs: 0,
      outputOrder: new Map(
        routingInput(definition).nodes.map((node) => [
          node.id,
          node.id === 'wall' ? [] : Object.keys(node.outputs),
        ]),
      ),
    };
    store().load('L1', definition);
    render(<Live />);
    const mover = flow().nodes!.find((n) => n.id === 'check')!;
    act(() => flow().onNodeDragStart!({} as never, mover, [mover]));
    moveCard('check', 250, 240);
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'check', position: { x: 250, y: 240 }, dragging: true },
      ]),
    );
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'check', position: { x: 250, y: 240 }, dragging: false },
      ]),
    );
    expect(route('start-work')).toEqual([240, 290, 270]);
    expect(route('return')).toBeUndefined();
    expect(screen.getByTestId('canvas').querySelector('[aria-live="polite"]')).toHaveTextContent(
      'A manual route would cross a card and now routes automatically. A manual route is kept because the automatic replacement crosses a card. Crosses a card; move the card or edit the route.',
    );
    expect(labels()).toEqual(['move check']);
  });

  it('lets a moved card take a manual route back to automatic, in the move’s own undo step', () => {
    const definition = simpleLoop();
    definition.edges.find((e) => e.id === 'return')!.ui = { route: [1116, 290, 268] };
    store().load('L1', definition);
    render(<Live />);
    expect(edge('return').ariaLabel).toBe('done Repeat (repeat) to work, manual route');
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
      'done Repeat (repeat) to work, manual route set aside under a moving card',
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

  it('consumes the drop-position plan when the last position change has no preview frame', () => {
    const definition = simpleLoop();
    definition.edges.find((e) => e.id === 'return')!.ui = { route: [1116, 290, 268] };
    store().load('L1', definition);
    render(<Live />);
    const check = flow().nodes!.find((n) => n.id === 'check')!;
    act(() => flow().onNodeDragStart!({} as never, check, [check]));
    moveCard('check', 600, 240);
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'check', position: { x: 600, y: 240 }, dragging: true },
      ]),
    );
    expect(edge('return').data).toMatchObject({ suspended: true });
    // The release lands clear of the lane, after the last rendered suspended preview.
    moveCard('check', 600, 340);
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'check', position: { x: 600, y: 340 }, dragging: false },
      ]),
    );
    expect(route('return')).toEqual([1116, 290, 268]);
    expect(edge('return').ariaLabel).toBe('done Repeat (repeat) to work, manual route');
    expect(store().definition!.nodes.find((n) => n.id === 'check')!.ui).toEqual({ x: 600, y: 340 });
    expect(labels()).toEqual(['move check']);
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
    vi.advanceTimersByTime(100);
    fireEvent.keyDown(lane(), { key: 'ArrowDown' });
    expect(route('return')).not.toEqual(dragged);
    expect(labels()).toEqual(['reroute done repeat to work', 'reroute done repeat to work']);
    act(() => store().undo());
    expect(route('return')).toEqual(dragged);
    act(() => store().undo());
    expect(route('return')).toBeUndefined();
  });
});

describe('the selected connection is the one the user selected (#207)', () => {
  const STALE = 'That connection changed since it was selected; nothing changed.';
  let undo: HTMLButtonElement;
  beforeEach(() => {
    // jsdom does not lay out SVG text; xyflow measures label pills with getBBox.
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 56, height: 11 }),
    });
    drawEdges = true;
    vi.useFakeTimers({ toFake: ['performance'] });
    // The editor toolbar's Undo, where focus goes after a removal or a refused stale action.
    undo = document.body.appendChild(document.createElement('button'));
    undo.dataset['history'] = 'undo';
  });
  afterEach(() => {
    undo.remove();
    drawEdges = false;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The canvas as the editor page renders it: on the store's current definition. */
  function Live({ issues = [] }: { issues?: EditorIssue[] }) {
    const definition = useEditorStore((s) => s.definition)!;
    return <Canvas definition={definition} issues={issues} />;
  }
  /** Load `definition` with the geometry its cards measure, as the editor loads a draft. */
  const load = (definition: LoopDefinitionInput) => {
    geometry = geometryOf(routingInput(definition).nodes);
    store().load('L1', definition);
    return definition;
  };
  /** xyflow's selection of a connection (a click on it, or Enter or Space on it). */
  const select = (id: string) =>
    act(() => flow().onEdgesChange!([{ type: 'select', id, selected: true }]));
  /** xyflow's Control-click on a card: selects it, keeps the selected connection, opens it. */
  const controlClick = (id: string) =>
    act(() => {
      flow().onNodesChange!([{ type: 'select', id, selected: true }]);
      const card = flow().nodes!.find((n) => n.id === id)!;
      flow().onNodeClick!({ target: document.createElement('div') } as never, card);
    });
  const selected = () =>
    flow()
      .edges!.filter((e) => e.selected)
      .map((e) => e.id);
  const removes = () => screen.queryAllByRole('button', { name: 'Remove connection' });
  const labels = () => store().past.map((entry) => entry.label);
  const edge = (id: string) => flow().edges!.find((e) => e.id === id)!;
  const canvas = () => screen.getByTestId('canvas');
  const press = (key: string) => fireEvent.keyDown(canvas(), { key });
  /** What the canvas last said in its polite live region. */
  const said = () => canvas().querySelector('[aria-live="polite"]')!.textContent;
  /** The draft is exactly `definition` as loaded: no edit, no undo step, nothing to save. */
  const untouched = (definition: LoopDefinitionInput) => {
    expect(store().definition).toBe(definition);
    expect(store()).toMatchObject({ revision: 0, saveState: 'saved', past: [], future: [] });
  };
  /** `definition` after Delete on its selected card `id`: the card and its connections go. */
  const withoutNode = (definition: LoopDefinitionInput, id: string) => ({
    ...definition,
    nodes: definition.nodes.filter((n) => n.id !== id),
    edges: definition.edges.filter((e) => e.from.node !== id && e.to.node !== id),
  });
  /** A Simple loop whose loop-back `return` has a manual route, so its toolbar has Reset route. */
  function routed() {
    const definition = simpleLoop();
    definition.edges.find((e) => e.id === 'return')!.ui = { route: [1116, 290, 268] };
    return definition;
  }
  /** A Simple loop whose script `check` also sends exit code 3 back to `work` through `again`. */
  function scripted() {
    const definition = simpleLoop();
    definition.nodes.find((n) => n.id === 'check')!.config = {
      command: 'node',
      args: ['check.js'],
      exitCodeRoutes: { '3': 'again' },
    };
    definition.edges.push({
      id: 'again',
      from: { node: 'check', port: 'again' },
      to: { node: 'work' },
    });
    return definition;
  }
  /** The gate `done` with its first route's ID set to `id` (typing in that row, or a rename). */
  const gateRouteId = (id: string) => {
    const gate = simpleLoop().nodes.find((n) => n.id === 'done')!;
    const config = gate.config as { routes: { id: string }[] };
    return () =>
      store().updateNode(
        'done',
        {
          config: { ...config, routes: config.routes.map((r, i) => (i === 0 ? { ...r, id } : r)) },
        },
        { path: 'routes.0.id', kind: 'typing', id: 1 },
      );
  };

  it('refuses an id two connections hold from every Remove and from the keyboard, changing nothing', () => {
    const definition = simpleLoop();
    // An imported or API-written draft can give two connections one id: start → work, work → check.
    definition.edges.find((e) => e.id === 'work-check')!.id = 'start-work';
    expect(LoopDefinitionSchema.safeParse(definition).success).toBe(true);
    load(definition);
    const ownership = store().decisionRoutes;
    render(<Live />);
    act(() => store().select('check'));
    select('start-work');
    const message =
      'More than one connection uses the ID "start-work"; this action cannot choose just one.';
    // xyflow marks every edge of the id selected, so each draws a toolbar; each Remove is disabled
    // with the store's own reason.
    expect(removes()).toHaveLength(2);
    for (const remove of removes()) {
      expect(remove).toBeDisabled();
      expect(remove).toHaveAttribute('title', message);
      fireEvent.click(remove);
    }
    expect(store().connectionError).toBeUndefined();
    press('Delete');
    press('Backspace');
    untouched(definition);
    expect(store().decisionRoutes).toBe(ownership);
    expect(store().connectionError).toBe(message);
    // The keys were the connection's alone: the selected card and the selection both stay.
    expect(store().selectedNodeId).toBe('check');
    expect(selected()).toEqual(['start-work', 'start-work']);

    // A unique connection is removed alone, in one step, and Undo restores the draft exactly. (The
    // stand-in edge layer keys edges by id, as xyflow does, so React may keep a stale toolbar for
    // the shared id: use the one on `return` itself.)
    select('return');
    fireEvent.click(
      within(canvas().querySelector<HTMLElement>('.react-flow__edge[data-id="return"]')!).getByRole(
        'button',
        { name: 'Remove connection' },
      ),
    );
    expect(store().definition!.edges).toEqual(definition.edges.filter((e) => e.id !== 'return'));
    expect(labels()).toEqual(['remove edge done repeat to work']);
    expect(undo).toHaveFocus();
    act(() => store().undo());
    expect(store().definition).toEqual(definition);
  });

  it.each<[string, (definition: LoopDefinitionInput) => LoopDefinitionInput, string]>([
    ['the same ends', (definition) => definition, 'work'],
    [
      'other ends',
      (definition) => ({
        ...definition,
        edges: definition.edges.map((e) =>
          e.id === 'start-work' ? { ...e, to: { node: 'check' } } : e,
        ),
      }),
      'check',
    ],
  ])(
    'does not carry the selection into a loaded draft whose connection has %s',
    (_, replace, target) => {
      load(simpleLoop());
      render(<Live />);
      select('start-work');
      expect(removes()).toHaveLength(1);
      // Reload server draft, a device restore or a reconcile loads into the mounted canvas.
      const replacement = replace(simpleLoop());
      act(() => store().load('L1', replacement, { baseToken: 'server-2' }));
      expect(selected()).toEqual([]);
      expect(removes()).toEqual([]);
      press('Delete');
      press('Backspace');
      untouched(replacement);
      // Selected afresh, it is removed in one step; Undo restores the loaded draft exactly.
      select('start-work');
      fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));
      expect(labels()).toEqual([`remove edge start to ${target}`]);
      expect(undo).toHaveFocus();
      act(() => store().undo());
      expect(store().definition).toEqual(replacement);
    },
  );

  it.each<[string, () => LoopDefinitionInput, string, string, (id: string) => void, () => void]>([
    [
      'a Script exit-code label removed, its card Control-clicked',
      scripted,
      'again',
      'check',
      controlClick,
      () => store().updateNode('check', { config: { command: 'node', args: ['check.js'] } }),
    ],
    [
      'a Decision route ID left blank, its card Control-clicked',
      simpleLoop,
      'return',
      'done',
      controlClick,
      gateRouteId(''),
    ],
    [
      'a Decision route ID left blank, its node opened from Loop issues',
      simpleLoop,
      'return',
      'done',
      (id) => act(() => store().openNode(id)),
      gateRouteId(''),
    ],
  ])(
    'forgets a selection whose port is gone (%s); Delete then removes the selected card, never the hidden connection',
    (_, fixture, edgeId, nodeId, open, edit) => {
      load(fixture());
      render(<Live />);
      select(edgeId);
      open(nodeId);
      expect(store()).toMatchObject({ selectedNodeId: nodeId, nodeDialogOpen: true });
      expect(selected()).toEqual([edgeId]);
      act(edit);
      // Still stored with its ends, but no longer drawn: nothing shows it selected.
      const edited = store().definition!;
      expect(edited.edges.find((e) => e.id === edgeId)).toEqual(
        fixture().edges.find((e) => e.id === edgeId),
      );
      expect(strandedEdges(edited).map((e) => e.id)).toEqual([edgeId]);
      expect(selected()).toEqual([]);
      expect(removes()).toEqual([]);
      // Undo draws it again, unselected: a forgotten selection does not come back.
      act(() => store().undo());
      expect(strandedEdges(store().definition!)).toEqual([]);
      expect(selected()).toEqual([]);
      act(() => store().redo());
      // The dialog closes onto the selected card; Delete is that card's ordinary removal.
      act(() => store().closeNodeDialog());
      press('Delete');
      expect(labels()).toEqual([`edit config of ${nodeId}`, `delete ${nodeId}`]);
      expect(store().definition).toEqual(withoutNode(edited, nodeId));
    },
  );

  it.each<[string, () => void, string, string]>([
    [
      'its source card renamed',
      () => store().renameNode('start', 'begin'),
      'start-work',
      'rename start to begin',
    ],
    ['its Decision route ID renamed', gateRouteId('again'), 'return', 'edit config of done'],
  ])(
    'forgets a selection whose stored ends change in the same draft: %s',
    (_, change, edgeId, label) => {
      load(simpleLoop());
      render(<Live />);
      select(edgeId);
      // xyflow measures a renamed port's handle with the edit that renames it.
      const measured = (edit: () => void) =>
        act(() => {
          edit();
          geometry = geometryOf(routingInput(store().definition!).nodes);
        });
      measured(change);
      expect(labels()).toEqual([label]);
      // The id is still stored and drawn, with other ends: not the connection that was selected.
      const now = store().definition!;
      expect(now.edges.find((e) => e.id === edgeId)).not.toEqual(
        simpleLoop().edges.find((e) => e.id === edgeId),
      );
      expect(strandedEdges(now)).toEqual([]);
      expect(selected()).toEqual([]);
      expect(removes()).toEqual([]);
      measured(() => store().undo());
      expect(store().definition).toEqual(simpleLoop());
      expect(selected()).toEqual([]);
    },
  );

  it.each<[string, (ui: Record<'remove' | 'reset' | 'lane', HTMLElement>) => void]>([
    ['Remove connection', (ui) => fireEvent.click(ui.remove)],
    ['Reset route', (ui) => fireEvent.click(ui.reset)],
    ['an arrow-key nudge', (ui) => fireEvent.keyDown(ui.lane, { key: 'ArrowDown' })],
    ['Delete', () => press('Delete')],
  ])(
    'refuses %s rendered for a connection that a load replaced before the canvas rendered again',
    (_, action) => {
      load(routed());
      render(<Live />);
      select('return');
      const ui = {
        remove: screen.getByRole('button', { name: 'Remove connection' }),
        reset: screen.getByRole('button', { name: 'Reset route' }),
        lane: screen.getByRole('button', { name: 'Route segment 3 of 5, horizontal' }),
      };
      // The same draft again (same id, ends and route), but a new load. The action runs on the
      // render from before it, in the same batch, with a card selected in the new load.
      const replacement = routed();
      act(() => {
        store().load('L1', replacement, { baseToken: 'server-2' });
        store().select('work');
        action(ui);
      });
      untouched(replacement);
      // Only the guard on the stale render says this: the action reached it and changed nothing.
      expect(said()).toBe(STALE);
      expect(selected()).toEqual([]);
      expect(store().selectedNodeId).toBe('work');
      expect(undo).toHaveFocus();
      // Rendered again, the canvas has no connection selected: Delete removes the selected card.
      press('Delete');
      expect(labels()).toEqual(['delete work']);
      expect(store().definition).toEqual(withoutNode(replacement, 'work'));
    },
  );

  it.each([
    ['the pointer moves on', false],
    ['the same connection is selected again before the release', true],
  ])('writes no route for a drag held while a load replaced its draft: %s', (_, reselect) => {
    load(simpleLoop());
    render(<Live />);
    select('return');
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Route segment 3 of 5, horizontal' }),
      {
        button: 0,
        clientX: 0,
        clientY: 0,
      },
    );
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40 });
    expect(edge('return').ariaLabel).toBe('done Repeat (repeat) to work, manual route');
    const replacement = simpleLoop();
    act(() => store().load('L1', replacement, { baseToken: 'server-2' }));
    if (reselect) {
      select('return');
      expect(selected()).toEqual(['return']);
    } else fireEvent.pointerMove(window, { clientX: 0, clientY: 60 });
    fireEvent.pointerUp(window);
    untouched(replacement);
    expect(said()).toBe(STALE);
    expect(edge('return').ariaLabel).toBe('done Repeat (repeat) to work');
    expect(selected()).toEqual([]);
    expect(undo).toHaveFocus();
    // The drag is over: a later move and release of the pointer change nothing.
    fireEvent.pointerMove(window, { clientX: 0, clientY: 90 });
    fireEvent.pointerUp(window);
    untouched(replacement);
  });

  it('keeps a drag when xyflow selects its connection again under the multi-selection key', () => {
    load(simpleLoop());
    render(<Live />);
    select('return');
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Route segment 3 of 5, horizontal' }),
      {
        button: 0,
        clientX: 0,
        clientY: 0,
      },
    );
    fireEvent.pointerMove(window, { clientX: 0, clientY: 40 });
    // With Control held xyflow reports the selected connection selected again: the same selection.
    select('return');
    fireEvent.pointerMove(window, { clientX: 0, clientY: 44 });
    fireEvent.pointerUp(window);
    expect(labels()).toEqual(['reroute done repeat to work']);
    expect(said()).toMatch(/^Route changed\./);
    expect(selected()).toEqual(['return']);
  });

  it('keeps the selection through moves, route, label and config edits that keep the ports, issue refreshes and Undo, then removes once', () => {
    const definition = load(simpleLoop());
    const view = render(<Live />);
    select('start-work');
    const kept = () => expect(selected()).toEqual(['start-work']);
    act(() => store().moveNode('work', { x: 320, y: 120 }));
    kept();
    act(() => store().setEdgeRoute('start-work', [200]));
    kept();
    act(() => store().updateNode('work', { label: 'Labour' }));
    kept();
    act(() => store().updateNode('check', { config: { command: 'node', args: ['verify.js'] } }));
    kept();
    view.rerender(
      <Live issues={[{ code: 'X', severity: 'warning', message: 'm', nodeId: 'work' }]} />,
    );
    kept();
    expect(labels()).toEqual([
      'move work',
      'reroute start to work',
      'edit label of work',
      'edit config of check',
    ]);
    for (let step = 0; step < 4; step += 1) {
      act(() => store().undo());
      kept();
    }
    expect(store().definition).toEqual(definition);
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));
    expect(labels()).toEqual(['remove edge start to work']);
    expect(store().definition!.edges).toEqual(
      definition.edges.filter((e) => e.id !== 'start-work'),
    );
    expect(undo).toHaveFocus();
    act(() => store().undo());
    expect(store().definition).toEqual(definition);
  });

  it('makes the toolbar unavailable from a mouse drag of a card until its release settles; a touch drag never does', async () => {
    load(simpleLoop());
    render(<Live />);
    select('start-work');
    const remove = screen.getByRole('button', { name: 'Remove connection' });
    const card = flow().nodes!.find((n) => n.id === 'check')!;
    // A touch drag, and a start without a mouse event, add no click blocker.
    act(() => {
      flow().onNodeDragStart!(new TouchEvent('touchmove'), card, [card]);
      flow().onNodeDragStart!({} as never, card, [card]);
    });
    expect(remove).not.toHaveAttribute('aria-disabled');
    act(() => store().moveNode('check', { x: 600, y: 120 }));
    expect(store().openStep).toBeDefined();
    // xyflow starts a mouse drag on the move past the click distance.
    act(() => flow().onNodeDragStart!(new MouseEvent('mousemove'), card, [card]));
    // The drag start still closes the open step, as before.
    expect(store().openStep).toBeUndefined();
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).toHaveAttribute('data-gesture', 'panning');
    fireEvent.click(remove);
    expect(store().definition!.edges.some((e) => e.id === 'start-work')).toBe(true);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(remove).toHaveAttribute('data-gesture', 'settling');
    await waitFor(() => expect(remove).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(remove);
    expect(labels()).toEqual(['move check', 'remove edge start to work']);
  });

  describe('Reset route holds the selected connection’s toolbar where it was clicked (#207)', () => {
    /** A manual route on a loop-back (`return`), and on a forward connection (`start-work`). */
    const MANUAL = {
      return: { route: [1116, 290, 268], reset: 'reset route of done repeat to work' },
      'start-work': { route: [200], reset: 'reset route of start to work' },
    } as const;
    const REMOVE = {
      return: 'remove edge done repeat to work',
      'start-work': 'remove edge start to work',
    } as const;
    type Connection = keyof typeof MANUAL;
    const CONNECTIONS = [
      ['a loop-back', 'return'],
      ['a forward connection', 'start-work'],
    ] as const;
    const withRoute = (id: Connection) => {
      const definition = simpleLoop();
      definition.edges.find((e) => e.id === id)!.ui = { route: [...MANUAL[id].route] };
      return definition;
    };
    const deselect = (id: string) =>
      act(() => flow().onEdgesChange!([{ type: 'select', id, selected: false }]));
    const resetButton = () => screen.getByRole('button', { name: 'Reset route' });
    const removeButton = () => screen.getByRole('button', { name: 'Remove connection' });
    /** Where the selected connection's toolbar is: the transform of the group that holds it. */
    const toolbarAt = () =>
      removeButton().closest('foreignObject')!.parentElement!.getAttribute('transform');
    const toolbar = () =>
      [...document.querySelector('.gg-route-toolbar')!.children].map((child) => child.textContent);
    /** Where the toolbar goes over the route as drawn now, at zoom 1. */
    const overLabel = (id: string) => {
      const { label } = (edge(id).data as OrthogonalEdgeData).channel.getSnapshot()!;
      return `translate(${label.x} ${label.y - 18}) scale(1)`;
    };

    it.each(CONNECTIONS)(
      'keeps the same two buttons through one Reset route on %s, then removes once on purpose: one step each, two Undos',
      (_, id) => {
        const definition = load(withRoute(id));
        render(<Live />);
        select(id);
        const reset = resetButton();
        const remove = removeButton();
        const at = toolbarAt();
        expect(toolbar()).toEqual(['Reset route', 'Remove connection']);
        expect(reset).not.toHaveAttribute('aria-disabled');

        // The first click of a double click: one reset, one step, announced as before.
        fireEvent.click(reset);
        expect(labels()).toEqual([MANUAL[id].reset]);
        expect(store().definition!.edges.find((e) => e.id === id)!.ui).toBeUndefined();
        expect(said()).toBe('Route reset: the connection routes automatically.');
        const reseted = store().definition;
        expect(selected()).toEqual([id]);
        // The route is automatic now; the toolbar, and the very buttons in it, are where they were.
        expect(edge(id).ariaLabel).not.toMatch(/manual route/);
        expect(resetButton()).toBe(reset);
        expect(removeButton()).toBe(remove);
        expect(reset.isConnected && remove.isConnected).toBe(true);
        expect(toolbarAt()).toBe(at);
        expect(toolbar()).toEqual(['Reset route', 'Remove connection']);
        expect(reset).toHaveAttribute('aria-disabled', 'true');
        expect(reset).toHaveAttribute('title', 'The connection already routes automatically.');
        expect(remove).toBeEnabled();
        expect(remove).not.toHaveAttribute('aria-disabled');

        // The rest of a double click, a triple click and modifiers: nothing is written or removed.
        fireEvent.click(reset, { detail: 2 });
        fireEvent.doubleClick(reset);
        fireEvent.click(reset, { detail: 3 });
        fireEvent.click(reset, { ctrlKey: true });
        fireEvent.click(reset, { metaKey: true });
        fireEvent.click(reset, { shiftKey: true });
        expect(labels()).toEqual([MANUAL[id].reset]);
        expect(store().definition).toBe(reseted);
        expect(selected()).toEqual([id]);
        expect(toolbarAt()).toBe(at);

        // A deliberate click on Remove connection removes once, in a step of its own.
        fireEvent.click(remove);
        expect(labels()).toEqual([MANUAL[id].reset, REMOVE[id]]);
        expect(store().definition!.edges.some((e) => e.id === id)).toBe(false);
        expect(selected()).toEqual([]);
        expect(undo).toHaveFocus();
        act(() => store().undo());
        expect(store().definition!.edges.find((e) => e.id === id)!.ui).toBeUndefined();
        act(() => store().undo());
        expect(store().definition).toEqual(definition);
      },
    );

    it.each(CONNECTIONS)(
      'follows the label again once Undo brings the manual route back on %s, and holds again at the next Reset',
      (_, id) => {
        const definition = load(withRoute(id));
        render(<Live />);
        select(id);
        const reset = resetButton();
        const at = toolbarAt();
        fireEvent.click(reset);
        expect(reset).toHaveAttribute('aria-disabled', 'true');
        act(() => store().undo());
        expect(store().definition).toEqual(definition);
        expect(edge(id).ariaLabel).toMatch(/manual route/);
        // The selection survives Undo: the very same buttons, and Reset route available again.
        expect(resetButton()).toBe(reset);
        expect(reset).not.toHaveAttribute('aria-disabled');
        expect(reset).not.toHaveAttribute('title');
        expect(toolbarAt()).toBe(at);

        // The hold ended with the route Undo brought back: when it goes automatic some other way
        // (a card moved onto it resets it; here an edit does), the toolbar follows its label and
        // there is no Reset route to hold.
        act(() => store().setEdgeRoute(id, undefined));
        expect(toolbar()).toEqual(['Remove connection']);
        const followed = toolbarAt();
        expect(followed).not.toBe(at);
        deselect(id);
        select(id);
        expect(toolbarAt()).toBe(followed);

        // Undo again, and Reset route holds again where it is clicked.
        act(() => store().undo());
        expect(toolbar()).toEqual(['Reset route', 'Remove connection']);
        expect(resetButton()).not.toHaveAttribute('aria-disabled');
        fireEvent.click(resetButton());
        expect(toolbarAt()).toBe(at);
        expect(resetButton()).toHaveAttribute('aria-disabled', 'true');
        expect(labels()).toEqual([MANUAL[id].reset]);
      },
    );

    it.each(CONNECTIONS)(
      'follows the label again at a keyboard nudge, a drag and a later Undo of the route a held Reset route reset on %s',
      (_, id) => {
        const lane =
          id === 'return'
            ? { name: 'Route segment 3 of 5, horizontal', key: 'ArrowDown', drag: [0, 40] }
            : { name: 'Route segment 2 of 3, vertical', key: 'ArrowRight', drag: [40, 0] };
        load(withRoute(id));
        render(<Live />);
        select(id);
        const at = toolbarAt();
        for (const how of ['nudge', 'drag'] as const) {
          fireEvent.click(resetButton());
          expect(toolbarAt()).toBe(at);
          expect(resetButton()).toHaveAttribute('aria-disabled', 'true');
          const handle = screen.getByRole('button', { name: lane.name });
          if (how === 'nudge') fireEvent.keyDown(handle, { key: lane.key });
          else {
            fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 });
            fireEvent.pointerMove(window, { clientX: lane.drag[0]!, clientY: lane.drag[1]! });
            fireEvent.pointerUp(window);
          }
          // The connection is drawn by hand again: Reset route is available, and the toolbar is
          // over the label of the route now drawn, not where the hold kept it.
          expect(edge(id).ariaLabel).toMatch(/manual route/);
          expect(resetButton()).not.toHaveAttribute('aria-disabled');
          expect(resetButton()).not.toHaveAttribute('title');
          expect(toolbarAt()).toBe(overLabel(id));
          expect(toolbarAt()).not.toBe(at);
          // Back to the route that was reset, for the next way of drawing it again.
          act(() => store().setEdgeRoute(id, [...MANUAL[id].route]));
          expect(toolbarAt()).toBe(at);
        }
      },
    );

    it.each(CONNECTIONS)(
      'drops the hold on deselection and on a new load of the draft, so a fresh selection starts again on %s',
      (_, id) => {
        load(withRoute(id));
        render(<Live />);
        select(id);
        const at = toolbarAt();
        fireEvent.click(resetButton());
        expect(toolbarAt()).toBe(at);
        deselect(id);
        expect(screen.queryByRole('button', { name: 'Remove connection' })).toBeNull();
        // Selected again: the ordinary toolbar of an automatic route, Remove connection alone.
        select(id);
        expect(toolbar()).toEqual(['Remove connection']);
        expect(screen.queryByRole('button', { name: 'Reset route' })).toBeNull();
        expect(toolbarAt()).not.toBe(at);

        // Undo brings the manual route back; a Reset route held on it is forgotten with a load.
        act(() => store().undo());
        expect(toolbar()).toEqual(['Reset route', 'Remove connection']);
        fireEvent.click(resetButton());
        expect(resetButton()).toHaveAttribute('aria-disabled', 'true');
        act(() => store().load('L1', withRoute(id), { baseToken: 'server-2' }));
        expect(selected()).toEqual([]);
        expect(screen.queryByRole('button', { name: 'Remove connection' })).toBeNull();
        select(id);
        expect(toolbar()).toEqual(['Reset route', 'Remove connection']);
        expect(resetButton()).not.toHaveAttribute('aria-disabled');
        expect(resetButton()).not.toHaveAttribute('title');
      },
    );
  });
});
