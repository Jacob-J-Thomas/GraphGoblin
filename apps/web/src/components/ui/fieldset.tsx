import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A group of fields with a heading. `variant="box"` (the default) is a quiet bordered box (the
 * nested object, array, record, or union in a schema-driven form) whose `Legend` names it;
 * `variant="section"` is a borderless section of a longer group (a heading inside a form's Advanced
 * options), set off from the section before it by a rule. Pass `ref` and `tabIndex` through when a
 * collection needs to take focus itself.
 */
export function Fieldset({
  variant = 'box',
  className,
  ...props
}: ComponentProps<'fieldset'> & { variant?: 'box' | 'section' }) {
  return (
    <fieldset
      className={cn(
        'grid min-w-0 gap-3',
        variant === 'box'
          ? 'rounded-md border border-default px-4 pt-3 pb-4'
          : 'border-0 p-0 not-first:border-t not-first:border-default not-first:pt-3',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A fieldset's name. `variant="group"` (the default) is the heading of a bordered `Fieldset`;
 * `variant="label"` names a borderless group of choices (checkboxes, a segmented control) and looks
 * like a field `Label`; `variant="section"` heads a section `Fieldset`, smaller and quieter than a
 * group's heading so the groups inside it still read as nested.
 */
export function Legend({
  variant = 'group',
  className,
  ...props
}: ComponentProps<'legend'> & { variant?: 'group' | 'label' | 'section' }) {
  return (
    <legend
      className={cn(
        variant === 'group'
          ? '-ml-1 px-1 text-sm font-semibold'
          : variant === 'label'
            ? 'mb-1.5 text-sm leading-[1.3] font-medium text-default'
            : 'mb-2 text-xs font-semibold tracking-wide text-muted uppercase',
        className,
      )}
      {...props}
    />
  );
}
