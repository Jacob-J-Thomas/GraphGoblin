import {
  BaseEdge,
  getSmoothStepPath,
  Position,
  useStore,
  type Edge,
  type EdgeProps,
  type ReactFlowState,
} from '@xyflow/react';
import {
  memo,
  use,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { Button } from '../components/ui/index.js';
import {
  coordinatesOf,
  forwardPoints,
  LARGE_NUDGE,
  midpoint,
  segmentsOf,
  type RouteSegment,
} from './manual-route.js';
import { RouteEditingContext, type RouteBase, type RouteEditing } from './route-editing.js';
import type { RouteChannel } from './route-channels.js';
import type { Box, Point } from './routing-geometry.js';
import { LABEL_CHARACTER_WIDTH, LABEL_HEIGHT, LABEL_PADDING } from './routing-labels.js';
import { roundedPath, routeMessage } from './routing.js';

export interface OrthogonalEdgeData extends Record<string, unknown> {
  /** The edge's routed geometry, published by the canvas without rebuilding xyflow's edges. */
  channel: RouteChannel;
  /** Points forward: with no route of its own it draws xyflow's smoothstep path, as before. */
  forward: boolean;
  /**
   * Its stored manual route is set aside: a card being dragged now lands on it, so the automatic
   * route is drawn (and the manual one is removed if the card is released there).
   */
  suspended: boolean;
}
export type OrthogonalFlowEdge = Edge<OrthogonalEdgeData, 'orthogonal'>;

const noSnapshot = () => undefined;
const noSubscription = () => () => {};
export const zoomOf = (state: Pick<ReactFlowState, 'transform'>): number => state.transform[2];

/** Keep a handle this far (screen px) from a label pill, when its segment has room for it. */
const HANDLE_REACH = 14;
const ARROWS: Record<string, ['x' | 'y', -1 | 1]> = {
  ArrowLeft: ['x', -1],
  ArrowRight: ['x', 1],
  ArrowUp: ['y', -1],
  ArrowDown: ['y', 1],
};

/**
 * One edge's path from ordered orthogonal points: a backward route from the router (#18), a manual
 * route (#44), or, for a forward edge without one, xyflow's own smoothstep. Selected, it shows a
 * handle on each segment and, for a manual route, a Reset route button. xyflow's wrapper keeps the
 * hit target, keyboard selection, and edge change and delete events.
 */
export const OrthogonalEdge = memo(function OrthogonalEdge({
  id,
  data,
  label,
  style,
  markerStart,
  markerEnd,
  interactionWidth,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps<OrthogonalFlowEdge>) {
  const route = useSyncExternalStore(
    data?.channel.subscribe ?? noSubscription,
    data?.channel.getSnapshot ?? noSnapshot,
  );
  const editing = use(RouteEditingContext);
  if (!route && !data?.forward) return null; // A backward edge's handles are not measured yet.
  const textLabel = typeof label === 'string' ? label : '';
  const message = route ? routeMessage(route) : '';
  const fullLabel = message ? `${textLabel || 'Connection'}: ${message}` : textLabel;
  let path: string;
  let labelAt: Point;
  let visibleLabel = fullLabel;
  let labelBox: Box | undefined;
  if (route) {
    path = roundedPath(route.points, route.radii);
    labelAt = route.label;
    // Fit text on the straight segment; the edge's accessible name and title keep the full port.
    const capacity = Math.floor(route.labelWidth / LABEL_CHARACTER_WIDTH);
    if (fullLabel.length > capacity && !message)
      visibleLabel = `${fullLabel.slice(0, Math.max(0, capacity - 1))}…`;
    labelBox = route.labelBounds ?? pill(labelAt, visibleLabel);
  } else {
    const [smooth, x, y] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition: Position.Right,
      targetX,
      targetY,
      targetPosition: Position.Left,
      borderRadius: 10,
    });
    path = smooth;
    labelAt = { x, y };
    labelBox = pill(labelAt, visibleLabel);
  }
  const points = route
    ? route.points
    : forwardPoints({ x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  return (
    <>
      <title>{fullLabel}</title>
      <BaseEdge
        id={id}
        path={path}
        label={visibleLabel || undefined}
        labelX={labelAt.x}
        labelY={labelAt.y}
        labelBgPadding={[8, 3]}
        labelBgBorderRadius={9}
        style={style}
        {...(route?.crossing ? { className: 'gg-route-crossing' } : {})}
        {...(markerStart ? { markerStart } : {})}
        {...(markerEnd ? { markerEnd } : {})}
        {...(interactionWidth !== undefined ? { interactionWidth } : {})}
      />
      {selected && editing && points.length > 1 ? (
        <RouteHandles
          edgeId={id}
          points={points}
          labelAt={labelAt}
          labelBox={labelBox}
          manual={!!route?.manual || !!data?.suspended}
          crossing={!!route?.crossing}
          editing={editing}
        />
      ) : null}
    </>
  );
});

/** The envelope of a label pill holding `text` at `at`, as the router reserves one. */
function pill(at: Point, text: string): Box | undefined {
  if (!text) return undefined;
  const half = (text.length * LABEL_CHARACTER_WIDTH + LABEL_PADDING) / 2;
  const top = at.y - LABEL_HEIGHT / 2;
  return { id: '', left: at.x - half, right: at.x + half, top, bottom: top + LABEL_HEIGHT };
}

/**
 * Where a segment's handle goes: its midpoint, unless the label pill sits there; then the middle
 * of the longer part of the segment beside the pill, when that part has room for the handle.
 */
function handleAt(segment: RouteSegment, labelBox: Box | undefined, zoom: number): Point {
  const middle = midpoint(segment);
  const reach = HANDLE_REACH / zoom;
  if (
    !labelBox ||
    middle.x < labelBox.left - reach ||
    middle.x > labelBox.right + reach ||
    middle.y < labelBox.top - reach ||
    middle.y > labelBox.bottom + reach
  )
    return middle;
  const along = segment.axis === 'y' ? 'x' : 'y';
  const [low, high] = [segment.a[along], segment.b[along]].sort((p, q) => p - q) as [
    number,
    number,
  ];
  const [boxLow, boxHigh] =
    along === 'x' ? [labelBox.left, labelBox.right] : [labelBox.top, labelBox.bottom];
  const parts: [number, number][] = [
    [low, boxLow - reach],
    [boxHigh + reach, high],
  ];
  const [start, end] = parts.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0]!;
  if (end - start < 2 * reach) return middle;
  return { ...middle, [along]: (start + end) / 2 };
}

function RouteHandles({
  edgeId,
  points,
  labelAt,
  labelBox,
  manual,
  crossing,
  editing,
}: {
  edgeId: string;
  points: readonly Point[];
  labelAt: Point;
  labelBox: Box | undefined;
  manual: boolean;
  crossing: boolean;
  editing: RouteEditing;
}) {
  const zoom = useStore(zoomOf);
  const groupRef = useRef<SVGGElement>(null);
  const base = useMemo<RouteBase>(
    () => ({ route: coordinatesOf(points), from: points[0]!, to: points.at(-1)! }),
    [points],
  );
  const segments = useMemo(() => segmentsOf(base.route, base.from, base.to), [base]);
  // After a nudge, keep focus on the moved segment even when a split renumbered it: once the
  // stored route comes back with that segment, focus its handle.
  const focusTargetRef = useRef<RouteSegment>(undefined);
  useEffect(() => {
    const target = focusTargetRef.current;
    const moved =
      target &&
      segments.find(
        (s) => s.index === target.index && s.axis === target.axis && s.value === target.value,
      );
    if (!moved) return;
    focusTargetRef.current = undefined;
    groupRef.current?.querySelector<SVGGElement>(`[data-segment="${moved.index}"]`)?.focus();
  }, [segments]);
  const edgeElement = () => groupRef.current?.closest<SVGGElement>('.react-flow__edge');

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, segment: RouteSegment) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      edgeElement()?.focus();
      return;
    }
    // A handle only moves its segment: Enter, Space, Delete and Backspace change nothing.
    if (['Enter', ' ', 'Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    event.stopPropagation();
    if (arrow[0] !== segment.axis) return;
    const moved = editing.nudge(edgeId, base, segment, arrow[1], event.shiftKey ? LARGE_NUDGE : 1);
    focusTargetRef.current = moved;
  };

  const scale = `scale(${1 / zoom})`;
  return (
    <g ref={groupRef} className="gg-route-handles">
      {segments.map((segment, i) => {
        const at = handleAt(segment, labelBox, zoom);
        const vertical = segment.axis === 'x';
        return (
          <g
            key={segment.index}
            data-segment={segment.index}
            className={`gg-route-handle nodrag nopan nokey gg-route-handle-${segment.axis}`}
            role="button"
            tabIndex={0}
            aria-label={`Route segment ${i + 1} of ${segments.length}, ${vertical ? 'vertical' : 'horizontal'}`}
            aria-description={`${vertical ? 'Left and Right' : 'Up and Down'} arrows move it one grid step, with Shift five. Escape returns to the connection.`}
            aria-keyshortcuts={vertical ? 'ArrowLeft ArrowRight' : 'ArrowUp ArrowDown'}
            transform={`translate(${at.x} ${at.y}) ${scale}`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.preventDefault();
              event.currentTarget.focus();
              editing.begin(edgeId, base, segment, event);
            }}
            onKeyDown={(event) => onKeyDown(event, segment)}
          >
            <circle className="gg-route-handle-hit" r={12} />
            <circle className="gg-route-handle-ring" r={10} />
            <circle className="gg-route-handle-dot" r={6} />
          </g>
        );
      })}
      {manual ? (
        <g transform={`translate(${labelAt.x} ${labelAt.y - 18 / zoom}) ${scale}`}>
          <foreignObject
            x={crossing ? -120 : -60}
            y={-48}
            width={crossing ? 240 : 120}
            height={48}
            className="gg-route-toolbar-frame"
          >
            <div className="gg-route-toolbar flex h-full items-end justify-center gap-2">
              {crossing ? (
                <span className="rounded-md border border-default bg-surface-raised px-2 py-1 text-xs text-muted">
                  Crosses a card
                </span>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="nodrag nopan nokey pointer-coarse:h-11"
                onClick={() => {
                  editing.reset(edgeId);
                  edgeElement()?.focus();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    edgeElement()?.focus();
                  } else if (['Enter', ' ', 'Delete', 'Backspace'].includes(event.key))
                    event.stopPropagation();
                }}
              >
                Reset route
              </Button>
            </div>
          </foreignObject>
        </g>
      ) : null}
    </g>
  );
}
