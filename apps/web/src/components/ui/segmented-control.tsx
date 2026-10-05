import type { ReactNode } from 'react';
import { ChoiceGroup, type Choice } from './choice-group.js';

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
 * A choice among two to four options, drawn as connected segments in one row: the shared
 * `ChoiceGroup` in its `row` layout (radio semantics, keyboard, track, chosen and focus states,
 * forced colours), the chosen segment in the accent's subtle fill with a 3:1 inset edge. `notSet`
 * adds a first segment for "no value", so an optional choice can be left, or put back, unset. A
 * long label ends in an ellipsis, keeping the whole text as the radio's name and its tooltip.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  notSet,
  ...group
}: SegmentedControlProps<T>) {
  const select = onChange as (value: T | undefined) => void;
  const choices: Choice[] = [
    ...(notSet === undefined
      ? []
      : [
          {
            key: '',
            value: '',
            checked: value === undefined,
            onSelect: () => select(undefined),
            label: notSet,
          },
        ]),
    ...options.map((option) => ({
      key: `=${option.value}`,
      value: option.value,
      checked: option.value === value,
      onSelect: () => select(option.value),
      label: option.label,
    })),
  ];
  return <ChoiceGroup {...group} choices={choices} layout="row" />;
}
