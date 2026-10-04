/**
 * What every field renderer shares: the react-hook-form binding with an explicit "unset" state,
 * the label row, help and error text linked to the control, and the required marker.
 */
import { useId, type ReactNode } from 'react';
import { get, useController, useFormContext } from 'react-hook-form';
import { FieldGroup, HelpText, Label } from '../../components/ui/index.js';
import { descriptionOf, unwrap, type Schema } from '../introspect.js';
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

/** Read the live collection only when an action needs it, without a second subscription. */
export function useCollectionField(name: string) {
  const field = useField(name);
  const { getValues } = useFormContext();
  return {
    ...field,
    read: () => {
      const value: unknown = getValues(name);
      return isUnset(value) ? undefined : value;
    },
  };
}

export function joinPath(base: string, key: string | number): string {
  return base === '' ? String(key) : `${base}.${key}`;
}

export function useFieldErrorMessage(name: string) {
  const {
    formState: { errors },
  } = useFormContext();
  const error = get(errors, name) as { message?: string; root?: { message?: string } } | undefined;
  return error?.message ?? error?.root?.message;
}

/**
 * What a schema says about its field beyond its shape: required when it is neither optional nor
 * defaulted (a required field shows the marker and its control `aria-required`), and its
 * `.describe()` text, shown as help.
 */
export function fieldMeta(schema: Schema): { required: boolean; help: string | undefined } {
  return { required: !unwrap(schema).optional, help: descriptionOf(schema) };
}

/** The ARIA a field's control carries: its id, the text that describes it, and its state. */
export interface ControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

/**
 * Ids for a field's help and error text, and the props that link its control to them: the help
 * and the error (while there is one) describe the control, an error marks it invalid, and a
 * required field says so.
 */
export function useFieldControl(
  name: string,
  id: string,
  { help, required }: { help: boolean; required: boolean },
) {
  const message = useFieldErrorMessage(name);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : '', message ? errorId : ''].filter(Boolean).join(' ');
  const control: ControlProps = {
    id,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(message ? { 'aria-invalid': true as const } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };
  return { control, helpId, errorId };
}

/** A field's validation message, announced when it appears. `id` links it to the control. */
export function FieldError({ name, id }: { name: string; id?: string }) {
  const message = useFieldErrorMessage(name);
  if (!message) return null;
  return (
    <HelpText id={id} tone="bad" role="alert">
      {message}
    </HelpText>
  );
}

/** A field's help text (from its schema's description), when it has any. */
export function FieldHelp({ id, help }: { id: string; help: string | undefined }) {
  return help === undefined ? null : <HelpText id={id}>{help}</HelpText>;
}

/**
 * A label above its control, with an optional tag on the right (a code field's language), then
 * help and error text. `children` may be a function of the control's props (`id`,
 * `aria-describedby`, `aria-invalid`, `aria-required`), so the control is linked to the text
 * below it. `data-field` carries the field's path for focusing it from an issue.
 */
export function Row({
  label,
  htmlFor,
  aside,
  children,
  name,
  required = false,
  help,
}: {
  label: string;
  htmlFor?: string;
  aside?: ReactNode;
  children: ReactNode | ((control: ControlProps) => ReactNode);
  name: string;
  required?: boolean;
  help?: string | undefined;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const { control, helpId, errorId } = useFieldControl(name, id, {
    help: help !== undefined,
    required,
  });
  return (
    <FieldGroup data-field={name}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
        {aside}
      </div>
      {typeof children === 'function' ? children(control) : children}
      <FieldHelp id={helpId} help={help} />
      <FieldError name={name} id={errorId} />
    </FieldGroup>
  );
}
