import type { LoopDefinitionInput, NodeKind } from '@graphgoblin/contracts';
import {
  Background,
  Controls,
  ReactFlow,
  type AriaLabelConfig,
  type FitViewOptions,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
  type XYPosition,
} from '@xyflow/react';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { closePopovers } from '../components/ui/index.js';
import { BackwardEdge } from './BackwardEdge.js';
import {
  canvasPorts,
  connectionProblem,
  issuesByNode,
  KIND_INFO,
  KIND_MIME,
  NODE_KINDS,
  sameIssues,
  type EditorIssue,
} from './model.js';
import { NodeCard, type FlowNode, type NodeCardData } from './NodeCard.js';
import { useEditorStore } from './store.js';
import { backwardDirection, routeMessage, type RoutedEdge } from './routing.js';
import { useRouting } from './useRouting.js';
import { createRouteChannels } from './route-channels.js';

const nodeTypes = { gg: NodeCard };
const edgeTypes = { backward: BackwardEdge };

/** Fit the graph with room on the left for the zoom controls, so they never cover a card. */
const FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: { top: '8%', right: '8%', bottom: '8%', left: '72px' },
};

/**
 * How far (px) the pointer may move between press and release for a click on a node, which opens
 * its editor. Further, and it is a drag that moves the node and opens nothing; xyflow starts the
 * drag only past the same distance, so a press is always exactly one of the two.
 */
const CLICK_DISTANCE = 3;

/** What screen readers say about a focused node and edge (xyflow's defaults mention select only). */
const ARIA_LABELS: Partial<AriaLabelConfig> = {
  'node.a11yDescription.default':
    'Press Enter to edit the node, or Space to select it. With a node selected, press Delete to remove it.',
  'node.a11yDescription.keyboardDisabled':
    'Press Enter to edit the node, or Space to select it. With a node selected, use the arrow keys to move it and Delete to remove it.',
};

export { canvasFocusTarget } from './canvas-focus.js';

type Size = { width: number; height: number };

const NO_ISSUES: readonly EditorIssue[] = [];

/**
 * Each node's card data: the node, its ports, and its issues. A node whose definition and issues
 * did not change keeps its previous data object, so its memoised card does not re-render when
 * another node is edited (validation runs on every edit and yields new issue objects).
 */
export function buildCardData(
  def: LoopDefinitionInput,
  issues: readonly EditorIssue[],
  previous: ReadonlyMap<string, NodeCardData>,
): Map<string, NodeCardData> {
  const byNode = issuesByNode(issues);
  const next = new Map<string, NodeCardData>();
  for (const node of def.nodes) {
    const list = byNode.get(node.id) ?? NO_ISSUES;
    const before = previous.get(node.id);
    next.set(
      node.id,
      before && before.node === node && sameIssues(before.issues, list)
        ? before
        : { node, ports: canvasPorts(node), issues: list },
    );
  }
  return next;
}

function buildNodes(
  def: LoopDefinitionInput,
  data: ReadonlyMap<string, NodeCardData>,
  selected: string | undefined,
  measured: Record<string, Size>,
  dragging: Record<string, XYPosition>,
  previous: ReadonlyMap<string, FlowNode>,
): FlowNode[] {
  return def.nodes.map((node) => {
    const size = measured[node.id];
    const position = dragging[node.id] ?? node.ui ?? { x: 0, y: 0 };
    const card = data.get(node.id)!;
    const before = previous.get(node.id);
    if (
      before &&
      before.data === card &&
      before.position.x === position.x &&
      before.position.y === position.y &&
      before.measured === size &&
      before.selected === (node.id === selected)
    )
      return before;
    return {
      id: node.id,
      type: 'gg',
      position,
      selected: node.id === selected,
      ariaLabel: `${KIND_INFO[node.kind].label} ${node.label} (${node.id})`,
      ...(size ? { measured: size } : {}),
      data: card,
    };
  });
}

/**
 * Forward edges keep their existing smoothstep path. Backward paths come from measured canvas
 * geometry (#18); labels and the exit's animated dash retain the existing token styles.
 */
function buildEdges(
  def: LoopDefinitionInput,
  selected: string | undefined,
  routes: ReadonlyMap<string, RoutedEdge>,
  previous: ReadonlyMap<string, Edge>,
  nodes: readonly FlowNode[],
  directions: ReadonlyMap<string, boolean>,
  channels: ReturnType<typeof createRouteChannels>,
): Edge[] {
  const positions = new Map(nodes.map((node) => [node.id, node]));
  return def.edges.map((edge) => {
    const before = previous.get(edge.id);
    const route = routes.get(edge.id);
    // A new backward connection waits for its own handles; measured connections keep their
    // routes while an unrelated card awaits measurement.
    const from = positions.get(edge.from.node);
    const to = positions.get(edge.to.node);
    const pendingDirection =
      !!from &&
      !!to &&
      backwardDirection(
        { id: edge.id, source: edge.from.node, target: edge.to.node, port: edge.from.port },
        { x: from.position.x + (from.measured?.width ?? 184) + 6, y: 0 },
        { x: to.position.x - 6, y: 0 },
        before ? before.type === 'backward' : undefined,
      );
    const type = (directions.get(edge.id) ?? pendingDirection) ? 'backward' : 'smoothstep';
    const data = type === 'backward' ? channels.edge(edge.id, route) : undefined;
    const ariaLabel = `${edge.from.node} ${edge.from.port} to ${edge.to.node}${route && routeMessage(route) ? ': ' + routeMessage(route) : ''}`;
    // xyflow subscribes each edge to its object identity. Keep untouched edges asleep during a
    // drag, even though another path or selection changed in the same graph.
    if (
      before &&
      before.source === edge.from.node &&
      before.target === edge.to.node &&
      before.sourceHandle === edge.from.port &&
      before.data === data &&
      before.ariaLabel === ariaLabel &&
      before.type === type &&
      before.selected === (edge.id === selected)
    )
      return before;
    return {
      id: edge.id,
      type,
      pathOptions: { borderRadius: 10 },
      source: edge.from.node,
      sourceHandle: edge.from.port,
      target: edge.to.node,
      targetHandle: 'in',
      selected: edge.id === selected,
      ...(data ? { data } : {}),
      ariaLabel,
      ...(edge.from.port !== 'out'
        ? { label: edge.from.port, labelBgPadding: [8, 3], labelBgBorderRadius: 9 }
        : {}),
      ...(edge.from.port === 'loopBack' ? { animated: true, className: 'gg-edge-loop' } : {}),
    };
  });
}

/**
 * The loop graph. The editor store is the source of truth for nodes, edges, positions, and node
 * selection; local state holds only what xyflow measures and the position of a node mid-drag.
 */
export function Canvas({
  definition,
  issues,
}: {
  definition: LoopDefinitionInput;
  issues: readonly EditorIssue[];
}) {
  const selected = useEditorStore((s) => s.selectedNodeId);
  const { select, openNode, moveNode, removeNode, connect, removeEdge, addNode, closeStep } =
    useEditorStore.getState();
  const { screenToFlowPosition } = useReactFlow();
  const [measured, setMeasured] = useState<Record<string, Size>>({});
  const [dragging, setDragging] = useState<Record<string, XYPosition>>({});
  const [selectedEdge, setSelectedEdge] = useState<string | undefined>();
  const cardDataRef = useRef<ReadonlyMap<string, NodeCardData>>(new Map());
  const nodesRef = useRef<ReadonlyMap<string, FlowNode>>(new Map());
  const edgesRef = useRef({ byId: new Map<string, Edge>(), value: [] as Edge[] });
  const rootRef = useRef<HTMLDivElement>(null);
  // A node's issue popover is placed from its badge: a pan, a zoom, or a drag closes it. Popovers
  // elsewhere (the toolbar's) stay, since nothing they hang from moved.
  const closeCanvasPopovers = useCallback(() => closePopovers(rootRef.current), []);

  const cardData = useMemo(() => {
    const next = buildCardData(definition, issues, cardDataRef.current);
    cardDataRef.current = next;
    return next;
  }, [definition, issues]);
  const nodes = useMemo(() => {
    // xyflow can retain the other 99 internal nodes while one card moves. Card-data memoisation
    // alone would still recreate their wrappers and handle lookups on every drag frame.
    const next = buildNodes(definition, cardData, selected, measured, dragging, nodesRef.current);
    nodesRef.current = new Map(next.map((node) => [node.id, node]));
    return next;
  }, [definition, cardData, selected, measured, dragging]);
  const routingEdges = useMemo(
    () =>
      definition.edges.map((edge) => ({
        id: edge.id,
        source: edge.from.node,
        target: edge.to.node,
        port: edge.from.port,
      })),
    [definition.edges],
  );
  const { routes, directions } = useRouting(routingEdges);
  const [channels] = useState(createRouteChannels);
  useLayoutEffect(() => {
    channels.publish(routes, new Set(routingEdges.map((edge) => edge.id)));
  }, [channels, routes, routingEdges]);
  const edges = useMemo(() => {
    const previous = edgesRef.current;
    const next = buildEdges(
      definition,
      selectedEdge,
      routes,
      previous.byId,
      nodes,
      directions,
      channels,
    );
    if (
      next.length === previous.value.length &&
      next.every((edge, index) => edge === previous.value[index])
    )
      return previous.value;
    edgesRef.current = { byId: new Map(next.map((edge) => [edge.id, edge])), value: next };
    return next;
  }, [definition, selectedEdge, routes, nodes, directions, channels]);

  const endDrag = useCallback(
    (id: string, position: XYPosition) => {
      moveNode(id, position);
      setDragging(({ [id]: _done, ...rest }) => rest);
    },
    [moveNode],
  );

  // xyflow writes each changed callback into its store separately. Stable handlers avoid
  // notifying every node/edge subscriber several extra times on each drag frame.
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      for (const change of changes) {
        if (change.type === 'dimensions' && change.dimensions) {
          const size = change.dimensions;
          setMeasured((m) => ({ ...m, [change.id]: size }));
        } else if (change.type === 'position' && change.position) {
          const position = change.position;
          if (change.dragging) setDragging((d) => ({ ...d, [change.id]: position }));
          else endDrag(change.id, position);
        } else if (change.type === 'select' && change.selected) {
          select(change.id);
        } else if (change.type === 'remove') {
          removeNode(change.id);
        }
      }
    },
    [endDrag, select, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'select') setSelectedEdge(change.selected ? change.id : undefined);
        if (change.type === 'remove') removeEdge(change.id);
      }
    },
    [removeEdge],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (conn) =>
      connectionProblem(definition, {
        source: conn.source,
        sourceHandle: conn.sourceHandle ?? null,
        target: conn.target,
      }) === null,
    [definition],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      connect({ source: conn.source, sourceHandle: conn.sourceHandle, target: conn.target });
    },
    [connect],
  );

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_, node) => endDrag(node.id, node.position),
    [endDrag],
  );
  const onNodeDragStart = useCallback(() => {
    closeCanvasPopovers();
    // Each drag is an undo step of its own, however soon it follows the last move.
    closeStep();
  }, [closeCanvasPopovers, closeStep]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData(KIND_MIME) as NodeKind;
    if (!NODE_KINDS.includes(kind)) return;
    addNode(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  // A click without a drag opens the node's editor (a drag past CLICK_DISTANCE suppresses the
  // click). A click on a port handle starts or ends a connection instead.
  const onNodeClick: NodeMouseHandler<FlowNode> = useCallback(
    (event, node) => {
      if ((event.target as Element).closest('.react-flow__handle')) return;
      openNode(node.id);
    },
    [openNode],
  );
  const onPaneClick = useCallback(() => select(undefined), [select]);

  // Enter on a focused node opens its editor; Space still only selects it (xyflow). Delete or
  // Backspace removes the selected edge or node only while focus is on the canvas: xyflow's own
  // handler listens on the whole document, so the keys deleted the selected node with focus on a
  // toolbar button too, with no undo. The node editor dialog renders outside the canvas, and keys
  // from any dialog are ignored here as well, as are keys from a node's issue badge and its popover
  // (`nokey`, which xyflow ignores too).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('dialog, .nokey')) return;
    if (event.key === 'Enter' && target.classList.contains('react-flow__node')) {
      const id = target.dataset['id'];
      if (id) {
        event.preventDefault();
        openNode(id);
      }
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (selectedEdge) {
      removeEdge(selectedEdge);
      setSelectedEdge(undefined);
    } else if (selected) {
      removeNode(selected);
    } else {
      return;
    }
    event.preventDefault();
  };

  // A geometry-only update publishes edge channels without rendering the whole canvas again.
  const flow = useMemo(
    () => (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={onNodeDragStop}
        onMove={closeCanvasPopovers}
        onNodeDragStart={onNodeDragStart}
        onNodeClick={onNodeClick}
        nodeClickDistance={CLICK_DISTANCE}
        nodeDragThreshold={CLICK_DISTANCE}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        deleteKeyCode={null}
        ariaLabelConfig={ARIA_LABELS}
      >
        <Background gap={22} size={1.3} />
        <Controls fitViewOptions={FIT_VIEW_OPTIONS} />
      </ReactFlow>
    ),
    [
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      onConnect,
      isValidConnection,
      onNodeDragStop,
      closeCanvasPopovers,
      onNodeDragStart,
      onNodeClick,
      onPaneClick,
    ],
  );

  return (
    <div
      ref={rootRef}
      className="h-full w-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      data-testid="canvas"
      data-editor-canvas=""
      // Focus lands here when the node editor closes on a deleted node.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={onDrop}
    >
      {flow}
    </div>
  );
}
