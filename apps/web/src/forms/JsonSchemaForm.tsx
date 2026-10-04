import type { JsonSchema } from '@graphgoblin/contracts';
import { validateJson } from '@graphgoblin/domain';
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
  Switch,
  Textarea,
} from '../components/ui/index.js';
import { cn, parseJson } from '../lib/utils.js';
import { LanguageTag } from './CodeField.js';
import { isSegmented, NOT_SET } from './fields/choice.js';

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

function objectProperties(
  schema: JsonSchema | undefined,
): Record<string, PropertySchema> | undefined {
  if (!schema || schema['type'] !== 'object') return undefined;
  const props = schema['properties'];
  return typeof props === 'object' && props !== null
    ? (props as Record<string, PropertySchema>)
    : undefined;
}

function requiredProperties(schema: JsonSchema | undefined): Set<string> {
  const required = schema?.['required'];
  return new Set(Array.isArray(required) ? required.filter((k) => typeof k === 'string') : []);
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
      invalid: gone,
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
        aria-invalid={gone || undefined}
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
 * One property's field: label (or legend), control, help, and any error, linked by id. Help is the
 * property's description, then its default when a placeholder cannot show it.
 */
function PropertyField({
  id,
  name,
  prop,
  required,
  value,
  onChange,
}: {
  id: string;
  name: string;
  prop: PropertySchema;
  required: boolean;
  value: string | boolean | undefined;
  onChange: (value: string | boolean | undefined) => void;
}) {
  const type = propertyType(prop);
  const label = prop.title ?? name;
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
  const control: Control = {
    id,
    ...(help ? { 'aria-describedby': helpId } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  };
  let field: ReactNode;
  if (type === 'boolean' && !required && !hasDefault) {
    field = (
      <SegmentedControl
        legend={label}
        notSet={NOT_SET}
        options={[
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' },
        ]}
        value={typeof value === 'boolean' ? String(value) : undefined}
        onChange={(next) => onChange(next === undefined ? undefined : next === 'true')}
        describedBy={control['aria-describedby']}
      />
    );
  } else if (type === 'boolean') {
    field = (
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Label id={`${id}-label`} htmlFor={id} required={required} className="cursor-pointer">
          {label}
        </Label>
        <Switch
          {...control}
          aria-labelledby={`${id}-label`}
          checked={value === true}
          onCheckedChange={onChange}
        />
      </div>
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
    </FieldGroup>
  );
}

/**
 * A form for a JSON Schema: the wait node's `inputSchema` or a manual trigger's input. Object
 * schemas get one field per property, drawn as SchemaForm draws its fields (text and number
 * inputs, a switch for a required or defaulted boolean and Not set / Yes / No for an optional one,
 * a segmented control or select for an enum, and anything else as JSON), with the properties the
 * schema requires marked; any other schema, or none, gets a single JSON editor. An enum choice is
 * kept by value and sent as the value it stands for (a number stays a number). A field left unset
 * is not sent. The value is checked with `domain`'s validator before `onSubmit`, as the API will
 * check it: an empty JSON editor as `null`, which is what the API validates when no input is sent.
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
  const id = useId();
  const properties = objectProperties(schema);
  const required = requiredProperties(schema);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [raw, setRaw] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const set = (key: string, value: string | boolean | undefined) =>
    setValues((current) => {
      const { [key]: _previous, ...rest } = current;
      return value === undefined ? rest : { ...rest, [key]: value };
    });

  const collect = (): { ok: true; value: unknown } | { ok: false; errors: string[] } => {
    if (!properties) {
      if (raw.trim() === '') return { ok: true, value: undefined };
      const parsed = parseJson(raw);
      return parsed.ok ? parsed : { ok: false, errors: [`Invalid JSON: ${parsed.error}`] };
    }
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(properties)) {
      const value = values[key];
      if (value === undefined || value === '') continue;
      const type = propertyType(prop);
      if (type === 'number') out[key] = Number(value);
      // Enum controls hold the chosen member's JSON text: the member comes back with its type. A
      // choice the schema no longer offers is refused, never silently left out.
      else if (type === 'enum') {
        const member = (prop.enum ?? []).find((option) => enumKey(option) === value);
        if (member === undefined)
          return {
            ok: false,
            errors: [`${prop.title ?? key}: ${String(value)} is no longer offered`],
          };
        out[key] = member;
      } else if (type === 'json') {
        const parsed = parseJson(String(value));
        if (!parsed.ok) return { ok: false, errors: [`${key}: invalid JSON`] };
        out[key] = parsed.value;
      } else out[key] = value;
    }
    return { ok: true, value: out };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const collected = collect();
    if (!collected.ok) return setErrors(collected.errors);
    if (schema) {
      // No input at all reaches the API's check as null.
      const result = validateJson(schema, collected.value ?? null);
      if (!result.ok) return setErrors(result.errors);
    }
    setErrors([]);
    onSubmit(collected.value);
  };

  const anyRequired = properties ? Object.keys(properties).some((key) => required.has(key)) : false;
  return (
    <form onSubmit={submit} noValidate aria-label={submitLabel} className="grid gap-field">
      {anyRequired ? <RequiredNote /> : null}
      {properties ? (
        Object.entries(properties).map(([key, prop]) => (
          <PropertyField
            key={key}
            id={`${id}-${key}`}
            name={key}
            prop={prop}
            required={required.has(key)}
            value={values[key]}
            onChange={(value) => set(key, value)}
          />
        ))
      ) : (
        <FieldGroup className="max-w-[440px]">
          <Label htmlFor={`${id}-json`}>Input (JSON)</Label>
          <Textarea
            id={`${id}-json`}
            value={raw}
            placeholder="{}"
            onChange={(e) => setRaw(e.target.value)}
          />
        </FieldGroup>
      )}
      {errors.length > 0 ? (
        <ul role="alert" className="list-disc pl-4 text-xs font-medium text-status-bad-fg">
          {errors.map((e, i) => (
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
