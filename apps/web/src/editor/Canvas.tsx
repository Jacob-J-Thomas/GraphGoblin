import { EdgeRouteSchema, type LoopDefinitionInput, type NodeKind } from '@graphgoblin/contracts';
import {
  Background,
  Controls,
  ReactFlow,
  type AriaLabelConfig,
  type FitViewOptions,
  useReactFlow,
  useStore,
  type ReactFlowState,
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
  type RefObject,
} from 'react';
import { closePopovers } from '../components/ui/index.js';
import {
  crossesCards,
  crossedCardIds,
  drawnPoints,
  findSegment,
  midpoint,
  moveSegment,
  normalize,
  nudged,
  sameRoute,
} from './manual-route.js';
import { OrthogonalEdge, type OrthogonalEdgeData } from './OrthogonalEdge.js';
import { RouteEditingContext, type RouteEditing } from './route-editing.js';
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
import { backwardDirection, routeMessage, type RoutingNode, type RoutingPlan } from './routing.js';
import { useRouting } from './useRouting.js';
import { createRouteChannels } from './route-channels.js';
import { portWidthLimits } from './port-targets.js';

const nodeTypes = { gg: NodeCard };
const edgeTypes = { orthogonal: OrthogonalEdge };

/** The background's dot spacing; keyboard nudges of a route segment move by it (#44). */
export const CANVAS_GRID = 22;
/** A selected edge draws above the cards, so its segment handles and toolbar are never covered. */
const SELECTED_EDGE_Z = 2000;
const MIN_CANVAS_ZOOM = 0.5;
const MAX_CANVAS_ZOOM = 2;

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

const zoomOf = (state: ReactFlowState) => state.transform[2];

/** Publish zoom without re-rendering the canvas or its cards on each viewport change. */
function CanvasZoom({
  canvasRef,
  nodes,
}: {
  canvasRef: RefObject<HTMLDivElement | null>;
  nodes: readonly RoutingNode[];
}) {
  const zoom = useStore(zoomOf);
  useLayoutEffect(() => {
    canvasRef.current?.style.setProperty(
      '--gg-canvas-zoom',
      String(Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom))),
    );
  }, [canvasRef, zoom]);
  useLayoutEffect(() => {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    const limits = portWidthLimits(nodes);
    for (const handle of canvasRef.current?.querySelectorAll<HTMLElement>('.react-flow__handle') ??
      []) {
      const node = limits.get(handle.dataset['nodeid'] ?? '');
      const width = handle.classList.contains('target')
        ? node?.input
        : node?.outputs[handle.dataset['handleid'] ?? ''];
      if (width !== undefined) handle.style.setProperty('--gg-port-max-width', `${width}px`);
    }
  }, [canvasRef, nodes]);
  return null;
}

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
 * Unselected forward edges without a manual route keep xyflow's smoothstep path. Backward paths
 * (#18) and manual routes (#44) come from the routing plan; a selected edge always uses the
 * orthogonal edge, which shows its segment handles. Labels and the exit's animated dash keep the
 * existing token styles.
 */
function buildEdges(
  def: LoopDefinitionInput,
  selected: string | undefined,
  plan: Pick<RoutingPlan, 'routes' | 'directions' | 'suspended'>,
  previous: ReadonlyMap<string, Edge>,
  nodes: readonly FlowNode[],
  channels: ReturnType<typeof createRouteChannels>,
): Edge[] {
  const { routes, directions } = plan;
  const positions = new Map(nodes.map((node) => [node.id, node]));
  return def.edges.map((edge) => {
    const before = previous.get(edge.id);
    const route = routes.get(edge.id);
    const beforeData = before?.data as OrthogonalEdgeData | undefined;
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
        before ? before.type === 'orthogonal' && !beforeData?.forward : undefined,
      );
    const backward = directions.get(edge.id) ?? pendingDirection;
    const isSelected = edge.id === selected;
    const suspended = plan.suspended.has(edge.id);
    const type = route || backward || isSelected ? 'orthogonal' : 'smoothstep';
    const channel = type === 'orthogonal' ? channels.edge(edge.id, route) : undefined;
    // Keep the data object while nothing in it changed: xyflow re-renders an edge on a new one.
    const data: OrthogonalEdgeData | undefined =
      channel &&
      (beforeData?.channel === channel &&
      beforeData.forward === !backward &&
      beforeData.suspended === suspended
        ? beforeData
        : { channel, forward: !backward, suspended });
    const status = route && routeMessage(route) ? ': ' + routeMessage(route) : '';
    const manual = route?.manual
      ? route.crossing
        ? ', manual route, crosses a card'
        : ', manual route'
      : suspended
        ? ', manual route set aside under a moving card'
        : '';
    const ariaLabel = `${edge.from.node} ${edge.from.port} to ${edge.to.node}${status}${manual}`;
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
      before.selected === isSelected
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
      selected: isSelected,
      ...(isSelected ? { zIndex: SELECTED_EDGE_Z } : {}),
      ...(data ? { data } : {}),
      ariaLabel,
      ...(edge.from.port !== 'out'
        ? { label: edge.from.port, labelBgPadding: [8, 3], labelBgBorderRadius: 9 }
        : {}),
      ...(edge.from.port === 'loopBack' ? { animated: true, className: 'gg-edge-loop' } : {}),
    };
  });
}

const cardBoxes = (nodes: readonly RoutingNode[]) =>
  nodes.map((n) => ({
    id: n.id,
    left: n.x,
    right: n.x + n.width,
    top: n.y,
    bottom: n.y + n.height,
  }));

/** A card moved to `x, y` with its ports. */
function placed(node: RoutingNode, x: number, y: number): RoutingNode {
  const dx = x - node.x;
  const dy = y - node.y;
  const shift = (p: XYPosition) => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...node,
    x,
    y,
    outputs: Object.fromEntries(Object.entries(node.outputs).map(([port, p]) => [port, shift(p)])),
    ...(node.input ? { input: shift(node.input) } : {}),
  };
}

/**
 * The manual routes that moving card `id` from its stored position to `position` makes cross a
 * card (any card, its own included, as when a port moves past its route). Routes the author
 * already left crossing a particular card keep that intersection; only newly crossed cards count.
 */
export function newlyCrossed(
  definition: LoopDefinitionInput | undefined,
  plan: Pick<RoutingPlan, 'nodes'>,
  id: string,
  position: XYPosition,
): string[] {
  const card = plan.nodes.find((n) => n.id === id);
  const stored = definition?.nodes.find((n) => n.id === id)?.ui ?? { x: 0, y: 0 };
  if (!definition || !card) return [];
  const crosses = (nodes: readonly RoutingNode[], edge: LoopDefinitionInput['edges'][number]) => {
    const from = nodes.find((n) => n.id === edge.from.node)?.outputs[edge.from.port];
    const to = nodes.find((n) => n.id === edge.to.node)?.input;
    if (!from || !to) return new Set<string>();
    const points = drawnPoints(edge.ui!.route, from, to);
    return crossedCardIds(points, cardBoxes(nodes));
  };
  const before = plan.nodes.map((n) => (n === card ? placed(n, stored.x, stored.y) : n));
  const after = plan.nodes.map((n) => (n === card ? placed(n, position.x, position.y) : n));
  return definition.edges
    .filter((edge) => {
      if (!edge.ui) return false;
      const deliberate = crosses(before, edge);
      return [...crosses(after, edge)].some((cardId) => !deliberate.has(cardId));
    })
    .map((edge) => edge.id);
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
  const {
    select,
    openNode,
    moveNode,
    removeNode,
    connect,
    removeEdge,
    addNode,
    closeStep,
    setEdgeRoute,
  } = useEditorStore.getState();
  const { screenToFlowPosition } = useReactFlow();
  // A segment drag in progress (#44): its route is routed as a preview until the pointer is up.
  const [routeDrag, setRouteDrag] = useState<{ edgeId: string; route: readonly number[] }>();
  const [announcement, setAnnouncement] = useState({ text: '', key: 0 });
  const announce = useCallback(
    (text: string) => setAnnouncement((previous) => ({ text, key: previous.key + 1 })),
    [],
  );
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
  // Pin deliberate intersections at drag start. The plan sets a newly crossing route aside
  // only when its automatic replacement is clear; otherwise preview and drop keep it dotted.
  const [nodeDrag, setNodeDrag] = useState<ReadonlyMap<string, ReadonlySet<string>>>();
  const [drop, setDrop] = useState<{ id: string; position: XYPosition }>();
  const committedDropRef = useRef(drop);
  const authoredCrossings = useMemo(
    () => new Set(definition.nodes.map((n) => n.id)),
    [definition.nodes],
  );
  const routingEdges = useMemo(
    () =>
      definition.edges.map((edge) => {
        const preview = routeDrag?.edgeId === edge.id ? routeDrag.route : undefined;
        const route = preview ?? edge.ui?.route;
        const allowed = preview || !nodeDrag ? authoredCrossings : nodeDrag.get(edge.id);
        return {
          id: edge.id,
          source: edge.from.node,
          target: edge.to.node,
          port: edge.from.port,
          ...(route ? { route } : {}),
          ...(route && allowed ? { allowCrossing: allowed } : {}),
        };
      }),
    [definition.edges, routeDrag, nodeDrag, authoredCrossings],
  );
  const decisionPorts = useMemo(
    () => new Map([...cardData].filter(([, data]) => data.node.kind === 'decision')),
    [cardData],
  );
  const plan = useRouting(routingEdges, decisionPorts);
  const { routes } = plan;
  // The route editor reads the latest card boxes when a drag ends or a nudge lands.
  const planRef = useRef(plan);
  useLayoutEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const [channels] = useState(createRouteChannels);
  useLayoutEffect(() => {
    channels.publish(routes, new Set(routingEdges.map((edge) => edge.id)));
  }, [channels, routes, routingEdges]);
  const edges = useMemo(() => {
    const previous = edgesRef.current;
    const next = buildEdges(definition, selectedEdge, plan, previous.byId, nodes, channels);
    if (
      next.length === previous.value.length &&
      next.every((edge, index) => edge === previous.value[index])
    )
      return previous.value;
    edgesRef.current = { byId: new Map(next.map((edge) => [edge.id, edge])), value: next };
    return next;
  }, [definition, selectedEdge, plan, nodes, channels]);

  // Segment handles and Reset route (#44). A drag previews through the router and ends in one
  // store change; the step before it is closed first, as for a node drag. Where the author puts a
  // segment is kept, even across a card: the route is then drawn dotted and announced as crossing.
  const editing = useMemo<RouteEditing>(() => {
    const store = (edgeId: string, route: readonly number[], from: XYPosition, to: XYPosition) => {
      const stored = normalize(route, from, to);
      if (stored.length && !EdgeRouteSchema.safeParse(stored).success) {
        announce('This route has as many segments as a route can hold');
        return undefined;
      }
      setEdgeRoute(edgeId, stored.length ? stored : undefined);
      return stored;
    };
    const crossing = (route: readonly number[], from: XYPosition, to: XYPosition) =>
      crossesCards(drawnPoints(route, from, to), cardBoxes(planRef.current.nodes))
        ? ' It crosses a card.'
        : '';
    return {
      begin(edgeId, base, segment, pointer) {
        closeStep();
        const start = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
        let latest: number[] | undefined;
        const move = (event: PointerEvent) => {
          const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          const delta = segment.axis === 'x' ? at.x - start.x : at.y - start.y;
          const value = Math.round(segment.value + delta);
          latest = moveSegment(base.route, segment.index, value, base.from, base.to).route;
          setRouteDrag({ edgeId, route: latest });
        };
        const stop = (keep: boolean) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', release);
          window.removeEventListener('pointercancel', cancel);
          window.removeEventListener('keydown', escape, true);
          setRouteDrag(undefined);
          if (!keep || !latest) return;
          const before = normalize(base.route, base.from, base.to);
          if (sameRoute(normalize(latest, base.from, base.to), before)) return;
          if (!store(edgeId, latest, base.from, base.to)) return;
          closeStep();
          announce(`Route changed.${crossing(latest, base.from, base.to)}`);
        };
        const release = () => stop(true);
        const cancel = () => stop(false);
        const escape = (event: globalThis.KeyboardEvent) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          stop(false);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', escape, true);
      },
      nudge(edgeId, base, segment, direction, steps) {
        const value = nudged(segment.value, direction, steps);
        const moved = moveSegment(base.route, segment.index, value, base.from, base.to);
        const stored = store(edgeId, moved.route, base.from, base.to);
        if (!stored) return undefined;
        announce(`Segment at ${segment.axis} ${value}.${crossing(stored, base.from, base.to)}`);
        const near = midpoint({
          a: { ...segment.a, [segment.axis]: value },
          b: { ...segment.b, [segment.axis]: value },
        });
        return findSegment(stored, base.from, base.to, segment.axis, value, near);
      },
      reset(edgeId) {
        setEdgeRoute(edgeId, undefined);
        announce('Route reset: the connection routes automatically.');
      },
    };
  }, [announce, closeStep, screenToFlowPosition, setEdgeRoute]);

  const pinnedCrossings = useCallback(() => {
    const cards = cardBoxes(planRef.current.nodes);
    return new Map(
      [...planRef.current.routes]
        .filter(([, route]) => route.manual)
        .map(([edgeId, route]) => [edgeId, crossedCardIds(route.points, cards)]),
    );
  }, []);
  const endDrag = useCallback(
    (id: string, position: XYPosition) => {
      // Wait for the plan at the drop position, including a final move without a drag frame.
      setNodeDrag((current) => current ?? pinnedCrossings());
      setDragging((current) => ({ ...current, [id]: position }));
      setDrop({ id, position });
    },
    [pinnedCrossings],
  );
  useLayoutEffect(() => {
    // Each queued drop commits once, even if React repeats an effect before state is cleared.
    if (!drop || committedDropRef.current === drop) return;
    const { id, position } = drop;
    const card = plan.nodes.find((n) => n.id === id);
    if (card && (card.x !== position.x || card.y !== position.y)) return;
    committedDropRef.current = drop;
    const definition = useEditorStore.getState().definition;
    const candidates = newlyCrossed(definition, plan, id, position);
    const reset = candidates.filter((edgeId) => plan.suspended.has(edgeId));
    moveNode(id, position);
    // Part of the move's step: undoing the move brings the routes back with it.
    for (const edgeId of reset) setEdgeRoute(edgeId, undefined, `move:${id}`);
    const messages: string[] = [];
    if (reset.length)
      messages.push(
        `${reset.length === 1 ? 'A manual route' : `${reset.length} manual routes`} would cross a card and now route${reset.length === 1 ? 's' : ''} automatically.`,
      );
    const kept = candidates.length - reset.length;
    if (kept)
      messages.push(
        `${kept === 1 ? 'A manual route is' : `${kept} manual routes are`} kept because the automatic replacement crosses a card. Crosses a card; move the card or edit the route.`,
      );
    if (messages.length)
      setAnnouncement((previous) => ({ text: messages.join(' '), key: previous.key + 1 }));
    setDragging(({ [id]: _done, ...rest }) => rest);
    setNodeDrag(undefined);
    setDrop(undefined);
  }, [drop, plan, moveNode, setEdgeRoute]);

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
      setSelectedEdge((current) => {
        const replacement = changes.find((change) => change.type === 'select' && change.selected);
        if (replacement?.type === 'select') return replacement.id;
        return changes.some(
          (change) => change.type === 'select' && !change.selected && change.id === current,
        )
          ? undefined
          : current;
      });
      for (const change of changes) {
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
    setNodeDrag(pinnedCrossings());
  }, [closeCanvasPopovers, closeStep, pinnedCrossings]);

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
      <RouteEditingContext value={editing}>
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
          minZoom={MIN_CANVAS_ZOOM}
          maxZoom={MAX_CANVAS_ZOOM}
          fitViewOptions={FIT_VIEW_OPTIONS}
          deleteKeyCode={null}
          ariaLabelConfig={ARIA_LABELS}
        >
          <Background gap={CANVAS_GRID} size={1.3} />
          <Controls fitViewOptions={FIT_VIEW_OPTIONS} />
        </ReactFlow>
      </RouteEditingContext>
    ),
    [
      editing,
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
      <CanvasZoom canvasRef={rootRef} nodes={plan.nodes} />
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        <span key={announcement.key}>{announcement.text}</span>
      </span>
    </div>
  );
}
