/**
 * The Space cards offer on the pan gate and the installed dependencies (#207, #208): the real
 * Canvas on @xyflow/react, d3-zoom and d3-drag in jsdom, on real timers, as in
 * `viewport-gesture.contract.test.tsx`, whose fixture this repeats in brief. No dependency, window
 * listener or timer is replaced. The fixture supplies only the layout jsdom lacks (card and pane
 * sizes, and a ResizeObserver that reports them).
 *
 * It shows that the offer's two buttons follow the same gate as the selected connection's Remove
 * button: d3 cancels the click that follows a mouse pan before it reaches any of them, all three say
 * so, and the first press after they show as available acts once. It also shows what xyflow and d3
 * do, and do not do, with the presses that follow a Space cards click once its result has replaced
 * the offer (#208): presses on the result reach neither, while the first press elsewhere ends the
 * result and acts exactly as it would have without it. jsdom has no hit-testing and no layout:
 * which element a native press lands on, target sizes, the browser's own click counting and touch
 * stay native checks, and here each press is dispatched at the element a browser would hit.
 */
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
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

/** The page's window as an event's `view`, and the one d3 keeps its bookkeeping on (see the contract test). */
const view = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;

/** d3-selection's record of the listeners d3 registered on the window, read and never changed. */
const clickBlocker = () =>
  ((view as unknown as { __on?: { type: string; name: string }[] }).__on ?? []).some(
    (listener) => listener.type === 'click' && listener.name === 'drag',
  );

function mouse(type: string, x: number, y: number, button = 0, buttons = 0) {
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

/** A click on `target` now: whether d3 left it uncancelled, and whether it reached its target. */
function click(target: Element) {
  const event = mouse('click', 0, 0);
  let reachedTarget = false;
  const arrive = () => {
    reachedTarget = true;
  };
  target.addEventListener('click', arrive, { passive: true });
  const delivered = target.dispatchEvent(event);
  target.removeEventListener('click', arrive);
  return { delivered, reachedTarget };
}

/** Resolves at the first moment `button` is shown available, running `act` right then. */
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

let flow: ReactFlowInstance | undefined;
let flowStore: ReturnType<typeof useStoreApi> | undefined;

/** Reads xyflow's instance and store, which the Canvas leaves to the provider. */
function Observe() {
  flow = useReactFlow();
  flowStore = useStoreApi();
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
const space = () => screen.getByRole('button', { name: 'Space cards' });
const dismiss = () => screen.getByRole('button', { name: 'Dismiss suggestion' });
const remove = () => screen.getByRole('button', { name: 'Remove connection' });
const canvas = () => screen.getByTestId('canvas');
const announced = () => canvas().querySelector('[aria-live="polite"]')!.textContent;

/** Two cards at the origin joined by one connection with no route: the smallest pile. */
function pile(): LoopDefinitionInput {
  const base = newLoopDefinition('Pile');
  return { ...base, nodes: base.nodes.map((node) => ({ ...node, ui: { x: 0, y: 0 } })) };
}

/** The pile on the canvas with its connection `e1` selected, so its toolbar shows beside the offer. */
async function openedPile() {
  store().load('L1', pile());
  const rendered = render(<Live />);
  const wrapper = await waitFor(() => {
    const found = rendered.container.querySelector<SVGGElement>('.react-flow__edge[data-id="e1"]');
    expect(found).not.toBeNull();
    return found!;
  });
  fireEvent.click(wrapper);
  await waitFor(() => expect(remove()).toBeInTheDocument());
  await waitFor(() => expect(space()).toBeInTheDocument());
  const pane = rendered.container.querySelector<HTMLElement>('.react-flow__pane')!;
  return { rendered, pane };
}

/** The same attributes on the offer's buttons and on the toolbar's Remove: one gate, one state. */
function expectOneGate(gesture: 'panning' | 'settling' | undefined) {
  for (const button of [space(), dismiss(), remove()]) {
    if (gesture) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAttribute('data-gesture', gesture);
    } else {
      expect(button).not.toHaveAttribute('aria-disabled');
      expect(button).not.toHaveAttribute('data-gesture');
    }
    expect(button).toBeEnabled();
  }
}

/**
 * A mouse pan of the pane, its release and the click that follows it: through the release, d3's
 * `click.drag` blocker is registered and cancels that click, which never reaches the pane's target.
 */
async function panAndRelease(pane: HTMLElement) {
  pane.dispatchEvent(mouse('mousedown', 600, 400, 0, 1));
  await microtasks();
  pane.dispatchEvent(mouse('mousemove', 710, 400, 0, 1));
  await microtasks();
  expectOneGate('panning');
  pane.dispatchEvent(mouse('mouseup', 710, 400, 0, 0));
  const panClick = click(pane);
  await microtasks();
  return panClick;
}

describe('the Space cards offer on the pan gate and the installed d3 (#207, #208)', () => {
  it('shares the gate with Remove: Space cards is refused in every window, and the first available press acts once', async () => {
    const { pane } = await openedPile();
    const original = store().definition!;
    const state = store();
    expectOneGate(undefined);
    const buttons = [space(), dismiss(), remove()];

    const panClick = await panAndRelease(pane);
    // Panned and released: the controls are the same elements, still attached and focusable.
    expect([space(), dismiss(), remove()]).toEqual(buttons);
    for (const button of buttons) {
      expect(button.isConnected).toBe(true);
      button.focus();
      expect(button).toHaveFocus();
    }
    space().focus();
    expect(panClick).toEqual({ delivered: false, reachedTarget: false });
    expectOneGate('settling');

    // While d3's blocker is registered it cancels the press before it reaches Space cards.
    const immediate = { blocker: clickBlocker(), ...click(space()) };
    expect(immediate).toEqual({ blocker: true, delivered: false, reachedTarget: false });
    expect(store()).toBe(state);

    // After d3's cleanup the press arrives while the gate still settles, and the offer refuses it.
    const afterCleanup = await queuedTask(() => ({
      blocker: clickBlocker(),
      gesture: space().getAttribute('data-gesture'),
      ...click(space()),
    }));
    expect(afterCleanup).toEqual({
      blocker: false,
      gesture: 'settling',
      delivered: true,
      reachedTarget: true,
    });
    expect(store()).toBe(state);
    expect(space()).toHaveFocus();
    expect(announced()).toBe('');

    // The first moment it is shown available, d3's blocker is gone and the press acts once.
    const first = await whenFirstAvailable(space(), () => ({
      blocker: clickBlocker(),
      gestures: [dismiss(), remove()].map((button) => button.hasAttribute('aria-disabled')),
      ...click(space()),
    }));
    expect(first).toEqual({
      blocker: false,
      gestures: [false, false],
      delivered: true,
      reachedTarget: true,
    });
    expect(store().past.map((step) => step.label)).toEqual(['space cards']);
    expect(store().revision).toBe(state.revision + 1);
    expect(store().definition!.nodes[0]).toEqual(original.nodes[0]);
    expect(store().definition!.edges).toBe(original.edges);
    await waitFor(() => expect(canvas()).toHaveFocus());
    expect(announced()).toBe('Spaced 2 cards. Undo puts them back.');
    expect(screen.queryByRole('button', { name: 'Space cards' })).toBeNull();
    store().undo();
    expect(store().definition).toBe(original);
  });

  it('refuses Dismiss suggestion the same way, and dismissing changes no draft', async () => {
    const { pane } = await openedPile();
    const state = store();
    const changes = vi.fn();
    const unsubscribe = useEditorStore.subscribe(changes);
    try {
      await panAndRelease(pane);
      const immediate = { blocker: clickBlocker(), ...click(dismiss()) };
      expect(immediate).toEqual({ blocker: true, delivered: false, reachedTarget: false });
      const afterCleanup = await queuedTask(() => ({
        blocker: clickBlocker(),
        gesture: dismiss().getAttribute('data-gesture'),
        ...click(dismiss()),
      }));
      expect(afterCleanup).toEqual({
        blocker: false,
        gesture: 'settling',
        delivered: true,
        reachedTarget: true,
      });
      // Refused: the offer is still there, and nothing was announced or focused.
      expect(screen.getByRole('region', { name: '2 cards are stacked in one spot' })).toBeVisible();
      expect(announced()).toBe('');

      const first = await whenFirstAvailable(dismiss(), () => ({
        blocker: clickBlocker(),
        ...click(dismiss()),
      }));
      expect(first).toEqual({ blocker: false, delivered: true, reachedTarget: true });
      await waitFor(() => expect(canvas()).toHaveFocus());
      expect(announced()).toBe('Suggestion dismissed.');
      expect(screen.queryByRole('button', { name: 'Space cards' })).toBeNull();
    } finally {
      unsubscribe();
    }
    // No edit, no save and no history step: the store was never written.
    expect(changes).not.toHaveBeenCalled();
    expect(store()).toBe(state);
    // The connection's own toolbar, on the same gate, is ready again too.
    expect(remove()).not.toHaveAttribute('aria-disabled');
  });

  it('lets a new pan invalidate an earlier release, and starts ready again after the canvas unmounts mid-settle', async () => {
    const { rendered, pane } = await openedPile();
    pane.dispatchEvent(mouse('mousedown', 600, 400, 0, 1));
    pane.dispatchEvent(mouse('mousemove', 700, 400, 0, 1));
    pane.dispatchEvent(mouse('mouseup', 700, 400, 0, 0));
    // A second pan presses and moves before the first release's barrier ran.
    pane.dispatchEvent(mouse('mousedown', 700, 400, 0, 1));
    pane.dispatchEvent(mouse('mousemove', 760, 420, 0, 1));
    await microtasks();
    await queuedTask(() => undefined);
    await queuedTask(() => undefined);
    await microtasks();
    // Both of the first release's tasks have run: the second pan keeps the offer unavailable.
    expectOneGate('panning');
    const state = store();
    fireEvent.click(space());
    expect(store()).toBe(state);
    // The second pan's release settles it.
    pane.dispatchEvent(mouse('mouseup', 760, 420, 0, 0));
    await whenFirstAvailable(space(), () => undefined);
    expectOneGate(undefined);

    // A release that settles after the canvas is gone leaves nothing behind.
    pane.dispatchEvent(mouse('mousedown', 600, 400, 0, 1));
    pane.dispatchEvent(mouse('mousemove', 700, 400, 0, 1));
    pane.dispatchEvent(mouse('mouseup', 700, 400, 0, 0));
    rendered.unmount();
    await queuedTask(() => undefined);
    await queuedTask(() => undefined);
    expect(screen.queryByRole('button', { name: 'Space cards' })).toBeNull();
    expect(store()).toBe(state);
    // A new canvas has a gate of its own, ready.
    await openedPile();
    expectOneGate(undefined);
  });
});

/** d3's window listeners now, as d3-selection records them (read only). */
const d3Listeners = () =>
  ((view as unknown as { __on?: { type: string; name: string }[] }).__on ?? []).map(
    (listener) => `${listener.type}.${listener.name}`,
  );

const PRIMARY = {
  bubbles: true,
  cancelable: true,
  composed: true,
  view,
  clientX: 93,
  clientY: 290,
  button: 0,
};

/** The pointerdown a browser sends before the mousedown of a press, for a press done by hand. */
const pointerDown = (target: Element) =>
  target.dispatchEvent(
    new PointerEvent('pointerdown', { ...PRIMARY, buttons: 1, pointerType: 'mouse', pointerId: 1 }),
  );

/**
 * One press of the primary mouse button as a browser delivers it to `target`, the `count`th of a
 * run: pointerdown and pointerup (no click count yet), then mousedown, mouseup and click carrying
 * it, and a dblclick after the second.
 */
async function press(target: Element, count: number, shiftKey = false) {
  const base = { ...PRIMARY, shiftKey };
  const pointer = (type: string, buttons: number) =>
    new PointerEvent(type, {
      ...base,
      buttons,
      pointerType: 'mouse',
      isPrimary: true,
      pointerId: 1,
    });
  const mouseEvent = (type: string, buttons: number) =>
    new MouseEvent(type, { ...base, buttons, detail: count });
  for (const event of [
    pointer('pointerdown', 1),
    mouseEvent('mousedown', 1),
    pointer('pointerup', 0),
    mouseEvent('mouseup', 0),
    mouseEvent('click', 0),
    ...(count === 2 ? [mouseEvent('dblclick', 0)] : []),
  ]) {
    target.dispatchEvent(event);
    // As in a browser, microtasks run between one event's listeners and the next event.
    await microtasks();
  }
}

/** A few tasks and microtasks: React commits, d3's cleanup and the fit have all had their turn. */
async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await queuedTask(() => undefined);
    await microtasks();
  }
}

describe('presses after a Space cards click, on the installed xyflow and d3 (#208)', () => {
  const result = () => screen.queryByTestId('space-cards-result');
  const zoomOut = () => document.querySelector<HTMLElement>('.react-flow__controls-zoomout')!;
  let boxSpy: MockInstance<Element['getBoundingClientRect']>;

  beforeEach(() => {
    // jsdom has no layout: the offer's box is the one a browser measured at 512 px.
    const measured = Element.prototype.getBoundingClientRect;
    boxSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this.getAttribute('data-testid') === 'space-cards-offer'
        ? DOMRect.fromRect({ width: 392, height: 129.5 })
        : measured.call(this);
    });
  });
  afterEach(async () => {
    // A test that failed mid-gesture must not leave d3's window listeners, or its click blocker,
    // to swallow the next test's press: release, then let the blocker's own task run.
    view.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view }));
    await queuedTask(() => undefined);
    fireEvent.keyUp(document.body, { key: 'Shift', code: 'ShiftLeft' });
    boxSpy.mockRestore();
  });

  /** The pile with its connection and one card selected, and Shift held when asked. */
  async function selectedPile(shift: boolean) {
    const opened = await openedPile();
    const nodeId = store().definition!.nodes[0]!.id;
    store().select(nodeId);
    if (shift)
      fireEvent.keyDown(document.body, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    await settle();
    expect(store().selectedNodeId).toBe(nodeId);
    expect(remove()).toBeInTheDocument();
    return { ...opened, nodeId };
  }

  /** Press 1: Space cards. Waits for the offer to go and the one fit to land. */
  async function spaced(shift: boolean) {
    await press(space(), 1, shift);
    await waitFor(() => expect(screen.queryByTestId('space-cards-offer')).toBeNull());
    await settle();
  }

  /**
   * Where the next press of the run lands, as a browser would hit it at the box's point: on the
   * result while there is one, else on what the offer covered (`covered`: at 512 px, Zoom Out, as
   * the native run found). jsdom has no hit-testing, so the premise is stated here; xyflow and d3
   * then do whatever they really do with it. Without the result this reproduces the double hit.
   */
  const landing = (covered: Element) => result() ?? covered;

  it('holds the second and third presses of a run on the result, Shift held: neither xyflow nor d3 sees them', async () => {
    const { nodeId } = await selectedPile(true);
    const before = { revision: store().revision, d3: d3Listeners() };
    await spaced(true);
    const fitted = flow!.getViewport();

    // Press 2 (and its dblclick) on what it lands on, press 3 on that element's first child.
    await press(landing(zoomOut()), 2, true);
    await press(landing(zoomOut()).firstElementChild!, 3, true);
    await settle();

    // The view is still the one fit, and both selections are kept.
    expect(flow!.getViewport()).toEqual(fitted);
    expect(store().selectedNodeId).toBe(nodeId);
    expect(remove()).toBeInTheDocument();
    // No selection box, drag or pan began, and nothing was opened.
    expect(flowStore!.getState()).toMatchObject({
      userSelectionActive: false,
      userSelectionRect: null,
      nodesSelectionActive: false,
    });
    expect(d3Listeners()).toEqual(before.d3);
    expect(screen.queryByRole('dialog')).toBeNull();
    // The result is still there, and the one step, announcement and focus are as press 1 left them.
    expect(result()).not.toBeNull();
    expect(store().past.map((step) => step.label)).toEqual(['space cards']);
    expect(store().revision).toBe(before.revision + 1);
    expect(announced()).toBe('Spaced 2 cards. Undo puts them back.');
    expect(canvas()).toHaveFocus();
  });

  it.each([false, true])(
    'holds a press dragged on the result: no pan, selection box or listener begins (Shift %s)',
    async (shift) => {
      const { pane, nodeId } = await selectedPile(shift);
      const before = d3Listeners();
      await spaced(shift);
      const fitted = flow!.getViewport();
      const target = landing(pane);
      const at = (type: string, x: number, buttons: number) => ({
        pointer: new PointerEvent(type, {
          ...PRIMARY,
          clientX: x,
          buttons,
          pointerType: 'mouse',
          isPrimary: true,
          pointerId: 1,
        }),
        mouse: mouse(type.replace('pointer', 'mouse'), x, 290, 0, buttons),
      });
      for (const [type, x, buttons] of [
        ['pointerdown', 93, 1],
        ['pointermove', 103, 1],
        ['pointermove', 123, 1],
      ] as const) {
        const events = at(type, x, buttons);
        target.dispatchEvent(events.pointer);
        target.dispatchEvent(events.mouse);
        await microtasks();
      }
      // Mid-drag, where a pan would have started or a selection box been drawn.
      expect(flow!.getViewport()).toEqual(fitted);
      expect(remove()).not.toHaveAttribute('data-gesture');
      expect(flowStore!.getState()).toMatchObject({
        userSelectionActive: false,
        userSelectionRect: null,
      });
      expect(d3Listeners()).toEqual(before);
      const release = at('pointerup', 123, 0);
      target.dispatchEvent(release.pointer);
      target.dispatchEvent(release.mouse);
      await settle();
      expect(flow!.getViewport()).toEqual(fitted);
      expect(store().selectedNodeId).toBe(nodeId);
      expect(remove()).toBeInTheDocument();
      expect(result()).not.toBeNull();
      expect(store().past.map((step) => step.label)).toEqual(['space cards']);
    },
  );

  it.each([false, true])(
    'control: the first press on the pane ends the result and clears both selections as ever (Shift %s)',
    async (shift) => {
      const { pane } = await selectedPile(shift);
      await spaced(shift);
      await press(pane, 1, shift);
      await settle();
      expect(result()).toBeNull();
      expect(screen.queryByRole('button', { name: 'Remove connection' })).toBeNull();
      expect(store().selectedNodeId).toBeUndefined();
      expect(store().past.map((step) => step.label)).toEqual(['space cards']);
    },
  );

  it('control: a mouse pan that is the first press elsewhere ends the result and pans as ever', async () => {
    const { pane } = await selectedPile(false);
    await spaced(false);
    const fitted = flow!.getViewport();
    pointerDown(pane);
    // The pointerdown's own listener only schedules the end: React commits it in the microtask after
    // the listeners return, which is before this press's mousedown and anything it triggers.
    await microtasks();
    expect(result()).toBeNull();
    pane.dispatchEvent(mouse('mousedown', 600, 400, 0, 1));
    await microtasks();
    pane.dispatchEvent(mouse('mousemove', 710, 400, 0, 1));
    await microtasks();
    expect(remove()).toHaveAttribute('data-gesture', 'panning');
    expect(flow!.getViewport().x).toBeCloseTo(fitted.x + 110, 5);
    pane.dispatchEvent(mouse('mouseup', 710, 400, 0, 0));
    await whenFirstAvailable(remove(), () => undefined);
    expect(remove()).not.toHaveAttribute('data-gesture');
  });

  it('control: a Zoom Out press that is the first press elsewhere ends the result and zooms out once', async () => {
    await selectedPile(false);
    await spaced(false);
    const zoom = flow!.getViewport().zoom;
    await press(zoomOut(), 1);
    await settle();
    expect(result()).toBeNull();
    expect(flow!.getViewport().zoom).toBeCloseTo(zoom / 1.2, 5);
  });
});
