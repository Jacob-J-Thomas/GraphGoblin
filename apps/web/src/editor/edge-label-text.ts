import { LABEL_CHARACTER_WIDTH } from './routing-labels.js';
import { routeMessage, type RoutedEdge } from './routing.js';

/** The solver reserves exactly the text the renderer draws; titles keep the complete label. */
export function edgeLabelText(
  text: string,
  route?: Pick<RoutedEdge, 'blocked' | 'unavailable' | 'labelWidth'>,
): { full: string; visible: string } {
  const message = route ? routeMessage(route) : '';
  const full = message ? `${text || 'Connection'}: ${message}` : text;
  const capacity = route ? Math.floor(route.labelWidth / LABEL_CHARACTER_WIDTH) : full.length;
  const visible =
    !message && full.length > capacity ? `${full.slice(0, Math.max(0, capacity - 1))}…` : full;
  return { full, visible };
}
