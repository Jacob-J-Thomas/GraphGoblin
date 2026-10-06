import { createContext } from 'react';
import type { Route, RouteSegment } from './manual-route.js';
import type { Point } from './routing-geometry.js';

/** The route an edit starts from: the one drawn now, in stored form, between its port tips. */
export interface RouteBase {
  route: Route;
  from: Point;
  to: Point;
}

/**
 * What a selected edge's segment handles and Reset route button ask of the canvas (#44). The
 * canvas owns the drag preview, the card geometry, the store, and the announcements.
 */
export interface RouteEditing {
  /** Start a pointer drag of `segment`; the canvas follows the pointer until it is released. */
  begin(
    edgeId: string,
    base: RouteBase,
    segment: RouteSegment,
    pointer: { clientX: number; clientY: number },
  ): void;
  /**
   * Move `segment` by grid lines (`steps` of them) in `direction`, past any card in the way. Returns
   * the segment as it is in the stored route afterwards, or `undefined` when nothing moved.
   */
  nudge(
    edgeId: string,
    base: RouteBase,
    segment: RouteSegment,
    direction: -1 | 1,
    steps: number,
  ): RouteSegment | undefined;
  /** Remove the edge's manual route: it routes automatically again. */
  reset(edgeId: string): void;
}

export const RouteEditingContext = createContext<RouteEditing | undefined>(undefined);
