import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A group of fields with a heading: a quiet bordered box (the nested object, array, record, or
 * union in a schema-driven form) whose `Legend` names it. Pass `ref` and `tabIndex` through when a
 * collection needs to take focus itself.
 */
export function Fieldset({ className, ...props }: ComponentProps<'fieldset'>) {
  return (
    <fieldset
      className={cn(
        'grid min-w-0 gap-3 rounded-md border border-default px-4 pt-3 pb-4',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A fieldset's name. `variant="group"` (the default) is the heading of a bordered `Fieldset`;
 * `variant="label"` names a borderless group of choices (checkboxes, a segmented control) and looks
 * like a field `Label`.
 */
export function Legend({
  variant = 'group',
  className,
  ...props
}: ComponentProps<'legend'> & { variant?: 'group' | 'label' }) {
  return (
    <legend
      className={cn(
        variant === 'group'
          ? '-ml-1 px-1 text-sm font-semibold'
          : 'mb-1.5 text-sm leading-[1.3] font-medium text-default',
        className,
      )}
      {...props}
    />
  );
}
