import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_DELAY, closePopovers, OPEN_DELAY, placePopover, Popover } from './index.js';

/** A popover between two plain buttons, with two controls inside; the first closes it. */
function Harness({ label = 'Details', name = 'Info' }: { label?: string; name?: string }) {
  return (
    <>
      <button type="button">Before {name}</button>
      <Popover
        label={label}
        trigger={(props) => (
          <button type="button" {...props}>
            {name}
          </button>
        )}
      >
        {({ close }) => (
          <>
            <p>Body of {label}</p>
            <button type="button" onClick={() => close({ returnFocus: true })}>
              First {name}
            </button>
            <button type="button">Second {name}</button>
          </>
        )}
      </Popover>
      <button type="button">After {name}</button>
    </>
  );
}

const trigger = (name = 'Info') => screen.getByRole('button', { name });
const popover = (name = 'Info') =>
  document.getElementById(trigger(name).getAttribute('aria-controls')!)!;
const isOpen = (name = 'Info') => trigger(name).getAttribute('aria-expanded') === 'true';

function rect(box: { top: number; left: number; width: number; height: number }): DOMRect {
  const { top, left, width, height } = box;
  return {
    ...box,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('placePopover', () => {
  const viewport = { width: 1000, height: 800 };

  it('goes below the trigger, aligned with its left edge, when it fits', () => {
    expect(
      placePopover({ top: 100, bottom: 124, left: 200 }, { width: 300, height: 200 }, viewport),
    ).toEqual({ top: 130, left: 200, maxHeight: 800 - 8 - 130, side: 'below' });
  });

  it('flips above when below has no room, and never covers the trigger', () => {
    const placed = placePopover(
      { top: 700, bottom: 724, left: 200 },
      { width: 300, height: 200 },
      viewport,
    );
    expect(placed).toEqual({
      top: 700 - 6 - 200,
      left: 200,
      maxHeight: 700 - 6 - 8,
      side: 'above',
    });
    expect(placed.top + 200).toBeLessThanOrEqual(700);
  });

  it('shifts inside the viewport horizontally and scrolls when taller than the room', () => {
    // Near the right edge: shifted left so its right edge stays 8 px inside.
    expect(
      placePopover({ top: 10, bottom: 34, left: 950 }, { width: 300, height: 100 }, viewport).left,
    ).toBe(1000 - 8 - 300);
    // Off the left edge: pinned 8 px in.
    expect(
      placePopover({ top: 10, bottom: 34, left: -40 }, { width: 300, height: 100 }, viewport).left,
    ).toBe(8);
    // Wider than the viewport: as wide as it can be, from the margin.
    expect(
      placePopover({ top: 10, bottom: 34, left: 50 }, { width: 2000, height: 100 }, viewport).left,
    ).toBe(8);
    // Taller than either side: the larger side, limited to its room (it scrolls).
    const tall = placePopover(
      { top: 300, bottom: 324, left: 50 },
      { width: 300, height: 2000 },
      viewport,
    );
    expect(tall).toEqual({ top: 330, left: 50, maxHeight: 800 - 8 - 330, side: 'below' });
    const high = placePopover(
      { top: 600, bottom: 624, left: 50 },
      { width: 300, height: 2000 },
      viewport,
    );
    expect(high).toEqual({ top: 8, left: 50, maxHeight: 600 - 6 - 8, side: 'above' });
    // No room at all: nothing negative.
    expect(
      placePopover({ top: 0, bottom: 800, left: 0 }, { width: 10, height: 10 }, viewport).maxHeight,
    ).toBe(0);
  });
});

describe('Popover', () => {
  it('opens on hover after a delay, stays while the pointer is over it, and closes after leaving both', () => {
    vi.useFakeTimers();
    render(<Harness />);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(popover()).toHaveAttribute('hidden');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY - 10);
    });
    expect(isOpen()).toBe(false);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(isOpen()).toBe(true);
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(dialog).toBe(popover());
    expect(dialog).not.toHaveAttribute('hidden');
    // jsdom has no popover API: a plain element, shown in place.
    expect(dialog).not.toHaveAttribute('popover');
    expect(dialog).toHaveTextContent('Body of Details');

    // The pointer moves from the trigger into the popover: it stays open as long as it is there.
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY / 2);
    });
    fireEvent.pointerEnter(dialog, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY * 5);
    });
    expect(isOpen()).toBe(true);

    // Leaving both: closed once the grace period is over, not before.
    fireEvent.pointerLeave(dialog, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY - 10);
    });
    expect(isOpen()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(isOpen()).toBe(false);
    expect(popover()).toHaveAttribute('hidden');
    expect(popover()).toBeEmptyDOMElement();

    // A pointer passing over quickly opens nothing, and touch has no hover.
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY / 2);
    });
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY * 4);
    });
    expect(isOpen()).toBe(false);
    fireEvent.pointerEnter(trigger(), { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY * 4);
    });
    expect(isOpen()).toBe(false);
    fireEvent.pointerLeave(trigger(), { pointerType: 'touch' });
  });

  it('opens on keyboard focus, lets Tab move through it, and closes when focus leaves both', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Before Info' })).toHaveFocus();
    await user.tab();
    expect(trigger()).toHaveFocus();
    expect(isOpen()).toBe(true);
    // In DOM order right after the trigger: Tab moves into it, then out the other side.
    await user.tab();
    expect(screen.getByRole('button', { name: 'First Info' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Second Info' })).toHaveFocus();
    expect(isOpen()).toBe(true);
    await user.tab();
    expect(screen.getByRole('button', { name: 'After Info' })).toHaveFocus();
    expect(isOpen()).toBe(false);

    // Shift+Tab skips the closed popover and lands on the trigger, which opens it again.
    await user.tab({ shift: true });
    expect(trigger()).toHaveFocus();
    expect(isOpen()).toBe(true);
    // Enter pins it (it stays), a second Enter closes it, a third opens it.
    await user.keyboard('{Enter}');
    expect(isOpen()).toBe(true);
    await user.keyboard('{Enter}');
    expect(isOpen()).toBe(false);
    await user.keyboard('{Enter}');
    expect(isOpen()).toBe(true);
    // A control inside closing it with returnFocus puts focus back on the trigger, quietly.
    await user.tab();
    await user.keyboard('{Enter}');
    expect(isOpen()).toBe(false);
    expect(trigger()).toHaveFocus();
  });

  it('toggles on click or tap, and the focus a press brings opens nothing by itself', async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    render(
      <div onClick={outer}>
        <Harness />
      </div>,
    );
    // A press focuses the trigger without opening it; the click then opens it.
    fireEvent.pointerDown(trigger());
    act(() => trigger().focus());
    expect(isOpen()).toBe(false);
    fireEvent.click(trigger());
    expect(isOpen()).toBe(true);
    // Neither the trigger's click nor a click inside the popover reaches the page behind.
    await user.click(screen.getByText('Body of Details'));
    expect(outer).not.toHaveBeenCalled();
    expect(isOpen()).toBe(true);
    await user.click(trigger());
    expect(isOpen()).toBe(false);
    await user.click(trigger());
    expect(isOpen()).toBe(true);
    expect(outer).not.toHaveBeenCalled();
  });

  it('closes on Esc, returning focus to the trigger only when focus was inside', async () => {
    const user = userEvent.setup();
    const onKey = vi.fn();
    document.addEventListener('keydown', onKey);
    render(<Harness />);
    await user.click(trigger());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'First Info' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(isOpen()).toBe(false);
    expect(trigger()).toHaveFocus();
    // Esc closed the popover and went no further (a dialog around it stays open).
    const escapes = () =>
      onKey.mock.calls.filter(([event]) => (event as KeyboardEvent).key === 'Escape').length;
    expect(escapes()).toBe(0);

    // Opened by hover with focus elsewhere: Esc closes it and focus stays where it was.
    screen.getByRole('button', { name: 'After Info' }).focus();
    vi.useFakeTimers();
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY);
    });
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(isOpen()).toBe(false);
    expect(screen.getByRole('button', { name: 'After Info' })).toHaveFocus();
    // Other keys pass through while it is open.
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY);
    });
    fireEvent.keyDown(document.activeElement!, { key: 'a' });
    expect(isOpen()).toBe(true);
    expect(escapes()).toBe(0);
    expect(onKey.mock.calls.at(-1)![0]).toMatchObject({ key: 'a' });
    document.removeEventListener('keydown', onKey);
  });

  it('closes on a press outside, but not on one inside', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByText('Body of Details'));
    expect(isOpen()).toBe(true);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'After Info' }));
    expect(isOpen()).toBe(false);
  });

  it('keeps focus moves inside open, and closes when focus goes nowhere', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    const first = screen.getByRole('button', { name: 'First Info' });
    fireEvent.blur(trigger(), { relatedTarget: first });
    expect(isOpen()).toBe(true);
    fireEvent.blur(first, { relatedTarget: null });
    expect(isOpen()).toBe(false);
    // Closed already: a blur changes nothing.
    fireEvent.blur(trigger(), { relatedTarget: null });
    expect(isOpen()).toBe(false);
  });

  it('moves between its controls with the arrow keys, Home, and End', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // ArrowDown on a closed trigger opens it and moves into it.
    act(() => {
      fireEvent.pointerDown(trigger());
      trigger().focus();
    });
    expect(isOpen()).toBe(false);
    await user.keyboard('{ArrowDown}');
    expect(isOpen()).toBe(true);
    const first = screen.getByRole('button', { name: 'First Info' });
    const second = screen.getByRole('button', { name: 'Second Info' });
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{End}');
    expect(second).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    await user.keyboard('{x}');
    expect(first).toHaveFocus();
    // ArrowUp from the first control goes back to the trigger, which stays open.
    await user.keyboard('{ArrowUp}');
    expect(trigger()).toHaveFocus();
    expect(isOpen()).toBe(true);
    // ArrowDown on an open trigger moves in again; other keys on the trigger do nothing.
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(first).toHaveFocus();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowRight' });
    expect(trigger()).toHaveFocus();
  });

  it('ArrowDown opens a popover with nothing to focus and leaves focus on the trigger', () => {
    render(
      <Popover
        label="Empty"
        trigger={(props) => (
          <button type="button" {...props}>
            Empty
          </button>
        )}
      >
        <p>Nothing to press</p>
      </Popover>,
    );
    act(() => {
      fireEvent.pointerDown(trigger('Empty'));
      trigger('Empty').focus();
    });
    fireEvent.keyDown(trigger('Empty'), { key: 'ArrowDown' });
    expect(screen.getByRole('dialog', { name: 'Empty' })).toHaveTextContent('Nothing to press');
    expect(trigger('Empty')).toHaveFocus();
    // A click pins a popover opened by focus; a second click closes it.
    fireEvent.click(trigger('Empty'));
    expect(isOpen('Empty')).toBe(true);
    fireEvent.click(trigger('Empty'));
    expect(isOpen('Empty')).toBe(false);
    // Pinned by a click, ArrowDown keeps it pinned: the next click closes it.
    fireEvent.click(trigger('Empty'));
    fireEvent.keyDown(trigger('Empty'), { key: 'ArrowDown' });
    expect(isOpen('Empty')).toBe(true);
    fireEvent.click(trigger('Empty'));
    expect(isOpen('Empty')).toBe(false);
  });

  it('closes others when one opens, and closePopovers closes them all', () => {
    render(
      <>
        <Harness label="One" name="One" />
        <Harness label="Two" name="Two" />
      </>,
    );
    fireEvent.click(trigger('One'));
    expect(isOpen('One')).toBe(true);
    fireEvent.click(trigger('Two'));
    expect(isOpen('One')).toBe(false);
    expect(isOpen('Two')).toBe(true);
    // Scoped: only popovers whose trigger is inside the scope close.
    act(() => closePopovers(screen.getByRole('button', { name: 'Before Two' })));
    expect(isOpen('Two')).toBe(true);
    act(() => closePopovers(document.body));
    expect(isOpen('Two')).toBe(false);
    fireEvent.click(trigger('Two'));
    act(() => closePopovers());
    expect(isOpen('Two')).toBe(false);
  });

  it('places itself from the trigger inside the viewport, and again on resize', () => {
    render(<Harness />);
    const anchor = vi
      .spyOn(trigger(), 'getBoundingClientRect')
      .mockReturnValue(rect({ top: 700, left: 1000, width: 24, height: 24 }));
    vi.spyOn(popover(), 'getBoundingClientRect').mockReturnValue(
      rect({ top: 0, left: 0, width: 300, height: 200 }),
    );
    fireEvent.click(trigger());
    // jsdom's window is 1024 x 768: no room below, so above; shifted left to stay inside.
    expect(popover().style).toMatchObject({
      top: `${700 - 6 - 200}px`,
      left: `${1024 - 8 - 300}px`,
      maxHeight: `${700 - 6 - 8}px`,
    });
    expect(popover().dataset['side']).toBe('above');
    anchor.mockReturnValue(rect({ top: 40, left: 100, width: 24, height: 24 }));
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(popover().style).toMatchObject({ top: '70px', left: '100px' });
    expect(popover().dataset['side']).toBe('below');
  });

  it('uses the native popover API where the browser has it, and leaves the top layer on close', () => {
    const show = vi.fn();
    const hide = vi.fn();
    Object.assign(HTMLElement.prototype, { showPopover: show, hidePopover: hide });
    try {
      const view = render(<Harness />);
      expect(popover()).toHaveAttribute('popover', 'manual');
      fireEvent.click(trigger());
      expect(show).toHaveBeenCalledTimes(1);
      expect(show.mock.contexts[0]).toBe(popover());
      fireEvent.click(trigger());
      expect(hide).toHaveBeenCalledTimes(1);
      fireEvent.click(trigger());
      view.unmount();
      expect(show).toHaveBeenCalledTimes(2);
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
      delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover;
    }
  });

  it('clears a pending hover timer when it unmounts', () => {
    vi.useFakeTimers();
    const view = render(<Harness />);
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    view.unmount();
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(OPEN_DELAY * 2);
      }),
    ).not.toThrow();
  });
});
