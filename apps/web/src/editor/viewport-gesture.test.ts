import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewportGestureGate, type ViewportGesture } from './viewport-gesture.js';

const mousemove = () => new MouseEvent('mousemove');
const release = (button = 0) => window.dispatchEvent(new MouseEvent('mouseup', { button }));

/** Listeners and gates a test attached, released after it however it ended. */
const cleanups: (() => void)[] = [];
function attached(gate = createViewportGestureGate()) {
  cleanups.push(gate.attach(window));
  return gate;
}

/**
 * A stand-in for the listener d3-zoom adds to the window on a press: it runs after the gate's (it is
 * added later), queues its cleanup task as d3-drag's `yesdrag` does, and stops the event as d3's
 * `noevent` does. It records how many timers were queued when it ran (`timers`, under fake timers)
 * and the gate's state when its cleanup runs.
 */
function pressLikeD3(gate: { state(): ViewportGesture }, log: string[], timers?: () => number) {
  const mouseupped = (event: MouseEvent) => {
    if (timers) log.push(`d3 mouseup after ${timers()} queued`);
    setTimeout(() => log.push(`cleanup:${gate.state()}`), 0);
    event.stopImmediatePropagation();
  };
  window.addEventListener('mouseup', mouseupped, { capture: true });
  cleanups.push(() => window.removeEventListener('mouseup', mouseupped, { capture: true }));
}

describe('viewport gesture gate (#207)', () => {
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts ready, and only a mouse move makes it unavailable, notifying once per change', () => {
    const gate = createViewportGestureGate();
    const changes: ViewportGesture[] = [];
    const unsubscribe = gate.subscribe(() => changes.push(gate.state()));
    expect(gate.state()).toBe('ready');
    // Wheel, touch, a double click, a programmatic move: none adds d3's click blocker.
    for (const event of [
      new WheelEvent('wheel'),
      new Event('touchmove'),
      new MouseEvent('dblclick'),
      new MouseEvent('mousedown'),
      null,
      undefined,
    ])
      gate.move(event);
    expect(gate.state()).toBe('ready');
    gate.move(mousemove());
    gate.move(mousemove());
    expect(gate.state()).toBe('panning');
    expect(changes).toEqual(['panning']);
    unsubscribe();
    gate.move(mousemove());
    expect(changes).toEqual(['panning']);
  });

  it('queues its first task before d3’s cleanup, and settles only in a later second task', () => {
    vi.useFakeTimers();
    const gate = attached();
    const log: string[] = [];
    gate.subscribe(() => log.push(gate.state()));
    // A release while ready (a click on the pane) queues nothing.
    release();
    expect(vi.getTimerCount()).toBe(0);
    // A press adds d3's listener after the gate's; the pan moves.
    pressLikeD3(gate, log, () => vi.getTimerCount());
    gate.move(mousemove());
    release();
    // The gate saw the release first, though d3's listener stops it, and had queued its first task.
    expect(log).toEqual(['panning', 'settling', 'd3 mouseup after 1 queued']);
    expect(vi.getTimerCount()).toBe(2);
    // The first task and d3's cleanup (due at the same time) run: still settling, and the first
    // task has only queued the second.
    vi.advanceTimersToNextTimer();
    expect(log).toEqual(['panning', 'settling', 'd3 mouseup after 1 queued', 'cleanup:settling']);
    expect(gate.state()).toBe('settling');
    expect(vi.getTimerCount()).toBe(1);
    // The second task makes it ready.
    vi.advanceTimersToNextTimer();
    expect(log.at(-1)).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a new mouse move invalidates a pending release, in either phase', () => {
    vi.useFakeTimers();
    const gate = attached();
    // Before the first task.
    gate.move(mousemove());
    release();
    gate.move(mousemove());
    expect(gate.state()).toBe('panning');
    expect(vi.getTimerCount()).toBe(0);
    // Between the first task and the second.
    release();
    vi.advanceTimersToNextTimer();
    expect(gate.state()).toBe('settling');
    expect(vi.getTimerCount()).toBe(1);
    gate.move(mousemove());
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    expect(gate.state()).toBe('panning');
    // The newer pan's own release settles it.
    release();
    vi.runAllTimers();
    expect(gate.state()).toBe('ready');
  });

  it('keeps one barrier for repeated releases, for any button, and ignores later wheel and programmatic ends', () => {
    vi.useFakeTimers();
    const gate = attached();
    const changes: ViewportGesture[] = [];
    gate.subscribe(() => changes.push(gate.state()));
    gate.move(mousemove());
    // A middle-button pan's release, then another button's release before the barrier ran.
    release(1);
    release(2);
    expect(vi.getTimerCount()).toBe(1);
    // Moves that are not a mouse pan's (a wheel, a fit) do not cancel the completion.
    gate.move(new WheelEvent('wheel'));
    gate.move(null);
    vi.advanceTimersToNextTimer();
    expect(gate.state()).toBe('settling');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersToNextTimer();
    expect(gate.state()).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
    expect(changes).toEqual(['panning', 'settling', 'ready']);
  });

  it('leaves no listener or task behind once detached', () => {
    vi.useFakeTimers();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const gate = createViewportGestureGate();
    const detach = gate.attach(window);
    const [, listener, options] = add.mock.calls.find(([type]) => type === 'mouseup')!;
    // Passive and in the capture phase: it never prevents or stops an event.
    expect(options).toEqual({ capture: true, passive: true });
    gate.move(mousemove());
    release();
    expect(vi.getTimerCount()).toBe(1);
    detach();
    expect(remove).toHaveBeenCalledWith('mouseup', listener, { capture: true });
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    // Nothing enables a gate whose canvas is gone, and later releases reach no listener.
    expect(gate.state()).toBe('settling');
    release();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('orders the barrier around a d3-like cleanup on the real timer queue', async () => {
    const gate = attached();
    const log: string[] = [];
    pressLikeD3(gate, log);
    gate.move(mousemove());
    release();
    // Queued after the release: after the gate's first task and d3's cleanup, before the second.
    const queuedAfter = new Promise<ViewportGesture>((resolve) =>
      setTimeout(() => resolve(gate.state()), 0),
    );
    const ready = new Promise<void>((resolve) =>
      gate.subscribe(() => {
        if (gate.state() === 'ready') resolve();
      }),
    );
    expect(await queuedAfter).toBe('settling');
    expect(log).toEqual(['cleanup:settling']);
    await ready;
    expect(gate.state()).toBe('ready');
  });
});
