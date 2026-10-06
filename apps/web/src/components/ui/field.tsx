import type {
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';

/**
 * The frame every text-entry control shares (inputs, selects, text areas, and the code editors in
 * forms/CodeEditor.tsx): a 3:1 border with 8 px corners and a lighter edge on hover. Each control
 * adds its surface, its focus ring (2 px, outside a green edge), and the bad-tone edge when invalid.
 */
export const FIELD_FRAME =
  'rounded-md border border-strong transition-[border-color,box-shadow] hover:border-field-hover';

/** Shared by inputs, selects, and textareas: the frame, the type, and the focus and disabled states. */
const FIELD = [
  FIELD_FRAME,
  'bg-surface-field aria-invalid:border-status-bad-border',
  'w-full min-w-0 px-3 text-md text-default placeholder:text-subtle',
  'focus-visible:border-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2',
  'focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:border-default disabled:bg-surface-sunken disabled:text-subtle',
];

/** Number inputs drop the browser's spin buttons; the arrow keys still step the value. */
const NUMBER = [
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none',
  '[&::-webkit-outer-spin-button]:appearance-none',
];

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(FIELD, 'h-9 pointer-coarse:h-11', props.type === 'number' && NUMBER, className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(FIELD, 'min-h-16 py-2 font-mono text-sm leading-[1.45]', className)}
      {...props}
    />
  );
}

/** A native select (keyboard and screen-reader behaviour intact) with a drawn chevron. */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block min-w-0">
      <select
        className={cn(
          FIELD,
          'h-9 cursor-pointer appearance-none pr-9 pointer-coarse:h-11',
          className,
        )}
        {...props}
      />
      <Icon
        name="chevron"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
      />
    </span>
  );
}

/**
 * A native checkbox drawn as an 18 px box: a 3:1 edge, and when checked the accent fill with an ink
 * tick. The input itself is the box, so labels, keyboard, and form behaviour stay native; forced
 * colours mode shows the system checkbox. `className` sizes and places the box's wrapper.
 */
export function Checkbox({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <span className={cn('relative inline-grid size-[18px] shrink-0 place-items-center', className)}>
      <input
        type="checkbox"
        className={cn(
          'peer col-start-1 row-start-1 m-0 size-[18px] cursor-pointer appearance-none rounded-[5px]',
          'border border-strong bg-surface-raised transition-colors hover:border-field-hover',
          'checked:border-accent-strong checked:bg-accent checked:hover:bg-accent-hover',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          'disabled:cursor-not-allowed disabled:opacity-45',
          'forced-colors:appearance-auto',
        )}
        {...props}
      />
      <Icon
        name="check"
        strokeWidth={3}
        className="pointer-events-none col-start-1 row-start-1 size-[13px] text-on-accent opacity-0 peer-checked:opacity-100 forced-colors:hidden"
      />
    </span>
  );
}

/**
 * The `<label>` around a Checkbox and its text: the whole line is the target, at least 44 px each way
 * where the pointer is coarse (the box keeps its size).
 */
export const CHECKBOX_LABEL =
  'flex cursor-pointer items-center gap-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11';

/**
 * The required marker after a label: an asterisk in the error tone. It is decorative: the control
 * carries `aria-required`, which assistive technology announces.
 */
export function RequiredMarker({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('font-semibold text-status-bad-fg', className)}>
      *
    </span>
  );
}

/**
 * The first line of a form with required fields. It explains the visual marker only, so it is
 * hidden from assistive technology, which hears "required" on each such control instead.
 */
export function RequiredNote({ className }: { className?: string }) {
  return (
    <p aria-hidden="true" className={cn('text-xs leading-snug text-muted', className)}>
      Required fields are marked <RequiredMarker />
    </p>
  );
}

/**
 * A field label. `required` adds the marker after it, outside the `<label>` element, so the
 * label's text (and the control's accessible name) stays exactly the field's name.
 */
export function Label({
  className,
  required = false,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  const label = (
    <label
      className={cn('block text-sm leading-[1.3] font-medium text-default', className)}
      {...props}
    />
  );
  if (!required) return label;
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      {label}
      <RequiredMarker />
    </span>
  );
}

/** A label above its control (and any help or error text below it), 6 px apart. */
export function FieldGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid min-w-0 content-start gap-1.5', className)} {...props} />;
}

/**
 * Fields side by side that wrap, 12 px apart; below 640 px they become one column, every field (and
 * note) the full width whatever width it asked for, while a button keeps its own width at the start
 * of its line. For a `<form>` or `<div>` of `FieldGroup`s and buttons: `FieldRow` (its fields
 * aligned on their controls' bottom edge), or `FIELD_ROW` on an element of its own, which adds its
 * own cross-axis alignment (`items-end`, or `items-start` when a field has help under it).
 */
export const FIELD_ROW = cn(
  'flex flex-wrap gap-3',
  // One column that never wraps into a second one; a note's basis-full must not become a height.
  'max-sm:flex-col max-sm:flex-nowrap max-sm:items-stretch max-sm:[&>*]:w-full max-sm:[&>*]:basis-auto',
  'max-sm:[&>button]:w-auto max-sm:[&>button]:self-start',
);

export function FieldRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(FIELD_ROW, 'items-end', className)} {...props} />;
}

/** Help text under a field; `tone="bad"` for an error, `tone="warn"` for an advisory. */
export function HelpText({
  tone = 'muted',
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { tone?: 'muted' | 'bad' | 'warn' }) {
  return (
    <p
      className={cn(
        'text-xs leading-snug',
        tone === 'bad'
          ? 'font-medium text-status-bad-fg'
          : tone === 'warn'
            ? 'text-status-warn-fg'
            : 'text-muted',
        className,
      )}
      {...props}
    />
  );
}
