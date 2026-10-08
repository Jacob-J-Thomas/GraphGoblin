/**
 * What every field renderer shares: the react-hook-form binding with an explicit "unset" state,
 * the label row, help and error text linked to the control, and the required marker.
 */
import { fieldMeta as schemaMeta, type FieldMeta } from '@graphgoblin/contracts';
import { createContext, use, useId, type ComponentType, type ReactNode } from 'react';
import { get, useController, useFormContext } from 'react-hook-form';
import { FieldGroup, HelpText, Label } from '../../components/ui/index.js';
import { useFormChange, type ChangeKind } from '../changes.js';
import { useParseErrors } from '../parse-errors.js';
import { descriptionOf, unwrap, type Schema } from '../introspect.js';
import { isUnset, UNSET } from '../unset.js';

export interface FieldProps {
  schema: Schema;
  name: string;
  label: string;
  /**
   * Drawn inside a frame that already names it (a collapsible list item, whose header shows the
   * label): a group drops its border and keeps its legend for assistive technology only.
   */
  bare?: boolean | undefined;
  /**
   * Set when the field is drawn while its optional parent object is absent (only for a control
   * that `drawsWithoutParent`): the parent's path and the value its Add button would create. The
   * field then shows its effective value, and a change writes the whole parent rather than the
   * field alone, so nothing is added to the form until the user chooses something.
   */
  absentParent?: { name: string; initial: Record<string, unknown> } | undefined;
}

/**
 * A control that draws a field in place of its default renderer, registered under the name its
 * metadata's `control` gives (`.meta(field('…', { control: 'model' }))` in `@graphgoblin/contracts`).
 * It gets the field's props and binds to the form itself (`useField`); it may draw the default
 * renderer too (`DefaultField`), for a raw-value toggle, say. With `drawsWithoutParent` it is also
 * drawn while its optional parent object is absent (see `FieldProps.absentParent`).
 */
export type FieldControl = ComponentType<FieldProps> & { drawsWithoutParent?: boolean };

/** Registered controls by name. SchemaForm's `controls` prop provides them to every field. */
export type FieldControls = Readonly<Record<string, FieldControl>>;

/** Field controls selected by the field's form-relative path instead of schema metadata. */
export type FieldOverrides = Readonly<Record<string, FieldControl>>;

export interface UnionPickerOption {
  value: string;
  label: string;
}

export interface UnionPickerProps {
  name: string;
  label: string;
  options: readonly UnionPickerOption[];
  value: string | undefined;
  onChange: (value: string) => void;
  required: boolean;
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
}

export type UnionPicker = ComponentType<UnionPickerProps>;
export type UnionPickers = Readonly<Record<string, UnionPicker>>;

export const UnionPickersContext = createContext<UnionPickers>({});

export const FieldControlsContext = createContext<FieldControls>({});

export const FieldOverridesContext = createContext<FieldOverrides>({});

/** Exact field-path labels supplied by a form's presentation context; values and schema stay intact. */
export const FieldLabelsContext = createContext<Readonly<Record<string, string>>>({});

/** The active form schema and a unique scope for controls that describe sibling fields. */
export const FormScopeContext = createContext<{ schema: Schema; id: string } | undefined>(
  undefined,
);

/**
 * `useController` with an explicit "unset" state. react-hook-form shows a field's initial value
 * again when its value becomes `undefined`, so clearing stores the UNSET sentinel instead, which
 * this hook reads back as `undefined` and SchemaForm strips before validation and reporting.
 *
 * `kind` says how the field's changes count for undo (`ChangeKind`): a control that types text
 * binds with `typing`, one that chooses (a select, a switch, segments, checkboxes) with `commit`.
 * An action that wraps its writes in its own change (`useFormChange`) keeps that description.
 */
export function useField(name: string, kind: ChangeKind) {
  const { field } = useController({ name });
  const change = useFormChange();
  return {
    value: isUnset(field.value) ? undefined : (field.value as unknown),
    onChange: (value: unknown) =>
      change({ path: name, kind }, () => field.onChange(value === undefined ? UNSET : value)),
    onBlur: field.onBlur,
  };
}

/**
 * Read the live collection only when an action needs it, without a second subscription. Its own
 * writes (adding and removing rows) are commits.
 */
export function useCollectionField(name: string) {
  const field = useField(name, 'commit');
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

/**
 * The schema's issues with the whole value, by field path (the path's segments joined with "."):
 * SchemaForm checks every change against the schema and provides them. react-hook-form reports an
 * error only at a field it controls, so a value inside one field's value, such as a record entry,
 * finds its message here, by the exact path (a record key may hold any character, dots included).
 */
export const FieldIssuesContext = createContext<ReadonlyMap<string, string>>(new Map());

/** The message for the field at `name`: react-hook-form's, else the schema issue at that path. */
export function useFieldErrorMessage(name: string) {
  const {
    formState: { errors },
  } = useFormContext();
  const issues = use(FieldIssuesContext);
  const error = get(errors, name) as { message?: string; root?: { message?: string } } | undefined;
  return error?.message ?? error?.root?.message ?? issues.get(name);
}

/**
 * What a schema says about its field beyond its shape: required when it is neither optional nor
 * defaulted (a required field shows the marker and its control `aria-required`), its description
 * (`.describe()` or the contracts' field metadata), shown as help, and the rest of its metadata
 * (`fieldMeta` in `@graphgoblin/contracts`: title, advanced, group, control, collapseItems).
 */
export function fieldMeta(
  schema: Schema,
): FieldMeta & { required: boolean; help: string | undefined } {
  return { ...schemaMeta(schema), required: !unwrap(schema).optional, help: descriptionOf(schema) };
}

/** Whether an issue or unparsed-text path lies in a field at `path` (the field or inside it). */
export function isWithin(issuePath: string, path: string): boolean {
  return issuePath === path || issuePath.startsWith(`${path}.`);
}

/**
 * Paths, relative to the form's value, of errors found outside the form: the loop's validation of
 * the draft, such as the domain's template and expression checks and the API's (SchemaForm's
 * `problems`). Collapsed groups count them with the form's own.
 */
export const ProblemPathsContext = createContext<readonly string[]>([]);

/**
 * How many problems lie in a part of the form that may be hidden (a collapsed Advanced group or
 * list item), so its summary can say so: the paths with a schema issue (SchemaForm's check of the
 * whole value), unparsed JSON text, or an error found outside the form (`ProblemPathsContext`)
 * inside any of `fields`, or exactly at one of `exact` (an object whose own message shows there).
 * Each path counts once.
 */
export function useProblemCount(fields: readonly string[], exact: readonly string[] = []): number {
  const issues = use(FieldIssuesContext);
  const outside = use(ProblemPathsContext);
  const parseErrors = useParseErrors();
  const paths = new Set([...issues.keys(), ...Object.keys(parseErrors.errors ?? {}), ...outside]);
  let count = 0;
  for (const path of paths) {
    if (exact.includes(path) || fields.some((field) => isWithin(path, field))) count += 1;
  }
  return count;
}

/**
 * The ARIA a field's control carries: its id, the text that describes it, its state, and its full
 * name when the visible label is a shorter caption (see `Row`).
 */
export interface ControlProps {
  id: string;
  'aria-label'?: string;
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

/** Help text with its `code` spans (between backticks, as the reference writes them) as code. */
export function helpContent(help: string): ReactNode {
  const parts = help.split('`');
  // An odd number of backticks is not a code span: show the text as it is.
  if (parts.length < 3 || parts.length % 2 === 0) return help;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="font-mono">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

/** A field's help text (from its schema's description), when it has any. */
export function FieldHelp({ id, help }: { id: string; help: string | undefined }) {
  return help === undefined ? null : <HelpText id={id}>{helpContent(help)}</HelpText>;
}

/**
 * A label above its control, with an optional tag on the right (a code field's language), then
 * help and error text. `children` may be a function of the control's props (`id`,
 * `aria-describedby`, `aria-invalid`, `aria-required`), so the control is linked to the text
 * below it. `data-field` carries the field's path for focusing it from an issue. `caption` shows a
 * shorter visible label (a record row's "Value") while `label` stays the control's accessible name
 * (`aria-label`, "Env value 1").
 */
export function Row({
  label,
  caption,
  htmlFor,
  aside,
  after,
  children,
  name,
  required = false,
  help,
}: {
  label: string;
  caption?: string | undefined;
  htmlFor?: string;
  aside?: ReactNode;
  after?: ReactNode;
  children: ReactNode | ((control: ControlProps) => ReactNode);
  name: string;
  required?: boolean;
  help?: string | undefined;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const field = useFieldControl(name, id, { help: help !== undefined, required });
  const { helpId, errorId } = field;
  const control = caption === undefined ? field.control : { ...field.control, 'aria-label': label };
  return (
    <FieldGroup data-field={name}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Label htmlFor={id} required={required}>
          {caption ?? label}
        </Label>
        {aside}
      </div>
      {typeof children === 'function' ? children(control) : children}
      <FieldHelp id={helpId} help={help} />
      <FieldError name={name} id={errorId} />
      {after}
    </FieldGroup>
  );
}
