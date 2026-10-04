import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A raised panel: an optional head (title and actions over a hairline) and a padded body.
 * `flush` drops the body padding for content that brings its own, such as a table.
 */
export function Card({
  title,
  actions,
  flush = false,
  className,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-lg border border-default bg-surface-raised shadow-1',
        flush && 'overflow-hidden',
        className,
      )}
    >
      {title || actions ? (
        <header className="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-default px-5 py-3">
          {title ? (
            <h2 className="flex items-center gap-2 text-md font-semibold">{title}</h2>
          ) : (
            <span />
          )}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? undefined : 'p-5'}>{children}</div>
    </section>
  );
}
