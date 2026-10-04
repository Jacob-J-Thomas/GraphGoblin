import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A screen's content column: page padding and section gaps from the tokens, capped at 1240 px for
 * list screens; `wide` lets the run inspector use the full width.
 */
export function Page({
  wide = false,
  className,
  children,
}: {
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'mx-auto grid w-full min-w-0 content-start gap-section p-page',
        !wide && 'max-w-[1240px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The screen title, with optional inline details after it and actions on the right. */
export function PageHeader({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <h1 className="text-2xl leading-tight font-bold tracking-tight">{title}</h1>
      {children}
      {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
