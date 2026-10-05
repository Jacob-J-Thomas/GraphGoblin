import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { memo, useSyncExternalStore } from 'react';
import { roundedPath, routeMessage } from './routing.js';
import type { RouteChannel } from './route-channels.js';

export type BackwardFlowEdge = Edge<RouteChannel, 'backward'>;
const noSnapshot = () => undefined;
const noSubscription = () => () => {};

/** xyflow's wrapper retains the hit target, keyboard selection and edge-change/delete events. */
export const BackwardEdge = memo(function BackwardEdge({
  id,
  data,
  label,
  style,
  markerStart,
  markerEnd,
  interactionWidth,
}: EdgeProps<BackwardFlowEdge>) {
  const route = useSyncExternalStore(
    data?.subscribe ?? noSubscription,
    data?.getSnapshot ?? noSnapshot,
  );
  if (!route) return null; // Handles have not been measured yet.
  const textLabel = typeof label === 'string' ? label : '';
  const fullLabel = routeMessage(route)
    ? `${textLabel || 'Connection'}: ${routeMessage(route)}`
    : textLabel;
  // Fit text on the straight segment; the edge's accessible name and title retain the full port.
  const capacity = Math.floor(route.labelWidth / 7);
  const visibleLabel =
    fullLabel.length > capacity && !routeMessage(route)
      ? `${fullLabel.slice(0, Math.max(1, capacity - 1))}…`
      : fullLabel;
  return (
    <>
      <title>{fullLabel}</title>
      <BaseEdge
        id={id}
        path={roundedPath(route.points, route.radius)}
        label={visibleLabel || undefined}
        labelX={route.label.x}
        labelY={route.label.y}
        labelBgPadding={[8, 3]}
        labelBgBorderRadius={9}
        style={style}
        {...(markerStart ? { markerStart } : {})}
        {...(markerEnd ? { markerEnd } : {})}
        {...(interactionWidth !== undefined ? { interactionWidth } : {})}
      />
    </>
  );
});
