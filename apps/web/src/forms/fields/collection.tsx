import { useEffect, useRef, useState } from 'react';

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
          : ref.current
              ?.querySelector(`:scope > [data-collection-row="${action.row}"]`)
              ?.querySelector<HTMLElement>(
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
