import type { JsonSchema } from '@graphgoblin/contracts';
import { validateJson } from '@graphgoblin/domain';
import { useId, useState, type FormEvent } from 'react';
import { Button, Input, Label, Select, Textarea } from '../components/ui/index.js';
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
 * any other schema, or none, gets a single JSON editor. Values are checked with `domain`'s
 * validator before `onSubmit`.
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
    if (schema && collected.value !== undefined) {
      const result = validateJson(schema, collected.value);
      if (!result.ok) return setErrors(result.errors);
    }
    setErrors([]);
    onSubmit(collected.value);
  };

  return (
    <form onSubmit={submit} noValidate aria-label={submitLabel}>
      {properties ? (
        Object.entries(properties).map(([key, prop]) => {
          const fieldId = `${id}-${key}`;
          const type = propertyType(prop);
          const label = prop.title ?? key;
          if (type === 'boolean') {
            return (
              <div key={key} className="mb-2 flex items-center gap-2">
                <input
                  id={fieldId}
                  type="checkbox"
                  checked={values[key] === true}
                  onChange={(e) => setValues({ ...values, [key]: e.target.checked })}
                />
                <Label htmlFor={fieldId}>{label}</Label>
              </div>
            );
          }
          return (
            <div key={key} className="mb-2">
              <Label htmlFor={fieldId}>{label}</Label>
              {type === 'enum' ? (
                <Select
                  id={fieldId}
                  value={String(values[key] ?? '')}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                >
                  <option value="">(choose)</option>
                  {(prop.enum ?? []).map((option) => (
                    <option key={String(option)} value={String(option)}>
                      {String(option)}
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
              {prop.description ? (
                <p className="text-xs text-slate-500">{prop.description}</p>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className="mb-2">
          <Label htmlFor={`${id}-json`}>Input (JSON)</Label>
          <Textarea
            id={`${id}-json`}
            value={raw}
            placeholder="{}"
            onChange={(e) => setRaw(e.target.value)}
          />
        </div>
      )}
      {errors.length > 0 ? (
        <ul role="alert" className="mb-2 list-disc pl-4 text-xs text-orange-800">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      <Button type="submit" disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
