import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { roundedPath, type RoutedEdge } from './routing.js';

export type BackwardFlowEdge = Edge<RoutedEdge, 'backward'>;

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
  if (!data) return null; // Handles have not been measured yet.
  const route = data;
  const textLabel = typeof label === 'string' ? label : '';
  const fullLabel = route.blocked
    ? `${textLabel || 'Connection'}: move overlapping nodes apart`
    : textLabel;
  // Fit text on the straight segment; the edge's accessible name and title retain the full port.
  const capacity = Math.floor(route.labelWidth / 7);
  const visibleLabel =
    fullLabel.length > capacity && !route.blocked
      ? `${fullLabel.slice(0, Math.max(1, capacity - 1))}…`
      : fullLabel;
  return (
    <>
      <title>{fullLabel}</title>
      <BaseEdge
        id={id}
        path={roundedPath(route.points)}
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
