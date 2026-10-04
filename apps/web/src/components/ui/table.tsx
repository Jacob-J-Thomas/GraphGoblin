import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

/** A data table: sunken header row, hairline rows that tint on hover. Put it in a flush Card. */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn(
        'w-full border-separate border-spacing-0 text-left',
        '[&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-hover',
        '[&_tbody_tr:last-child>td]:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

export function Th({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-default bg-surface-sunken px-4 py-2.5 text-xs font-semibold',
        'tracking-wide whitespace-nowrap text-muted uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('border-b border-default px-4 py-3.5 align-middle', className)} {...props} />
  );
}
