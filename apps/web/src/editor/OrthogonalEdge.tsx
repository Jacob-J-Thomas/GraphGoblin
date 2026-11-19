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
  useId,
  useMemo,
  useRef,
  useState,
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
import { roundedPath } from './routing.js';
import { followEdgeLabel } from './edge-label-placement.js';
import { edgeLabelText } from './edge-label-text.js';
import { edgeRemovalRefusal, edgeRouteRefusal, useEditorStore } from './store.js';

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
/**
 * The selected edge's toolbar frame (screen px), centred above its label. Wide enough for Crosses a
 * card, Reset route and Remove connection side by side; only the controls themselves take pointer
 * events, so the empty frame never covers the canvas.
 */
const TOOLBAR_WIDTH = 420;
/** The height (screen px) of the toolbar's row of controls, whose bottom sits above the label. */
const TOOLBAR_HEIGHT = 48;
/** How far (screen px) the toolbar's row ends above the label's centre, and the note starts below. */
const LABEL_GAP = 18;
/**
 * Room (screen px) for the note of a connection whose id is shared (#481), enough for its text
 * wrapped on a narrow screen. Its frame is twice the toolbar's width, so the note can move sideways
 * by up to half its own width. Frames are transparent to the pointer, so the room covers nothing;
 * only the note and the controls take pointer events.
 */
const NOTE_ROOM = 240;
/** The margin (screen px) the note keeps from the pane's sides, and its gap to the controls. */
const NOTE_MARGIN = 8;
type Transform = readonly [number, number, number];
const NO_TRANSFORM: Transform = [0, 0, 1];
/** The viewport, which a shared id's note follows while it shows (#481); otherwise a constant. */
const transformOf = (state: Pick<ReactFlowState, 'transform'>): Transform => state.transform;
const noTransformOf = (): Transform => NO_TRANSFORM;
const paneWidthOf = (state: Pick<ReactFlowState, 'width'>): number => state.width;
const paneHeightOf = (state: Pick<ReactFlowState, 'height'>): number => state.height;

/**
 * Where the note of a shared id (#481) goes, in screen px, for a toolbar anchored at `anchor` (flow
 * coordinates) in a pane of size `pane` seen through `transform`: as wide as the toolbar, or the
 * pane less its margins; moved sideways, by at most half its width so it stays over its connection,
 * to keep inside the pane; and below the label when the room above the controls is less than the
 * note's room and the room below is larger. The controls never move. A pane not yet measured leaves
 * the note centred above, at the toolbar's width.
 */
export function notePlacement(
  anchor: Point,
  transform: Transform,
  pane: { width: number; height: number },
): { width: number; shift: number; below: boolean } {
  if (pane.width <= 0 || pane.height <= 0) return { width: TOOLBAR_WIDTH, shift: 0, below: false };
  const [tx, ty, zoom] = transform;
  const width = Math.max(0, Math.min(TOOLBAR_WIDTH, pane.width - 2 * NOTE_MARGIN));
  const half = width / 2;
  const x = anchor.x * zoom + tx;
  const y = anchor.y * zoom + ty;
  const inside = Math.min(Math.max(x, NOTE_MARGIN + half), pane.width - NOTE_MARGIN - half);
  const shift = Math.min(Math.max(inside - x, -half), half);
  const roomAbove = y - LABEL_GAP - TOOLBAR_HEIGHT - NOTE_MARGIN;
  const roomBelow = pane.height - y - LABEL_GAP;
  return { width, shift, below: roomAbove < NOTE_ROOM && roomBelow > roomAbove };
}
/** Keys a toolbar button keeps from the edge and the canvas: they act on the button alone. */
const TOOLBAR_KEYS = ['Enter', ' ', 'Delete', 'Backspace'];
/** What a held Reset route says: it is unavailable because the route is automatic. */
const ROUTES_AUTOMATICALLY = 'The connection already routes automatically.';

/**
 * The toolbar as it was when Reset route was clicked (#207). The second press of a double click
 * lands where the first did; recentred on the automatic label, with Reset route gone, the toolbar
 * would put Remove connection under it. So the toolbar stays at `at` and Reset route stays in its
 * slot, unavailable, until the connection is drawn by hand again or deselected (the toolbar
 * unmounts). Meanwhile it may sit apart from the automatic label, or from a card moved since.
 */
interface ToolbarHold {
  /** The label the toolbar was centred on. */
  at: Point;
  /** Whether Crosses a card was showing: its slot stays as a blank, so nothing shifts. */
  crossing: boolean;
  /**
   * The manual route that was reset, until the automatic one has been drawn. The click's own render
   * still draws that route, and it must not end the hold. After the automatic route, any manual
   * route ends it (an Undo, a nudge or a drag), whatever array it comes back as; before it, only a
   * different array does (the reset took no effect and the route was drawn again).
   */
  reset: readonly Point[] | undefined;
}
const ARROWS: Record<string, ['x' | 'y', -1 | 1]> = {
  ArrowLeft: ['x', -1],
  ArrowRight: ['x', 1],
  ArrowUp: ['y', -1],
  ArrowDown: ['y', 1],
};

/**
 * One edge's path from ordered orthogonal points: a backward route from the router (#18), a manual
 * route (#44), or, for a forward edge without one, xyflow's own smoothstep. Selected, it shows a
 * handle on each segment and a toolbar: Remove connection (#207), which ignores a later click of a
 * double or triple click (a browser click count above one) and keeps focus on the connection, and,
 * for a manual route, Reset route, which stays where it was clicked, unavailable, until the route is
 * drawn by hand again or the connection is deselected. When more than one stored connection holds
 * its id (#481), a note above them says why both are unavailable and how to repair the draft.
 * xyflow's wrapper keeps the hit target, keyboard selection, and edge change and delete events.
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
  const placement = useSyncExternalStore(
    data?.channel.subscribe ?? noSubscription,
    data?.channel.getLabelSnapshot ?? noSnapshot,
  );
  if (!route && !data?.forward) return null; // A backward edge's handles are not measured yet.
  const textLabel = typeof label === 'string' ? label : '';
  const { full: fullLabel, visible: visibleLabel } = edgeLabelText(textLabel, route);
  let path: string;
  let labelAt: Point;
  let labelBox: Box | undefined;
  if (route) {
    path = roundedPath(route.points, route.radii);
    labelAt = route.label;
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
  const placedLabel = placement ? followEdgeLabel(placement, points) : undefined;
  if (placedLabel) {
    labelAt = placedLabel.at;
    labelBox = placedLabel.box;
  }
  return (
    <>
      <title>{fullLabel}</title>
      {placedLabel?.anchor ? (
        <path
          className="gg-edge-label-leader"
          fill="none"
          style={style}
          d={`M ${placedLabel.anchor.x} ${placedLabel.anchor.y} L ${labelAt.x} ${labelAt.y}`}
          aria-hidden="true"
          pointerEvents="none"
        />
      ) : null}
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
  const [hold, setHold] = useState<ToolbarHold>();
  // Reset route holds the toolbar until the connection is drawn by hand again (#207). Settled while
  // rendering, as the canvas settles its selection: the automatic route first, then any manual one.
  if (hold) {
    if (!manual) {
      if (hold.reset) setHold({ ...hold, reset: undefined });
    } else if (points !== hold.reset) setHold(undefined);
  }
  const anchor = hold?.at ?? labelAt;
  const base = useMemo<RouteBase>(
    () => ({ route: coordinatesOf(points), from: points[0]!, to: points.at(-1)! }),
    [points],
  );
  const segments = useMemo(() => segmentsOf(base.route, base.from, base.to), [base]);
  // The store's own reason for refusing this removal, if it has one (#207): a protected Chat voice
  // step keeps its connection, and an id more than one stored connection holds names no single one.
  const refusal = useEditorStore((s) =>
    s.definition ? edgeRemovalRefusal(s.definition, s.systemChat, edgeId) : undefined,
  );
  // The store's reason for refusing a route edit (#481): an id more than one stored connection
  // holds names no single route. It is the removal's reason too (the shared id is checked first),
  // and it says how to repair the draft. The toolbar shows it as a note as soon as the connection
  // is selected, before any refused action. Reset route, Remove connection and the handles stay
  // focusable, unavailable (aria-disabled) and described by the note, as Open in Runs is before a
  // publish: a pointer, the keyboard and assistive technology all reach the reason. A click on the
  // buttons changes nothing and raises no notice above the canvas, which would move the canvas
  // under a second click; a drag or nudge on a handle still shows the notice, as Delete does.
  const routeRefusal = useEditorStore((s) =>
    s.definition ? edgeRouteRefusal(s.definition, edgeId) : undefined,
  );
  const noteId = useId();
  const described = routeRefusal ? noteId : undefined;
  // The note stays readable on a narrow pane, or with the label near its top: it is placed from the
  // pane's size and the viewport, which it follows only while it shows.
  const transform = useStore(routeRefusal ? transformOf : noTransformOf);
  const paneWidth = useStore(paneWidthOf);
  const paneHeight = useStore(paneHeightOf);
  const placement = notePlacement(anchor, transform, { width: paneWidth, height: paneHeight });
  // From a mouse pan's first move, or a mouse node drag's start, until its release settles, d3 may
  // cancel the next click (#207). Reset route and Remove connection then say they are unavailable,
  // keeping their hit target and focus (aria-disabled, not disabled), and their handlers refuse on
  // the same rendered state.
  const gesture = useSyncExternalStore(editing.viewport.subscribe, editing.viewport.state);
  const settling = gesture === 'ready' ? undefined : gesture;
  // The store's reason wins: that button stays disabled with its message.
  const removeSettling = refusal ? undefined : settling;
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
  // The shared id's note (#481): one element, above the controls or, without room there, below the
  // label. Pointer presses on it neither pan nor drag.
  const note = routeRefusal ? (
    <p
      id={noteId}
      className="gg-route-note nodrag nopan rounded-md border border-l-4 border-status-warn-border bg-status-warn-bg px-2.5 py-1.5 text-xs leading-snug text-default wrap-anywhere"
      style={{ width: placement.width, transform: `translateX(${placement.shift}px)` }}
    >
      {routeRefusal}
    </p>
  ) : null;
  const noteAbove = !!note && !placement.below;
  // Escape returns to the connection; the keys that act on a button stay with it.
  const toolbarKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      edgeElement()?.focus();
    } else if (TOOLBAR_KEYS.includes(event.key)) event.stopPropagation();
  };
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
            aria-description={
              routeRefusal
                ? undefined
                : `${vertical ? 'Left and Right' : 'Up and Down'} arrows move it one grid step, with Shift five. Escape returns to the connection.`
            }
            aria-describedby={described}
            aria-disabled={routeRefusal ? true : undefined}
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
      <g transform={`translate(${anchor.x} ${anchor.y - LABEL_GAP / zoom}) ${scale}`}>
        <foreignObject
          x={-(noteAbove ? 2 * TOOLBAR_WIDTH : TOOLBAR_WIDTH) / 2}
          y={-(TOOLBAR_HEIGHT + (noteAbove ? NOTE_ROOM : 0))}
          width={noteAbove ? 2 * TOOLBAR_WIDTH : TOOLBAR_WIDTH}
          height={TOOLBAR_HEIGHT + (noteAbove ? NOTE_ROOM : 0)}
          className="gg-route-toolbar-frame"
        >
          {/* The row of controls stays at the bottom, where it is without the note. */}
          <div className="flex h-full flex-col items-center justify-end gap-2">
            {noteAbove ? note : null}
            <div className="gg-route-toolbar flex w-full items-end justify-center gap-2">
              {manual && crossing ? (
                <span className="rounded-md border border-default bg-surface-raised px-2 py-1 text-xs text-muted">
                  Crosses a card
                </span>
              ) : hold?.crossing ? (
                // The same span, blank and hidden from assistive technology: its width keeps the
                // controls beside it where they were.
                <span
                  className="rounded-md border border-default bg-surface-raised px-2 py-1 text-xs text-muted invisible"
                  aria-hidden="true"
                >
                  Crosses a card
                </span>
              ) : null}
              {manual || hold ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="nodrag nopan nokey pointer-coarse:h-11"
                  // Unavailable for a shared id, described by the note above (#481); held on an
                  // automatic route, because there is nothing to reset. Either way still a hit
                  // target that keeps focus and `nopan`, so a second press lands here.
                  aria-disabled={routeRefusal || settling || !manual ? true : undefined}
                  aria-describedby={described}
                  data-gesture={routeRefusal ? undefined : settling}
                  title={routeRefusal || manual ? undefined : ROUTES_AUTOMATICALLY}
                  onClick={(event) => {
                    // As Remove connection's: the edge wrapper would select this edge again, which
                    // with Control or Meta held toggles it off and takes the hold with it.
                    event.stopPropagation();
                    if (routeRefusal || settling || !manual) return;
                    setHold({ at: labelAt, crossing, reset: points });
                    // Focus first: a reset refused for a stale selection moves focus on to Undo.
                    edgeElement()?.focus();
                    editing.reset(edgeId);
                  }}
                  onKeyDown={toolbarKeys}
                >
                  Reset route
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="nodrag nopan nokey pointer-coarse:h-11"
                // A protected voice step stays disabled with its own reason (#207). A shared id is
                // unavailable, focusable and described by the note above (#481).
                disabled={!!refusal && !routeRefusal}
                aria-disabled={routeRefusal || removeSettling ? true : undefined}
                aria-describedby={described}
                data-gesture={removeSettling}
                title={routeRefusal ? undefined : refusal}
                onClick={(event) => {
                  // The edge wrapper would select this (now removed) edge again on the same click.
                  event.stopPropagation();
                  // A later click of a double or triple click (the browser's count above one) goes
                  // on from the press before it, which may have selected this connection and so
                  // drawn this button under the pointer (#207). It removes nothing and leaves focus
                  // on the connection, as that press did. Enter, Space and element.click() report
                  // 0, and a separate click 1: both go on to remove.
                  if (event.detail > 1) {
                    edgeElement()?.focus();
                    return;
                  }
                  if (routeRefusal || settling) return;
                  editing.remove(edgeId);
                }}
                onKeyDown={toolbarKeys}
              >
                Remove connection
              </Button>
            </div>
          </div>
        </foreignObject>
      </g>
      {note && placement.below ? (
        // No room above the controls, and more below the label: the note goes there instead.
        <g transform={`translate(${anchor.x} ${anchor.y + LABEL_GAP / zoom}) ${scale}`}>
          <foreignObject
            x={-TOOLBAR_WIDTH}
            y={0}
            width={2 * TOOLBAR_WIDTH}
            height={NOTE_ROOM}
            className="gg-route-toolbar-frame"
          >
            <div className="flex h-full flex-col items-center justify-start">{note}</div>
          </foreignObject>
        </g>
      ) : null}
    </g>
  );
}
