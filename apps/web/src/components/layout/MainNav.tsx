import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { NavLink } from 'react-router';
import { cn } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';

export interface NavItem {
  to: string;
  label: string;
  /**
   * Something on that screen needs the user (for example "1 waiting for input"): a magenta dot
   * beside the label, and the text for screen readers. Nothing sets it yet; the data hook is a
   * follow-up.
   */
  attention?: string | undefined;
}

/**
 * The main navigation on the header. The current page gets a green underline directly under its
 * label. Below 640 px the links fold into a Menu button and a full-width panel, a disclosure that
 * Escape closes (from the button or from inside the panel), returning focus to the button.
 */
export function MainNav({ items }: { items: readonly NavItem[] }) {
  const [open, setOpen] = useState(false);
  const navId = useId();
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    setOpen(false);
    (menuRef.current as HTMLButtonElement).focus();
  };
  return (
    <>
      <button
        ref={menuRef}
        type="button"
        aria-expanded={open}
        aria-controls={navId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={closeOnEscape}
        className={cn(
          'ml-auto inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-inverse px-3',
          'font-medium text-inverse focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-focus sm:hidden',
        )}
      >
        <Icon name={open ? 'close' : 'menu'} />
        Menu
      </button>
      <nav
        id={navId}
        aria-label="Main"
        onKeyDown={closeOnEscape}
        className={cn(
          'flex gap-1 sm:static sm:flex sm:flex-row sm:items-stretch sm:self-stretch',
          'max-sm:absolute max-sm:inset-x-0 max-sm:top-14 max-sm:z-10 max-sm:flex-col',
          'max-sm:border-t max-sm:border-inverse max-sm:bg-surface-inverse max-sm:px-3',
          'max-sm:pt-2 max-sm:pb-4 max-sm:shadow-3',
          open ? 'max-sm:flex' : 'max-sm:hidden',
        )}
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={cn(
              'group relative inline-flex items-center gap-2 px-3.5 font-medium text-inverse-muted',
              'no-underline transition-colors hover:text-inverse',
              'aria-[current=page]:font-semibold aria-[current=page]:text-inverse',
              'focus-visible:rounded-md focus-visible:-outline-offset-[6px]',
              'max-sm:h-12 max-sm:rounded-md max-sm:pr-4 max-sm:pl-5 max-sm:text-lg',
              'max-sm:aria-[current=page]:bg-surface-inverse-raised',
            )}
          >
            <span
              className={cn(
                'relative after:absolute after:inset-x-0 after:-bottom-[5px] after:h-[3px]',
                'after:rounded-full after:transition-colors',
                'group-aria-[current=page]:after:bg-accent group-aria-[current=page]:after:glow-accent',
              )}
            >
              {item.label}
            </span>
            {item.attention ? (
              <>
                <span
                  aria-hidden="true"
                  data-testid="nav-attention"
                  className="glow-highlight size-[7px] rounded-full bg-accent-highlight sm:absolute sm:top-[15px] sm:right-[5px] max-sm:ml-auto"
                />
                <span className="sr-only">, {item.attention}</span>
              </>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
