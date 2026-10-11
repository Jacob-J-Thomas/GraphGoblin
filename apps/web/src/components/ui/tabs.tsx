import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

export const TAB_PANEL_SELECTOR = '[data-tab-panel]';
const REVEAL = 'graphgoblin:reveal-tab';

/** Horizontal, automatically activated tabs. Panels stay mounted, including held editor text. */
export function Tabs({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: readonly { id: string; label: ReactNode; content: ReactNode }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  useEffect(() => {
    const root = rootRef.current!;
    const reveal = (event: Event) => {
      const target = event.target as HTMLElement;
      const key = target.dataset['tabPanel'];
      if (key === undefined) return;
      // Reveal synchronously, like Disclosure, so issue/history focus works in the same task.
      for (const panel of root.querySelectorAll<HTMLElement>(TAB_PANEL_SELECTOR))
        panel.hidden = panel !== target;
      for (const tab of root.querySelectorAll<HTMLElement>('[role="tab"]')) {
        const active = tab.getAttribute('aria-controls') === target.id;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      }
      selectRef.current(key);
    };
    root.addEventListener(REVEAL, reveal);
    return () => root.removeEventListener(REVEAL, reveal);
  }, []);
  return (
    <div ref={rootRef} className="grid min-w-0 gap-field">
      {items.length > 1 ? (
        <div
          role="tablist"
          aria-label={label}
          className="flex min-w-0 gap-2 border-b border-default"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              id={`${id}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected === item.id}
              aria-controls={`${id}-panel-${item.id}`}
              tabIndex={selected === item.id ? 0 : -1}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : event.key === 'ArrowRight'
                        ? (index + 1) % items.length
                        : event.key === 'ArrowLeft'
                          ? (index + items.length - 1) % items.length
                          : undefined;
                if (next === undefined) return;
                event.preventDefault();
                onSelect(items[next]!.id);
                rootRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
              }}
              className={cn(
                'flex min-w-0 cursor-pointer flex-wrap items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-sm font-semibold pointer-coarse:min-h-11',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                selected === item.id
                  ? 'border-accent-strong text-default'
                  : 'border-transparent text-muted hover:bg-surface-hover',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {items.map((item) => (
        <div
          key={item.id}
          id={`${id}-panel-${item.id}`}
          role={items.length > 1 ? 'tabpanel' : undefined}
          aria-labelledby={items.length > 1 ? `${id}-tab-${item.id}` : undefined}
          data-tab-panel={item.id}
          hidden={selected !== item.id}
          className="grid min-w-0 gap-field"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

/** Select the panel holding a field before disclosures and focus are restored. */
export function revealTabs(element: Element): void {
  const panel = element.closest(TAB_PANEL_SELECTOR);
  if (panel?.hasAttribute('hidden')) panel.dispatchEvent(new Event(REVEAL, { bubbles: true }));
}
