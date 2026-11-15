/**
 * Whether the selected connection's toolbar may act after a mouse pan of the canvas, or a mouse drag
 * of one of its cards (#207).
 *
 * A mouse pan that moved ends in d3-zoom's window-capture `mouseup` handler, and a mouse drag of a
 * card in d3-drag's (xyflow's XYDrag). Each first calls d3-drag's `yesdrag`, which adds a
 * window-capture `click.drag` listener cancelling the next click anywhere on the page, and queues
 * the listener's removal as a zero-delay task. A click on Remove connection in that interval was
 * swallowed while the button looked enabled.
 *
 * The gate is `panning` from the canvas's first mouse move of a pan (xyflow's `onMove` with a
 * `mousemove` source event) or the start of a mouse drag of a card (xyflow's `onNodeDragStart`,
 * which XYDrag calls with the `mousemove` past the node drag threshold; the canvas sets that to the
 * click distance it gives d3-drag, past which d3-drag blocks the release's click). Wheel, touch,
 * keyboard and programmatic moves add no blocker and never touch the gate. It is then `settling`
 * once a mouse button is released, and `ready` again two tasks later. Its one passive window-capture
 * `mouseup` listener is added when the canvas mounts, so it runs before the `mouseup` listener
 * d3-zoom or d3-drag adds on each press (which stops the event). On a release it queues a
 * zero-delay task that queues a second one. The first is queued before d3 queues its cleanup, so
 * the second runs after that cleanup: only the second makes the gate ready, and only if no mouse
 * move came since the release and the canvas is still mounted. This is a task-order barrier on the
 * installed event order (pinned by `viewport-gesture.contract.test.tsx`), not a delay. A gesture
 * whose release never reaches the page keeps the gate unavailable until the next mouse release
 * there, which also ends d3's gesture. The gate never prevents, stops or replays an event.
 */
export type ViewportGesture = 'ready' | 'panning' | 'settling';

export interface ViewportGestureGate {
  /** The gate now: only `ready` lets the toolbar act. */
  state(this: void): ViewportGesture;
  /** Called on every change of state; returns the unsubscribe. */
  subscribe(this: void, listener: () => void): () => void;
  /**
   * xyflow's `onMove` or `onNodeDragStart` source event: a `mousemove` (a mouse pan, or a mouse
   * drag of a card) makes the gate `panning`; any other event leaves it as it is.
   */
  move(this: void, event: Event | null | undefined): void;
  /** Listen for mouse releases on `view` until the returned detach runs (the canvas unmounts). */
  attach(this: void, view: Window): () => void;
}

/** A gate per canvas; it starts ready. */
export function createViewportGestureGate(): ViewportGestureGate {
  let state: ViewportGesture = 'ready';
  // Advanced by every mouse move and by detaching: a release's barrier acts only on its own.
  let generation = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const set = (next: ViewportGesture) => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const cancel = () => {
    if (pending === undefined) return;
    clearTimeout(pending);
    pending = undefined;
  };
  const release = () => {
    if (state === 'ready') return;
    // A later release restarts the barrier: it then also follows any cleanup this one queues.
    cancel();
    const released = generation;
    set('settling');
    // Use the global timer queue, the one d3-drag queues its cleanup on.
    pending = setTimeout(() => {
      pending = setTimeout(() => {
        pending = undefined;
        if (released === generation) set('ready');
      }, 0);
    }, 0);
  };

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    move(event) {
      if (event?.type !== 'mousemove') return;
      generation += 1;
      cancel();
      set('panning');
    },
    attach(view) {
      view.addEventListener('mouseup', release, { capture: true, passive: true });
      return () => {
        view.removeEventListener('mouseup', release, { capture: true });
        generation += 1;
        cancel();
      };
    },
  };
}
