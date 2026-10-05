import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A raised panel: an optional head (title and actions on a band over a hairline) and a padded body.
 * The head's band (`--surface-head`) and title colour (`--text-heading`) are the light theme's
 * tinted surfaces and dark-brown accents (#11); in dark they match the card. `flush` drops the body
 * padding for content that brings its own, such as a table, and lets that content scroll sideways
 * when it is wider than the card (narrow windows, 200% zoom), with a shadow on the edge that has
 * more (`scroll-shadow-x`).
 */
export function Card({
  id,
  title,
  actions,
  flush = false,
  className,
  children,
}: {
  /** The section's id, for a link to it (Settings → Secrets, say). */
  id?: string;
  title?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      id={id}
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        'min-w-0 rounded-lg border border-default bg-surface-raised shadow-1',
        flush && 'overflow-hidden',
        className,
      )}
    >
      {title || actions ? (
        <header className="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-t-[inherit] border-b border-default bg-surface-head px-5 py-3">
          {title ? (
            <h2 id={titleId} className="flex items-center gap-2 text-md font-semibold text-heading">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? 'scroll-shadow-x overflow-x-auto' : 'p-5'}>{children}</div>
    </section>
  );
}
