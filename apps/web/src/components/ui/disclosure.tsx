import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';

/** Marks a disclosure's panel (`data-disclosure-panel`); `revealDisclosures` looks for it. */
const PANEL = 'data-disclosure-panel';
/** Sent to a collapsed panel to open it at once (see `revealDisclosures`). */
const REVEAL = 'graphgoblin:reveal';

export interface DisclosureProps {
  /** The toggle's text: what the panel holds. It names the toggle, with `summary`. */
  label: ReactNode;
  /** Shown after the label inside the toggle: what the panel holds, such as "2 set". */
  summary?: ReactNode;
  /** Controls after the toggle in the header, such as a list item's Remove button. */
  actions?: ReactNode;
  /** Whether the panel starts open; afterwards the toggle decides. */
  defaultOpen?: boolean;
  /**
   * `box`: a bordered section whose full-width header is the toggle (a form's Advanced options).
   * `row`: a compact header for one item of a list, its panel below.
   */
  variant?: 'box' | 'row';
  className?: string;
  children: ReactNode;
}

/**
 * A button that shows and hides a panel (the WAI-ARIA disclosure pattern): `aria-expanded` says
 * whether the panel is shown and `aria-controls` names it; Enter and Space toggle it, as on any
 * button, and it shows the focus ring. The chevron turns with `aria-expanded`.
 *
 * The panel stays mounted while it is hidden (`hidden`), so the fields inside keep their state and
 * their validation, and `revealDisclosures` can open it from outside, at once, to focus a field in
 * it. The open state is the component's own: it starts from `defaultOpen` on every mount.
 */
export function Disclosure({
  label,
  summary,
  actions,
  defaultOpen = false,
  variant = 'box',
  className,
  children,
}: DisclosureProps) {
  const id = useId();
  const panelId = `${id}-panel`;
  const [open, setOpen] = useState(defaultOpen);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const reveal = () => {
      // Shown in this task, so the caller can focus inside it now; React's state follows.
      panel.hidden = false;
      toggleRef.current?.setAttribute('aria-expanded', 'true');
      setOpen(true);
    };
    panel.addEventListener(REVEAL, reveal);
    return () => panel.removeEventListener(REVEAL, reveal);
  }, []);
  const box = variant === 'box';
  const toggle = (
    <button
      ref={toggleRef}
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => setOpen((current) => !current)}
      className={cn(
        'group/disclosure flex min-w-0 cursor-pointer items-center gap-2 text-left text-default',
        'rounded-md transition-colors hover:bg-surface-hover pointer-coarse:min-h-11',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        box ? 'w-full px-4 py-2.5 text-sm font-semibold' : 'flex-1 px-1.5 py-1 text-sm',
      )}
    >
      <Icon
        name="chevron"
        className={cn(
          'size-4 shrink-0 -rotate-90 text-muted transition-transform',
          'group-aria-expanded/disclosure:rotate-0',
        )}
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0">{label}</span>
        {/* Spaces keep the label and the summary apart in the toggle's accessible name. */}
        {summary === undefined ? null : <> {summary}</>}
      </span>
    </button>
  );
  return (
    <div
      className={cn(
        box ? 'grid min-w-0 rounded-md border border-default' : 'grid min-w-0',
        className,
      )}
    >
      {actions ? (
        <div className="flex min-w-0 items-center gap-2">
          {toggle}
          {actions}
        </div>
      ) : (
        toggle
      )}
      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        data-disclosure-panel=""
        className={cn(
          'min-w-0',
          box ? 'grid gap-field border-t border-default px-4 pt-3 pb-4' : 'grid gap-3 pt-2 pl-1.5',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Open every collapsed disclosure around `element` at once, innermost first, so the element can
 * take focus in the same task: following an issue to a field under a collapsed Advanced group or
 * list item (`editor/focus-field.ts`). Elements outside any disclosure are left alone.
 */
export function revealDisclosures(element: Element): void {
  for (
    let panel = element.closest(`[${PANEL}]`);
    panel;
    panel = panel.parentElement?.closest(`[${PANEL}]`) ?? null
  ) {
    if (panel.hasAttribute('hidden')) panel.dispatchEvent(new Event(REVEAL));
  }
}

/** The CSS selector of a disclosure's panel, for code that looks inside one. */
export const DISCLOSURE_PANEL_SELECTOR = `[${PANEL}]`;
