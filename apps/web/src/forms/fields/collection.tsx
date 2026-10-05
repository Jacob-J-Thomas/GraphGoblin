import { useEffect, useRef, useState } from 'react';
import { DISCLOSURE_PANEL_SELECTOR } from '../../components/ui/index.js';

/**
 * Where a row's first control is found: the row, or the panel of a collapsible row (its header's
 * toggle is not where an added item is filled in).
 */
function rowScope(collection: HTMLElement | null, row: number): Element | null | undefined {
  const element = collection?.querySelector(`:scope > [data-collection-row="${row}"]`);
  return element?.querySelector(DISCLOSURE_PANEL_SELECTOR) ?? element;
}

/** Focus only after the new controls have mounted, and keep repeated actions announceable. */
export function useCollectionFocus() {
  const ref = useRef<HTMLFieldSetElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [action, setAction] = useState<{
    message: string;
    row?: number;
    sequence: number;
    focus: boolean;
  }>();
  useEffect(() => {
    if (!action?.focus) return;
    const focus = () => {
      const target =
        action.row === undefined
          ? addRef.current?.disabled
            ? ref.current
            : addRef.current
          : rowScope(ref.current, action.row)?.querySelector<HTMLElement>(
              'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"], button:not(:disabled)',
            );
      (target ?? ref.current)?.focus();
    };
    // Removal moves focus immediately to a safe control. Added CodeMirror views may be recreated
    // by StrictMode; wait until their mount effects have finished before finding the control.
    if (action.row === undefined) return focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [action]);
  return {
    ref,
    addRef,
    announce: (message: string, row?: number, focus = true) =>
      setAction((previous) => ({
        message,
        focus,
        ...(row === undefined ? {} : { row }),
        sequence: (previous?.sequence ?? 0) + 1,
      })),
    status: (
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {action ? <span key={action.sequence}>{action.message}</span> : null}
      </span>
    ),
  };
}
