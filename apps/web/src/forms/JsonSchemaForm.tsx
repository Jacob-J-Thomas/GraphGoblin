import type { JsonSchema } from '@graphgoblin/contracts';
import { validateJson } from '@graphgoblin/domain';
import { useId, useState, type FormEvent } from 'react';
import {
  Button,
  Checkbox,
  FieldGroup,
  HelpText,
  Input,
  Label,
  Select,
  Textarea,
} from '../components/ui/index.js';
import { parseJson } from '../lib/utils.js';

interface PropertySchema {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  title?: string;
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
 * How an enum value reads in its select: a string as itself unless the enum also holds a value
 * that reads the same (a string "1" beside the number 1), then quoted; anything else as JSON.
 */
function enumLabel(option: unknown, options: unknown[]): string {
  if (typeof option !== 'string') return JSON.stringify(option);
  const clash = options.some((other) => other !== option && JSON.stringify(other) === option);
  return clash ? JSON.stringify(option) : option;
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

/**
 * A form for a JSON Schema: the wait node's `inputSchema` or a manual trigger's input. Object
 * schemas get one field per property (strings, numbers, booleans, enums; anything else as JSON);
 * any other schema, or none, gets a single JSON editor. An enum choice is sent as the value it
 * stands for (a number stays a number). The value is checked with `domain`'s validator before
 * `onSubmit`, as the API will check it: an empty JSON editor as `null`, which is what the API
 * validates when no input is sent.
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
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [raw, setRaw] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

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
      // Enum selects hold the chosen option's index, so values of any type come back as they are.
      else if (type === 'enum') out[key] = prop.enum?.[Number(value)];
      else if (type === 'json') {
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

  return (
    <form onSubmit={submit} noValidate aria-label={submitLabel} className="grid gap-field">
      {properties ? (
        Object.entries(properties).map(([key, prop]) => {
          const fieldId = `${id}-${key}`;
          const type = propertyType(prop);
          const label = prop.title ?? key;
          if (type === 'boolean') {
            return (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={fieldId}
                  checked={values[key] === true}
                  onChange={(e) => setValues({ ...values, [key]: e.target.checked })}
                />
                <Label htmlFor={fieldId} className="cursor-pointer">
                  {label}
                </Label>
              </div>
            );
          }
          return (
            <FieldGroup key={key} className="max-w-[440px]">
              <Label htmlFor={fieldId}>{label}</Label>
              {type === 'enum' ? (
                <Select
                  id={fieldId}
                  value={String(values[key] ?? '')}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                >
                  <option value="">(choose)</option>
                  {(prop.enum ?? []).map((option, index, options) => (
                    <option key={index} value={String(index)}>
                      {enumLabel(option, options)}
                    </option>
                  ))}
                </Select>
              ) : type === 'json' ? (
                <Textarea
                  id={fieldId}
                  value={String(values[key] ?? '')}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                />
              ) : (
                <Input
                  id={fieldId}
                  type={type === 'number' ? 'number' : 'text'}
                  value={String(values[key] ?? '')}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                />
              )}
              {prop.description ? <HelpText>{prop.description}</HelpText> : null}
            </FieldGroup>
          );
        })
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
