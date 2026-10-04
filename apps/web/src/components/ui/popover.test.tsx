import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  anchorInView,
  CLOSE_DELAY,
  closePopovers,
  OPEN_DELAY,
  placePopover,
  Popover,
} from './index.js';

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

describe('anchorInView', () => {
  const viewport = { width: 1000, height: 800 };
  const box = (top: number, left: number) => ({ top, left, bottom: top + 24, right: left + 24 });

  it('holds while any of the trigger is inside the viewport', () => {
    expect(anchorInView(box(100, 100), viewport)).toBe(true);
    expect(anchorInView(box(-20, 100), viewport)).toBe(true);
    expect(anchorInView(box(790, 990), viewport)).toBe(true);
    // jsdom's zero-size boxes at the origin count as visible.
    expect(anchorInView({ top: 0, left: 0, bottom: 0, right: 0 }, viewport)).toBe(true);
  });

  it('fails once the trigger is entirely outside, on any side', () => {
    expect(anchorInView(box(-30, 100), viewport)).toBe(false);
    expect(anchorInView(box(801, 100), viewport)).toBe(false);
    expect(anchorInView(box(100, -30), viewport)).toBe(false);
    expect(anchorInView(box(100, 1001), viewport)).toBe(false);
  });
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

  it('keeps focus moves inside open, and closes when focus leaves with nothing else holding it', () => {
    render(<Harness />);
    // Pinned by a click: a focus move inside keeps it; one to another control closes it.
    fireEvent.click(trigger());
    const first = screen.getByRole('button', { name: 'First Info' });
    const after = screen.getByRole('button', { name: 'After Info' });
    fireEvent.blur(trigger(), { relatedTarget: first });
    expect(isOpen()).toBe(true);
    fireEvent.blur(first, { relatedTarget: after });
    expect(isOpen()).toBe(false);
    // Closed already: a blur changes nothing.
    fireEvent.blur(trigger(), { relatedTarget: null });
    expect(isOpen()).toBe(false);
    // Opened by focus, with the pointer elsewhere: focus going nowhere closes it.
    act(() => trigger().focus());
    expect(isOpen()).toBe(true);
    act(() => trigger().blur());
    expect(isOpen()).toBe(false);
  });

  it('forgets focus that was inside when its controls go, so hover alone decides next time', () => {
    vi.useFakeTimers();
    render(<Harness />);
    // A row takes focus, then closes the popover without returning focus (as choosing an issue
    // does): the row unmounts with no focusout.
    fireEvent.click(trigger());
    const second = screen.getByRole('button', { name: 'Second Info' });
    act(() => second.focus());
    act(() => closePopovers());
    expect(isOpen()).toBe(false);
    // Opened by hover now, it closes once the pointer leaves.
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY);
    });
    expect(isOpen()).toBe(true);
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY);
    });
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
    // Open first: without the popover API it moves to document.body as it opens.
    fireEvent.click(trigger());
    vi.spyOn(popover(), 'getBoundingClientRect').mockReturnValue(
      rect({ top: 0, left: 0, width: 300, height: 200 }),
    );
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
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
    // Its own list scrolling leaves it be; a scroll around it places it again.
    anchor.mockReturnValue(rect({ top: 300, left: 100, width: 24, height: 24 }));
    act(() => {
      popover().dispatchEvent(new Event('scroll'));
    });
    expect(popover().style.top).toBe('70px');
    act(() => {
      document.body.dispatchEvent(new Event('scroll'));
    });
    expect(popover().style.top).toBe('330px');
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

describe('Popover: what holds it open (#15 review)', () => {
  const button = (name: string) => screen.getByRole('button', { name });

  it('opened by hover, stays while focus is inside after the pointer leaves, then closes when both are gone', () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY);
    });
    expect(isOpen()).toBe(true);
    // Focus moves into its rows (Shift+Tab from the next control, say), then the pointer leaves.
    act(() => button('Second Info').focus());
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY * 5);
    });
    expect(isOpen()).toBe(true);
    expect(button('Second Info')).toHaveFocus();
    // Focus leaves too: nothing holds it any more.
    act(() => button('After Info').focus());
    expect(isOpen()).toBe(false);
  });

  it('opened by focus, stays while hovered after focus leaves, then closes when both are gone', () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => trigger().focus());
    expect(isOpen()).toBe(true);
    fireEvent.pointerEnter(popover(), { pointerType: 'mouse' });
    act(() => button('After Info').focus());
    expect(isOpen()).toBe(true);
    fireEvent.pointerLeave(popover(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY - 10);
    });
    expect(isOpen()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(isOpen()).toBe(false);
  });

  it('pinned by a click, stays when the pointer leaves or focus goes nowhere, and closes when focus moves on', () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    fireEvent.click(trigger());
    act(() => trigger().focus());
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY * 5);
    });
    expect(isOpen()).toBe(true);
    // Focus going nowhere (the window losing focus) keeps it; focus moving to a control closes it.
    fireEvent.blur(trigger(), { relatedTarget: null });
    expect(isOpen()).toBe(true);
    act(() => button('After Info').focus());
    expect(isOpen()).toBe(false);
  });

  it('the focus a click leaves on the trigger does not hold a hover-opened popover open', () => {
    vi.useFakeTimers();
    render(<Harness />);
    const press = () => {
      fireEvent.pointerDown(trigger());
      act(() => trigger().focus());
      fireEvent.pointerUp(trigger());
      fireEvent.click(trigger());
    };
    // A click pins it, a second click closes it; Chrome leaves focus on the clicked button.
    press();
    expect(isOpen()).toBe(true);
    press();
    expect(isOpen()).toBe(false);
    expect(trigger()).toHaveFocus();
    // Hovered again, it closes once the pointer leaves: that focus came from a press.
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY);
    });
    expect(isOpen()).toBe(true);
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY);
    });
    expect(isOpen()).toBe(false);
    // Focus the keyboard gives back after Esc does hold it.
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY);
    });
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    expect(isOpen()).toBe(false);
    act(() => button('After Info').focus());
    act(() => trigger().focus());
    expect(isOpen()).toBe(true);
    fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY * 5);
    });
    expect(isOpen()).toBe(true);
  });

  it('a press that never became a click does not stop the next keyboard focus opening it', () => {
    render(<Harness />);
    // A touch that turned into a scroll: cancelled.
    fireEvent.pointerDown(trigger(), { pointerType: 'touch' });
    fireEvent.pointerCancel(trigger(), { pointerType: 'touch' });
    act(() => trigger().focus());
    expect(isOpen()).toBe(true);
    act(() => button('After Info').focus());
    expect(isOpen()).toBe(false);
    // A mouse press released somewhere else, so no click.
    fireEvent.pointerDown(trigger());
    fireEvent.pointerUp(document.body);
    act(() => trigger().focus());
    expect(isOpen()).toBe(true);
    // During a press the focus it brings still opens nothing (the click decides).
    act(() => button('After Info').focus());
    fireEvent.pointerDown(trigger());
    act(() => trigger().focus());
    expect(isOpen()).toBe(false);
    fireEvent.pointerUp(trigger());
    fireEvent.click(trigger());
    expect(isOpen()).toBe(true);
  });

  it('closes when its trigger has left the viewport, and still clamps a partly visible one', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    const anchor = vi.spyOn(trigger(), 'getBoundingClientRect');
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(500);
    vi.spyOn(popover(), 'getBoundingClientRect').mockReturnValue(
      rect({ top: 0, left: 0, width: 300, height: 200 }),
    );
    // Partly visible after the window shrank: placed above, inside the viewport.
    anchor.mockReturnValue(rect({ top: 490, left: 100, width: 24, height: 24 }));
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(isOpen()).toBe(true);
    expect(popover().style.top).toBe(`${490 - 6 - 200}px`);
    // Entirely below the viewport: it closes rather than float somewhere else.
    anchor.mockReturnValue(rect({ top: 750, left: 100, width: 24, height: 24 }));
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(isOpen()).toBe(false);
  });

  it('without the popover API, opens in document.body, out of transformed ancestors, keeping the keyboard order', async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="scaled" style={{ transform: 'scale(2)' }}>
        <Harness />
      </div>,
    );
    act(() => button('Before Info').focus());
    await user.tab();
    expect(trigger()).toHaveFocus();
    expect(isOpen()).toBe(true);
    expect(popover().parentElement).toBe(document.body);
    expect(screen.getByTestId('scaled')).not.toContainElement(popover());
    // Tab from the trigger moves into the first row; Shift+Tab from it goes back to the trigger.
    await user.tab();
    expect(button('First Info')).toHaveFocus();
    await user.tab({ shift: true });
    expect(trigger()).toHaveFocus();
    expect(isOpen()).toBe(true);
    await user.tab();
    await user.tab();
    expect(button('Second Info')).toHaveFocus();
    // Tab past the last row closes it and carries on after the trigger.
    await user.tab();
    expect(button('After Info')).toHaveFocus();
    expect(isOpen()).toBe(false);
    // Closed, it is back beside its trigger, hidden, so aria-controls still resolves.
    expect(trigger().nextElementSibling).toBe(popover());
    expect(popover()).toHaveAttribute('hidden');
  });

  it('without the popover API, stays in place inside a modal dialog, which would make the page inert', () => {
    render(
      <dialog open>
        <Harness />
      </dialog>,
    );
    fireEvent.click(trigger());
    expect(isOpen()).toBe(true);
    expect(trigger().nextElementSibling).toBe(popover());
    expect(popover().closest('dialog')).not.toBeNull();
  });
});
