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
import { cn } from '../../lib/utils.js';

/** How the popover was opened, which decides what closes it. */
type OpenedBy = 'hover' | 'focus' | 'click';

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

/**
 * Whether this browser has the popover API (every current one does). Without it (an old browser,
 * or jsdom, whose default stylesheet hides every `[popover]` element) the popover is a plain
 * fixed-position element shown in place.
 */
function hasPopoverApi(): boolean {
  return typeof HTMLElement.prototype.showPopover === 'function';
}

/**
 * A tooltip-style popover that meets WCAG 1.4.13 (content on hover or focus): it opens on pointer
 * hover after a short delay, on keyboard focus of its trigger, and on click or tap; it stays open
 * while the pointer is over the trigger or the popover (so the pointer can move into it), and closes
 * shortly after the pointer has left both, on Esc (focus returns to the trigger when it was inside),
 * on a press outside, and when focus leaves both. Opened by focus or a click, it stays until one of
 * those happens; a second click on the trigger closes it.
 *
 * It renders in the top layer (the native `popover` attribute, shown with `showPopover()`), so no
 * panel, card, or dialog covers it and a scaled canvas does not scale it, and it sits right after
 * its trigger in the DOM, so Tab moves from the trigger into it and on out. It is placed from the
 * trigger's box: below or above (never over the trigger), shifted to stay inside the viewport, and
 * scrolling when taller than the room there. ArrowDown on the trigger moves into it; the arrow keys,
 * Home, and End move between its controls. A click inside it or on the trigger goes no further
 * (a canvas node must not open under it). It has no animation, so reduced motion needs nothing.
 */
export function Popover({ label, trigger, children, className }: PopoverProps) {
  const id = useId();
  const [openedBy, setOpenedBy] = useState<OpenedBy | undefined>();
  const open = openedBy !== undefined;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A pointer press on the trigger: the focus it brings opens nothing (the click decides). */
  const pressRef = useRef(false);
  /** Set while this component moves focus to the trigger itself, which opens nothing either. */
  const quietRef = useRef(false);
  /** Focus the popover's first control once it is shown (ArrowDown on the trigger). */
  const focusFirstRef = useRef(false);

  const clearTimer = () => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };

  const close = useCallback((options?: { returnFocus?: boolean }) => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    setOpenedBy(undefined);
    if (options?.returnFocus) {
      quietRef.current = true;
      triggerRef.current?.focus();
      quietRef.current = false;
    }
  }, []);

  const show = (by: OpenedBy) => {
    clearTimer();
    for (const other of [...openPopovers.keys()]) if (other !== close) other();
    setOpenedBy(by);
  };

  const place = useCallback(() => {
    const popover = popoverRef.current;
    const anchor = triggerRef.current;
    if (!popover || !anchor) return;
    popover.style.maxHeight = '';
    const placement = placePopover(
      anchor.getBoundingClientRect(),
      popover.getBoundingClientRect(),
      {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: window.innerHeight,
      },
    );
    popover.style.top = `${placement.top}px`;
    popover.style.left = `${placement.left}px`;
    popover.style.maxHeight = `${placement.maxHeight}px`;
    popover.dataset['side'] = placement.side;
  }, []);

  // Into the top layer when it opens, out when it closes or unmounts; `hidden` hides it while
  // closed either way.
  const native = hasPopoverApi();
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
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && wrapperRef.current?.contains(event.target)) return;
      close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Only the popover closes: not a dialog it sits in, and nothing on the canvas.
      event.preventDefault();
      event.stopPropagation();
      close({ returnFocus: Boolean(wrapperRef.current?.contains(document.activeElement)) });
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    openPopovers.set(close, () => triggerRef.current);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      openPopovers.delete(close);
    };
  }, [open, close, place]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    // Touch has no hover: a tap is a click.
    if (event.pointerType === 'touch') return;
    clearTimer();
    if (!open) timerRef.current = setTimeout(() => show('hover'), OPEN_DELAY);
  };

  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    clearTimer();
    if (openedBy === 'hover') timerRef.current = setTimeout(() => close(), CLOSE_DELAY);
  };

  const items = () => [...(popoverRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];

  const triggerProps: PopoverTriggerProps = {
    ref: triggerRef,
    'aria-expanded': open,
    'aria-controls': id,
    'aria-haspopup': 'dialog',
    onPointerDown: () => {
      pressRef.current = true;
    },
    onFocus: () => {
      const pressed = pressRef.current;
      pressRef.current = false;
      if (quietRef.current || pressed) return;
      if (openedBy === undefined || openedBy === 'hover') show('focus');
    },
    onClick: (event) => {
      event.stopPropagation();
      pressRef.current = false;
      if (openedBy === 'click') close();
      else show('click');
    },
    onKeyDown: (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      const first = items()[0];
      if (first) first.focus();
      else {
        focusFirstRef.current = true;
        show(openedBy === 'click' ? 'click' : 'focus');
      }
    },
    onPointerEnter,
    onPointerLeave,
  };

  const onPopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (event.key === 'ArrowDown') next = list[index + 1] ?? list[0];
    else if (event.key === 'ArrowUp') next = index <= 0 ? triggerRef.current! : list[index - 1];
    else if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list.at(-1);
    if (!next) return;
    event.preventDefault();
    if (next === triggerRef.current) quietRef.current = true;
    next.focus();
    quietRef.current = false;
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    // Hover keeps its own rule (the pointer leaving); otherwise focus leaving both closes it.
    if (!open || openedBy === 'hover') return;
    const next = event.relatedTarget;
    if (next instanceof Node && wrapperRef.current?.contains(next)) return;
    close();
  };

  return (
    <div ref={wrapperRef} className="contents" onBlur={onBlur}>
      {trigger(triggerProps)}
      <div
        ref={popoverRef}
        id={id}
        popover={native ? 'manual' : undefined}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        hidden={!open}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
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
    </div>
  );
}
