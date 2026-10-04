import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils.js';

/** Pointer hover opens the popover after this long (ms), so a pointer passing over opens nothing. */
export const OPEN_DELAY = 150;
/** It closes this long (ms) after the pointer has left both the trigger and the popover. */
export const CLOSE_DELAY = 200;
/** Space between the trigger and the popover, and between the popover and the viewport edge (px). */
const GAP = 6;
const MARGIN = 8;

/** The open popovers: each one's close function and trigger. Opening one closes the others. */
const openPopovers = new Map<() => void, () => HTMLElement | null>();

/**
 * Close the open popovers whose trigger is inside `scope`, or every open popover without one. The
 * editor calls it with the canvas when the canvas pans or zooms and when a node starts to drag,
 * since a popover is placed from its trigger and would otherwise float away from it.
 */
export function closePopovers(scope?: Node | null): void {
  for (const [close, trigger] of [...openPopovers]) {
    const element = trigger();
    if (!scope || (element && scope.contains(element))) close();
  }
}

export interface Placement {
  top: number;
  left: number;
  /** The room on the chosen side; a taller popover scrolls. */
  maxHeight: number;
  side: 'below' | 'above';
}

/**
 * Where a popover of `size` goes for a trigger at `anchor`, inside a viewport of `viewport`: below
 * the trigger when it fits there (or when below has more room than above), otherwise above it, and
 * never over it; aligned with the trigger's left edge, shifted to stay inside the viewport.
 */
export function placePopover(
  anchor: { top: number; bottom: number; left: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): Placement {
  const below = viewport.height - MARGIN - (anchor.bottom + GAP);
  const above = anchor.top - GAP - MARGIN;
  const side = size.height <= below || below >= above ? 'below' : 'above';
  const room = Math.max(0, side === 'below' ? below : above);
  const height = Math.min(size.height, room);
  const width = Math.min(size.width, viewport.width - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - MARGIN - width));
  const top = side === 'below' ? anchor.bottom + GAP : anchor.top - GAP - height;
  return { top, left, maxHeight: room, side };
}

/**
 * Whether any of the trigger's box is inside the viewport. A popover whose trigger is entirely
 * outside (the window shrank, say) closes rather than float where nothing explains it.
 */
export function anchorInView(
  anchor: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
): boolean {
  return (
    anchor.bottom >= 0 &&
    anchor.top <= viewport.height &&
    anchor.right >= 0 &&
    anchor.left <= viewport.width
  );
}

/** What the trigger needs: spread these onto a `<button type="button">`, with its own name. */
export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  'aria-expanded': boolean;
  'aria-controls': string;
  'aria-haspopup': 'dialog';
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onPointerDown: () => void;
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
}

export interface PopoverControls {
  /** Close the popover; with `returnFocus`, focus goes back to the trigger. */
  close: (options?: { returnFocus?: boolean }) => void;
}

export interface PopoverProps {
  /** The popover's accessible name (it is a non-modal dialog). */
  label: string;
  /** Renders the trigger button from the props it must carry. */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** The content; a function receives `close`, for actions that close the popover. */
  children: ReactNode | ((controls: PopoverControls) => ReactNode);
  /** Classes for the popover element (its width, or classes a host such as the canvas reads). */
  className?: string;
}

const ITEMS = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The control Tab reaches after `from` in document order, leaving out anything inside `skip`. */
function nextTabbable(from: HTMLElement, skip: Element | null): HTMLElement | undefined {
  const order = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert]') && !skip?.contains(el),
  );
  const index = order.indexOf(from);
  return index < 0 ? undefined : order[index + 1];
}

/** Whether this browser has the popover API (every current one does; jsdom does not). */
function hasPopoverApi(): boolean {
  return typeof HTMLElement.prototype.showPopover === 'function';
}

function viewportSize(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * A tooltip-style popover that meets WCAG 1.4.13 (content on hover or focus).
 *
 * - **Opening.** Pointer hover opens it after a short delay, keyboard focus of the trigger opens it
 *   at once, and a click or tap pins it open (a click on a popover that hover or focus opened pins
 *   it; a click on a pinned one closes it). The focus a pointer press brings opens nothing by
 *   itself: the click decides; a press that ends without a click (a cancelled touch that became a
 *   scroll, a release elsewhere) leaves keyboard focus working as usual.
 * - **Staying open.** Hover (the pointer over the trigger or the popover, so the pointer can move
 *   into it) and focus inside either one are tracked separately, and it stays open while either
 *   holds: it closes shortly after the pointer has left both while focus is elsewhere, or when focus
 *   leaves both while the pointer is elsewhere. A pinned popover ignores both and closes when focus
 *   moves on to another control.
 * - **Closing.** Esc (focus returns to the trigger when it was inside; a dialog around it stays
 *   open), a press outside, a second click on the trigger, opening another popover,
 *   `closePopovers()`, or its trigger leaving the viewport.
 * - **Rendering.** In the top layer (the native `popover` attribute, shown with `showPopover()`),
 *   so no panel, card, or dialog covers it and a scaled canvas does not scale it, right after its
 *   trigger in the DOM, so Tab moves from the trigger into it and on out. Without the popover API it
 *   is a fixed-position element portalled to `document.body` while open (out of any transformed
 *   ancestor, such as a zoomed canvas node), with the same keyboard order kept by hand: Tab from the
 *   trigger moves into the first control, Shift+Tab from the first control returns to the trigger,
 *   Tab past the last control moves on to what follows the trigger (focus leaving then decides as
 *   ever: a pinned popover closes, a hovered one stays), and Shift+Tab from there returns to the
 *   last control. Inside a modal dialog, which makes the rest of the page inert, it stays in place.
 * - **Placement** from the trigger's box: below or above (never over the trigger), shifted to stay
 *   inside the viewport, and scrolling when taller than the room there; again on resize, on a scroll
 *   around it, and after every render.
 * - **Keys and clicks.** ArrowDown on the trigger moves into it; the arrow keys, Home, and End move
 *   between its controls. A click inside it or on the trigger goes no further (a canvas node must
 *   not open under it). It has no animation, so reduced motion needs nothing.
 */
export function Popover({ label, trigger, children, className }: PopoverProps) {
  const id = useId();
  const native = hasPopoverApi();
  const [open, setOpen] = useState(false);
  /** Pinned by a click: hover and focus no longer decide when it closes. */
  const [pinned, setPinned] = useState(false);
  /** Without the popover API: where it renders while open (`null`: in place, inside a dialog). */
  const [portal, setPortal] = useState<Element | null>(null);
  const liveRef = useRef({ open, pinned });
  liveRef.current = { open, pinned };
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Where the pointer is: over the trigger, over the popover (mouse and pen only). */
  const hoverRef = useRef({ trigger: false, popover: false });
  /** Whether focus is on the trigger (not from a pointer press) or inside the popover. */
  const focusWithinRef = useRef(false);
  /** Whether the trigger's focus came from a pointer press on it. */
  const pointerFocusRef = useRef(false);
  /** A pointer press on the trigger is under way: the focus it brings opens nothing. */
  const pressRef = useRef(false);
  /** Set while this component moves focus to the trigger itself, which opens nothing either. */
  const quietRef = useRef(false);
  /** Focus the popover's first control once it is shown (ArrowDown on the trigger). */
  const focusFirstRef = useRef(false);
  const portalled = open && !native && portal !== null;

  const clearTimer = () => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };

  /** Whether `node` is the trigger, the popover, or inside either (the popover may be portalled). */
  const inside = (node: unknown): boolean =>
    node instanceof Node &&
    Boolean(wrapperRef.current?.contains(node) || popoverRef.current?.contains(node));

  const focusTriggerQuietly = () => {
    quietRef.current = true;
    triggerRef.current?.focus();
    quietRef.current = false;
  };

  const close = useCallback((options?: { returnFocus?: boolean }) => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    // The popover is gone from under the pointer, whatever pointerleave would have said.
    hoverRef.current.popover = false;
    setOpen(false);
    setPinned(false);
    if (options?.returnFocus) {
      quietRef.current = true;
      triggerRef.current?.focus();
      quietRef.current = false;
    }
    // Its controls unmount without a focusout: focus stays within only if it is on the trigger,
    // and only if a pointer press did not put it there.
    focusWithinRef.current =
      document.activeElement === triggerRef.current && !pointerFocusRef.current;
  }, []);

  const show = (pin: boolean) => {
    clearTimer();
    for (const other of [...openPopovers.keys()]) if (other !== close) other();
    if (!native) setPortal(triggerRef.current?.closest('dialog') ? null : document.body);
    setOpen(true);
    if (pin) setPinned(true);
  };

  /** Close unless something still holds it open: a pin, the pointer over it, or focus inside. */
  const dismissIfIdle = () => {
    const hover = hoverRef.current;
    if (!liveRef.current.open || liveRef.current.pinned) return;
    if (hover.trigger || hover.popover || focusWithinRef.current) return;
    close();
  };

  const place = useCallback(() => {
    const popover = popoverRef.current;
    const anchor = triggerRef.current;
    if (!popover || !anchor) return;
    const viewport = viewportSize();
    const box = anchor.getBoundingClientRect();
    if (!anchorInView(box, viewport)) {
      close();
      return;
    }
    // Measured at its natural height; the scroll position survives the measurement.
    const { scrollTop } = popover;
    popover.style.maxHeight = '';
    const placement = placePopover(box, popover.getBoundingClientRect(), viewport);
    popover.style.top = `${placement.top}px`;
    popover.style.left = `${placement.left}px`;
    popover.style.maxHeight = `${placement.maxHeight}px`;
    popover.scrollTop = scrollTop;
    popover.dataset['side'] = placement.side;
  }, [close]);

  // Into the top layer when it opens, out when it closes or unmounts; `hidden` hides it while
  // closed either way.
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!open || !popover || !native) return;
    popover.showPopover();
    return () => {
      if (popover.isConnected) popover.hidePopover();
    };
  }, [open, native]);

  // Placed after every render while open, since its content (and so its height) may change.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    if (focusFirstRef.current) {
      focusFirstRef.current = false;
      popoverRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
    }
  });

  // While open: Esc and a press outside close it, a resize or scroll places it again, and opening
  // another popover closes this one.
  useEffect(() => {
    if (!open) return;
    const isInside = (node: unknown) =>
      node instanceof Node &&
      Boolean(wrapperRef.current?.contains(node) || popoverRef.current?.contains(node));
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!isInside(event.target)) close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Only the popover closes: not a dialog it sits in, and nothing on the canvas.
      event.preventDefault();
      event.stopPropagation();
      close({ returnFocus: isInside(document.activeElement) });
    };
    // Something around it scrolled (not its own list): follow the trigger.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      place();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    openPopovers.set(close, () => triggerRef.current);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      openPopovers.delete(close);
    };
  }, [open, close, place]);

  // Portalled away from the trigger, Shift+Tab from the control after the trigger reaches the last
  // row, as it does when the popover sits right after the trigger.
  useEffect(() => {
    if (!portalled) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab' || !event.shiftKey || event.defaultPrevented) return;
      const anchor = triggerRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover || document.activeElement !== nextTabbable(anchor, popover)) return;
      const last = [...popover.querySelectorAll<HTMLElement>(ITEMS)].at(-1);
      if (!last) return;
      event.preventDefault();
      last.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [portalled]);

  /**
   * The end of a pointer press, with or without a click: keyboard focus opens it again. One stable
   * listener per popover, so unmounting during a press can remove it.
   */
  const [endPress] = useState(() => {
    const end = () => {
      pressRef.current = false;
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
    };
    return end;
  });

  // Unmounting: no timer may fire, and no press listener may outlive the popover.
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      document.removeEventListener('pointerup', endPress, true);
      document.removeEventListener('pointercancel', endPress, true);
    },
    [endPress],
  );

  const onPointerEnter = (part: 'trigger' | 'popover') => (event: PointerEvent<HTMLElement>) => {
    // Touch has no hover: a tap is a click.
    if (event.pointerType === 'touch') return;
    hoverRef.current[part] = true;
    clearTimer();
    if (!liveRef.current.open && part === 'trigger')
      timerRef.current = setTimeout(() => show(false), OPEN_DELAY);
  };

  const onPointerLeave = (part: 'trigger' | 'popover') => (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    hoverRef.current[part] = false;
    clearTimer();
    if (liveRef.current.open) timerRef.current = setTimeout(dismissIfIdle, CLOSE_DELAY);
  };

  const items = () => [...(popoverRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];

  const triggerProps: PopoverTriggerProps = {
    ref: triggerRef,
    'aria-expanded': open,
    'aria-controls': id,
    'aria-haspopup': 'dialog',
    onPointerDown: () => {
      pressRef.current = true;
      document.addEventListener('pointerup', endPress, true);
      document.addEventListener('pointercancel', endPress, true);
    },
    onFocus: () => {
      if (quietRef.current || pressRef.current) return;
      if (!liveRef.current.open) show(false);
    },
    onClick: (event) => {
      event.stopPropagation();
      if (liveRef.current.open && liveRef.current.pinned) close();
      else show(true);
    },
    onKeyDown: (event) => {
      const first = items()[0];
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (first) first.focus();
        else if (!liveRef.current.open) {
          focusFirstRef.current = true;
          show(false);
        }
      } else if (event.key === 'Tab' && !event.shiftKey && portalled && first) {
        // Portalled away from the trigger: Tab still moves into it.
        event.preventDefault();
        first.focus();
      }
    },
    onPointerEnter: onPointerEnter('trigger'),
    onPointerLeave: onPointerLeave('trigger'),
  };

  const onPopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Tab' && portalled) {
      if (event.shiftKey && index <= 0) {
        // Back from the first control (or the popover itself) to the trigger.
        event.preventDefault();
        focusTriggerQuietly();
      } else if (!event.shiftKey && index === list.length - 1) {
        // Past the last control: on to what follows the trigger. Focus leaving then decides as it
        // always does (onFocusOut): a pinned popover closes, a hovered one stays.
        event.preventDefault();
        const after = triggerRef.current
          ? nextTabbable(triggerRef.current, popoverRef.current)
          : undefined;
        if (after) after.focus();
        else focusTriggerQuietly();
      }
      return;
    }
    let next: HTMLElement | undefined;
    if (event.key === 'ArrowDown') next = list[index + 1] ?? list[0];
    else if (event.key === 'ArrowUp') next = index <= 0 ? triggerRef.current! : list[index - 1];
    else if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list.at(-1);
    if (!next) return;
    event.preventDefault();
    if (next === triggerRef.current) focusTriggerQuietly();
    else next.focus();
  };

  const onFocusIn = (event: FocusEvent<HTMLDivElement>) => {
    // The focus a press on the trigger brings (Chrome focuses a clicked button) does not hold a
    // popover open: the pointer does that. Keyboard focus, and focus inside the popover, do.
    const pressed = pressRef.current && (event.target as Node) === triggerRef.current;
    pointerFocusRef.current = pressed;
    focusWithinRef.current = !pressed;
  };

  const onFocusOut = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (inside(next)) return;
    focusWithinRef.current = false;
    if (!liveRef.current.open) return;
    // Pinned: focus moving on to another control closes it; focus going nowhere (the window losing
    // focus) does not. Otherwise it closes unless the pointer still holds it.
    if (liveRef.current.pinned) {
      if (next) close();
    } else dismissIfIdle();
  };

  const popover = (
    <div
      ref={popoverRef}
      id={id}
      popover={native ? 'manual' : undefined}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      hidden={!open}
      onPointerEnter={onPointerEnter('popover')}
      onPointerLeave={onPointerLeave('popover')}
      onKeyDown={onPopoverKeyDown}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        // The UA centres a popover in the viewport; it is placed from its trigger instead. The
        // z-index matters only without the popover API (no top layer).
        'fixed inset-auto z-50 m-0 w-max max-w-[min(24rem,calc(100vw-1rem))] overflow-auto',
        'rounded-lg border border-default bg-surface-overlay p-2 text-left text-sm font-regular whitespace-normal text-default shadow-3',
        'cursor-default select-text focus:outline-none',
        className,
      )}
    >
      {open ? (typeof children === 'function' ? children({ close }) : children) : null}
    </div>
  );

  // React passes focus events from a portalled popover up to this wrapper, as if it were inside.
  return (
    <div ref={wrapperRef} className="contents" onFocus={onFocusIn} onBlur={onFocusOut}>
      {trigger(triggerProps)}
      {portalled ? createPortal(popover, portal) : popover}
    </div>
  );
}
