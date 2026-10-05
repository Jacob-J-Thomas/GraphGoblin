import type { JsonSchema } from '@graphgoblin/contracts';
import { validateJson, type SchemaIssue } from '@graphgoblin/domain';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  Button,
  FieldGroup,
  HelpText,
  Input,
  Label,
  RequiredNote,
  SegmentedControl,
  Select,
  Textarea,
} from '../components/ui/index.js';
import { cn, parseJson } from '../lib/utils.js';
import { LanguageTag } from './CodeField.js';
import { isSegmented, NOT_SET, YES_NO } from './fields/choice.js';

interface PropertySchema {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  title?: string;
  default?: unknown;
}

function propertyType(schema: PropertySchema): 'string' | 'number' | 'boolean' | 'enum' | 'json' {
  if (Array.isArray(schema.enum)) return 'enum';
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (type === 'string') return 'string';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'json';
}

/**
 * How an enum value reads in its control: a string as itself unless the enum also holds a value
 * that reads the same (a string "1" beside the number 1), then quoted; anything else as JSON.
 */
function enumLabel(option: unknown, options: unknown[]): string {
  if (typeof option !== 'string') return JSON.stringify(option);
  const clash = options.some((other) => other !== option && JSON.stringify(other) === option);
  return clash ? JSON.stringify(option) : option;
}

/**
 * An enum member as the value its control holds: its JSON text, so a choice survives the schema
 * changing under a mounted form (members reordered, added, or removed) and keeps meaning that
 * member. A string and a number with the same text ("1" and 1) stay apart.
 */
function enumKey(option: unknown): string {
  return JSON.stringify(option) ?? 'null';
}

/** The schema's properties, in order; property names are data and may be any string. */
function objectProperties(schema: JsonSchema | undefined): [string, PropertySchema][] | undefined {
  if (!schema || schema['type'] !== 'object') return undefined;
  const props = schema['properties'];
  return typeof props === 'object' && props !== null
    ? Object.entries(props as Record<string, PropertySchema>)
    : undefined;
}

function requiredProperties(schema: JsonSchema | undefined): Set<string> {
  const required = schema?.['required'];
  return new Set(Array.isArray(required) ? required.filter((k) => typeof k === 'string') : []);
}

/** The name a property shows: its title, else its key. */
function titleOf(name: string, prop: PropertySchema): string {
  return prop.title ?? name;
}

/** What failed, by property (shown and announced beside its field), and for the value as a whole. */
interface Problems {
  fields: ReadonlyMap<string, string[]>;
  form: string[];
}

const NO_PROBLEMS: Problems = { fields: new Map(), form: [] };

/**
 * A validation issue as a message beside the property it names: "Approval is required", "Issue
 * limit must be integer", "Labels /1 must be string". Issues about no form property (the value as
 * a whole, or an additional property) stay with the form.
 */
function placeIssues(
  issues: SchemaIssue[],
  properties: [string, PropertySchema][],
  messageOf: (issue: SchemaIssue) => string,
): Problems {
  const fields = new Map<string, string[]>();
  const form: string[] = [];
  for (const issue of issues) {
    const [name, ...rest] = issue.path;
    const prop = name === undefined ? undefined : properties.find(([key]) => key === name)?.[1];
    if (name === undefined || prop === undefined) {
      form.push(messageOf(issue));
      continue;
    }
    const where = rest.length > 0 ? ` /${rest.join('/')}` : '';
    fields.set(name, [
      ...(fields.get(name) ?? []),
      `${titleOf(name, prop)}${where} ${issue.message}`,
    ]);
  }
  return { fields, form };
}

/** A field's error messages, linked to its control by `id` and announced when they appear. */
function FieldErrors({ id, messages }: { id: string; messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div id={id} role="alert" className="grid gap-0.5">
      {messages.map((message, index) => (
        <HelpText key={index} tone="bad">
          {message}
        </HelpText>
      ))}
    </div>
  );
}

/** The ARIA that links a property's control to its help and error text. */
interface Control {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

/**
 * A choice among an enum's members: a segmented control for two to four, a select for more. An
 * optional enum offers "Not set"; a required one starts with nothing chosen. When the chosen member
 * is no longer offered (the schema changed while the form was open) nothing shows as chosen, the
 * control says so, and the form refuses to send.
 */
function EnumChoice({
  label,
  options,
  value,
  onChange,
  control,
  required,
  goneId,
}: {
  label: string;
  options: unknown[];
  value: string;
  onChange: (value: string) => void;
  control: Control;
  required: boolean;
  goneId: string;
}) {
  const gone = value !== '' && !options.some((option) => enumKey(option) === value);
  const describedBy = cn(control['aria-describedby'], gone && goneId) || undefined;
  const invalid = gone || control['aria-invalid'] === true;
  const message = gone ? (
    <HelpText id={goneId} tone="bad">
      The choice {value} is no longer offered; choose again.
    </HelpText>
  ) : null;
  if (isSegmented(options)) {
    const common = {
      legend: label,
      options: options.map((option) => ({
        value: enumKey(option),
        label: enumLabel(option, options),
      })),
      value: value === '' || gone ? undefined : value,
      required,
      describedBy,
      invalid,
    };
    return (
      <>
        {required ? (
          <SegmentedControl {...common} onChange={onChange} />
        ) : (
          <SegmentedControl
            {...common}
            notSet={NOT_SET}
            onChange={(next) => onChange(next ?? '')}
          />
        )}
        {message}
      </>
    );
  }
  return (
    <>
      <Label htmlFor={control.id} required={required}>
        {label}
      </Label>
      <Select
        {...control}
        value={gone ? '' : value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{required ? '(choose)' : NOT_SET}</option>
        {options.map((option, index) => (
          <option key={index} value={enumKey(option)}>
            {enumLabel(option, options)}
          </option>
        ))}
      </Select>
      {message}
    </>
  );
}

/**
 * One property's field: label (or legend), control, help, and its errors, linked by ids generated
 * here (the property's name is data, used only to look its value up). Help is the property's
 * description, then its default when a placeholder cannot show it.
 */
function PropertyField({
  name,
  prop,
  required,
  value,
  errors,
  onChange,
}: {
  name: string;
  prop: PropertySchema;
  required: boolean;
  value: string | boolean | undefined;
  errors: string[];
  onChange: (value: string | boolean | undefined) => void;
}) {
  const id = useId();
  const type = propertyType(prop);
  const label = titleOf(name, prop);
  const hasDefault = prop.default !== undefined;
  const placeholder =
    hasDefault && (type === 'string' || type === 'number') ? String(prop.default) : undefined;
  const help = [
    prop.description,
    hasDefault && placeholder === undefined ? `Default: ${JSON.stringify(prop.default)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const invalid = errors.length > 0;
  const describedBy = cn(help && helpId, invalid && errorId);
  const control: Control = {
    id,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(invalid ? { 'aria-invalid': true as const } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };
  let field: ReactNode;
  if (type === 'boolean') {
    // The form starts empty and sends only what it shows, so a boolean is never a switch here (a
    // switch always shows on or off): an optional one offers "Not set", and a required one starts
    // with neither Yes nor No chosen.
    const common = {
      legend: label,
      options: YES_NO,
      value: typeof value === 'boolean' ? String(value) : undefined,
      required,
      describedBy: control['aria-describedby'],
      invalid,
    };
    const choose = (next: string | undefined) =>
      onChange(next === undefined ? undefined : next === 'true');
    field = required ? (
      <SegmentedControl {...common} onChange={choose} />
    ) : (
      <SegmentedControl {...common} notSet={NOT_SET} onChange={choose} />
    );
  } else if (type === 'enum') {
    field = (
      <EnumChoice
        label={label}
        options={prop.enum ?? []}
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
        control={control}
        required={required}
        goneId={`${id}-gone`}
      />
    );
  } else {
    const text = typeof value === 'string' ? value : '';
    field = (
      <>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Label htmlFor={id} required={required}>
            {label}
          </Label>
          {type === 'json' ? <LanguageTag>JSON</LanguageTag> : null}
        </div>
        {type === 'json' ? (
          <Textarea {...control} value={text} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input
            {...control}
            type={type === 'number' ? 'number' : 'text'}
            value={text}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </>
    );
  }
  return (
    <FieldGroup className="max-w-[440px]">
      {field}
      {help ? <HelpText id={helpId}>{help}</HelpText> : null}
      <FieldErrors id={errorId} messages={errors} />
    </FieldGroup>
  );
}

/**
 * A form for a JSON Schema: the wait node's `inputSchema` or a manual trigger's input. Object
 * schemas get one field per property, drawn with the controls SchemaForm uses (text and number
 * inputs, Yes / No segments for a boolean, with Not set unless it is required, a segmented control
 * or select for an enum, and anything else as JSON), with the properties the schema requires
 * marked; any other schema, or none, gets a single JSON editor. The form starts empty, so nothing
 * shows a value it would not send (a switch, always on or off, has no place here). An enum choice is
 * kept by value and sent as the value it stands for (a number stays a number). A field left unset
 * is not sent. The value is checked with `domain`'s validator before `onSubmit`, as the API will
 * check it: an empty JSON editor as `null`, which is what the API validates when no input is sent.
 * Each problem shows beside its field (linked to the control, which is marked invalid, and
 * announced); a problem with the value as a whole shows under the form, or under the JSON editor.
 * Editing a field clears its problems.
 */
export function JsonSchemaForm({
  schema,
  submitLabel,
  onSubmit,
  busy = false,
}: {
  schema: JsonSchema | undefined;
  submitLabel: string;
  onSubmit: (value: unknown) => void;
  busy?: boolean;
}) {
  const rawId = useId();
  const properties = objectProperties(schema);
  const required = requiredProperties(schema);
  const [values, setValues] = useState<ReadonlyMap<string, string | boolean>>(() => new Map());
  const [raw, setRaw] = useState('');
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);

  const set = (key: string, value: string | boolean | undefined) => {
    setValues((current) => {
      const next = new Map(current);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      return next;
    });
    setProblems((current) => {
      if (!current.fields.has(key)) return current;
      const fields = new Map(current.fields);
      fields.delete(key);
      return { ...current, fields };
    });
  };

  /**
   * The value the fields stand for, and what is wrong with a field before the schema is asked (an
   * enum choice no longer offered, JSON that does not parse): those fields are left out.
   */
  const collectFields = (props: [string, PropertySchema][]) => {
    // Entries, then an object: a property named "__proto__" stays an own property.
    const out: [string, unknown][] = [];
    const fields = new Map<string, string[]>();
    for (const [key, prop] of props) {
      const value = values.get(key);
      if (value === undefined || value === '') continue;
      const type = propertyType(prop);
      if (type === 'number') out.push([key, Number(value)]);
      // Enum controls hold the chosen member's JSON text: the member comes back with its type. A
      // choice the schema no longer offers is refused, never silently left out.
      else if (type === 'enum') {
        const member = (prop.enum ?? []).find((option) => enumKey(option) === value);
        if (member === undefined)
          fields.set(key, [`${titleOf(key, prop)}: ${String(value)} is no longer offered`]);
        else out.push([key, member]);
      } else if (type === 'json') {
        const parsed = parseJson(String(value));
        if (parsed.ok) out.push([key, parsed.value]);
        else fields.set(key, [`${titleOf(key, prop)}: invalid JSON (${parsed.error})`]);
      } else out.push([key, value]);
    }
    return { value: Object.fromEntries(out), fields };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let value: unknown;
    let next: Problems;
    if (properties && schema) {
      const collected = collectFields(properties);
      value = collected.value;
      const result = validateJson(schema, value);
      const placed = result.ok
        ? NO_PROBLEMS
        : placeIssues(
            result.issues,
            properties,
            (issue) => `/${issue.path.join('/')} ${issue.message}`,
          );
      // A field's own problem (text that does not parse, a choice no longer offered) is what to
      // fix first; the schema's view of the value left out would only repeat it.
      const fields = new Map(placed.fields);
      for (const [key, messages] of collected.fields) fields.set(key, messages);
      next = { fields, form: placed.form };
    } else {
      if (raw.trim() !== '') {
        const parsed = parseJson(raw);
        if (!parsed.ok)
          return setProblems({ fields: new Map(), form: [`Invalid JSON: ${parsed.error}`] });
        value = parsed.value;
      }
      // No input at all reaches the API's check as null.
      const result = schema ? validateJson(schema, value ?? null) : undefined;
      next = { fields: new Map(), form: result?.errors ?? [] };
    }
    setProblems(next);
    if (next.fields.size === 0 && next.form.length === 0) onSubmit(value);
  };

  const anyRequired = properties ? properties.some(([key]) => required.has(key)) : false;
  const rawInvalid = !properties && problems.form.length > 0;
  return (
    <form onSubmit={submit} noValidate aria-label={submitLabel} className="grid gap-field">
      {anyRequired ? <RequiredNote /> : null}
      {properties ? (
        properties.map(([key, prop]) => (
          <PropertyField
            key={key}
            name={key}
            prop={prop}
            required={required.has(key)}
            value={values.get(key)}
            errors={problems.fields.get(key) ?? []}
            onChange={(value) => set(key, value)}
          />
        ))
      ) : (
        <FieldGroup className="max-w-[440px]">
          <Label htmlFor={rawId}>Input (JSON)</Label>
          <Textarea
            id={rawId}
            value={raw}
            placeholder="{}"
            aria-invalid={rawInvalid || undefined}
            aria-describedby={rawInvalid ? `${rawId}-error` : undefined}
            onChange={(e) => {
              setRaw(e.target.value);
              setProblems(NO_PROBLEMS);
            }}
          />
          <FieldErrors id={`${rawId}-error`} messages={problems.form} />
        </FieldGroup>
      )}
      {properties && problems.form.length > 0 ? (
        <ul role="alert" className="list-disc pl-4 text-xs font-medium text-status-bad-fg">
          {problems.form.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
