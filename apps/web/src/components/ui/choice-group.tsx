import { useEffect, useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';
import { Button } from './button.js';
import { ellipsize } from './ellipsis.js';
import { RequiredMarker } from './field.js';
import { Legend } from './fieldset.js';
import { Popover, type PopoverTriggerProps } from './popover.js';

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
  /** Text that describes the radio, shown inline unless `descriptionTooltips` is enabled. */
  description?: ReactNode;
  /** `data-*` attributes for the option, such as `data-font` to preview a face inside it. */
  data?: Readonly<Record<`data-${string}`, string>>;
}

interface ChoiceGroupBaseProps {
  /** The group's name, shown as its legend (the label of the choice). */
  legend: ReactNode;
  choices: readonly Choice[];
  /** The radios' shared `name`; one is generated when absent. */
  name?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Ids of help and error text that describe the group. */
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
}

export type ChoiceGroupProps = ChoiceGroupBaseProps &
  (
    | {
        /** Options in columns: three from 1024 px, two from 640 px, one below. */
        layout: 'grid';
        /** Move descriptions into help popovers, keeping them as radio descriptions. */
        descriptionTooltips?: boolean | undefined;
      }
    | {
        /** One-line segments on a wrapping track, with ellipsized labels. */
        layout?: 'row' | undefined;
        descriptionTooltips?: never;
      }
  );

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
    // On a coarse pointer every segment is at least 44 px in both dimensions (#41).
    option:
      'relative inline-flex max-w-full min-w-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
    face: cn(
      'inline-flex h-7 max-w-full min-w-0 items-center justify-center px-3 text-sm font-medium whitespace-nowrap',
      'pointer-coarse:min-h-11 pointer-coarse:min-w-11 peer-checked:font-semibold',
    ),
  },
  grid: {
    track: 'grid sm:grid-cols-2 lg:grid-cols-3',
    option: 'relative grid min-w-0',
    face: 'grid min-w-0 gap-0.5 px-3 py-2',
  },
} as const;

// Card selection can remount the form and restore radio focus before the click finishes.
// The press therefore outlives a picker instance, ending after the click's default action.
let pointerPress = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A choice among options: a fieldset (role `radiogroup`, named by its legend) of native radios
 * drawn as options on a sunken track. Native radios keep the keyboard: Tab reaches the chosen
 * option (or the first when none is chosen) and the arrow keys move the choice. The radio
 * semantics, the track, and the option states live here once; the segmented control (`row`) and
 * the Settings font control (`grid`) render through it.
 *
 * `descriptionTooltips` opts grid cards into compact labels. Keyboard focus on a radio shows its
 * explanation without moving focus; leaving the option or pressing Escape dismisses it. Help
 * buttons open the same popover on hover or tap and have `tabIndex={-1}`, so Tab still reaches the
 * group only once. Clicking or tapping a card selects it without opening help. Each radio keeps
 * its explanation as its accessible description while closed.
 */
export function ChoiceGroup({
  legend,
  choices,
  layout = 'row',
  descriptionTooltips = false,
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
  useEffect(() => {
    if (!descriptionTooltips) return;
    const release = () => {
      clearTimeout(releaseTimer);
      pointerPress = false;
    };
    // A cancelled press must not suppress the next keyboard focus, including Tab from outside.
    document.addEventListener('keydown', release, true);
    document.addEventListener('pointercancel', release, true);
    return () => {
      document.removeEventListener('keydown', release, true);
      document.removeEventListener('pointercancel', release, true);
    };
  }, [descriptionTooltips]);
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
          const tooltip = descriptionTooltips && described;
          const nameId = `${groupId}-${index}-name`;
          const descriptionId = `${groupId}-${index}-description`;
          const helpId = `${groupId}-${index}-help`;
          const option = (focusProps?: Pick<PopoverTriggerProps, 'onFocus' | 'onPointerDown'>) => (
            <label
              key={choice.key}
              className={styles.option}
              {...choice.data}
              onPointerDown={
                focusProps
                  ? () => {
                      clearTimeout(releaseTimer);
                      pointerPress = true;
                    }
                  : undefined
              }
              onClick={
                focusProps
                  ? () => {
                      // A visible label focuses its sr-only radio as the click's default action,
                      // after pointerup. Retain the press until that action has finished.
                      clearTimeout(releaseTimer);
                      releaseTimer = setTimeout(() => {
                        pointerPress = false;
                      }, 0);
                    }
                  : undefined
              }
            >
              <input
                type="radio"
                name={group}
                value={choice.value}
                checked={choice.checked}
                onChange={choice.onSelect}
                onFocus={
                  focusProps
                    ? () => {
                        if (!pointerPress) focusProps.onFocus();
                      }
                    : undefined
                }
                onPointerDown={focusProps?.onPointerDown}
                aria-labelledby={described ? nameId : undefined}
                aria-describedby={described ? descriptionId : undefined}
                className="peer sr-only"
              />
              <span
                title={
                  layout === 'row' && typeof choice.label === 'string' ? choice.label : undefined
                }
                className={cn(
                  styles.face,
                  OPTION_STATES,
                  layout === 'grid' &&
                    (tooltip ? 'content-center pointer-coarse:min-h-11' : 'content-start'),
                )}
              >
                {described ? (
                  // Grid wrappers, so the caller's own text spans set their line height alone.
                  <>
                    <span id={nameId} className="grid min-w-0">
                      {choice.label}
                    </span>
                    <span id={descriptionId} className={tooltip ? 'sr-only' : 'grid min-w-0'}>
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
          return tooltip ? (
            <Popover
              key={choice.key}
              label="Option help"
              trigger={(props) => (
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center">
                  {option(props)}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon"
                    tabIndex={-1}
                    aria-labelledby={`${nameId} ${helpId}`}
                    aria-describedby={descriptionId}
                  >
                    <Icon name="info" />
                    <span id={helpId} className="sr-only">
                      help
                    </span>
                  </Button>
                </div>
              )}
            >
              {choice.description}
            </Popover>
          ) : (
            option()
          );
        })}
      </div>
    </fieldset>
  );
}
