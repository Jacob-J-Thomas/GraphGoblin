/**
 * The handful of shadcn/ui-style primitives the app needs, copied in as plain elements with
 * Tailwind classes. No Radix: native inputs, selects, and details elements cover these screens.
 */
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/utils.js';

type Variant = 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  default: 'bg-emerald-600 text-white hover:bg-emerald-700',
  secondary: 'bg-slate-200 text-slate-900 hover:bg-slate-300',
  outline: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
  destructive: 'bg-red-700 text-white hover:bg-red-800',
  ghost: 'text-slate-700 hover:bg-slate-100',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3 text-sm',
};

export function Button({
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-md font-medium',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

const FIELD =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-60';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, 'h-8', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD, 'min-h-16 font-mono', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(FIELD, 'h-8', className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-xs font-medium text-slate-700', className)} {...props} />;
}

export function Card({
  title,
  actions,
  className,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white p-4', className)}>
      {title || actions ? (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2 className="text-sm font-semibold text-slate-900">{title}</h2> : <span />}
          {actions ? <div className="flex gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-800 border-slate-300',
  good: 'bg-sky-100 text-sky-900 border-sky-300',
  bad: 'bg-orange-100 text-orange-900 border-orange-400',
  warn: 'bg-amber-100 text-amber-900 border-amber-300',
  info: 'bg-violet-100 text-violet-900 border-violet-300',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />;
}

export function Th({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('border-b border-slate-200 px-2 py-1 text-xs font-semibold', className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('border-b border-slate-100 px-2 py-1 align-top', className)} {...props} />
  );
}

export function Alert({
  tone = 'bad',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cn('rounded border p-2 text-sm', TONES[tone])}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}
