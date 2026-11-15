import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getViewportForBounds, type NodeChange, type ReactFlowProps } from '@xyflow/react';
import { Profiler, useLayoutEffect, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from './Canvas.js';
import { newLoopDefinition } from './model.js';
import type { FlowNode } from './NodeCard.js';
import { spacedPositions } from './space-cards.js';
import { SpaceCardsOffer, SpaceCardsResult } from './SpaceCardsOffer.js';
import { useEditorStore } from './store.js';
import type { RoutingGeometry } from './useRouting.js';
import { createViewportGestureGate } from './viewport-gesture.js';

let props: ReactFlowProps<FlowNode> | undefined;
const fitView = vi.fn(() => Promise.resolve(true));
const setViewport = vi.fn(() => Promise.resolve(true));
const geometry: RoutingGeometry = { nodes: [], preparationMs: 0, outputOrder: new Map() };

/**
 * What xyflow says about its pane and its viewport, as these tests control it: the pane size its
 * store holds (a pane starts at 0 × 0 until measured) and whether the viewport can be moved. A
 * change notifies the hooks that read it, as xyflow's store does. The Canvas's real selector runs
 * on this state, and its live read of the pane size sees the same state.
 */
const FLOW_READY = { width: 1200, height: 800, viewportInitialized: true };
const flow$ = (() => {
  const listeners = new Set<() => void>();
  let state = { ...FLOW_READY };
  return {
    state: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (next: Partial<typeof FLOW_READY>) => {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    reset: () => {
      state = { ...FLOW_READY };
    },
  };
})();
const flowStoreStub = { getState: () => flow$.state() };

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ReactFlow: (p: ReactFlowProps<FlowNode>) => {
      props = p;
      return <div data-testid="flow" />;
    },
    useReactFlow: () => ({
      screenToFlowPosition: (p: { x: number; y: number }) => p,
      fitView,
      setViewport,
      viewportInitialized: useSyncExternalStore(
        flow$.subscribe,
        () => flow$.state().viewportInitialized,
      ),
    }),
    useStoreApi: () => flowStoreStub,
    useStore: (
      selector?: ((state: ReturnType<typeof flow$.state>) => unknown) & { name?: string },
    ) => {
      // The Canvas's own selector of the pane runs on the state above; its other hooks read the
      // routing geometry or the zoom, as before. Every call subscribes, so hooks run in order.
      const pane = useSyncExternalStore(flow$.subscribe, () =>
        selector?.name === 'paneMeasured' ? selector(flow$.state()) : undefined,
      );
      return selector?.name === 'zoomOf' ? 1 : selector?.name === 'paneMeasured' ? pane : geometry;
    },
  };
});

const store = () => useEditorStore.getState();
const flow = () => props as ReactFlowProps<FlowNode>;
const CARDS = kitchenSinkLoop().nodes.length;
const OFFER = `${CARDS} cards are stacked in one spot`;
const offer = () => screen.queryByRole('region', { name: OFFER });
const spaceButton = () => screen.getByRole('button', { name: 'Space cards' });
const canvas = () => screen.getByTestId('canvas');
const announced = () => canvas().querySelector('[aria-live="polite"]')!.textContent;
const labels = () => store().past.map((step) => step.label);
const positions = () => store().definition!.nodes.map((node) => node.ui ?? { x: 0, y: 0 });
const result = () => screen.queryByTestId('space-cards-result');
const dismissButton = () => screen.getByRole('button', { name: 'Dismiss suggestion' });

/** The box a browser measured for the offer at 512 px (#208): jsdom has no layout of its own. */
const OFFER_BOX = { width: 392, height: 129.5 };
function stubOfferBox() {
  const measured = Element.prototype.getBoundingClientRect;
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    return this.getAttribute('data-testid') === 'space-cards-offer'
      ? DOMRect.fromRect(OFFER_BOX)
      : measured.call(this);
  });
}
const FIT_PADDING = { top: '8%', right: '8%', bottom: '8%', left: '72px' } as const;

/** xyflow's measurement of every card in the current draft: `heights` by id, else 100. */
const measure = (heights: Record<string, number> = {}) =>
  act(() =>
    flow().onNodesChange!(
      store().definition!.nodes.map((node): NodeChange<FlowNode> => ({
        type: 'dimensions',
        id: node.id,
        dimensions: { width: 184, height: heights[node.id] ?? 100 },
      })),
    ),
  );

/** xyflow's measurement of the cards named, at the sizes given, and of no other. */
const measureCards = (sizes: Record<string, { width: number; height: number }>) =>
  act(() =>
    flow().onNodesChange!(
      Object.entries(sizes).map(([id, dimensions]): NodeChange<FlowNode> => ({
        type: 'dimensions',
        id,
        dimensions,
      })),
    ),
  );

/**
 * The view the draft is owed, worked from where its cards are now and the sizes `measure` gave
 * them, never from the Canvas's own bounds: the opening fit's padding, its 50 % floor and the
 * canvas's own 200 % ceiling, in a pane of the size given (1200 × 800 unless said).
 */
function owedView(
  heights: Record<string, number> = {},
  pane: { width: number; height: number } = FLOW_READY,
) {
  const cards = store().definition!.nodes.map((node) => {
    const { x, y } = node.ui ?? { x: 0, y: 0 };
    // By own id, as the canvas does: a card called `constructor` has no entry of `heights`.
    const height = Object.hasOwn(heights, node.id) ? heights[node.id]! : 100;
    return { left: x, top: y, right: x + 184, bottom: y + height };
  });
  const left = Math.min(...cards.map((card) => card.left));
  const top = Math.min(...cards.map((card) => card.top));
  return getViewportForBounds(
    {
      x: left,
      y: top,
      width: Math.max(...cards.map((card) => card.right)) - left,
      height: Math.max(...cards.map((card) => card.bottom)) - top,
    },
    pane.width,
    pane.height,
    0.5,
    2,
    FIT_PADDING,
  );
}

/** The canvas as the editor page renders it: on the store's current draft. */
function Live() {
  const definition = useEditorStore((s) => s.definition)!;
  return <Canvas definition={definition} issues={[]} />;
}

describe('Space cards on the canvas (#208)', () => {
  beforeEach(() => {
    fitView.mockClear();
    setViewport.mockClear();
    flow$.reset();
    store().load('L1', kitchenSinkLoop());
  });

  it('floats the offer over a pile, named and described, ahead of the cards in the Tab order', () => {
    render(<Live />);
    const region = screen.getByRole('region', { name: OFFER });
    const space = within(region).getByRole('button', { name: 'Space cards' });
    expect(space).toHaveAccessibleDescription(
      'Space cards puts them in columns that follow the connections. Only card positions change; Undo puts them back.',
    );
    const dismiss = within(region).getByRole('button', { name: 'Dismiss suggestion' });
    // DOM order is focus order: the action, then Dismiss, then the flow and its cards.
    expect(space.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      dismiss.compareDocumentPosition(screen.getByTestId('flow')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Placed over the canvas rather than in the page flow, and shielded from the canvas keys.
    expect(canvas()).toHaveClass('relative');
    expect(region.parentElement).toHaveClass('nokey', 'absolute');
  });

  it('hides the offer while a card is dragged and for a draft that is not a pile, and offers it again on undo', () => {
    render(<Live />);
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'prep', position: { x: 50, y: 60 }, dragging: true },
      ]),
    );
    expect(offer()).toBeNull();
    act(() =>
      flow().onNodesChange!([
        { type: 'position', id: 'prep', position: { x: 50, y: 60 }, dragging: false },
      ]),
    );
    expect(labels()).toEqual(['move prep']);
    expect(offer()).toBeNull();
    act(() => store().undo());
    expect(offer()).not.toBeNull();
    act(() => store().setEdgeRoute('e1', [240, 360, 420]));
    expect(offer()).toBeNull();
  });

  it('spaces with measured heights in one step, focuses the canvas, announces Undo, and fits once', async () => {
    const user = userEvent.setup();
    render(<Live />);
    const original = store().definition!;
    measure({ prep: 400 });
    await user.click(spaceButton());
    expect(labels()).toEqual(['space cards']);
    expect(positions()).toEqual(
      spacedPositions(
        original,
        original.nodes.map((node) => (node.id === 'prep' ? 400 : 100)),
      ),
    );
    expect(canvas()).toHaveFocus();
    expect(announced()).toBe(`Spaced ${CARDS} cards. Undo puts them back.`);
    expect(offer()).toBeNull();
    // One view, set at once from the spaced cards' own bounds. xyflow's queued `fitView` is not used.
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport).toHaveBeenCalledWith(owedView({ prep: 400 }));
    expect(fitView).not.toHaveBeenCalled();
    // Undo, redo, an ordinary edit and later measurements never fit the view again.
    act(() => store().undo());
    act(() => store().redo());
    act(() => store().moveNode('prep', { x: 1, y: 1 }));
    measure({ prep: 410 });
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(fitView).not.toHaveBeenCalled();
  });

  it('sets the view as the press is handled, with nothing waiting behind a promise, a timer or a frame', () => {
    render(<Live />);
    measure({ prep: 400 });
    fireEvent.click(spaceButton(), { detail: 1 });
    // `fireEvent` returns once React has handled the press and run its effects, and no `await`
    // came between: a fit behind a promise, timer or frame would not have set the view by now.
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport).toHaveBeenCalledWith(owedView({ prep: 400 }));
    expect(fitView).not.toHaveBeenCalled();
  });

  it('fits only once the spaced cards are measured, and drops the fit when an undo or a load comes first', async () => {
    const user = userEvent.setup();
    let view = render(<Live />);
    await user.click(spaceButton());
    expect(setViewport).not.toHaveBeenCalled();
    measure();
    expect(setViewport).toHaveBeenCalledTimes(1);

    for (const first of [() => store().undo(), () => store().load('L1', kitchenSinkLoop())]) {
      // A new canvas, with nothing measured yet.
      act(() => store().load('L1', kitchenSinkLoop()));
      view.unmount();
      view = render(<Live />);
      setViewport.mockClear();
      await user.click(spaceButton());
      act(first);
      measure();
      expect(setViewport).not.toHaveBeenCalled();
    }
    expect(fitView).not.toHaveBeenCalled();
  });

  it('keeps waiting for every card to have a size that is positive and finite, and fits when the last one does', async () => {
    const user = userEvent.setup();
    const none = { width: 0, height: 0 };
    for (const bad of [
      none,
      { width: 184, height: 0 },
      { width: 0, height: 100 },
      { width: -184, height: 100 },
      { width: 184, height: Number.NaN },
      { width: Number.POSITIVE_INFINITY, height: 100 },
    ]) {
      act(() => store().load('L1', kitchenSinkLoop()));
      setViewport.mockClear();
      const view = render(<Live />);
      await user.click(spaceButton());
      // Every card but `prep` has its size, and `prep` has none yet or has not got a usable one.
      measureCards(
        Object.fromEntries(
          store()
            .definition!.nodes.filter((node) => node.id !== 'prep')
            .map((node) => [node.id, { width: 184, height: 100 }]),
        ),
      );
      expect(setViewport).not.toHaveBeenCalled();
      measureCards({ prep: bad });
      expect(setViewport).not.toHaveBeenCalled();
      measureCards({ prep: { width: 184, height: 400 } });
      expect(setViewport).toHaveBeenCalledTimes(1);
      expect(setViewport).toHaveBeenCalledWith(owedView({ prep: 400 }));
      view.unmount();
    }
  });

  it('looks a card’s size up by its own id: a card called `constructor` is not measured by the object’s prototype', async () => {
    const user = userEvent.setup();
    const base = newLoopDefinition('Pile');
    const named = (id: string) => (id === 'start' ? 'constructor' : id);
    act(() =>
      store().load('L1', {
        ...base,
        nodes: base.nodes.map((node) => ({ ...node, id: named(node.id), ui: { x: 0, y: 0 } })),
        edges: base.edges.map((edge) => ({
          ...edge,
          from: { ...edge.from, node: named(edge.from.node) },
          to: { ...edge.to, node: named(edge.to.node) },
        })),
      }),
    );
    render(<Live />);
    await user.click(spaceButton());
    expect(store().past.map((step) => step.label)).toEqual(['space cards']);
    measureCards({ done: { width: 184, height: 100 } });
    expect(setViewport).not.toHaveBeenCalled();
    measureCards({ constructor: { width: 184, height: 100 } });
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport).toHaveBeenCalledWith(owedView());
  });

  it.each([
    ['no width', { width: 0 }],
    ['no height', { height: 0 }],
    ['no size at all', { width: 0, height: 0 }],
    ['a negative width', { width: -1 }],
    ['a width that is not a number', { width: Number.NaN }],
    ['an infinite height', { height: Number.POSITIVE_INFINITY }],
  ])(
    'waits while xyflow’s pane has %s, and fits once, at that size, when it is measured',
    async (_, unmeasured) => {
      const user = userEvent.setup();
      flow$.set(unmeasured);
      render(<Live />);
      measure({ prep: 400 });
      await user.click(spaceButton());
      expect(labels()).toEqual(['space cards']);
      // Kept, not dropped and not spent: nothing is set, and a later measurement of a card changes
      // nothing either while the pane has no size.
      expect(setViewport).not.toHaveBeenCalled();
      measure({ prep: 400 });
      expect(setViewport).not.toHaveBeenCalled();

      act(() => flow$.set({ width: 900, height: 600 }));
      expect(setViewport).toHaveBeenCalledTimes(1);
      expect(setViewport).toHaveBeenCalledWith(
        owedView({ prep: 400 }, { width: 900, height: 600 }),
      );
      // Spent: the pane changing again, or a card measured again, fits nothing more.
      act(() => flow$.set({ width: 1200, height: 800 }));
      measure({ prep: 410 });
      expect(setViewport).toHaveBeenCalledTimes(1);
      expect(fitView).not.toHaveBeenCalled();
    },
  );

  it('waits while xyflow has no viewport to move, and fits once when it has', async () => {
    const user = userEvent.setup();
    flow$.set({ viewportInitialized: false });
    render(<Live />);
    measure({ prep: 400 });
    await user.click(spaceButton());
    expect(setViewport).not.toHaveBeenCalled();
    measure({ prep: 400 });
    expect(setViewport).not.toHaveBeenCalled();

    act(() => flow$.set({ viewportInitialized: true }));
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport).toHaveBeenCalledWith(owedView({ prep: 400 }));
  });

  it('keeps waiting through each readiness change, and an edit while it waits drops the fit for good', async () => {
    const user = userEvent.setup();
    flow$.set({ width: 0, height: 0, viewportInitialized: false });
    render(<Live />);
    await user.click(spaceButton());
    measure({ prep: 400 });
    expect(setViewport).not.toHaveBeenCalled();
    act(() => flow$.set({ viewportInitialized: true }));
    expect(setViewport).not.toHaveBeenCalled();
    // An ordinary edit while it waits: the fit is gone for good, whatever arrives after.
    act(() => store().moveNode('prep', { x: 5, y: 5 }));
    act(() => flow$.set({ width: 1200, height: 800 }));
    measure({ prep: 400 });
    act(() => store().undo());
    measure({ prep: 400 });
    expect(setViewport).not.toHaveBeenCalled();
  });

  it('drops a fit that waits when an Undo and a Redo bring the same draft back, because it is a newer revision', async () => {
    const user = userEvent.setup();
    render(<Live />);
    await user.click(spaceButton());
    const spaced = store().definition!;
    const revision = store().revision;
    // Both in one update: the canvas renders the very draft it was given before, in the same load.
    act(() => {
      store().undo();
      store().redo();
    });
    expect(store().definition).toBe(spaced);
    expect(store().revision).toBe(revision + 2);
    measure({ prep: 400 });
    expect(setViewport).not.toHaveBeenCalled();
    // And the same with the draft measured first, the pane the last thing to arrive.
    act(() => store().load('L1', kitchenSinkLoop()));
    act(() => flow$.set({ width: 0 }));
    measure({ prep: 400 });
    await user.click(spaceButton());
    const again = store().definition!;
    act(() => {
      store().undo();
      store().redo();
    });
    expect(store().definition).toBe(again);
    act(() => flow$.set({ width: 1200 }));
    expect(setViewport).not.toHaveBeenCalled();
    expect(fitView).not.toHaveBeenCalled();
  });

  it('drops a fit when the store has moved past the draft this canvas still renders, and fits nothing when it catches up', async () => {
    const user = userEvent.setup();
    // A canvas whose rendering lags the store: it holds the draft it was told last, until released.
    let held: LoopDefinitionInput | undefined;
    const Lagging = () => {
      const definition = useEditorStore((s) => s.definition)!;
      return <Canvas definition={held ?? definition} issues={[]} />;
    };
    const view = render(<Lagging />);
    await user.click(spaceButton());
    held = store().definition!;
    // The store goes back to the pile while the canvas still renders the spaced draft it asked for.
    act(() => store().undo());
    expect(setViewport).not.toHaveBeenCalled();
    // Every card of that rendered draft is measured and the pane is ready: all but the store's word.
    measure();
    expect(setViewport).not.toHaveBeenCalled();
    held = undefined;
    view.rerender(<Lagging />);
    measure();
    expect(setViewport).not.toHaveBeenCalled();
    expect(fitView).not.toHaveBeenCalled();
  });

  it('drops a fit when input reaches the store after the render that would fit it and before the effect that does, even a load that repeats its revision', async () => {
    const user = userEvent.setup();
    // A load of another draft from a layout effect: after the press's render commits, before its
    // passive effects (the fit's) run. The load is dirty, so its revision is 1, the very revision
    // Space cards gave the draft it spaced: only the load's own number and draft tell them apart.
    let intrusion: (() => void) | undefined;
    const Intruder = () => {
      const definition = useEditorStore((s) => s.definition);
      useLayoutEffect(() => {
        const run = intrusion;
        intrusion = undefined;
        run?.();
      }, [definition]);
      return null;
    };
    render(
      <>
        <Live />
        <Intruder />
      </>,
    );
    measure();
    intrusion = () => store().load('L2', kitchenSinkLoop(), { dirty: true });
    await user.click(spaceButton());
    expect(store()).toMatchObject({ loopId: 'L2', revision: 1 });
    expect(intrusion).toBeUndefined();
    // Every card was measured and the pane ready: nothing but the store's own word stopped it.
    expect(setViewport).not.toHaveBeenCalled();
    expect(fitView).not.toHaveBeenCalled();
    // The load's own pile is offered, and its own press fits once.
    await user.click(spaceButton());
    expect(setViewport).toHaveBeenCalledTimes(1);
  });

  it('drops a fit when the canvas still renders an older draft than the one the store spaced, and fits nothing of the draft it renders', async () => {
    const user = userEvent.setup();
    // A canvas that lags the other way: it renders the pile it was given, while the store moves on.
    const pileDraft = store().definition!;
    const Behind = () => {
      useEditorStore((s) => s.definition);
      return <Canvas definition={pileDraft} issues={[]} />;
    };
    render(<Behind />);
    await user.click(spaceButton());
    expect(store().definition).not.toBe(pileDraft);
    expect(labels()).toEqual(['space cards']);
    // Every card is measured, the pane and viewport are ready, and the store still holds the spaced
    // draft it asked for: the canvas is not rendering it, so what it would fit is the pile's bounds.
    measure();
    expect(setViewport).not.toHaveBeenCalled();
    expect(fitView).not.toHaveBeenCalled();
  });

  it('drops a fit that waits when the draft is loaded again, even a draft of the same cards', async () => {
    const user = userEvent.setup();
    render(<Live />);
    await user.click(spaceButton());
    act(() => store().load('L1', kitchenSinkLoop()));
    measure();
    expect(setViewport).not.toHaveBeenCalled();
    expect(offer()).not.toBeNull();
    // The new load can still be spaced, and fits once of its own.
    await user.click(spaceButton());
    expect(setViewport).toHaveBeenCalledTimes(1);
  });

  it('leaves nothing queued when the canvas unmounts while its fit waits, however the pane and cards change after', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      flow$.set({ width: 0, height: 0 });
      const view = render(<Live />);
      await user.click(spaceButton());
      view.unmount();
      act(() => flow$.set({ width: 1200, height: 800, viewportInitialized: false }));
      act(() => flow$.set({ viewportInitialized: true }));
      expect(setViewport).not.toHaveBeenCalled();
      expect(fitView).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
      // A canvas that mounts afterwards has no fit waiting for it.
      act(() => store().undo());
      const next = render(<Live />);
      measure();
      expect(setViewport).not.toHaveBeenCalled();
      next.unmount();
    } finally {
      errors.mockRestore();
    }
  });

  it('refuses an offer the store has moved past: nothing changes, focus is on the canvas, and it says why', async () => {
    const user = userEvent.setup();
    // Rendered with the pile; the store's draft then changes without this canvas rendering again.
    render(<Canvas definition={store().definition!} issues={[]} />);
    act(() => store().moveNode('prep', { x: 5, y: 5 }));
    const state = store();
    await user.click(spaceButton());
    expect(store()).toBe(state);
    expect(canvas()).toHaveFocus();
    expect(announced()).toBe('Cards were not spaced: they are no longer all in one spot.');
    expect(setViewport).not.toHaveBeenCalled();
    expect(fitView).not.toHaveBeenCalled();
  });

  it('keeps keys on the offer from the canvas, and spaces once for a held Enter or Space', async () => {
    const user = userEvent.setup();
    render(<Live />);
    act(() => store().select('prep'));
    act(() => spaceButton().focus());
    // Delete and Backspace on its buttons never remove the selected card.
    fireEvent.keyDown(spaceButton(), { key: 'Delete' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Dismiss suggestion' }), {
      key: 'Backspace',
    });
    expect(store().definition!.nodes.some((node) => node.id === 'prep')).toBe(true);
    expect(labels()).toEqual([]);
    // Enter held down: the first press spaces and moves focus to the canvas, where the repeats
    // neither space again nor open or delete the selected card.
    await user.keyboard('{Enter>4/}');
    expect(labels()).toEqual(['space cards']);
    expect(canvas()).toHaveFocus();
    expect(store()).toMatchObject({ selectedNodeId: 'prep', nodeDialogOpen: false });
    // Space held down acts once, on release.
    act(() => store().undo());
    act(() => spaceButton().focus());
    await user.keyboard('[Space>4/]');
    expect(labels()).toEqual(['space cards']);
    expect(store().future).toEqual([]);
    expect(canvas()).toHaveFocus();
  });

  it('dismisses the offer for this editor load only', async () => {
    const user = userEvent.setup();
    const view = render(<Live />);
    await user.click(screen.getByRole('button', { name: 'Dismiss suggestion' }));
    expect(offer()).toBeNull();
    expect(canvas()).toHaveFocus();
    expect(announced()).toBe('Suggestion dismissed.');
    expect(store()).toMatchObject({ revision: 0, past: [] });
    // Edits and undo within the load keep it dismissed.
    act(() => store().moveNode('prep', { x: 1, y: 1 }));
    act(() => store().undo());
    expect(offer()).toBeNull();
    // A load (reopening, Reload server draft) offers it again, and so does a new canvas.
    act(() => store().load('L1', kitchenSinkLoop()));
    expect(offer()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss suggestion' }));
    view.unmount();
    render(<Live />);
    expect(offer()).not.toBeNull();
  });
});

describe('the result a pointer press leaves where the offer was (#208)', () => {
  const PRESSES = [
    'pointerdown',
    'mousedown',
    'pointerup',
    'mouseup',
    'click',
    'dblclick',
  ] as const;
  let boxSpy: ReturnType<typeof stubOfferBox>;

  beforeEach(() => {
    fitView.mockClear();
    setViewport.mockClear();
    flow$.reset();
    store().load('L1', kitchenSinkLoop());
    boxSpy = stubOfferBox();
  });
  afterEach(() => boxSpy.mockRestore());

  /** What the DOM shows after each commit: the offer, its result, or (never) neither. */
  const commitsOf = (states: string[]) => () => {
    const offered = screen.queryByTestId('space-cards-offer') !== null;
    const shown = result() !== null;
    states.push(offered ? (shown ? 'both' : 'offer') : shown ? 'result' : 'neither');
  };

  it('replaces the offer, in the same commit and box, with a plain line: no control, no live region, the same announcement', async () => {
    const user = userEvent.setup();
    const states: string[] = [];
    render(
      <Profiler id="canvas" onRender={commitsOf(states)}>
        <Live />
      </Profiler>,
    );
    const panel = screen.getByTestId('space-cards-offer');
    const was = { wrapper: panel.parentElement!.className, section: panel.className };
    measure({ prep: 400 });
    const before = states.length;
    await user.click(spaceButton());

    // The offer is never gone without its result: no commit shows neither.
    expect(states.slice(before)).toContain('result');
    expect(states.slice(before)).not.toContain('neither');
    expect(states.slice(before)).not.toContain('both');
    const shown = screen.getByTestId('space-cards-result');
    expect(offer()).toBeNull();
    expect(shown.textContent).toBe(`Spaced ${CARDS} cards.`);
    // The offer's own wrapper, classes (background, border, shadow) and measured size, ahead of the flow.
    expect(shown.parentElement!.className).toBe(was.wrapper);
    for (const name of was.section.split(' ')) expect(shown).toHaveClass(name);
    expect(shown).toHaveStyle({ width: '392px', height: '129.5px' });
    expect(shown.parentElement!.parentElement).toBe(canvas());
    expect(
      shown.compareDocumentPosition(screen.getByTestId('flow')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Nothing to press, focus, select or hear: the canvas's one polite region says it, once.
    expect(shown).toHaveClass('select-none');
    expect(
      shown.querySelectorAll('button, a, input, select, textarea, [tabindex], [role]'),
    ).toHaveLength(0);
    expect(shown).not.toHaveAttribute('tabindex');
    expect(canvas().querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(shown.closest('[aria-live]')).toBeNull();
    expect(announced()).toBe(`Spaced ${CARDS} cards. Undo puts them back.`);
    expect(canvas()).toHaveFocus();
    // One step and one fit, as without the result.
    expect(labels()).toEqual(['space cards']);
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport).toHaveBeenCalledWith(owedView({ prep: 400 }));
  });

  it('shows Suggestion dismissed. in the box for Dismiss, with no edit, save or step', async () => {
    const user = userEvent.setup();
    render(<Live />);
    const state = store();
    await user.click(dismissButton());
    expect(offer()).toBeNull();
    expect(result()!.textContent).toBe('Suggestion dismissed.');
    expect(result()).toHaveStyle({ width: '392px', height: '129.5px' });
    expect(announced()).toBe('Suggestion dismissed.');
    expect(canvas()).toHaveFocus();
    expect(store()).toBe(state);
  });

  it('shows the refusal line when the store refuses an offer that retires in the same update, and none while the offer stays', async () => {
    const user = userEvent.setup();
    const view = render(<Live />);
    // The click arrives in the update that moves the draft: the pile is gone when it renders.
    act(() => {
      store().moveNode('prep', { x: 5, y: 5 });
      fireEvent.click(spaceButton(), { detail: 1 });
    });
    expect(offer()).toBeNull();
    expect(result()!.textContent).toBe(
      'Cards were not spaced: they are no longer all in one spot.',
    );
    expect(announced()).toBe('Cards were not spaced: they are no longer all in one spot.');
    expect(labels()).toEqual(['move prep']);
    expect(canvas()).toHaveFocus();
    view.unmount();

    // A canvas that still shows the stale offer replaces nothing, so it adds nothing.
    act(() => store().load('L1', kitchenSinkLoop()));
    render(<Canvas definition={store().definition!} issues={[]} />);
    act(() => store().moveNode('prep', { x: 6, y: 6 }));
    await user.click(spaceButton());
    expect(result()).toBeNull();
    expect(offer()).not.toBeNull();
    expect(announced()).toBe('Cards were not spaced: they are no longer all in one spot.');
  });

  it('holds presses on it, plain, with Shift and as a double click, without preventing or stopping any event', async () => {
    const user = userEvent.setup();
    render(<Live />);
    act(() => store().select('prep'));
    await user.click(spaceButton());
    const shown = screen.getByTestId('space-cards-result');
    const state = store();
    const seen: { type: string; prevented: boolean }[] = [];
    const record = (event: Event) =>
      seen.push({ type: event.type, prevented: event.defaultPrevented });
    for (const type of PRESSES) window.addEventListener(type, record);
    try {
      await user.dblClick(shown);
      await user.keyboard('{Shift>}');
      await user.dblClick(shown);
      await user.keyboard('{/Shift}');
    } finally {
      for (const type of PRESSES) window.removeEventListener(type, record);
    }
    // Every kind of press reached the page's bubble phase, none cancelled.
    expect(new Set(seen.map((event) => event.type))).toEqual(new Set(PRESSES));
    expect(seen.some((event) => event.prevented)).toBe(false);
    // And it did nothing: the result stays, the draft, selection, focus and announcement are as they were.
    expect(result()).toBe(shown);
    expect(store()).toBe(state);
    expect(store().selectedNodeId).toBe('prep');
    expect(canvas()).toHaveFocus();
    expect(announced()).toBe(`Spaced ${CARDS} cards. Undo puts them back.`);
  });

  it('is not left by a keyboard or scripted activation: Enter, Space and a click with no detail retire the offer at once', async () => {
    const user = userEvent.setup();
    render(<Live />);
    for (const press of [
      () => user.keyboard('{Enter}'),
      () => user.keyboard('[Space]'),
      () => fireEvent.click(document.activeElement!),
    ]) {
      act(() => store().load('L1', kitchenSinkLoop()));
      act(() => spaceButton().focus());
      await act(async () => press());
      expect(offer()).toBeNull();
      expect(result()).toBeNull();
    }
    act(() => store().load('L1', kitchenSinkLoop()));
    act(() => dismissButton().focus());
    fireEvent.click(dismissButton());
    expect(offer()).toBeNull();
    expect(result()).toBeNull();
    expect(announced()).toBe('Suggestion dismissed.');
  });

  it('ends at the next pointerdown outside it, which goes on untouched, and not at one inside it', async () => {
    const user = userEvent.setup();
    render(<Live />);
    const show = async () => {
      if (result() === null) {
        act(() => store().load('L1', kitchenSinkLoop()));
        await user.click(spaceButton());
      }
      return screen.getByTestId('space-cards-result');
    };
    const shown = await show();
    fireEvent.pointerDown(shown, { button: 0 });
    fireEvent.pointerDown(shown.firstElementChild!, { button: 0 });
    expect(result()).toBe(shown);

    const flowElement = screen.getByTestId('flow');
    const arrivals: boolean[] = [];
    flowElement.addEventListener('pointerdown', (event) => arrivals.push(event.defaultPrevented));
    const presses = [
      { button: 0 },
      { button: 2 },
      { button: 1 },
      { button: 0, pointerType: 'touch' },
      { button: 0, pointerType: 'pen' },
    ];
    for (const init of presses) {
      await show();
      fireEvent.pointerDown(flowElement, init);
      expect(result()).toBeNull();
    }
    // Each press went on to the flow, never cancelled on the way.
    expect(arrivals).toEqual(presses.map(() => false));
    // Anywhere else on the page ends it too: the canvas's own root, and the page.
    for (const target of [canvas(), document.body]) {
      await show();
      fireEvent.pointerDown(target, { button: 0 });
      expect(result()).toBeNull();
    }
  });

  it('is dropped when the offer returns or another draft loads, and kept through other edits of this one', async () => {
    const user = userEvent.setup();
    render(<Live />);
    await user.click(spaceButton());
    expect(result()).not.toBeNull();
    // Edits and the undo of one, within this load, keep it: it was no offer's place.
    act(() => store().moveNode('prep', { x: 1, y: 1 }));
    expect(result()).not.toBeNull();
    act(() => store().undo());
    expect(result()).not.toBeNull();
    // The undo that brings the offer back takes it away, and a redo adds none.
    act(() => store().undo());
    expect(offer()).not.toBeNull();
    expect(result()).toBeNull();
    act(() => store().redo());
    expect(offer()).toBeNull();
    expect(result()).toBeNull();

    // A load of a draft that is no pile drops it, and so does a load of one that is.
    act(() => store().undo());
    await user.click(spaceButton());
    expect(result()).not.toBeNull();
    const loop = kitchenSinkLoop();
    act(() =>
      store().load('L2', {
        ...loop,
        nodes: loop.nodes.map((node, index) => ({ ...node, ui: { x: index * 300, y: 0 } })),
      }),
    );
    expect(offer()).toBeNull();
    expect(result()).toBeNull();
    act(() => store().load('L1', kitchenSinkLoop()));
    await user.click(dismissButton());
    expect(result()!.textContent).toBe('Suggestion dismissed.');
    act(() => store().load('L1', kitchenSinkLoop()));
    expect(offer()).not.toBeNull();
    expect(result()).toBeNull();
  });

  it('stays until a press elsewhere, however long: no timer ends it', () => {
    vi.useFakeTimers();
    try {
      render(<Live />);
      fireEvent.click(spaceButton(), { detail: 1 });
      expect(result()).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(60 * 60 * 1000);
      });
      expect(result()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('listens on the document for one passive capture pointerdown only while it shows, and cleans up when it ends and on unmount', async () => {
    const user = userEvent.setup();
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const windowAdded = vi.spyOn(window, 'addEventListener');
    const listeners = (spy: typeof added) =>
      spy.mock.calls.filter(([type]) => type === 'pointerdown');
    try {
      const view = render(<Live />);
      const baseline = listeners(added).length;
      expect(listeners(removed)).toHaveLength(0);
      await user.click(spaceButton());
      const [, press, options] = listeners(added).at(-1)!;
      expect(listeners(added)).toHaveLength(baseline + 1);
      expect(options).toEqual({ capture: true, passive: true });
      // Ending it removes that very listener; nothing else is left behind.
      fireEvent.pointerDown(document.body);
      expect(listeners(removed)).toEqual([['pointerdown', press, { capture: true }]]);
      // The canvas's own gate stays the page's one window `mouseup` listener.
      expect(windowAdded.mock.calls.filter(([type]) => type === 'mouseup')).toHaveLength(1);

      act(() => store().undo());
      await user.click(dismissButton());
      expect(result()).not.toBeNull();
      const second = listeners(added).at(-1)![1];
      view.unmount();
      expect(listeners(removed).at(-1)).toEqual(['pointerdown', second, { capture: true }]);
      expect(listeners(added)).toHaveLength(baseline + 2);
      expect(listeners(removed)).toHaveLength(2);
    } finally {
      added.mockRestore();
      removed.mockRestore();
      windowAdded.mockRestore();
    }
  });
});

describe('Space cards follow the canvas viewport gate (#207, #208)', () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  /** xyflow's `onMove` for the first move of a mouse pan: the gate is `panning` from here. */
  const pan = () => act(() => flow().onMove!(new MouseEvent('mousemove'), viewport));
  /** A mouse release on the page, seen first by the canvas's one window listener. */
  const release = () =>
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
  const untilAvailable = () =>
    waitFor(() => {
      expect(spaceButton()).not.toHaveAttribute('aria-disabled');
      expect(dismissButton()).not.toHaveAttribute('aria-disabled');
    });
  /** Both buttons say `gesture` (nothing when available) and are never disabled or click-through. */
  const expectGesture = (gesture?: 'panning' | 'settling') => {
    for (const button of [spaceButton(), dismissButton()]) {
      if (gesture) {
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveAttribute('data-gesture', gesture);
      } else {
        expect(button).not.toHaveAttribute('aria-disabled');
        expect(button).not.toHaveAttribute('data-gesture');
      }
      expect(button).toBeEnabled();
      expect(button.classList.contains('pointer-events-none')).toBe(false);
    }
  };

  beforeEach(() => {
    fitView.mockClear();
    setViewport.mockClear();
    flow$.reset();
    store().load('L1', kitchenSinkLoop());
  });

  it('keeps both buttons attached and focusable but unavailable, from a mouse pan’s first move until its release settles', async () => {
    render(<Live />);
    const space = spaceButton();
    const dismiss = dismissButton();
    // A new canvas is ready; a wheel, a touch pan and a programmatic move never change that.
    act(() => {
      flow().onMove!(new WheelEvent('wheel'), viewport);
      flow().onMove!(new TouchEvent('touchmove'), viewport);
      flow().onMove!(null, viewport);
    });
    expectGesture();
    pan();
    expectGesture('panning');
    // The offer is not hidden, so a press cannot fall through to the canvas below it.
    expect(offer()).not.toBeNull();
    for (const button of [dismiss, space]) {
      act(() => button.focus());
      expect(button).toHaveFocus();
      expect(button.isConnected).toBe(true);
    }
    release();
    expectGesture('settling');
    await untilAvailable();
    expectGesture();
    // The same elements throughout: nothing was replaced or remounted.
    expect(spaceButton()).toBe(space);
    expect(dismissButton()).toBe(dismiss);
    expect(space).toHaveFocus();
  });

  it('refuses Space cards by click, Enter and Space while unavailable, then spaces once on the first press after release', async () => {
    const user = userEvent.setup();
    render(<Live />);
    const original = store().definition!;
    measure({ prep: 400 });
    const state = store();
    const space = spaceButton();
    act(() => space.focus());
    const refused = () => {
      expect(store()).toBe(state);
      // Focus did not leave the button for the canvas, and nothing was announced or fitted.
      expect(space).toHaveFocus();
      expect(announced()).toBe('');
      expect(setViewport).not.toHaveBeenCalled();
      expect(fitView).not.toHaveBeenCalled();
      expect(offer()).not.toBeNull();
    };
    pan();
    fireEvent.click(space);
    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');
    refused();
    // Released, and still settling: shown unavailable and refused the same way.
    release();
    expectGesture('settling');
    fireEvent.click(space);
    refused();

    await untilAvailable();
    await user.click(space);
    expect(labels()).toEqual(['space cards']);
    expect(positions()).toEqual(
      spacedPositions(
        original,
        original.nodes.map((node) => (node.id === 'prep' ? 400 : 100)),
      ),
    );
    expect(canvas()).toHaveFocus();
    expect(announced()).toBe(`Spaced ${CARDS} cards. Undo puts them back.`);
    expect(offer()).toBeNull();
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport).toHaveBeenCalledWith(owedView({ prep: 400 }));
    expect(fitView).not.toHaveBeenCalled();
    expect(store().future).toEqual([]);
  });

  it('refuses Dismiss suggestion while unavailable, then dismisses once with no edit, save or history step', async () => {
    const user = userEvent.setup();
    render(<Live />);
    const state = store();
    const changes = vi.fn();
    const unsubscribe = useEditorStore.subscribe(changes);
    try {
      const dismiss = dismissButton();
      act(() => dismiss.focus());
      pan();
      fireEvent.click(dismiss);
      await user.keyboard('{Enter}');
      await user.keyboard('[Space]');
      release();
      fireEvent.click(dismiss);
      expectGesture('settling');
      // Still offered, still focused on Dismiss, and nothing was announced.
      expect(offer()).not.toBeNull();
      expect(dismiss).toHaveFocus();
      expect(announced()).toBe('');

      await untilAvailable();
      await user.click(dismiss);
      expect(offer()).toBeNull();
      expect(canvas()).toHaveFocus();
      expect(announced()).toBe('Suggestion dismissed.');
    } finally {
      unsubscribe();
    }
    // Dismissal is local to the editor load: the store was never written, so there is no revision,
    // no history step and nothing for autosave or the device copy to send.
    expect(changes).not.toHaveBeenCalled();
    expect(store()).toBe(state);
    expect(store()).toMatchObject({ revision: 0, past: [], future: [] });
  });

  it('keeps the store’s own recheck behind the gate: a stale offer is refused unheard while unavailable, then by the store', async () => {
    const user = userEvent.setup();
    // Rendered with the pile; the store's draft then changes without this canvas rendering again.
    render(<Canvas definition={store().definition!} issues={[]} />);
    act(() => store().moveNode('prep', { x: 5, y: 5 }));
    const state = store();
    const space = spaceButton();
    act(() => space.focus());
    pan();
    fireEvent.click(space);
    // The gate refused first: the store was not asked, so no refusal text and no focus move.
    expect(store()).toBe(state);
    expect(space).toHaveFocus();
    expect(announced()).toBe('');

    release();
    await untilAvailable();
    await user.click(space);
    expect(store()).toBe(state);
    expect(canvas()).toHaveFocus();
    expect(announced()).toBe('Cards were not spaced: they are no longer all in one spot.');
    expect(setViewport).not.toHaveBeenCalled();
    expect(fitView).not.toHaveBeenCalled();
  });

  it('leaves no result for a pointer press the gate refuses, and one for the first press that acts', async () => {
    const user = userEvent.setup();
    const boxSpy = stubOfferBox();
    try {
      render(<Live />);
      const state = store();
      pan();
      fireEvent.click(spaceButton(), { detail: 1 });
      fireEvent.click(dismissButton(), { detail: 1 });
      release();
      fireEvent.click(spaceButton(), { detail: 1 });
      expectGesture('settling');
      expect(result()).toBeNull();
      expect(offer()).not.toBeNull();
      expect(store()).toBe(state);

      await untilAvailable();
      await user.click(spaceButton());
      expect(offer()).toBeNull();
      expect(result()!.textContent).toBe(`Spaced ${CARDS} cards.`);
      expect(labels()).toEqual(['space cards']);
    } finally {
      boxSpy.mockRestore();
    }
  });

  it('uses the canvas’s one gate: no second window listener, detached with the canvas', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    try {
      const view = render(<Live />);
      // The offer is rendered, and the page still has the gate's single passive capture listener.
      expect(offer()).not.toBeNull();
      const releases = add.mock.calls.filter(([type]) => type === 'mouseup');
      expect(releases).toHaveLength(1);
      expect(releases[0]![2]).toEqual({ capture: true, passive: true });
      pan();
      expectGesture('panning');
      view.unmount();
      expect(removeListener).toHaveBeenCalledWith('mouseup', releases[0]![1], { capture: true });
    } finally {
      add.mockRestore();
      removeListener.mockRestore();
    }
  });

  it('reads the gate when the offer returns mid-pan, so it is never shown available while unavailable', async () => {
    render(<Live />);
    act(() => store().moveNode('prep', { x: 1, y: 1 }));
    expect(offer()).toBeNull();
    // A pan begins while the offer is away; undoing the move brings it back into that pan.
    pan();
    act(() => store().undo());
    expect(offer()).not.toBeNull();
    expectGesture('panning');
    release();
    await untilAvailable();
    expectGesture();
  });

  describe('the offer on its own, with the shared gate', () => {
    const offerOn = (
      viewportOf: Parameters<typeof SpaceCardsOffer>[0]['viewport'],
      onSpace = vi.fn(),
      onDismiss = vi.fn(),
    ) => ({
      onSpace,
      onDismiss,
      view: render(
        <SpaceCardsOffer count={3} viewport={viewportOf} onSpace={onSpace} onDismiss={onDismiss} />,
      ),
    });

    it('subscribes once while shown, unsubscribes when it leaves, and reads the current state on return', async () => {
      const gate = createViewportGestureGate();
      const detach = gate.attach(window);
      let subscribed = 0;
      let subscribers = 0;
      // One stable viewport, as the canvas passes its gate.
      const viewportOf = {
        state: gate.state,
        subscribe: (listener: () => void) => {
          subscribed += 1;
          subscribers += 1;
          const off = gate.subscribe(listener);
          return () => {
            subscribers -= 1;
            off();
          };
        },
      };
      try {
        const first = offerOn(viewportOf);
        expect(subscribers).toBe(1);
        act(() => gate.move(new MouseEvent('mousemove')));
        expectGesture('panning');
        release();
        expectGesture('settling');
        await untilAvailable();
        // Every change was heard through that one subscription.
        expect(subscribed).toBe(1);
        first.view.unmount();
        expect(subscribers).toBe(0);

        // The gate moves on while the offer is away; its next appearance already says so.
        act(() => gate.move(new MouseEvent('mousemove')));
        const second = offerOn(viewportOf);
        expect(subscribers).toBe(1);
        expectGesture('panning');
        fireEvent.click(spaceButton());
        fireEvent.click(dismissButton());
        expect(second.onSpace).not.toHaveBeenCalled();
        expect(second.onDismiss).not.toHaveBeenCalled();
        release();
        await untilAvailable();
        fireEvent.click(spaceButton());
        fireEvent.click(dismissButton());
        expect(second.onSpace).toHaveBeenCalledTimes(1);
        expect(second.onDismiss).toHaveBeenCalledTimes(1);
        second.view.unmount();
        expect(subscribers).toBe(0);
      } finally {
        detach();
      }
    });

    it('hands the canvas the offer’s measured box for a pointer click, and none for a keyboard or scripted one', () => {
      const boxSpy = stubOfferBox();
      try {
        const gate = createViewportGestureGate();
        const { onSpace, onDismiss } = offerOn(gate);
        fireEvent.click(spaceButton(), { detail: 1 });
        fireEvent.click(dismissButton(), { detail: 2 });
        expect(onSpace).toHaveBeenLastCalledWith(OFFER_BOX);
        expect(onDismiss).toHaveBeenLastCalledWith(OFFER_BOX);
        // Enter, Space and `element.click()` report a detail of 0.
        fireEvent.click(spaceButton());
        fireEvent.click(dismissButton(), { detail: 0 });
        expect(onSpace).toHaveBeenLastCalledWith(undefined);
        expect(onDismiss).toHaveBeenLastCalledWith(undefined);
        expect(onSpace).toHaveBeenCalledTimes(2);
        expect(onDismiss).toHaveBeenCalledTimes(2);
      } finally {
        boxSpy.mockRestore();
      }
    });

    it('shows its line in the given box, ends at a pointerdown outside only, and listens no more once gone', () => {
      const onEnd = vi.fn();
      const view = render(
        <>
          <SpaceCardsResult message="Done." box={{ width: 200, height: 60 }} onEnd={onEnd} />
          <button type="button">Elsewhere</button>
        </>,
      );
      const shown = screen.getByTestId('space-cards-result');
      expect(shown).toHaveStyle({ width: '200px', height: '60px' });
      expect(shown).toHaveTextContent('Done.');
      fireEvent.pointerDown(shown);
      fireEvent.pointerDown(within(shown).getByText('Done.'));
      expect(onEnd).not.toHaveBeenCalled();
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
      fireEvent.pointerDown(document);
      expect(onEnd).toHaveBeenCalledTimes(2);
      view.unmount();
      fireEvent.pointerDown(document.body);
      expect(onEnd).toHaveBeenCalledTimes(2);
    });

    it('asks the gate again when pressed, so a rendered state that missed a pan still refuses', () => {
      const gate = createViewportGestureGate();
      // A subscription that never reports: the buttons stay rendered available whatever happens.
      const { onSpace, onDismiss } = offerOn({
        state: gate.state,
        subscribe: () => () => undefined,
      });
      act(() => gate.move(new MouseEvent('mousemove')));
      expect(gate.state()).toBe('panning');
      expectGesture();
      fireEvent.click(spaceButton());
      fireEvent.click(dismissButton());
      expect(onSpace).not.toHaveBeenCalled();
      expect(onDismiss).not.toHaveBeenCalled();
    });
  });
});
