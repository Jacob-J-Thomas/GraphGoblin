import { EdgeRouteSchema, type LoopDefinitionInput, type NodeKind } from '@graphgoblin/contracts';
import {
  Background,
  getSmoothStepPath,
  getViewportForBounds,
  Position,
  Controls,
  ReactFlow,
  type AriaLabelConfig,
  type FitViewOptions,
  useReactFlow,
  useStore,
  useStoreApi,
  type ReactFlowState,
  type Rect,
  type Connection,
  type Edge,
  type EdgeChange,
  type HandleType,
  type IsValidConnection,
  type NodeChange,
  type NodeMouseHandler,
  type OnConnectEnd,
  type OnConnectStart,
  type OnInit,
  type OnMove,
  type OnNodeDrag,
  type XYPosition,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
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
  forwardPoints,
} from './manual-route.js';
import { OrthogonalEdge, type OrthogonalEdgeData } from './OrthogonalEdge.js';
import { RouteEditingContext, type RouteEditing } from './route-editing.js';
import {
  canvasDrawsEdge,
  canvasPorts,
  canvasPortLabels,
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
import { NODE_CARD_SIZE } from './routing-geometry.js';
import { createLabelPlacementCache, type EdgeLabelPosition } from './edge-label-placement.js';
import { ForwardEdge } from './ForwardEdge.js';
import { edgeLabelText } from './edge-label-text.js';
import { loopBackEdgeIds } from './loop-back-edges.js';
import { removalFocusTarget } from './canvas-focus.js';
import { spaceCardsEligible } from './space-cards.js';
import { SpaceCardsOffer, SpaceCardsResult, type OfferBox } from './SpaceCardsOffer.js';
import { createViewportGestureGate } from './viewport-gesture.js';

const nodeTypes = { gg: NodeCard };
const edgeTypes = { orthogonal: OrthogonalEdge, smoothstep: ForwardEdge };

/** The background's dot spacing; keyboard nudges of a route segment move by it (#44). */
export const CANVAS_GRID = NODE_CARD_SIZE.clearance;
/** A selected edge draws above the cards, so its segment handles and toolbar are never covered. */
const SELECTED_EDGE_Z = 2000;
// Fit View and manual zoom reach 0.1, so a large graph fits even while both side panels are open.
const MIN_CANVAS_ZOOM = 0.1;
const MAX_CANVAS_ZOOM = 2;

/** Fit the graph with room on the left for the zoom controls, so they never cover a card. */
const FIT_PADDING = { top: '8%', right: '8%', bottom: '8%', left: '72px' } as const;
const FIT_VIEW_OPTIONS: FitViewOptions = { padding: FIT_PADDING };
/**
 * Opening the editor fits the graph but stays readable; Fit View shows a large graph whole. The fit
 * is queued from `onInit` because xyflow's `fitView` prop can fit again without its options.
 */
const OPENING_MIN_ZOOM = 0.5;
const INITIAL_FIT_VIEW_OPTIONS: FitViewOptions<FlowNode> = {
  ...FIT_VIEW_OPTIONS,
  minZoom: OPENING_MIN_ZOOM,
};
const fitOnOpen: OnInit<FlowNode, Edge> = (instance) =>
  void instance.fitView(INITIAL_FIT_VIEW_OPTIONS);

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
  // A connection is changed by removing it and drawing it again (#207).
  'edge.a11yDescription.default':
    'Press Enter or Space to select the connection, then Delete or Backspace to remove it; its toolbar also has Remove connection. To connect its output elsewhere, remove the connection and draw from the output again.',
};

/** One end of a refused drop: a rendered port handle (xyflow's handle, or its element's data). */
export interface DropEnd {
  nodeId: string;
  id?: string | null | undefined;
  type: HandleType;
}

/**
 * Why a drop from `from` onto `to` was refused, in the store's current draft (#207), or null when it
 * says nothing: no handle under the drop (the pane), two ends of one type, or an allowed tuple. A
 * drag may start at either end, so the output end is found by its handle type.
 */
export function dropRefusal(
  definition: LoopDefinitionInput | undefined,
  from: DropEnd | null | undefined,
  to: DropEnd | null | undefined,
): string | null {
  if (!definition || !from || !to || from.type === to.type) return null;
  const [source, target] = from.type === 'source' ? [from, to] : [to, from];
  return connectionProblem(definition, {
    source: source.nodeId,
    sourceHandle: source.id ?? null,
    target: target.nodeId,
  });
}

const connectionKey = (source: string, port: string | null, target: string) =>
  JSON.stringify([source, port ?? 'out', target]);

/** The port handle a click landed on, read from xyflow's handle element. */
function clickedEnd(target: EventTarget | null): DropEnd | undefined {
  const handle =
    target instanceof Element ? target.closest<HTMLElement>('.react-flow__handle') : null;
  const nodeId = handle?.dataset['nodeid'];
  if (!handle || !nodeId) return undefined;
  return {
    nodeId,
    id: handle.dataset['handleid'] ?? null,
    type: handle.classList.contains('source') ? 'source' : 'target',
  };
}

export { canvasFocusTarget } from './canvas-focus.js';

/**
 * The connection the user selected (#207), as it was then: the load of the draft it was selected in
 * (the store's `generation`: a reload, restore or reconcile is a new one), its id, and the stored
 * ends of every edge holding that id, in stored order. Canvas-local; the store selects nodes only.
 */
interface EdgeSelection {
  readonly generation: number;
  readonly id: string;
  readonly ends: string;
}

/** The stored ends of every edge holding `id`, in stored order, as one key (JSON, no delimiter). */
const storedEnds = (definition: LoopDefinitionInput, id: string) =>
  JSON.stringify(
    definition.edges
      .filter((edge) => edge.id === id)
      .map((edge) => [edge.from.node, edge.from.port, edge.to.node, edge.to.port ?? 'in']),
  );

/** A selection of `id` in the store's draft as it is now; none when no stored edge holds the id. */
function selectionOf(id: string): EdgeSelection | undefined {
  const { definition, generation } = useEditorStore.getState();
  if (!definition?.edges.some((edge) => edge.id === id)) return undefined;
  return { generation, id, ends: storedEnds(definition, id) };
}

/**
 * Whether the canvas draws every edge holding `id`: xyflow draws an edge only when both its nodes
 * and both its handles exist (`canvasDrawsEdge`). One whose output port is gone (a removed Script
 * label, a blank Decision route ID) has no path, so nothing on the canvas shows it selected.
 */
const drawsAll = (definition: LoopDefinitionInput, id: string) =>
  definition.edges.every((edge) => edge.id !== id || canvasDrawsEdge(definition, edge));

/**
 * Whether `selection` is still the connection the user selected, in `definition` as loaded in
 * `generation`: the same load and the same stored ends under its id (not a replacement that reuses
 * the id, nor one with a renamed end), and still drawn.
 */
function selectionLive(
  selection: EdgeSelection,
  definition: LoopDefinitionInput,
  generation: number,
): boolean {
  return (
    selection.generation === generation &&
    storedEnds(definition, selection.id) === selection.ends &&
    drawsAll(definition, selection.id)
  );
}

/**
 * Whether an action rendered for `expected`, the selection of `edgeId`, may act now: it is still the
 * canvas's selection (`current`, the same selection, not merely the same id), and still live in the
 * store's draft. Rendering can lag the store, so the toolbar, a key and a route edit ask when they act.
 */
function mayAct(
  current: EdgeSelection | undefined,
  expected: EdgeSelection | undefined,
  edgeId: string,
): boolean {
  const { definition, generation } = useEditorStore.getState();
  return (
    expected !== undefined &&
    expected === current &&
    expected.id === edgeId &&
    definition !== undefined &&
    selectionLive(expected, definition, generation)
  );
}

/** What a stale action says (#207): politely, in the canvas's live region. */
const STALE_CONNECTION = 'That connection changed since it was selected; nothing changed.';

type Size = { width: number; height: number };

const NO_ISSUES: readonly EditorIssue[] = [];

const zoomOf = (state: ReactFlowState) => state.transform[2];

const isLength = (length: number) => Number.isFinite(length) && length > 0;

/** Whether xyflow has measured its pane, which starts at 0 × 0: a fit needs room to fit into. */
const paneMeasured = (state: ReactFlowState) => isLength(state.width) && isLength(state.height);

/**
 * The rectangle the draft's cards fill: their positions in the draft and the sizes xyflow measured
 * for them. It is undefined while any card has no size yet, or a size that is not positive and
 * finite. Sizes are looked up as own properties, since a card can be called `constructor`. The
 * draft is one Space cards spaced, so it has at least two cards.
 */
function cardBounds(
  definition: LoopDefinitionInput,
  measured: Record<string, Size>,
): Rect | undefined {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of definition.nodes) {
    const size = Object.hasOwn(measured, node.id) ? measured[node.id] : undefined;
    if (!size || !isLength(size.width) || !isLength(size.height)) return undefined;
    const { x, y } = node.ui ?? { x: 0, y: 0 };
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + size.width);
    bottom = Math.max(bottom, y + size.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

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
        : { node, ports: canvasPorts(node), portLabels: canvasPortLabels(node), issues: list },
    );
  }
  return next;
}

/**
 * The visual loop-back edges (#449): one set for the canvas's direction, style and routing. It is
 * classified again only when what the classifier reads changes (node ids, kinds and ports; edge
 * ids and ends), so a committed move, a label or prompt edit, or an issue refresh keeps the set.
 */
export function createLoopBackCache() {
  let key: string | undefined;
  let ids: ReadonlySet<string> = new Set();
  return (
    def: Pick<LoopDefinitionInput, 'nodes' | 'edges'>,
    data: ReadonlyMap<string, Pick<NodeCardData, 'ports'>>,
  ): ReadonlySet<string> => {
    const next = JSON.stringify([
      def.nodes.map((n) => [n.id, n.kind, data.get(n.id)?.ports ?? canvasPorts(n)]),
      def.edges.map((e) => [e.id, e.from.node, e.from.port, e.to.node]),
    ]);
    if (next !== key) {
      key = next;
      ids = loopBackEdgeIds(def);
    }
    return ids;
  };
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
 * Unselected forward edges without a manual route keep xyflow's smoothstep type and path;
 * a label channel changes only a colliding label's position. Backward paths
 * (#18) and manual routes (#44) come from the routing plan; a selected edge always uses the
 * orthogonal edge, which shows its segment handles. Labels keep the existing token styles; only
 * a loop-back (`loopBacks`, from the graph's topology, #449) takes the animated loop dash. An edge
 * that is merely drawn backward on the canvas is routed backward but keeps the ordinary style.
 */
function buildEdges(
  def: LoopDefinitionInput,
  loopBacks: ReadonlySet<string>,
  selected: string | undefined,
  plan: Pick<RoutingPlan, 'routes' | 'directions' | 'suspended'>,
  previous: ReadonlyMap<string, Edge>,
  nodes: readonly FlowNode[],
  channels: ReturnType<typeof createRouteChannels>,
  labels: ReadonlyMap<string, EdgeLabelPosition>,
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
    const portLabel = from?.data.portLabels[edge.from.port] ?? edge.from.port;
    const loopBack = loopBacks.has(edge.id);
    const pendingDirection =
      !!from &&
      !!to &&
      backwardDirection(
        {
          id: edge.id,
          source: edge.from.node,
          target: edge.to.node,
          port: edge.from.port,
          loopBack,
        },
        { x: from.position.x + (from.measured?.width ?? NODE_CARD_SIZE.width) + 6, y: 0 },
        { x: to.position.x - 6, y: 0 },
        // As in the router, a changed classification starts without the previous direction.
        before && !!before.animated === loopBack
          ? before.type === 'orthogonal' && !beforeData?.forward
          : undefined,
      );
    const backward = directions.get(edge.id) ?? pendingDirection;
    const isSelected = edge.id === selected;
    const suspended = plan.suspended.has(edge.id);
    const type = route || backward || isSelected ? 'orthogonal' : 'smoothstep';
    const channel =
      type === 'orthogonal' || labels.has(edge.id)
        ? channels.edge(edge.id, route, labels.get(edge.id))
        : undefined;
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
    const portId = portLabel === edge.from.port ? '' : ` (${edge.from.port})`;
    const ariaLabel = `${edge.from.node} ${portLabel}${portId} to ${edge.to.node}${status}${manual}`;
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
      before.selected === isSelected &&
      // Gaining or losing the loop-back style (a topology edit, #449) replaces the edge object.
      !!before.animated === loopBack
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
        ? { label: portLabel, labelBgPadding: [8, 3], labelBgBorderRadius: 9 }
        : {}),
      ...(loopBack ? { animated: true, className: 'gg-edge-loop' } : {}),
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
  const generation = useEditorStore((s) => s.generation);
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
    spaceCards,
  } = useEditorStore.getState();
  const { screenToFlowPosition, setViewport, viewportInitialized } = useReactFlow();
  const flowStore = useStoreApi();
  // Renders again when xyflow measures its pane, so a fit waiting for one tries again; the size
  // itself is read live where the fit uses it.
  const paneReady = useStore(paneMeasured);
  // A segment drag in progress (#44): its route is routed as a preview until the pointer is up.
  const [routeDrag, setRouteDrag] = useState<{ edgeId: string; route: readonly number[] }>();
  const [announcement, setAnnouncement] = useState({ text: '', key: 0 });
  const announce = useCallback(
    (text: string) => setAnnouncement((previous) => ({ text, key: previous.key + 1 })),
    [],
  );
  const [measured, setMeasured] = useState<Record<string, Size>>({});
  const [dragging, setDragging] = useState<Record<string, XYPosition>>({});
  // The selected connection (#207). It stays selected only while it is the one the user selected:
  // a load (even of an edge with the same id and ends), an id now held by other ends (a rename of
  // an end, or an id reused after a removal) or a port that is gone forgets it while rendering, and
  // Undo does not bring it back. Moves, route edits, label and config edits that keep the ports,
  // and issue refreshes keep it. Drawing parses the ports, so this runs when the draft changes,
  // not on drag frames.
  const [selection, setSelection] = useState<EdgeSelection>();
  const selectedEdge = useMemo(
    () =>
      selection && selectionLive(selection, definition, generation) ? selection.id : undefined,
    [selection, definition, generation],
  );
  if (selection !== undefined && selectedEdge === undefined) setSelection(undefined);
  // The selection an action finds when it acts (the toolbar, a key, a route edit).
  const selectionRef = useRef(selection);
  useLayoutEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  // An action rendered for a selection that is no longer live (rendering can lag a load or an edit)
  // changes nothing. The selection goes and focus moves to Undo, outside the canvas, so the same
  // key cannot go on to remove a selected node.
  const refuseStale = useCallback(() => {
    setSelection(undefined);
    announce(STALE_CONNECTION);
    removalFocusTarget()?.focus();
  }, [announce]);
  const cardDataRef = useRef<ReadonlyMap<string, NodeCardData>>(new Map());
  const nodesRef = useRef<ReadonlyMap<string, FlowNode>>(new Map());
  const edgesRef = useRef({ byId: new Map<string, Edge>(), value: [] as Edge[] });
  const rootRef = useRef<HTMLDivElement>(null);
  // A node's issue popover is placed from its badge: a pan, a zoom, or a drag closes it. Popovers
  // elsewhere (the toolbar's) stay, since nothing they hang from moved.
  const closeCanvasPopovers = useCallback(() => closePopovers(rootRef.current), []);
  // A mouse pan's or mouse node drag's release leaves d3's click blocker in place for a task: the
  // selected connection's toolbar is unavailable until it is gone (#207), and so are the Space
  // cards offer's buttons (#208), which follow this same gate. The gate's window listener is added
  // at mount, before any press adds d3's own; a layout effect adds it before the browser can
  // deliver one.
  const [gesture] = useState(createViewportGestureGate);
  useLayoutEffect(() => gesture.attach(window), [gesture]);
  const onMove: OnMove = useCallback(
    (event) => {
      gesture.move(event);
      closeCanvasPopovers();
    },
    [gesture, closeCanvasPopovers],
  );

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
  // One classification for the pending direction, the loop style and the router (#449).
  const [loopBackCache] = useState(createLoopBackCache);
  const loopBacks = useMemo(
    () => loopBackCache(definition, cardData),
    [loopBackCache, definition, cardData],
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
          loopBack: loopBacks.has(edge.id),
          ...(route ? { route } : {}),
          ...(route && allowed ? { allowCrossing: allowed } : {}),
        };
      }),
    [definition.edges, loopBacks, routeDrag, nodeDrag, authoredCrossings],
  );
  const decisionPorts = useMemo(
    () => new Map([...cardData].filter(([, data]) => data.node.kind === 'decision')),
    [cardData],
  );
  const { plan, measureLabels } = useRouting(routingEdges, decisionPorts);
  const { routes } = plan;
  const [placeLabels] = useState(createLabelPlacementCache);
  const moving = !!nodeDrag || !!routeDrag || Object.keys(dragging).length > 0;
  // Card issues and committed ui positions do not change port text. This primitive dependency
  // stays equal across those refreshes; its collection is memoized away during drag frames.
  const portText = useMemo(
    () =>
      JSON.stringify(
        plan.edges.map((edge) =>
          edge.port === 'out'
            ? ''
            : (cardData.get(edge.source)?.portLabels[edge.port] ?? edge.port),
        ),
      ),
    [plan.edges, cardData],
  );
  const labels = useMemo(() => {
    const start = performance.now();
    const result = placeLabels(moving, () => {
      const byId = new Map(plan.nodes.map((node) => [node.id, node]));
      const texts = JSON.parse(portText) as string[];
      return {
        paths: plan.edges.flatMap((edge, i) => {
          const from = byId.get(edge.source)?.outputs[edge.port];
          const to = byId.get(edge.target)?.input;
          if (!from || !to) return [];
          const route = routes.get(edge.id);
          const { visible } = edgeLabelText(texts[i]!, route);
          const [, x, y] = getSmoothStepPath({
            sourceX: from.x,
            sourceY: from.y,
            targetX: to.x,
            targetY: to.y,
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            borderRadius: 10,
          });
          return [
            {
              id: edge.id,
              text: visible,
              points: route?.points ?? forwardPoints(from, to),
              preferred: route?.label ?? { x, y },
              fixed: !!route,
            },
          ];
        }),
        cards: cardBoxes(plan.nodes),
      };
    });
    measureLabels(performance.now() - start);
    return result;
  }, [plan.edges, portText, plan.nodes, routes, moving, placeLabels, measureLabels]);
  // The route editor reads the latest card boxes when a drag ends or a nudge lands.
  const planRef = useRef(plan);
  useLayoutEffect(() => {
    planRef.current = plan;
  }, [plan]);
  const [channels] = useState(createRouteChannels);
  useLayoutEffect(() => {
    channels.publish(routes, new Set(routingEdges.map((edge) => edge.id)), labels);
  }, [channels, routes, routingEdges, labels]);
  const edges = useMemo(() => {
    const previous = edgesRef.current;
    const next = buildEdges(
      definition,
      loopBacks,
      selectedEdge,
      plan,
      previous.byId,
      nodes,
      channels,
      labels,
    );
    if (
      next.length === previous.value.length &&
      next.every((edge, index) => edge === previous.value[index])
    )
      return previous.value;
    edgesRef.current = { byId: new Map(next.map((edge) => [edge.id, edge])), value: next };
    return next;
  }, [definition, loopBacks, selectedEdge, plan, nodes, channels, labels]);

  // Segment handles and Reset route (#44). A drag previews through the router and ends in one
  // store change; the step before it is closed first, as for a node drag. Where the author puts a
  // segment is kept, even across a card: the route is then drawn dotted and announced as crossing.
  // Each edit acts only for the selection it was rendered or started for, while that is still live
  // in the store's draft (#207); otherwise it changes nothing (`refuseStale`).
  const editing = useMemo<RouteEditing>(() => {
    const store = (
      expected: EdgeSelection | undefined,
      edgeId: string,
      route: readonly number[],
      from: XYPosition,
      to: XYPosition,
    ) => {
      if (!mayAct(selectionRef.current, expected, edgeId)) {
        refuseStale();
        return undefined;
      }
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
        // The drag belongs to the selection it starts from. A load, or another selection (even of
        // a connection with the same id, selected again), ends it without writing a route.
        const bound = selectionRef.current;
        closeStep();
        const start = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
        let latest: number[] | undefined;
        const move = (event: PointerEvent) => {
          if (selectionRef.current !== bound) {
            stop(false);
            refuseStale();
            return;
          }
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
          if (!store(bound, edgeId, latest, base.from, base.to)) return;
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
        const stored = store(selectionRef.current, edgeId, moved.route, base.from, base.to);
        if (!stored) return undefined;
        announce(`Segment at ${segment.axis} ${value}.${crossing(stored, base.from, base.to)}`);
        const near = midpoint({
          a: { ...segment.a, [segment.axis]: value },
          b: { ...segment.b, [segment.axis]: value },
        });
        return findSegment(stored, base.from, base.to, segment.axis, value, near);
      },
      reset(edgeId) {
        if (!mayAct(selectionRef.current, selectionRef.current, edgeId)) return refuseStale();
        setEdgeRoute(edgeId, undefined);
        announce('Route reset: the connection routes automatically.');
      },
      remove(edgeId) {
        const expected = selectionRef.current;
        if (!mayAct(expected, expected, edgeId)) return refuseStale();
        const before = useEditorStore.getState().definition;
        removeEdge(edgeId);
        // Refused (a protected Chat voice step, or an id more than one connection holds): the
        // store's notice says why, and the selection stays.
        if (useEditorStore.getState().definition === before) return;
        setSelection((current) => (current === expected ? undefined : current));
        removalFocusTarget()?.focus();
      },
      viewport: gesture,
    };
  }, [announce, closeStep, gesture, refuseStale, removeEdge, screenToFlowPosition, setEdgeRoute]);

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
      const replacement = changes.find((change) => change.type === 'select' && change.selected);
      // What is selected is read from the store's draft as it is now, before any removal below.
      const next = replacement?.type === 'select' ? selectionOf(replacement.id) : undefined;
      setSelection((current) => {
        if (replacement) {
          // xyflow selects an edge again under its multi-selection key: the same selection stays.
          const same =
            current &&
            next &&
            current.generation === next.generation &&
            current.id === next.id &&
            current.ends === next.ends;
          return same ? current : next;
        }
        return changes.some(
          (change) => change.type === 'select' && !change.selected && change.id === current?.id,
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

  // The last connection a gesture made, so the click-connect end below can tell a click that
  // connected from one that was refused; and the port a click-connect started from.
  const connectedRef = useRef<string | undefined>(undefined);
  const clickStartRef = useRef<DropEnd | undefined>(undefined);
  const onConnect = useCallback(
    (conn: Connection) => {
      connectedRef.current = connectionKey(conn.source, conn.sourceHandle, conn.target);
      connect({ source: conn.source, sourceHandle: conn.sourceHandle, target: conn.target });
    },
    [connect],
  );

  // A drop on a port that refused it says why in the page's "Connection refused" notice (#207). A
  // drop that connected went through onConnect; a drop on the pane or on a port of the same type
  // says nothing (and leaves an earlier notice as it was). Never connects anything.
  const onConnectEnd: OnConnectEnd = useCallback((_event, state) => {
    if (state.isValid) return;
    const problem = dropRefusal(
      useEditorStore.getState().definition,
      state.fromHandle,
      state.toHandle,
    );
    if (problem) useEditorStore.setState({ connectionError: problem });
  }, []);
  // xyflow hands a click-connect's end the drag state (idle by then), so the two ends come from
  // the click that started it and the handle element clicked last.
  const onClickConnectStart: OnConnectStart = useCallback((_event, params) => {
    connectedRef.current = undefined;
    clickStartRef.current =
      params.nodeId && params.handleType
        ? { nodeId: params.nodeId, id: params.handleId, type: params.handleType }
        : undefined;
  }, []);
  const onClickConnectEnd: OnConnectEnd = useCallback((event) => {
    const from = clickStartRef.current;
    clickStartRef.current = undefined;
    const to = clickedEnd(event.target);
    if (!from || !to || from.type === to.type) return;
    const [source, target] = from.type === 'source' ? [from, to] : [to, from];
    const made = connectionKey(source.nodeId, source.id ?? null, target.nodeId);
    if (connectedRef.current === made) {
      connectedRef.current = undefined;
      return;
    }
    const problem = dropRefusal(useEditorStore.getState().definition, from, to);
    if (problem) useEditorStore.setState({ connectionError: problem });
  }, []);

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_, node) => endDrag(node.id, node.position),
    [endDrag],
  );
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (event) => {
      // A mouse drag of a card ends, like a pan, with d3's click blocker (#207): xyflow starts it on
      // the `mousemove` past the click distance, the same move that makes d3-drag block the click
      // after the release. A touch drag adds no blocker, and the gate ignores it.
      gesture.move(event);
      closeCanvasPopovers();
      // Each drag is an undo step of its own, however soon it follows the last move.
      closeStep();
      setNodeDrag(pinnedCrossings());
    },
    [gesture, closeCanvasPopovers, closeStep, pinnedCrossings],
  );

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
  // (`nokey`, which xyflow ignores too). With a connection selected the key is that connection's
  // alone (#207): it removes the connection, or the store refuses and says why (the selection
  // stays), or, when the connection changed since it was selected, nothing changes and the key does
  // not go on to the selected node. A selection forgotten while rendering leaves the node's keys.
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
    if (selection) {
      event.preventDefault();
      if (!mayAct(selectionRef.current, selection, selection.id)) return refuseStale();
      const before = useEditorStore.getState().definition;
      removeEdge(selection.id);
      if (useEditorStore.getState().definition !== before)
        setSelection((current) => (current === selection ? undefined : current));
      return;
    }
    if (!selected) return;
    removeNode(selected);
    event.preventDefault();
  };

  // Space cards (#208, ADR-0077): offered while every card is at the origin and no card or route
  // is being dragged. Dismissing it lasts for this editor load; a load or a remount offers it again.
  const pile = useMemo(() => spaceCardsEligible(definition), [definition]);
  const [dismissedOffer, setDismissedOffer] = useState<number>();
  const offered = pile && !moving && dismissedOffer !== generation;
  // What a pointer press on the offer leaves in its box (#208): the result of the press, until the
  // next press elsewhere, so a double click's second press lands on it and not on what the offer
  // covered. Like a selected connection that is gone, it is dropped while rendering when the offer
  // is back (undo) or the draft was loaded; a keyboard press leaves none.
  const [offerResult, setOfferResult] = useState<{
    message: string;
    box: OfferBox;
    generation: number;
  }>();
  if (offerResult && (offered || offerResult.generation !== generation)) setOfferResult(undefined);
  const endOfferResult = useCallback(() => setOfferResult(undefined), []);
  // The polite announcement says `spoken`, which defaults to what the result shows.
  const report = (message: string, box: OfferBox | undefined, spoken = message) => {
    announce(spoken);
    if (box) setOfferResult({ message, box, generation: useEditorStore.getState().generation });
  };
  // The one view fit that Space cards asks for: the draft it produced (and its revision, which
  // tells it from the same draft object back after an undo and a redo), kept until that draft has
  // rendered with every card measured, the pane measured and the viewport ready. This is not
  // `fitView`: xyflow queues that fit and spends it on whichever graph it adopts next (an undo that
  // lands first fits the restored pile), and no public call cancels a queued fit. The view is set
  // from the cards' own bounds with `setViewport` in the same synchronous turn as these checks, so
  // nothing is left to run later. Any other edit, an undo, a redo or a load before then drops the
  // fit for good, as the store's own draft is read again here; the effect runs again as
  // measurements and readiness arrive. The padding and zoom limits are the opening fit's, and no
  // edit, undo or redo fits the view by itself.
  const spacedFitRef = useRef<{
    definition: LoopDefinitionInput;
    generation: number;
    revision: number;
  }>(undefined);
  useEffect(() => {
    const pending = spacedFitRef.current;
    if (!pending) return;
    const live = useEditorStore.getState();
    if (
      pending.definition !== definition ||
      pending.generation !== generation ||
      live.definition !== pending.definition ||
      live.generation !== pending.generation ||
      live.revision !== pending.revision
    ) {
      spacedFitRef.current = undefined;
      return;
    }
    const bounds = cardBounds(definition, measured);
    const pane = flowStore.getState();
    if (!viewportInitialized || !bounds || !paneMeasured(pane)) return;
    spacedFitRef.current = undefined;
    void setViewport(
      getViewportForBounds(
        bounds,
        pane.width,
        pane.height,
        OPENING_MIN_ZOOM,
        MAX_CANVAS_ZOOM,
        FIT_PADDING,
      ),
    );
  }, [definition, generation, measured, viewportInitialized, paneReady, setViewport, flowStore]);
  // The store checks its current draft again, so a second press, a repeated key or an offer left
  // from an older render changes nothing.
  const spaceAll = (box: OfferBox | undefined) => {
    // xyflow measures each card's layout box, which zoom does not scale: flow pixels.
    const heights = new Map(Object.entries(measured).map(([id, size]) => [id, size.height]));
    const result = spaceCards(heights);
    // The canvas, never Undo: a held or repeated Enter must not undo what it just did.
    rootRef.current?.focus();
    if (result === 'applied') {
      const state = useEditorStore.getState();
      const spaced = state.definition!;
      spacedFitRef.current = {
        definition: spaced,
        generation: state.generation,
        revision: state.revision,
      };
      const shown = `Spaced ${spaced.nodes.length} cards.`;
      report(shown, box, `${shown} Undo puts them back.`);
    } else {
      report('Cards were not spaced: they are no longer all in one spot.', box);
    }
  };
  const dismissOffer = (box: OfferBox | undefined) => {
    setDismissedOffer(generation);
    rootRef.current?.focus();
    report('Suggestion dismissed.', box);
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
          onConnectEnd={onConnectEnd}
          onClickConnectStart={onClickConnectStart}
          onClickConnectEnd={onClickConnectEnd}
          isValidConnection={isValidConnection}
          onNodeDragStop={onNodeDragStop}
          onMove={onMove}
          onNodeDragStart={onNodeDragStart}
          onNodeClick={onNodeClick}
          nodeClickDistance={CLICK_DISTANCE}
          nodeDragThreshold={CLICK_DISTANCE}
          onPaneClick={onPaneClick}
          onInit={fitOnOpen}
          minZoom={MIN_CANVAS_ZOOM}
          maxZoom={MAX_CANVAS_ZOOM}
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
      onConnectEnd,
      onClickConnectStart,
      onClickConnectEnd,
      isValidConnection,
      onNodeDragStop,
      onMove,
      onNodeDragStart,
      onNodeClick,
      onPaneClick,
    ],
  );

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      data-testid="canvas"
      data-editor-canvas=""
      // Focus lands here when the node editor closes on a deleted node, and after Space cards.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={onDrop}
    >
      {/* Before the flow: after the palette and before the first card in the Tab order. */}
      {offered ? (
        <SpaceCardsOffer
          count={definition.nodes.length}
          viewport={gesture}
          onSpace={spaceAll}
          onDismiss={dismissOffer}
        />
      ) : null}
      {offerResult ? (
        <SpaceCardsResult
          message={offerResult.message}
          box={offerResult.box}
          onEnd={endOfferResult}
        />
      ) : null}
      {flow}
      <CanvasZoom canvasRef={rootRef} nodes={plan.nodes} />
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        <span key={announcement.key}>{announcement.text}</span>
      </span>
    </div>
  );
}
