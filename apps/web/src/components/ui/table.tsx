import type { HTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

/** Below which breakpoint a table's rows stack: md (768 px) or lg (1024 px). */
export type TableStack = 'md' | 'lg';

const STACK: Record<TableStack, string> = {
  md: 'table-stack-md',
  lg: 'table-stack-lg',
};

/**
 * A data table: sunken header row, hairline rows that tint on hover. Put it in a flush Card, whose
 * body scrolls sideways with a shadow on the edge that has more (narrow windows, 200% zoom, a very
 * long name). `stack` turns each row into a stacked block below that breakpoint, each cell a line
 * that starts with its column's name (`Td`'s `label`; styles/layout.css), so a narrow window shows
 * every column without scrolling sideways.
 */
export function Table({
  stack,
  className,
  ...props
}: HTMLAttributes<HTMLTableElement> & { stack?: TableStack }) {
  return (
    <table
      className={cn(
        'w-full border-separate border-spacing-0 text-left',
        '[&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-hover',
        '[&_tbody_tr:last-child>td]:border-b-0',
        stack && STACK[stack],
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
        'tracking-wide whitespace-nowrap text-table-head uppercase',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A cell. `label` names its column where the rows stack (the column header's text); leave it out
 * for the row's name and its actions, which then take the whole line.
 */
export function Td({
  label,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { label?: string }) {
  return (
    <td
      data-label={label}
      className={cn('border-b border-default px-4 py-3.5 align-middle', className)}
      {...props}
    />
  );
}
