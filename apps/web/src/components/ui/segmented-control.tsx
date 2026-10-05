import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';
import { RequiredMarker } from './field.js';
import { ellipsize } from './ellipsis.js';
import { Legend } from './fieldset.js';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * With `notSet` (the label of a first segment that leaves the value unset, such as "Not set"),
 * `onChange` also receives `undefined`; without it, only the options' values.
 */
type Unset<T extends string> =
  | { notSet: string; onChange: (value: T | undefined) => void }
  | { notSet?: undefined; onChange: (value: T) => void };

export type SegmentedControlProps<T extends string> = Unset<T> & {
  /** The group's name, shown as its legend (the label of the choice). */
  legend: ReactNode;
  /** Two to four choices. */
  options: readonly SegmentedOption<T>[];
  /** The chosen value; `undefined` is "not set" (the `notSet` segment when there is one). */
  value: T | undefined;
  /** The radios' shared `name`; one is generated when absent. */
  name?: string;
  required?: boolean | undefined;
  disabled?: boolean;
  /** Ids of help and error text that describe the group. */
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
  className?: string;
};

/**
 * A choice among two to four options: a fieldset (role `radiogroup`, named by its legend) of native
 * radios drawn as connected segments on a sunken track, the chosen one in the accent's subtle fill
 * with a 3:1 inset edge. Native radios keep the keyboard: Tab reaches the chosen segment (or the
 * first when none is chosen) and the arrow keys move the choice. `notSet` adds a first segment for
 * "no value", so an optional choice can be left, or put back, unset.
 */
export function SegmentedControl<T extends string>({
  legend,
  options,
  value,
  onChange,
  notSet,
  name,
  required = false,
  disabled = false,
  describedBy,
  invalid = false,
  className,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const legendId = `${groupId}-legend`;
  const group = name ?? groupId;
  const segments: { value: T | undefined; label: ReactNode; key: string }[] = [
    ...(notSet === undefined ? [] : [{ value: undefined, label: notSet, key: '' }]),
    ...options.map((option) => ({ ...option, key: `=${option.value}` })),
  ];
  return (
    <fieldset
      role="radiogroup"
      aria-labelledby={legendId}
      aria-describedby={describedBy || undefined}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className={cn('group/segmented grid min-w-0 gap-1.5', className)}
    >
      <Legend variant="label" className="flex items-baseline gap-1">
        <span id={legendId}>{legend}</span>
        {required ? <RequiredMarker /> : null}
      </Legend>
      <div
        className={cn(
          'inline-flex w-fit max-w-full min-w-0 flex-wrap gap-0.5 rounded-md border border-strong',
          'bg-surface-sunken p-[3px] group-aria-invalid/segmented:border-status-bad-border',
        )}
      >
        {segments.map((segment) => (
          // A segment never grows wider than the track: a long label ends in an ellipsis, with the
          // whole text kept for the radio's name and shown on hover (title).
          <label key={segment.key} className="relative inline-flex max-w-full min-w-0">
            <input
              type="radio"
              name={group}
              value={segment.value ?? ''}
              checked={segment.value === value}
              onChange={() => (onChange as (value: T | undefined) => void)(segment.value)}
              className="peer sr-only"
            />
            <span
              title={typeof segment.label === 'string' ? segment.label : undefined}
              className={cn(
                'inline-flex h-7 max-w-full min-w-0 cursor-pointer items-center rounded-[6px] px-3 text-sm pointer-coarse:h-11',
                'font-medium whitespace-nowrap text-muted transition-colors',
                'peer-[:not(:checked)]:hover:bg-surface-hover peer-[:not(:checked)]:hover:text-default',
                'peer-checked:bg-accent-subtle peer-checked:font-semibold peer-checked:text-accent-on-subtle',
                'peer-checked:ring-1 peer-checked:ring-accent-strong peer-checked:ring-inset',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1',
                'peer-focus-visible:outline-focus forced-colors:peer-checked:outline',
                'peer-disabled:cursor-not-allowed peer-disabled:opacity-45',
              )}
            >
              {ellipsize(segment.label)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
