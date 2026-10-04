import type {
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/utils.js';
import { Icon } from '../icons/index.js';

/** Shared by inputs, selects, and textareas: a 3:1 border on the field surface, green on focus. */
const FIELD = [
  'w-full min-w-0 rounded-md border border-strong bg-surface-field px-3 text-md text-default',
  'placeholder:text-subtle transition-[border-color,box-shadow] hover:border-field-hover',
  'focus-visible:border-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2',
  'focus-visible:outline-focus aria-invalid:border-status-bad-border',
  'disabled:cursor-not-allowed disabled:border-default disabled:bg-surface-sunken disabled:text-subtle',
];

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, 'h-9', className)} {...props} />;
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
        className={cn(FIELD, 'h-9 cursor-pointer appearance-none pr-9', className)}
        {...props}
      />
      <Icon
        name="chevron"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
      />
    </span>
  );
}

/** A native checkbox in the accent colour (the switch and toggle chips are #8). */
export function Checkbox({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn('size-4 shrink-0 cursor-pointer accent-accent', className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block text-sm leading-[1.3] font-medium text-default', className)}
      {...props}
    />
  );
}

/** A label above its control (and any help or error text below it), 6 px apart. */
export function FieldGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid min-w-0 content-start gap-1.5', className)} {...props} />;
}

/** Help text under a field; `tone="bad"` for a validation message. */
export function HelpText({
  tone = 'muted',
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { tone?: 'muted' | 'bad' }) {
  return (
    <p
      className={cn(
        'text-xs leading-snug',
        tone === 'bad' ? 'font-medium text-status-bad-fg' : 'text-muted',
        className,
      )}
      {...props}
    />
  );
}
