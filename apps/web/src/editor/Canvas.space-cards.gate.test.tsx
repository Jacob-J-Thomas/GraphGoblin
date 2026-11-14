/**
 * The Space cards offer on the pan gate and the installed dependencies (#207, #208): the real
 * Canvas on @xyflow/react, d3-zoom and d3-drag in jsdom, on real timers, as in
 * `viewport-gesture.contract.test.tsx`, whose fixture this repeats in brief. No dependency, window
 * listener or timer is replaced. The fixture supplies only the layout jsdom lacks (card and pane
 * sizes, and a ResizeObserver that reports them).
 *
 * It shows that the offer's two buttons follow the same gate as the selected connection's Remove
 * button: d3 cancels the click that follows a mouse pan before it reaches any of them, all three say
 * so, and the first press after they show as available acts once. jsdom has no hit-testing and no
 * layout: where a native press lands, target sizes and doubleclicks stay native checks.
 */
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

function Live() {
  const definition = useEditorStore((s) => s.definition)!;
  return (
    <ReactFlowProvider>
      <Canvas definition={definition} issues={[]} />
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
