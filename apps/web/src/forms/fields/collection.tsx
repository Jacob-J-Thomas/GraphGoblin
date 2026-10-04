import { useEffect, useRef, useState } from 'react';

/** Focus only after the new controls have mounted, and keep repeated actions announceable. */
export function useCollectionFocus() {
  const ref = useRef<HTMLFieldSetElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [action, setAction] = useState<{ message: string; row?: number; sequence: number }>();
  useEffect(() => {
    if (!action) return;
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
  }, [action]);
  return {
    ref,
    addRef,
    announce: (message: string, row?: number) =>
      setAction((previous) => ({
        message,
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
