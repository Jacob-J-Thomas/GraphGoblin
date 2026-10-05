import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'role' | 'onChange' | 'aria-checked' | 'children'
> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/**
 * An on/off switch for a boolean that always has a value: a `button` with `role="switch"` and
 * `aria-checked`, 44 by 24 px, whose thumb slides to the right and turns the track goblin green
 * when on. A click, Space, or Enter toggles it (native button behaviour). Name it with
 * `aria-labelledby` (a visible label, which may also point at it with `htmlFor` so a click on the
 * label toggles it) or `aria-label`.
 */
export function Switch({ checked, onCheckedChange, className, onClick, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        'group/switch relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
        'border border-strong bg-surface-sunken p-0 transition-colors hover:border-field-hover',
        'aria-checked:border-accent-strong aria-checked:bg-accent aria-checked:hover:bg-accent-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-busy:cursor-wait',
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          props['aria-disabled'] !== true &&
          props['aria-disabled'] !== 'true'
        )
          onCheckedChange(!checked);
      }}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-[2px] left-[2px] size-[18px] rounded-full bg-thumb-off',
          'transition-[translate,background-color] duration-(--duration-base) ease-emphasised',
          'group-aria-checked/switch:translate-x-5 group-aria-checked/switch:bg-thumb-on',
          // Dim only the thumb while pending so the focus ring retains its contrast.
          'group-aria-disabled/switch:opacity-45',
          // Forced colours drop backgrounds: a solid border keeps the thumb, whose side shows the state.
          'forced-colors:border-[9px] forced-colors:border-solid',
        )}
      />
    </button>
  );
}
