import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';
import { Button } from './button.js';

type PanelState = 'expanded' | 'collapsed';

/** The remembered state, or undefined when there is none, it is unknown, or storage throws. */
export function readPanelState(key: string): PanelState | undefined {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === 'expanded' || stored === 'collapsed' ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Remember the state in this browser. Returns false when storage refuses (the state still applies). */
export function writePanelState(key: string, state: PanelState): boolean {
  try {
    window.localStorage.setItem(key, state);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a side panel is expanded, remembered per browser under `storageKey` (every storage access
 * is guarded: private mode, blocked site data, or a throwing accessor fall back to the default).
 * `defaultExpanded` decides when nothing is stored, read once when the panel first renders.
 */
export function useSidePanelState(
  storageKey: string,
  defaultExpanded: () => boolean,
): readonly [boolean, (expanded: boolean) => void] {
  const [expanded, setExpanded] = useState(() => {
    const stored = readPanelState(storageKey);
    return stored ? stored === 'expanded' : defaultExpanded();
  });
  const set = useCallback(
    (next: boolean) => {
      setExpanded(next);
      writePanelState(storageKey, next ? 'expanded' : 'collapsed');
    },
    [storageKey],
  );
  return [expanded, set] as const;
}

/**
 * A panel beside the main content that collapses to a narrow rail. Expanded, it shows its heading,
 * a Hide button, and its content; collapsed, the rail keeps a Show button and whatever `rail` holds
 * (a short summary), so the panel never disappears without a trace. The panel keeps its `id` in
 * both states, so a control can name it in `aria-controls`. When it expands, focus moves to its
 * heading; when its own Hide button collapses it, focus moves to Show.
 */
export function SidePanel({
  id,
  title,
  side = 'right',
  expanded,
  onExpandedChange,
  rail,
  children,
  className,
  expandedWidth = 380,
}: {
  id: string;
  /** The heading; also the panel's accessible name. */
  title: string;
  /** Which edge the panel occupies. */
  side?: 'left' | 'right';
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Shown under the Show button while collapsed. */
  rail?: ReactNode;
  children: ReactNode;
  /** Expanded width in pixels; the collapsed rail always uses the primitive's narrow width. */
  expandedWidth?: number;
  className?: string;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const previousRef = useRef(expanded);
  const border = side === 'left' ? 'border-r' : 'border-l';

  useEffect(() => {
    if (previousRef.current === expanded) return;
    previousRef.current = expanded;
    if (expanded) headingRef.current?.focus();
    // Collapsed by its own Hide button, which is gone now: keep focus on the panel.
    else if (document.activeElement === document.body) showRef.current?.focus();
  }, [expanded]);

  if (!expanded) {
    return (
      <aside
        id={id}
        aria-label={title}
        className={cn(
          `flex w-11 shrink-0 flex-col items-center gap-2 ${border} border-default bg-surface-raised py-2`,
          className,
        )}
      >
        <Button
          ref={showRef}
          size="icon"
          variant="ghost"
          aria-label={`Show ${title.toLowerCase()}`}
          aria-expanded={false}
          aria-controls={id}
          title={`Show ${title.toLowerCase()}`}
          className={cn('min-h-11 min-w-11', side === 'left' ? 'self-start' : 'self-end')}
          onClick={() => onExpandedChange(true)}
        >
          <Icon name="panel" />
        </Button>
        {rail}
      </aside>
    );
  }
  return (
    <aside
      id={id}
      aria-labelledby={headingId}
      style={{ width: expandedWidth }}
      className={cn(`flex shrink-0 flex-col ${border} border-default bg-surface-raised`, className)}
    >
      <div
        className={cn(
          'flex h-[46px] shrink-0 items-center justify-between gap-2 border-b border-default',
          side === 'left' ? 'flex-row-reverse pl-2 pr-5' : 'pr-2 pl-5',
        )}
      >
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-md font-semibold focus:outline-none"
        >
          {title}
        </h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Hide ${title.toLowerCase()}`}
          aria-expanded={true}
          aria-controls={id}
          title={`Hide ${title.toLowerCase()}`}
          onClick={() => onExpandedChange(false)}
        >
          <Icon name="panel" />
        </Button>
      </div>
      {children}
    </aside>
  );
}
