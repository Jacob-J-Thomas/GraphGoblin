/**
 * The one view fit Space cards asks for, on the installed dependencies (#208, ADR-0077): the real
 * Canvas on @xyflow/react and d3-zoom in jsdom, inside StrictMode and a provider, as the editor page
 * renders it. No dependency module is replaced. The fixture supplies the layout jsdom lacks (card
 * and pane sizes, a ResizeObserver that reports them, and `checkVisibility`, which xyflow asks of
 * its renderer element before it measures the pane) and one controlled scheduling intervention:
 * while it holds animation frames, a callback requested through `window.requestAnimationFrame` is
 * kept until the test releases it, and while it does not, every request goes to jsdom's own.
 *
 * Why this file exists apart from `Canvas.space-cards.test.tsx`, whose `fitView` mock resolves at
 * once and can only show that a fit was asked for: xyflow's `fitView` queues the fit and the
 * next node adoption (an Undo that changes the `nodes` prop) or the next frame consumes it with
 * whatever graph is current then. A held frame is how this fixture holds that window open, and
 * Undo is the public store action `Ctrl+Z` reaches. This is a controlled component fixture, not
 * native verification: it shows what the installed xyflow and d3 do in jsdom with that
 * intervention, never how often the window opens in a browser or what a browser paints.
 *
 * The oracle is the viewport itself, read through xyflow's public `getViewport`, and the count of
 * transform changes in its store (read only). An Undo, Redo, edit, load or unmount that follows
 * Space cards must leave the view where the one fit put it, whether the fit landed at once or
 * is still waiting for the pane. A manual Fit View, which stays on xyflow's queue, is the control
 * that the hold really intercepts a queued fit.
 */
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  getViewportForBounds,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import { StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from './Canvas.js';
import { newLoopDefinition } from './model.js';
import { NODE_CARD_SIZE } from './routing-geometry.js';
import { useEditorStore } from './store.js';

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
const VIEW = { width: 1200, height: 800 };

/** Whether the fixture hides the pane xyflow measures (its renderer), as in a tab not showing yet. */
const layout = { hidden: false };

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

/** Animation frames, held on request: the controlled intervention that opens the queued-fit window. */
const frames = (() => {
  const held = new Map<number, FrameRequestCallback>();
  let seen: FrameRequestCallback[] = [];
  let holding = false;
  let issued = 1_000_000;
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  return {
    request,
    install() {
      window.requestAnimationFrame = (callback) => {
        if (!holding) return request(callback);
        issued += 1;
        held.set(issued, callback);
        seen.push(callback);
        return issued;
      };
      window.cancelAnimationFrame = (id) => {
        if (!held.delete(id)) cancel(id);
      };
    },
    uninstall() {
      window.requestAnimationFrame = request;
      window.cancelAnimationFrame = cancel;
    },
    /** From now on, requested frames wait. `matching` counts those requested since. */
    hold() {
      holding = true;
      seen = [];
    },
    /** The held frames xyflow requested to consume a queued fit (its callback reads `fitViewQueued`). */
    matching: () => seen.filter((callback) => String(callback).includes('fitViewQueued')).length,
    pending: () => held.size,
    /** Run every held frame, in the order requested, and stop holding. */
    release() {
      holding = false;
      for (const [id, callback] of [...held]) {
        held.delete(id);
        callback(performance.now());
      }
    },
    /** A test that failed while holding must not leave its frames to the next one. */
    reset() {
      holding = false;
      held.clear();
      seen = [];
    },
  };
})();

const saved = {
  observer: globalThis.ResizeObserver,
  width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
  visibility: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'checkVisibility'),
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
  Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
    configurable: true,
    value(this: HTMLElement) {
      return !(layout.hidden && this.classList.contains('react-flow__renderer'));
    },
  });
  frames.install();
});
afterAll(() => {
  frames.uninstall();
  globalThis.ResizeObserver = saved.observer;
  if (saved.width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', saved.width);
  if (saved.height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', saved.height);
  if (saved.visibility)
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', saved.visibility);
  else delete (HTMLElement.prototype as { checkVisibility?: unknown }).checkVisibility;
});
beforeEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  layout.hidden = false;
});
const stops: (() => void)[] = [];
afterEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = saved.act;
  frames.reset();
  layout.hidden = false;
  for (const stop of stops.splice(0)) stop();
});

/** Let the microtasks queued so far run (React commits a synchronous update in one), no task. */
async function microtasks() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A zero-delay task queued now, on the global queue d3 and the gate use. */
const queuedTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A few tasks and microtasks: React commits and xyflow's own updates have all had their turn. */
async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await queuedTask();
    await microtasks();
  }
}

/** `count` of jsdom's own animation frames, which the hold never touches. */
async function realFrames(count: number) {
  for (let i = 0; i < count; i += 1)
    await new Promise<void>((resolve) => frames.request(() => resolve()));
  await microtasks();
}

let flow: ReactFlowInstance | undefined;
let flowStore: ReturnType<typeof useStoreApi> | undefined;

/** Reads xyflow's instance and store, which the Canvas leaves to the provider. */
function Observe() {
  flow = useReactFlow();
  flowStore = useStoreApi();
  return null;
}

/** The canvas as the editor page renders it: on the store's current draft, in a provider that stays. */
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
const offer = () => screen.queryByTestId('space-cards-offer');
const zoomOut = () => document.querySelector<HTMLElement>('.react-flow__controls-zoomout')!;
const fitViewButton = () => document.querySelector<HTMLElement>('.react-flow__controls-fitview')!;
const viewport = () => flow!.getViewport();
const labels = () => store().past.map((step) => step.label);

/** Two cards at the origin joined by one connection with no route: the smallest pile. */
function pile(): LoopDefinitionInput {
  const base = newLoopDefinition('Pile');
  return { ...base, nodes: base.nodes.map((node) => ({ ...node, ui: { x: 0, y: 0 } })) };
}

const FIT_PADDING = { top: '8%', right: '8%', bottom: '8%', left: '72px' } as const;

/** The view a fit of the cards in `draft` is owed: their bounds, the opening padding and 50 % floor. */
function owedView(draft: LoopDefinitionInput, minZoom = 0.5): Viewport {
  const left = Math.min(...draft.nodes.map((node) => node.ui?.x ?? 0));
  const top = Math.min(...draft.nodes.map((node) => node.ui?.y ?? 0));
  const right = Math.max(...draft.nodes.map((node) => node.ui?.x ?? 0)) + NODE_CARD_SIZE.width;
  const bottom = Math.max(...draft.nodes.map((node) => node.ui?.y ?? 0)) + NODE_CARD_SIZE.height;
  return getViewportForBounds(
    { x: left, y: top, width: right - left, height: bottom - top },
    VIEW.width,
    VIEW.height,
    minZoom,
    2,
    FIT_PADDING,
  );
}

function expectView(actual: Viewport, expected: Viewport) {
  expect(actual.x).toBeCloseTo(expected.x, 3);
  expect(actual.y).toBeCloseTo(expected.y, 3);
  expect(actual.zoom).toBeCloseTo(expected.zoom, 4);
}

/** Hand-worked from xyflow's formula, with the cards 184 × 120 in a 1200 × 800 pane. */
const OPENING: Viewport = { x: 416, y: 280, zoom: 2 };
/** One Zoom Out press (a step of 1.2 about the pane's centre) from the opening view. */
const ZOOMED_OUT: Viewport = {
  x: 600 - (600 - 416) / 1.2,
  y: 400 - (400 - 280) / 1.2,
  zoom: 2 / 1.2,
};
/** The two cards spaced one column apart, 456 × 120 together. */
const SPACED: Viewport = { x: 144, y: 280, zoom: 2 };

/** Counts the changes of xyflow's transform from now on, read only. */
function transformChanges() {
  let count = 0;
  const stop = flowStore!.subscribe((state, previous) => {
    if (state.transform !== previous.transform) count += 1;
  });
  stops.push(stop);
  return { count: () => count };
}

/** The pile on the canvas, opened and fitted, with the pane measured and the offer showing. */
async function openedPile() {
  store().load('L1', pile());
  const rendered = render(
    <StrictMode>
      <Live />
    </StrictMode>,
  );
  await waitFor(() => expect(space()).toBeInTheDocument());
  await waitFor(() => expectView(viewport(), OPENING));
  await settle();
  return rendered;
}

/** The pile on a canvas whose container xyflow cannot measure yet: its pane is 0 × 0. */
async function openedHiddenPile() {
  layout.hidden = true;
  store().load('L1', pile());
  const rendered = render(
    <StrictMode>
      <Live />
    </StrictMode>,
  );
  await waitFor(() => expect(space()).toBeInTheDocument());
  // Every card measured, the pane not: the premise of these cases.
  await waitFor(() => {
    for (const node of store().definition!.nodes)
      expect(flowStore!.getState().nodeLookup.get(node.id)?.measured.width).toBe(
        NODE_CARD_SIZE.width,
      );
  });
  await realFrames(3);
  await settle();
  expect(flowStore!.getState().width).toBe(0);
  expect(flowStore!.getState().height).toBe(0);
  return rendered;
}

/** The container shows: xyflow measures the pane on the window's resize, as it does in a browser. */
async function showPane() {
  layout.hidden = false;
  window.dispatchEvent(new Event('resize'));
  await waitFor(() => expect(flowStore!.getState().width).toBe(VIEW.width));
  await settle();
}

/** Space cards pressed as a pointer's click: the press that leaves the result in the offer's place. */
const pressSpace = () => fireEvent.click(space(), { detail: 1 });

describe('the one fit Space cards asks for, on the installed xyflow and d3 (#208)', () => {
  it('control: with frames held, Fit View waits for its frame and then fits, so the hold does intercept a queued fit', async () => {
    await openedPile();
    fireEvent.click(zoomOut());
    await settle();
    expectView(viewport(), ZOOMED_OUT);
    const transforms = transformChanges();

    frames.hold();
    fireEvent.click(fitViewButton());
    await settle();
    // The fit is queued in xyflow and its one frame is held: the view has not moved.
    expect(frames.matching()).toBe(1);
    expect(frames.pending()).toBeGreaterThanOrEqual(1);
    expectView(viewport(), ZOOMED_OUT);
    expect(transforms.count()).toBe(0);

    frames.release();
    await settle();
    expectView(viewport(), OPENING);
    expect(transforms.count()).toBe(1);
  });

  it('leaves the view where Space cards fit it when Undo comes while a frame is held, and nothing is left for the frame to fit', async () => {
    await openedPile();
    const original = store().definition!;
    fireEvent.click(zoomOut());
    await settle();
    // Before Space cards the view is not the pile's own fit, so a fit of the restored pile shows.
    expectView(viewport(), ZOOMED_OUT);
    const transforms = transformChanges();

    // Every animation frame from here waits: whatever depends on one cannot run until released.
    frames.hold();
    pressSpace();
    await waitFor(() => expect(offer()).toBeNull());
    await settle();
    expect(labels()).toEqual(['space cards']);
    const spaced = store().definition!;
    const afterSpace = viewport();
    const changesAfterSpace = transforms.count();

    // Undo, the public store action Ctrl+Z reaches, restores the pile and offers Space cards again.
    store().undo();
    await settle();
    expect(store().definition).toBe(original);
    expect(store().future).toHaveLength(1);
    expect(offer()).not.toBeNull();
    // The oracle: no fit of the restored pile, whatever xyflow still has queued for a frame.
    expect(viewport()).toEqual(afterSpace);
    expect(transforms.count()).toBe(changesAfterSpace);

    // Releasing every held frame changes nothing either.
    frames.release();
    await settle();
    await realFrames(2);
    expect(viewport()).toEqual(afterSpace);
    expect(transforms.count()).toBe(changesAfterSpace);

    // What Space cards did: one fit of the spaced draft, with no xyflow fit queued for a frame.
    expectView(afterSpace, owedView(spaced));
    expectView(afterSpace, SPACED);
    expect(changesAfterSpace).toBe(1);
    expect(frames.matching()).toBe(0);

    // Redo brings the spaced cards back and leaves the view alone, as Undo did.
    store().redo();
    await settle();
    await realFrames(2);
    expect(store().definition).toBe(spaced);
    expect(viewport()).toEqual(afterSpace);
    expect(transforms.count()).toBe(1);
  });

  it('control: unheld, Space cards fits the spaced draft once and no Undo, Redo, edit or load fits again; Fit View still fits', async () => {
    await openedPile();
    const original = store().definition!;
    fireEvent.click(zoomOut());
    await settle();
    expectView(viewport(), ZOOMED_OUT);
    const transforms = transformChanges();

    pressSpace();
    await waitFor(() => expectView(viewport(), SPACED));
    await realFrames(3);
    await settle();
    const spaced = store().definition!;
    expectView(viewport(), owedView(spaced));
    expect(transforms.count()).toBe(1);
    expect(labels()).toEqual(['space cards']);
    expect(store().revision).toBe(1);

    store().undo();
    await realFrames(2);
    store().redo();
    await realFrames(2);
    store().moveNode(spaced.nodes[0]!.id, { x: 1, y: 1 });
    await realFrames(2);
    store().load('L1', original);
    await realFrames(3);
    await settle();
    expectView(viewport(), SPACED);
    expect(transforms.count()).toBe(1);

    // The user's own Fit View is a different path and keeps fitting what is on the canvas.
    store().load('L1', spaced);
    await settle();
    fireEvent.click(zoomOut());
    await settle();
    expect(transforms.count()).toBe(2);
    fireEvent.click(fitViewButton());
    await waitFor(() => expectView(viewport(), SPACED));
    expect(transforms.count()).toBe(3);
  });

  it('waits while the pane is not measured, then fits once when it is, and nothing before then moves the view', async () => {
    await openedHiddenPile();
    const idle = viewport();
    const transforms = transformChanges();

    pressSpace();
    await waitFor(() => expect(offer()).toBeNull());
    await realFrames(3);
    await settle();
    expect(labels()).toEqual(['space cards']);
    // The fit is kept, not spent and not applied to a pane that has no size.
    expect(viewport()).toEqual(idle);
    expect(transforms.count()).toBe(0);

    await showPane();
    await waitFor(() => expectView(viewport(), SPACED));
    expectView(viewport(), owedView(store().definition!));
    expect(transforms.count()).toBe(1);
    // Spent: later input does not fit again.
    store().undo();
    await realFrames(2);
    store().redo();
    await realFrames(2);
    expect(transforms.count()).toBe(1);
  });

  it('drops a fit that waits for the pane when Undo and Redo bring back the same draft object, because it is a newer revision', async () => {
    await openedHiddenPile();
    const idle = viewport();
    const transforms = transformChanges();

    pressSpace();
    await waitFor(() => expect(offer()).toBeNull());
    await settle();
    const spaced = store().definition!;
    const revision = store().revision;
    store().undo();
    store().redo();
    await settle();
    // The same object is back, so only the revision can tell this draft from the one that was spaced.
    expect(store().definition).toBe(spaced);
    expect(store().revision).toBe(revision + 2);

    await showPane();
    await realFrames(3);
    expect(viewport()).toEqual(idle);
    expect(transforms.count()).toBe(0);
  });

  it('drops a fit that waits for the pane when an edit or a load comes first', async () => {
    await openedHiddenPile();
    const idle = viewport();
    const transforms = transformChanges();

    pressSpace();
    await waitFor(() => expect(offer()).toBeNull());
    await settle();
    store().moveNode(store().definition!.nodes[1]!.id, { x: 400, y: 20 });
    await settle();
    await showPane();
    await realFrames(3);
    expect(viewport()).toEqual(idle);
    expect(transforms.count()).toBe(0);
  });

  it('drops a fit that waits for the pane when the draft is loaded again', async () => {
    await openedHiddenPile();
    const idle = viewport();
    const transforms = transformChanges();

    pressSpace();
    await waitFor(() => expect(offer()).toBeNull());
    await settle();
    store().load('L1', pile());
    await settle();
    expect(offer()).not.toBeNull();
    await showPane();
    await realFrames(3);
    expect(viewport()).toEqual(idle);
    expect(transforms.count()).toBe(0);
  });

  it('leaves nothing behind for a frame or the pane after the canvas unmounts, and raises no error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // A fit that has landed, with every frame held through the unmount and the release.
      const first = await openedPile();
      frames.hold();
      pressSpace();
      await waitFor(() => expect(offer()).toBeNull());
      await settle();
      first.unmount();
      frames.release();
      await realFrames(2);
      await settle();
      expect(frames.matching()).toBe(0);

      // A fit still waiting for the pane.
      layout.hidden = true;
      store().load('L1', pile());
      const second = render(
        <StrictMode>
          <Live />
        </StrictMode>,
      );
      await waitFor(() => expect(space()).toBeInTheDocument());
      await realFrames(2);
      pressSpace();
      await waitFor(() => expect(offer()).toBeNull());
      second.unmount();
      layout.hidden = false;
      window.dispatchEvent(new Event('resize'));
      await realFrames(2);
      await settle();
      expect(labels()).toEqual(['space cards']);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
