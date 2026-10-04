import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { cn } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';
import { Button } from './button.js';

/**
 * Why a dialog asks to close: Esc, a click on the backdrop, or its close button. `dismissed` means
 * the browser has already closed it (it closes a modal dialog on a repeated Esc without asking), so
 * the owner must close it too.
 */
export type DialogCloseReason = 'escape' | 'backdrop' | 'button' | 'dismissed';

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The controls Tab visits inside `root`, in document (visual) order. */
function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert]'),
  );
}

/** Whether a pointer event happened outside the dialog's box, that is on its backdrop. */
function onBackdrop(dialog: HTMLDialogElement, event: MouseEvent): boolean {
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

export interface DialogProps {
  open: boolean;
  /**
   * Asked to close. The owner decides: it closes the dialog by setting `open` to false, or keeps it
   * open (for example to show why it cannot close yet), except for `dismissed`.
   */
  onClose: (reason: DialogCloseReason) => void;
  /** The heading; it names the dialog. */
  title: ReactNode;
  /** A line under the title; it describes the dialog. */
  description?: ReactNode;
  /** Shown before the title, for example a node kind's chip. */
  icon?: ReactNode;
  /** Actions pinned under the scrolling body. */
  footer?: ReactNode;
  children: ReactNode;
  /** The close button's accessible name. */
  closeLabel?: string;
  /** Close on a click on the backdrop. Leave it on only where closing never loses input. */
  closeOnBackdrop?: boolean;
  /**
   * Where focus goes when the dialog closes: an opener that may be re-rendered or renamed (a canvas
   * node) is better found again here. Without it, or when it finds nothing on the page, focus goes
   * back to the element that had it when the dialog opened.
   */
  returnFocus?: () => HTMLElement | null | undefined;
  className?: string;
}

/**
 * A modal dialog on the native `<dialog>` element, opened with `showModal()`: the browser puts it
 * in the top layer, makes the rest of the page inert, and closes it on Esc. Here Esc, a backdrop
 * click, and the close button only ask (`onClose`), so the owner controls `open`. It is named by
 * its title, takes focus on its heading when it opens (so a key that opened it never activates a
 * control inside), keeps Tab and Shift+Tab inside it, and returns focus when it closes or unmounts.
 * Below 768 px it is a full-width sheet along the bottom edge.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  footer,
  children,
  closeLabel = 'Close',
  closeOnBackdrop = true,
  returnFocus,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const latestRef = useRef({ onClose, returnFocus, open });
  latestRef.current = { onClose, returnFocus, open };
  /**
   * Closes this component made itself whose `close` event has not arrived yet. Browsers deliver
   * `close` as a queued task, after the code that closed the dialog has finished (Strict Mode
   * closes and reopens it while mounting), so those events are matched here and ignored rather
   * than taken for a dismissal by the browser.
   */
  const ownClosesRef = useRef(0);
  /** Whether the current press started on the backdrop (a drag out of a field must not close). */
  const pressedBackdropRef = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    headingRef.current?.focus();
    return () => {
      if (dialog.open) {
        ownClosesRef.current += 1;
        dialog.close();
      }
      const preferred = latestRef.current.returnFocus?.();
      const target = preferred?.isConnected ? preferred : opener;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [open]);

  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // A cancel the browser lets us refuse: ask the owner. Otherwise the close event follows.
    if (!event.nativeEvent.cancelable) return;
    event.preventDefault();
    latestRef.current.onClose('escape');
  };

  const onNativeClose = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (ownClosesRef.current > 0) {
      ownClosesRef.current -= 1;
      return;
    }
    // Reopened since that close was queued: it no longer describes the dialog.
    if (event.currentTarget.open) return;
    if (latestRef.current.open) latestRef.current.onClose('dismissed');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const items = tabbables(event.currentTarget);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === headingRef.current)) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && active === last) {
      first.focus();
      event.preventDefault();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      onCancel={onCancel}
      onClose={onNativeClose}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        pressedBackdropRef.current = onBackdrop(event.currentTarget, event);
      }}
      onClick={(event) => {
        const started = pressedBackdropRef.current;
        pressedBackdropRef.current = false;
        if (closeOnBackdrop && started && onBackdrop(event.currentTarget, event))
          latestRef.current.onClose('backdrop');
      }}
      className={cn(
        // Centred in the top layer (Tailwind's preflight resets the browser's margin: auto).
        'm-auto max-h-[calc(100dvh-4rem)] w-[min(40rem,calc(100vw-2rem))] max-w-none p-0',
        'overflow-hidden rounded-lg border border-default bg-surface-raised text-default shadow-3',
        'backdrop:bg-scrim open:flex open:flex-col',
        // Below 768 px: a full-width sheet along the bottom edge.
        'max-md:mb-0 max-md:max-h-[92dvh] max-md:w-full max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0',
        className,
      )}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-default py-3.5 pr-3 pl-5">
        {icon}
        <div className="grid min-w-0 flex-1 gap-0.5 pt-0.5">
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className="text-lg leading-tight font-semibold wrap-anywhere focus:outline-none"
          >
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-sm text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label={closeLabel}
          onClick={() => latestRef.current.onClose('button')}
        >
          <Icon name="close" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      {footer ? (
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-default px-5 py-3">
          {footer}
        </footer>
      ) : null}
    </dialog>
  );
}
