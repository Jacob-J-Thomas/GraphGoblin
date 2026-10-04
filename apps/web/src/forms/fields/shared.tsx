/**
 * What every field renderer shares: the react-hook-form binding with an explicit "unset" state,
 * the label row, and the inline error.
 */
import type { ReactNode } from 'react';
import { get, useController, useFormContext } from 'react-hook-form';
import { FieldGroup, HelpText, Label } from '../../components/ui/index.js';
import type { Schema } from '../introspect.js';
import { isUnset, UNSET } from '../unset.js';

export interface FieldProps {
  schema: Schema;
  name: string;
  label: string;
}

/**
 * `useController` with an explicit "unset" state. react-hook-form shows a field's initial value
 * again when its value becomes `undefined`, so clearing stores the UNSET sentinel instead, which
 * this hook reads back as `undefined` and SchemaForm strips before validation and reporting.
 */
export function useField(name: string) {
  const { field } = useController({ name });
  return {
    value: isUnset(field.value) ? undefined : (field.value as unknown),
    onChange: (value: unknown) => field.onChange(value === undefined ? UNSET : value),
    onBlur: field.onBlur,
  };
}

export function joinPath(base: string, key: string | number): string {
  return base === '' ? String(key) : `${base}.${key}`;
}

export function FieldError({ name }: { name: string }) {
  const {
    formState: { errors },
  } = useFormContext();
  const error = get(errors, name) as { message?: string; root?: { message?: string } } | undefined;
  const message = error?.message ?? error?.root?.message;
  if (!message) return null;
  return (
    <HelpText tone="bad" role="alert">
      {message}
    </HelpText>
  );
}

/** A label above its control, with an optional tag on the right (a code field's language). */
export function Row({
  label,
  htmlFor,
  aside,
  children,
  name,
}: {
  label: string;
  htmlFor?: string;
  aside?: ReactNode;
  children: ReactNode;
  name: string;
}) {
  return (
    <FieldGroup data-field={name}>
      {aside ? (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={htmlFor}>{label}</Label>
          {aside}
        </div>
      ) : (
        <Label htmlFor={htmlFor}>{label}</Label>
      )}
      {children}
      <FieldError name={name} />
    </FieldGroup>
  );
}

/** A group of fields for an object, array, record, or union, with its name as the legend. */
export const FIELDSET = 'grid min-w-0 gap-3 rounded-md border border-default px-4 pt-3 pb-4';
export const LEGEND = '-ml-1 px-1 text-sm font-semibold';
