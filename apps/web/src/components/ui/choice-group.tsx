import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';
import { ellipsize } from './ellipsis.js';
import { RequiredMarker } from './field.js';
import { Legend } from './fieldset.js';

/** One radio of a `ChoiceGroup`. */
export interface Choice {
  /** The React key, unique in the group. */
  key: string;
  /** The radio's `value` attribute. */
  value: string;
  checked: boolean;
  onSelect: () => void;
  /** The visible name, and the radio's accessible name. */
  label: ReactNode;
  /** A line under the name that describes the radio (the grid layout). */
  description?: ReactNode;
  /** `data-*` attributes for the option, such as `data-font` to preview a face inside it. */
  data?: Readonly<Record<`data-${string}`, string>>;
}

export interface ChoiceGroupProps {
  /** The group's name, shown as its legend (the label of the choice). */
  legend: ReactNode;
  choices: readonly Choice[];
  /**
   * `row`: one-line segments on a track that wraps, each label ending in an ellipsis when cut short
   * (the segmented control). `grid`: options of a name and a description in columns (three from
   * 1024 px, two from 640 px, one below), for more choices than a row holds.
   */
  layout?: 'row' | 'grid' | undefined;
  /** The radios' shared `name`; one is generated when absent. */
  name?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Ids of help and error text that describe the group. */
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The states every option shares, whatever its layout: hover, the chosen option in the accent's
 * subtle fill with a 3:1 inset edge, the keyboard focus ring, an outline for the chosen option in
 * forced colours (where the fill and the edge are dropped), and disabled.
 */
const OPTION_STATES = cn(
  'cursor-pointer rounded-[6px] text-muted transition-colors',
  'peer-[:not(:checked)]:hover:bg-surface-hover peer-[:not(:checked)]:hover:text-default',
  'peer-checked:bg-accent-subtle peer-checked:text-accent-on-subtle',
  'peer-checked:ring-1 peer-checked:ring-accent-strong peer-checked:ring-inset',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-focus',
  'forced-colors:peer-checked:outline',
  'peer-disabled:cursor-not-allowed peer-disabled:opacity-45',
);

const LAYOUTS = {
  row: {
    track: 'inline-flex w-fit max-w-full min-w-0 flex-wrap',
    // A segment never grows wider than the track: a long label ends in an ellipsis, with the whole
    // text kept for the radio's name and shown on hover (title).
    option: 'relative inline-flex max-w-full min-w-0',
    face: cn(
      'inline-flex h-7 max-w-full min-w-0 items-center px-3 text-sm font-medium whitespace-nowrap',
      'peer-checked:font-semibold',
    ),
  },
  grid: {
    track: 'grid sm:grid-cols-2 lg:grid-cols-3',
    option: 'relative grid min-w-0',
    face: 'grid min-w-0 content-start gap-0.5 px-3 py-2',
  },
} as const;

/**
 * A choice among options: a fieldset (role `radiogroup`, named by its legend) of native radios
 * drawn as options on a sunken track. Native radios keep the keyboard: Tab reaches the chosen
 * option (or the first when none is chosen) and the arrow keys move the choice. The radio
 * semantics, the track, and the option states live here once; the segmented control (`row`) and
 * the Settings font control (`grid`) render through it.
 */
export function ChoiceGroup({
  legend,
  choices,
  layout = 'row',
  name,
  required = false,
  disabled = false,
  describedBy,
  invalid = false,
  className,
}: ChoiceGroupProps) {
  const groupId = useId();
  const legendId = `${groupId}-legend`;
  const group = name ?? groupId;
  const styles = LAYOUTS[layout];
  return (
    <fieldset
      role="radiogroup"
      aria-labelledby={legendId}
      aria-describedby={describedBy || undefined}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className={cn('group/choices grid min-w-0 gap-1.5', className)}
    >
      <Legend variant="label" className="flex items-baseline gap-1">
        <span id={legendId}>{legend}</span>
        {required ? <RequiredMarker /> : null}
      </Legend>
      <div
        className={cn(
          styles.track,
          'gap-0.5 rounded-md border border-strong bg-surface-sunken p-[3px]',
          'group-aria-invalid/choices:border-status-bad-border',
        )}
      >
        {choices.map((choice, index) => {
          // With a description the name and the description are separate runs of text: the radio is
          // named by the first and described by the second. Otherwise the label names it.
          const described = choice.description !== undefined;
          const nameId = `${groupId}-${index}-name`;
          const descriptionId = `${groupId}-${index}-description`;
          return (
            <label key={choice.key} className={styles.option} {...choice.data}>
              <input
                type="radio"
                name={group}
                value={choice.value}
                checked={choice.checked}
                onChange={choice.onSelect}
                aria-labelledby={described ? nameId : undefined}
                aria-describedby={described ? descriptionId : undefined}
                className="peer sr-only"
              />
              <span
                title={
                  layout === 'row' && typeof choice.label === 'string' ? choice.label : undefined
                }
                className={cn(styles.face, OPTION_STATES)}
              >
                {described ? (
                  // Grid wrappers, so the caller's own text spans set their line height alone.
                  <>
                    <span id={nameId} className="grid min-w-0">
                      {choice.label}
                    </span>
                    <span id={descriptionId} className="grid min-w-0">
                      {choice.description}
                    </span>
                  </>
                ) : layout === 'row' ? (
                  ellipsize(choice.label)
                ) : (
                  choice.label
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
