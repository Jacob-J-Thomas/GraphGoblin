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
  type XYPosition,
} from '@xyflow/react';
import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  canvasPorts,
  connectionProblem,
  KIND_INFO,
  KIND_MIME,
  NODE_KINDS,
  type EditorIssue,
} from './model.js';
import { NodeCard, type FlowNode } from './NodeCard.js';
import { useEditorStore } from './store.js';

const nodeTypes = { gg: NodeCard };

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

/**
 * Where focus goes when the node editor closes: the node's card on the canvas, or the canvas itself
 * when the node is gone (deleted).
 */
export function canvasFocusTarget(nodeId: string | undefined): HTMLElement | null {
  const card = nodeId
    ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
    : null;
  return card ?? document.querySelector<HTMLElement>('[data-editor-canvas]');
}

type Size = { width: number; height: number };

function buildNodes(
  def: LoopDefinitionInput,
  issues: EditorIssue[],
  selected: string | undefined,
  measured: Record<string, Size>,
  dragging: Record<string, XYPosition>,
): FlowNode[] {
  return def.nodes.map((node) => {
    const size = measured[node.id];
    return {
      id: node.id,
      type: 'gg',
      position: dragging[node.id] ?? node.ui ?? { x: 0, y: 0 },
      selected: node.id === selected,
      ariaLabel: `${KIND_INFO[node.kind].label} ${node.label} (${node.id})`,
      ...(size ? { measured: size } : {}),
      data: {
        node,
        ports: canvasPorts(node),
        issueCount: issues.filter((i) => i.nodeId === node.id).length,
      },
    };
  });
}

/**
 * Edges as orthogonal steps with rounded corners (xyflow's built-in smoothstep path; the routing
 * itself is xyflow's, see #18), labels as pills, and the exit's loop-back animated and dashed in
 * the loop colour (styles/canvas.css).
 */
function buildEdges(def: LoopDefinitionInput, selected: string | undefined): Edge[] {
  return def.edges.map((edge) => ({
    id: edge.id,
    type: 'smoothstep',
    pathOptions: { borderRadius: 10 },
    source: edge.from.node,
    sourceHandle: edge.from.port,
    target: edge.to.node,
    targetHandle: 'in',
    selected: edge.id === selected,
    ...(edge.from.port !== 'out'
      ? { label: edge.from.port, labelBgPadding: [8, 3], labelBgBorderRadius: 9 }
      : {}),
    ...(edge.from.port === 'loopBack' ? { animated: true, className: 'gg-edge-loop' } : {}),
  }));
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
  issues: EditorIssue[];
}) {
  const selected = useEditorStore((s) => s.selectedNodeId);
  const { select, openNode, moveNode, removeNode, connect, removeEdge, addNode } =
    useEditorStore.getState();
  const { screenToFlowPosition } = useReactFlow();
  const [measured, setMeasured] = useState<Record<string, Size>>({});
  const [dragging, setDragging] = useState<Record<string, XYPosition>>({});
  const [selectedEdge, setSelectedEdge] = useState<string | undefined>();

  const nodes = useMemo(
    () => buildNodes(definition, issues, selected, measured, dragging),
    [definition, issues, selected, measured, dragging],
  );
  const edges = useMemo(() => buildEdges(definition, selectedEdge), [definition, selectedEdge]);

  const endDrag = (id: string, position: XYPosition) => {
    moveNode(id, position);
    setDragging(({ [id]: _done, ...rest }) => rest);
  };

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
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
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    for (const change of changes) {
      if (change.type === 'select') setSelectedEdge(change.selected ? change.id : undefined);
      if (change.type === 'remove') removeEdge(change.id);
    }
  };

  const isValidConnection: IsValidConnection = (conn) =>
    connectionProblem(definition, {
      source: conn.source,
      sourceHandle: conn.sourceHandle ?? null,
      target: conn.target,
    }) === null;

  const onConnect = (conn: Connection) => {
    connect({ source: conn.source, sourceHandle: conn.sourceHandle, target: conn.target });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData(KIND_MIME) as NodeKind;
    if (!NODE_KINDS.includes(kind)) return;
    addNode(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  // A click without a drag opens the node's editor (a drag past CLICK_DISTANCE suppresses the
  // click). A click on a port handle starts or ends a connection instead.
  const onNodeClick: NodeMouseHandler<FlowNode> = (event, node) => {
    if ((event.target as Element).closest('.react-flow__handle')) return;
    openNode(node.id);
  };

  // Enter on a focused node opens its editor; Space still only selects it (xyflow). Delete or
  // Backspace removes the selected edge or node only while focus is on the canvas: xyflow's own
  // handler listens on the whole document, so the keys deleted the selected node with focus on a
  // toolbar button too, with no undo. The node editor dialog renders outside the canvas, and keys
  // from any dialog are ignored here as well.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('dialog')) return;
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

  return (
    <div
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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={(_, node) => endDrag(node.id, node.position)}
        onNodeClick={onNodeClick}
        nodeClickDistance={CLICK_DISTANCE}
        nodeDragThreshold={CLICK_DISTANCE}
        onPaneClick={() => select(undefined)}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        deleteKeyCode={null}
        ariaLabelConfig={ARIA_LABELS}
      >
        <Background gap={22} size={1.3} />
        <Controls fitViewOptions={FIT_VIEW_OPTIONS} />
      </ReactFlow>
    </div>
  );
}
