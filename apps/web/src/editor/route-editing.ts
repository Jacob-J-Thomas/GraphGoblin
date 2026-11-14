import { createContext } from 'react';
import type { Route, RouteSegment } from './manual-route.js';
import type { Point } from './routing-geometry.js';
import type { ViewportGestureGate } from './viewport-gesture.js';

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
  /**
   * Remove the connection itself (#207): one undo step, refused for a protected Chat voice step. The
   * canvas drops the selection and moves focus to a control where Delete removes nothing.
   */
  remove(edgeId: string): void;
  /**
   * Whether Reset route and Remove connection may act (#207): not from a mouse pan's first move
   * until its release has settled, while d3 may still cancel the next click (viewport-gesture.ts).
   */
  viewport: Pick<ViewportGestureGate, 'state' | 'subscribe'>;
}

export const RouteEditingContext = createContext<RouteEditing | undefined>(undefined);
