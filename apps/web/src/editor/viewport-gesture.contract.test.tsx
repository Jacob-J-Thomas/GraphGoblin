/**
 * The pan gate's contract with the installed dependencies (#207), for a mouse pan (d3-zoom) and a
 * mouse drag of a card (xyflow's XYDrag on d3-drag): the real Canvas on
 * @xyflow/react 12.12.0, @xyflow/system 0.0.83, d3-zoom 3.0.0 and d3-drag 3.0.0 in jsdom, on real
 * timers. No dependency, window listener or timer is replaced. The fixture supplies only the layout
 * jsdom lacks (card and pane sizes, and a ResizeObserver that reports them), so xyflow measures the
 * cards and draws the connection; React schedules work as in a browser (no act environment).
 *
 * Readings are passive. Window listeners added by the test record whether each event was cancelled
 * and whether it reached the window's bubble phase, and d3-selection's own bookkeeping on the
 * window (`__on`) says which of d3's listeners are registered. Events are dispatched as a browser
 * dispatches pointer input: mousedown, mousemove and mouseup with `view: window`, then the click.
 */
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useEffect } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from './Canvas.js';
import { newLoopDefinition } from './model.js';
import { NODE_CARD_SIZE } from './routing-geometry.js';
import { useEditorStore } from './store.js';

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
const VIEW = { width: 1200, height: 800 };

/** jsdom has no layout: cards and the flow get their sizes; everything else stays 0 × 0. */
function size(element: Element): { width: number; height: number } {
  if (element.classList.contains('react-flow__node'))
    return { width: NODE_CARD_SIZE.width, height: NODE_CARD_SIZE.height };
  if (
    element.classList.contains('react-flow') ||
    element.classList.contains('react-flow__renderer')
  )
    return VIEW;
  return { width: 0, height: 0 };
}

/** A ResizeObserver that reports each observed element once, as a browser does on observe. */
class ReportingResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    // xyflow reads an entry's `target` and, for the pane's extent, its `contentRect` size.
    const { width, height } = size(target);
    const contentRect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
    };
    const entries = [{ target, contentRect }] as unknown as ResizeObserverEntry[];
    queueMicrotask(() => this.callback(entries, this));
  }
  unobserve(): void {}
  disconnect(): void {}
}

const saved = {
  observer: globalThis.ResizeObserver,
  width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  act: actEnvironment.IS_REACT_ACT_ENVIRONMENT,
};
beforeAll(() => {
  globalThis.ResizeObserver = ReportingResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return size(this).width;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return size(this).height;
    },
  });
});
afterAll(() => {
  globalThis.ResizeObserver = saved.observer;
  if (saved.width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', saved.width);
  if (saved.height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', saved.height);
});
beforeEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = saved.act;
});

/**
 * The page's window, as an event's `view` (a browser's `window`). In Vitest's jsdom environment the
 * global `window` (also `document.defaultView` there) is the test global with jsdom's window
 * functions bound to jsdom's own window, so a listener added through it (as the canvas adds the
 * gate's) is on the same window as d3's. jsdom's event constructors accept only jsdom's own window,
 * which Vitest exposes as `jsdom.window`, and d3 keeps its bookkeeping on `event.view`.
 */
const view = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;

/** d3-selection's record of the listeners d3 registered on the window, read and never changed. */
function d3OnWindow(): string[] {
  const on = (view as unknown as { __on?: { type: string; name: string }[] }).__on ?? [];
  return on.map((listener) => `${listener.type}.${listener.name}`);
}
const clickBlocker = () => d3OnWindow().includes('click.drag');

interface Reading {
  type: string;
  /** Cancelled before the test's capture listener (the first listener d3 can add after) ran. */
  cancelledAtCapture: boolean;
  /** d3's window listeners when the event reached the test's capture listener. */
  d3: string[];
  /** Whether the event went on to the window's bubble phase (d3's `noevent` stops it). */
  bubbled: boolean;
}

/** Passive window listeners added after the canvas mounted and before any press. */
function observeWindow() {
  const readings = new Map<Event, Reading>();
  const capture = (event: Event) =>
    readings.set(event, {
      type: event.type,
      cancelledAtCapture: event.defaultPrevented,
      d3: d3OnWindow(),
      bubbled: false,
    });
  const bubble = (event: Event) => {
    const reading = readings.get(event);
    if (reading) reading.bubbled = true;
  };
  for (const type of ['mouseup', 'click']) {
    window.addEventListener(type, capture, { capture: true, passive: true });
    window.addEventListener(type, bubble, { passive: true });
  }
  return {
    readings,
    stop() {
      for (const type of ['mouseup', 'click']) {
        window.removeEventListener(type, capture, { capture: true });
        window.removeEventListener(type, bubble);
      }
    },
  };
}

const BUTTONS: Record<number, number> = { 0: 1, 1: 4 };
function mouse(type: string, x: number, y: number, button = 0, buttons = 0, init?: MouseEventInit) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    clientX: x,
    clientY: y,
    button,
    buttons,
    detail: type === 'click' ? 1 : 0,
    ...init,
  });
}

/** Let the microtasks queued so far run (React commits a synchronous update in one), no task. */
async function microtasks() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A zero-delay task queued now, on the global queue d3 and the gate use, and its result. */
function queuedTask<T>(read: () => T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(read()), 0));
}

let flow: ReactFlowInstance | undefined;
let xyflow: ReturnType<typeof useStoreApi> | undefined;
const ends: (string | null)[] = [];

/** The public `onMoveEnd` slot of xyflow's store, used here only to observe its end callbacks. */
function Observe() {
  flow = useReactFlow();
  const store = useStoreApi();
  xyflow = store;
  useEffect(() => {
    store.setState({ onMoveEnd: (event) => ends.push(event?.type ?? null) });
  }, [store]);
  return null;
}

function Live() {
  const definition = useEditorStore((s) => s.definition)!;
  return (
    <ReactFlowProvider>
      <Canvas definition={definition} issues={[]} />
      <Observe />
    </ReactFlowProvider>
  );
}

const store = () => useEditorStore.getState();
const remove = () => screen.getByRole('button', { name: 'Remove connection' });
const stored = () => store().definition!.edges.map((edge) => edge.id);

/** The canvas with start → done drawn and its connection `e1` selected, as a click selects it. */
async function selectedConnection(definition: LoopDefinitionInput = newLoopDefinition('Contract')) {
  store().load('L1', definition);
  const view = render(<Live />);
  const wrapper = await waitFor(() => {
    const found = view.container.querySelector<SVGGElement>('.react-flow__edge[data-id="e1"]');
    expect(found).not.toBeNull();
    return found!;
  });
  fireEvent.click(wrapper);
  await waitFor(() => expect(remove()).toBeInTheDocument());
  const pane = view.container.querySelector<HTMLElement>('.react-flow__pane')!;
  return { view, pane, wrapper };
}

/**
 * Resolves at the first moment Remove connection is shown available, running `act` right then: now,
 * if it is shown available already (as before #207, when it never said otherwise).
 */
function whenFirstAvailable<T>(button: HTMLElement, act: () => T): Promise<T> {
  if (!button.hasAttribute('aria-disabled')) return Promise.resolve(act());
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (button.hasAttribute('aria-disabled')) return;
      observer.disconnect();
      resolve(act());
    });
    observer.observe(button, { attributes: true, attributeFilter: ['aria-disabled'] });
  });
}

/**
 * A click on `target` now: whether it stayed uncancelled, whether it reached its target (d3's
 * window-capture `noevent` stops it before), and how the window's capture listener saw it. The
 * window's bubble phase is no signal for a toolbar button: an accepted or refused click on it stops
 * there, so the edge wrapper does not select the edge again.
 */
function click(target: Element, readings: Map<Event, Reading>, x = 0, y = 0) {
  const event = mouse('click', x, y);
  let reachedTarget = false;
  const arrive = () => {
    reachedTarget = true;
  };
  target.addEventListener('click', arrive, { passive: true });
  const delivered = target.dispatchEvent(event);
  target.removeEventListener('click', arrive);
  return { delivered, reachedTarget, ...readings.get(event)! };
}

describe('the pan gate on the installed xyflow and d3 (#207)', () => {
  beforeEach(() => {
    ends.length = 0;
    flow = undefined;
  });

  it('shows Remove unavailable while d3 cancels the next click, and delivers the first available click once', async () => {
    const { pane } = await selectedConnection();
    const button = remove();
    // A new canvas, after its programmatic fit, is ready.
    expect(button).not.toHaveAttribute('aria-disabled');
    const windowEvents = observeWindow();
    try {
      // The pan: press on the pane, move past the click distance.
      pane.dispatchEvent(mouse('mousedown', 600, 400, 0, 1));
      // A listener added after the press runs after d3's, which stops the release.
      const late: Event[] = [];
      const lateListener = (event: Event) => late.push(event);
      window.addEventListener('mouseup', lateListener, { capture: true });
      await microtasks();
      pane.dispatchEvent(mouse('mousemove', 710, 400, 0, 1));
      await microtasks();
      // What Remove says during the pan (asserted with the click below, so a failure shows both).
      const duringPan = {
        ariaDisabled: button.getAttribute('aria-disabled'),
        gesture: button.getAttribute('data-gesture'),
      };

      // The release, and the click the browser dispatches with it.
      const up = mouse('mouseup', 710, 400, 0, 0);
      pane.dispatchEvent(up);
      const panClick = click(pane, windowEvents.readings, 710, 400);
      window.removeEventListener('mouseup', lateListener, { capture: true });
      // The test's capture listener (added after the gate's at mount, before the press) saw the
      // release with d3's per-press listener still registered and no blocker yet; the listener
      // added after the press never ran.
      expect(windowEvents.readings.get(up)).toEqual({
        type: 'mouseup',
        cancelledAtCapture: false,
        d3: expect.arrayContaining(['mousemove.zoom', 'mouseup.zoom']) as string[],
        bubbled: false,
      });
      expect(windowEvents.readings.get(up)!.d3).not.toContain('click.drag');
      expect(late).toEqual([]);
      // d3 cancelled the pan's own click; the connection stays selected.
      expect(panClick).toMatchObject({
        delivered: false,
        reachedTarget: false,
        cancelledAtCapture: false,
        bubbled: false,
      });
      expect(panClick.d3).toContain('click.drag');

      // A click on Remove while d3's blocker is registered: d3 cancels it before it reaches the
      // button (the #207 failure, where Remove looked available), and Remove says it is unavailable.
      await microtasks();
      const immediate = {
        ariaDisabled: button.getAttribute('aria-disabled'),
        gesture: button.getAttribute('data-gesture'),
        blocker: clickBlocker(),
        ...click(button, windowEvents.readings),
        stored: stored(),
      };
      expect({ duringPan, immediate }).toEqual({
        duringPan: { ariaDisabled: 'true', gesture: 'panning' },
        immediate: {
          ariaDisabled: 'true',
          gesture: 'settling',
          blocker: true,
          delivered: false,
          reachedTarget: false,
          type: 'click',
          cancelledAtCapture: false,
          d3: expect.arrayContaining(['click.drag']) as string[],
          bubbled: false,
          stored: ['e1'],
        },
      });

      // A task queued now runs after the gate's first task and after d3's cleanup: the blocker is
      // gone, the click goes through, and Remove, still shown unavailable, refuses it.
      const afterCleanup = await queuedTask(() => ({
        blocker: clickBlocker(),
        gesture: button.getAttribute('data-gesture'),
        ...click(button, windowEvents.readings),
        stored: stored(),
      }));
      expect(afterCleanup).toMatchObject({
        blocker: false,
        gesture: 'settling',
        delivered: true,
        reachedTarget: true,
        stored: ['e1'],
      });

      // The first moment Remove is shown available, d3's blocker is gone and the click acts once.
      const first = await whenFirstAvailable(button, () => ({
        blocker: clickBlocker(),
        ...click(button, windowEvents.readings),
      }));
      expect(first).toMatchObject({ blocker: false, delivered: true, reachedTarget: true });
      expect(stored()).toEqual([]);
      expect(store().past.map((step) => step.label)).toEqual(['remove edge start to done']);
      store().undo();
      expect(store().definition).toEqual(newLoopDefinition('Contract'));
    } finally {
      windowEvents.stop();
    }
  });

  it('settles a middle-button pan the same way', async () => {
    const { pane } = await selectedConnection();
    const button = remove();
    const windowEvents = observeWindow();
    try {
      pane.dispatchEvent(mouse('mousedown', 600, 400, 1, BUTTONS[1]));
      await microtasks();
      pane.dispatchEvent(mouse('mousemove', 600, 520, 0, BUTTONS[1]));
      await microtasks();
      expect(button).toHaveAttribute('data-gesture', 'panning');
      pane.dispatchEvent(mouse('mouseup', 600, 520, 1, 0));
      await microtasks();
      expect(button).toHaveAttribute('data-gesture', 'settling');
      expect(clickBlocker()).toBe(true);
      const first = await whenFirstAvailable(button, () => ({
        blocker: clickBlocker(),
        ...click(button, windowEvents.readings),
      }));
      expect(first).toMatchObject({ blocker: false, delivered: true, reachedTarget: true });
      expect(stored()).toEqual([]);
      expect(store().past).toHaveLength(1);
    } finally {
      windowEvents.stop();
    }
  });

  it('lets a new pan invalidate an earlier release that has not settled', async () => {
    const { pane } = await selectedConnection();
    const button = remove();
    const windowEvents = observeWindow();
    try {
      pane.dispatchEvent(mouse('mousedown', 600, 400, 0, 1));
      pane.dispatchEvent(mouse('mousemove', 700, 400, 0, 1));
      pane.dispatchEvent(mouse('mouseup', 700, 400, 0, 0));
      // A second pan presses and moves before the first release's barrier ran.
      pane.dispatchEvent(mouse('mousedown', 700, 400, 0, 1));
      pane.dispatchEvent(mouse('mousemove', 760, 420, 0, 1));
      await microtasks();
      expect(button).toHaveAttribute('data-gesture', 'panning');
      // Both of the first release's tasks have run by the second of these: still unavailable.
      await queuedTask(() => undefined);
      await queuedTask(() => undefined);
      await microtasks();
      expect(button).toHaveAttribute('data-gesture', 'panning');
      const refused = click(button, windowEvents.readings);
      expect(refused).toMatchObject({ delivered: true, reachedTarget: true });
      expect(stored()).toEqual(['e1']);
      // The second pan's release settles it.
      pane.dispatchEvent(mouse('mouseup', 760, 420, 0, 0));
      const first = await whenFirstAvailable(button, () => ({
        blocker: clickBlocker(),
        ...click(button, windowEvents.readings),
      }));
      expect(first).toMatchObject({ blocker: false, delivered: true, reachedTarget: true });
      expect(stored()).toEqual([]);
    } finally {
      windowEvents.stop();
    }
  });

  it('is not stranded when a programmatic or wheel move replaces the pan’s end callback', async () => {
    const { pane } = await selectedConnection();
    const button = remove();
    const windowEvents = observeWindow();
    try {
      // A wheel zoom alone never makes the toolbar unavailable.
      pane.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          view,
          clientX: 600,
          clientY: 400,
          deltaY: -40,
        }),
      );
      await microtasks();
      expect(button).not.toHaveAttribute('aria-disabled');
      ends.length = 0;

      pane.dispatchEvent(mouse('mousedown', 600, 400, 0, 1));
      pane.dispatchEvent(mouse('mousemove', 700, 400, 0, 1));
      pane.dispatchEvent(mouse('mouseup', 700, 400, 0, 0));
      // Before xyflow's end timer for the release runs, a programmatic viewport change ends
      // another zoom: xyflow cancels the pending end and reports only the newer one.
      await flow!.setViewport({ x: 40, y: 40, zoom: 1 });
      pane.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          view,
          clientX: 600,
          clientY: 400,
          deltaY: 40,
        }),
      );
      const first = await whenFirstAvailable(button, () => ({
        blocker: clickBlocker(),
        ...click(button, windowEvents.readings),
      }));
      expect(first).toMatchObject({ blocker: false, delivered: true, reachedTarget: true });
      expect(stored()).toEqual([]);
      // xyflow reported the programmatic end and never the mouse release's; the gate settled on
      // its own barrier.
      expect(ends).toContain(null);
      expect(ends).not.toContain('mouseup');
    } finally {
      windowEvents.stop();
    }
  });

  it('leaves nothing behind when the canvas unmounts while a release settles', async () => {
    const { view: rendered, pane } = await selectedConnection();
    pane.dispatchEvent(mouse('mousedown', 600, 400, 0, 1));
    pane.dispatchEvent(mouse('mousemove', 700, 400, 0, 1));
    pane.dispatchEvent(mouse('mouseup', 700, 400, 0, 0));
    rendered.unmount();
    // Both barrier tasks would have run by now; nothing is rendered or removed.
    await queuedTask(() => undefined);
    await queuedTask(() => undefined);
    expect(screen.queryByRole('button', { name: 'Remove connection' })).toBeNull();
    expect(stored()).toEqual(['e1']);
    // A fresh canvas starts ready.
    await selectedConnection();
    expect(remove()).not.toHaveAttribute('aria-disabled');
  });
});

/** The contract draft with a card `other` that no connection touches, to drag aside. */
function withOther(): LoopDefinitionInput {
  const definition = newLoopDefinition('Contract');
  definition.nodes.push({
    id: 'other',
    kind: 'exit',
    label: 'Other',
    config: {},
    ui: { x: 0, y: 360 },
  });
  return definition;
}

/**
 * Hold xyflow's multi-selection key (Control off macOS), which it reads from the window's keys. A
 * card drag then keeps the selected connection, and its toolbar, instead of selecting the card alone.
 */
async function holdControl() {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true }),
  );
  await waitFor(() => expect(xyflow!.getState().multiSelectionActive).toBe(true));
}
const releaseControl = () =>
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft' }));
const CONTROL: MouseEventInit = { ctrlKey: true };

describe('the card-drag gate on the installed xyflow and d3 (#207)', () => {
  beforeEach(() => {
    ends.length = 0;
    flow = undefined;
    xyflow = undefined;
  });

  it('shows Remove unavailable from a Control drag of a card while d3 cancels the next click, and delivers the first available click once', async () => {
    const definition = withOther();
    const { view: rendered } = await selectedConnection(definition);
    const button = remove();
    const card = rendered.container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="other"]',
    )!;
    await holdControl();
    const windowEvents = observeWindow();
    try {
      // The drag: press on the card, move past the click distance (xyflow's XYDrag on d3-drag).
      card.dispatchEvent(mouse('mousedown', 100, 500, 0, 1, CONTROL));
      // A listener added after the press runs after d3-drag's, which stops the release.
      const late: Event[] = [];
      const lateListener = (event: Event) => late.push(event);
      window.addEventListener('mouseup', lateListener, { capture: true });
      await microtasks();
      // XYDrag starts the drag on the move past the click distance and moves the card from the next.
      card.dispatchEvent(mouse('mousemove', 120, 510, 0, 1, CONTROL));
      card.dispatchEvent(mouse('mousemove', 160, 540, 0, 1, CONTROL));
      await microtasks();
      const duringDrag = {
        ariaDisabled: button.getAttribute('aria-disabled'),
        gesture: button.getAttribute('data-gesture'),
        connected: button.isConnected,
      };

      // The release, and the click the browser dispatches with it on the card.
      const up = mouse('mouseup', 160, 540, 0, 0, CONTROL);
      card.dispatchEvent(up);
      const dragClick = click(card, windowEvents.readings, 160, 540);
      window.removeEventListener('mouseup', lateListener, { capture: true });
      // The capture listener added after the gate's at mount, before the press, saw the release
      // with d3-drag's per-press listeners registered and no blocker yet; the later one never ran.
      expect(windowEvents.readings.get(up)).toEqual({
        type: 'mouseup',
        cancelledAtCapture: false,
        d3: expect.arrayContaining(['mousemove.drag', 'mouseup.drag']) as string[],
        bubbled: false,
      });
      expect(windowEvents.readings.get(up)!.d3).not.toContain('click.drag');
      expect(late).toEqual([]);
      // d3-drag cancelled the drag's own click.
      expect(dragClick).toMatchObject({
        delivered: false,
        reachedTarget: false,
        cancelledAtCapture: false,
        bubbled: false,
      });
      expect(dragClick.d3).toContain('click.drag');

      // A click on Remove while d3-drag's blocker is registered: it is cancelled before it reaches
      // the button (the native failure, where Remove looked available), and Remove says so.
      await microtasks();
      const immediate = {
        ariaDisabled: button.getAttribute('aria-disabled'),
        gesture: button.getAttribute('data-gesture'),
        blocker: clickBlocker(),
        ...click(button, windowEvents.readings),
        stored: stored(),
      };
      expect({ duringDrag, immediate }).toEqual({
        duringDrag: { ariaDisabled: 'true', gesture: 'panning', connected: true },
        immediate: {
          ariaDisabled: 'true',
          gesture: 'settling',
          blocker: true,
          delivered: false,
          reachedTarget: false,
          type: 'click',
          cancelledAtCapture: false,
          d3: expect.arrayContaining(['click.drag']) as string[],
          bubbled: false,
          stored: ['e1'],
        },
      });

      // The first moment Remove is shown available, the blocker is gone and the click acts once.
      const first = await whenFirstAvailable(button, () => ({
        blocker: clickBlocker(),
        ...click(button, windowEvents.readings),
      }));
      expect(first).toMatchObject({ blocker: false, delivered: true, reachedTarget: true });
      expect(stored()).toEqual([]);
      // Two edits, two steps: the move, then the removal. Undo takes back each exactly.
      expect(store().past.map((step) => step.label)).toEqual([
        'move other',
        'remove edge start to done',
      ]);
      const moved = store().definition!.nodes.find((node) => node.id === 'other')!.ui;
      expect(moved).not.toEqual({ x: 0, y: 360 });
      store().undo();
      expect(store().definition).toEqual({
        ...definition,
        nodes: definition.nodes.map((node) =>
          node.id === 'other' ? { ...node, ui: moved } : node,
        ),
      });
      store().undo();
      expect(store().definition).toEqual(withOther());
    } finally {
      windowEvents.stop();
      releaseControl();
    }
  });

  it('gates a card drag exactly when xyflow starts it, which is exactly when d3-drag blocks the click after it', async () => {
    const { view: rendered } = await selectedConnection(withOther());
    const button = remove();
    const card = rendered.container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="other"]',
    )!;
    await holdControl();
    try {
      /** Press, move by (dx, dy) and release on the card; what the gate and d3 did. */
      const press = async (dx: number, dy: number) => {
        card.dispatchEvent(mouse('mousedown', 100, 500, 0, 1, CONTROL));
        card.dispatchEvent(mouse('mousemove', 100 + dx, 500 + dy, 0, 1, CONTROL));
        await microtasks();
        const moving = button.getAttribute('data-gesture');
        card.dispatchEvent(mouse('mouseup', 100 + dx, 500 + dy, 0, 0, CONTROL));
        await microtasks();
        const released = {
          moving,
          gesture: button.getAttribute('data-gesture'),
          blocker: clickBlocker(),
        };
        // Past the blocker's zero-delay cleanup and the gate's two tasks.
        await queuedTask(() => undefined);
        await queuedTask(() => undefined);
        await microtasks();
        return released;
      };
      // Exactly the click distance (3 px) is still a click: xyflow starts no drag and d3-drag adds
      // no blocker, so the gate stays ready.
      expect(await press(3, 0)).toEqual({ moving: null, gesture: null, blocker: false });
      expect(store().past).toEqual([]);
      // Just past it (√10 px): xyflow starts the drag on that move and d3-drag blocks the click.
      expect(await press(3, 1)).toEqual({
        moving: 'panning',
        gesture: 'settling',
        blocker: true,
      });
      // Both settle: the blocker's cleanup and then the gate's second task have run.
      expect(clickBlocker()).toBe(false);
      expect(button).not.toHaveAttribute('aria-disabled');
    } finally {
      releaseControl();
    }
  });
});
