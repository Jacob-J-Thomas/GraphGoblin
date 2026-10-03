/**
 * Field renderers for the schema-driven form. Each one binds to react-hook-form through
 * `useController` at a dotted path and draws one Zod construct (see introspect.ts).
 */
import { useId, useState, type ReactNode } from 'react';
import { get, useController, useFormContext } from 'react-hook-form';
import { Button, Input, Label, Select, Textarea } from '../components/ui.js';
import { parseJson, prettyJson } from '../lib/utils.js';
import { CodeEditor } from './CodeEditor.js';
import { CodeField } from './CodeField.js';
import {
  humanize,
  initialValue,
  matchOption,
  optionLabel,
  shapeOf,
  unwrap,
  type FieldShape,
  type Schema,
} from './introspect.js';
import { useParseErrors } from './parse-errors.js';
import { isUnset, UNSET } from './unset.js';

/**
 * `useController` with an explicit "unset" state. react-hook-form shows a field's initial value
 * again when its value becomes `undefined`, so clearing stores the UNSET sentinel instead, which
 * this hook reads back as `undefined` and SchemaForm strips before validation and reporting.
 */
function useField(name: string) {
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

function FieldError({ name }: { name: string }) {
  const {
    formState: { errors },
  } = useFormContext();
  const error = get(errors, name) as { message?: string; root?: { message?: string } } | undefined;
  const message = error?.message ?? error?.root?.message;
  if (!message) return null;
  return (
    <p className="mt-0.5 text-xs text-orange-800" role="alert">
      {message}
    </p>
  );
}

function Row({
  label,
  htmlFor,
  children,
  name,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  name: string;
}) {
  return (
    <div className="mb-2" data-field={name}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      <FieldError name={name} />
    </div>
  );
}

interface FieldProps {
  schema: Schema;
  name: string;
  label: string;
}

/** Dispatch on the schema's shape. */
export function Field({ schema, name, label }: FieldProps) {
  const shape = shapeOf(schema);
  switch (shape.kind) {
    case 'string':
      return <StringField schema={schema} name={name} label={label} shape={shape} />;
    case 'number':
      return <NumberField schema={schema} name={name} label={label} shape={shape} />;
    case 'boolean':
      return <BooleanField schema={schema} name={name} label={label} />;
    case 'enum':
      return <EnumField schema={schema} name={name} label={label} options={shape.options} />;
    case 'literal':
      return <LiteralField name={name} label={label} value={shape.value} />;
    case 'object':
      return <ObjectField schema={schema} name={name} label={label} shape={shape.shape} />;
    case 'array':
      return <ArrayField schema={schema} name={name} label={label} shape={shape} />;
    case 'record':
      return <RecordField schema={schema} name={name} label={label} shape={shape} />;
    case 'union':
      return <UnionField schema={schema} name={name} label={label} shape={shape} />;
    case 'json':
      return <JsonField schema={schema} name={name} label={label} />;
  }
}

function StringField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Extract<FieldShape, { kind: 'string' }> }) {
  const field = useField(name);
  const id = useId();
  const { optional, defaultValue } = unwrap(schema);
  const value = typeof field.value === 'string' ? field.value : '';
  const set = (next: string) => field.onChange(next === '' && optional ? undefined : next);
  if (shape.format !== 'text') {
    return (
      <Row label={label} htmlFor={id} name={name}>
        <CodeField kind={shape.format} value={value} onChange={set} label={label} id={id} />
      </Row>
    );
  }
  const placeholder = typeof defaultValue === 'string' ? defaultValue : undefined;
  const multiline = /description|content|replacement/i.test(name.split('.').pop() ?? '');
  return (
    <Row label={label} htmlFor={id} name={name}>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => set(e.target.value)}
          onBlur={field.onBlur}
        />
      ) : (
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => set(e.target.value)}
          onBlur={field.onBlur}
        />
      )}
    </Row>
  );
}

function NumberField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Extract<FieldShape, { kind: 'number' }> }) {
  const field = useField(name);
  const id = useId();
  const { defaultValue } = unwrap(schema);
  const value =
    typeof field.value === 'number' && Number.isFinite(field.value) ? String(field.value) : '';
  return (
    <Row label={label} htmlFor={id} name={name}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        step={shape.integer ? 1 : 'any'}
        min={shape.min}
        max={shape.max}
        value={value}
        placeholder={typeof defaultValue === 'number' ? String(defaultValue) : undefined}
        onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        onBlur={field.onBlur}
      />
    </Row>
  );
}

function BooleanField({ schema, name, label }: FieldProps) {
  const field = useField(name);
  const id = useId();
  const { hasDefault, defaultValue, optional } = unwrap(schema);
  if (optional && !hasDefault) {
    const current = field.value === true ? 'true' : field.value === false ? 'false' : '';
    return (
      <Row label={label} htmlFor={id} name={name}>
        <Select
          id={id}
          value={current}
          onChange={(e) =>
            field.onChange(e.target.value === '' ? undefined : e.target.value === 'true')
          }
        >
          <option value="">(not set)</option>
          <option value="true">yes</option>
          <option value="false">no</option>
        </Select>
      </Row>
    );
  }
  const checked = typeof field.value === 'boolean' ? field.value : defaultValue === true;
  return (
    <div className="mb-2 flex items-center gap-2" data-field={name}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => field.onChange(e.target.checked)}
      />
      <Label htmlFor={id}>{label}</Label>
      <FieldError name={name} />
    </div>
  );
}

function EnumField({ schema, name, label, options }: FieldProps & { options: string[] }) {
  const field = useField(name);
  const id = useId();
  const { hasDefault, defaultValue, optional } = unwrap(schema);
  const current =
    typeof field.value === 'string' ? field.value : hasDefault ? String(defaultValue) : '';
  return (
    <Row label={label} htmlFor={id} name={name}>
      <Select
        id={id}
        value={current}
        onChange={(e) => field.onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        {optional && !hasDefault ? <option value="">(not set)</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </Row>
  );
}

function LiteralField({ name, label, value }: { name: string; label: string; value: unknown }) {
  return (
    <div className="mb-2 text-xs text-slate-600" data-field={name}>
      {label}: <code>{String(value)}</code>
    </div>
  );
}

function ObjectBody({
  shape,
  name,
  skip,
}: {
  shape: Record<string, Schema>;
  name: string;
  skip?: string | undefined;
}) {
  return (
    <>
      {Object.entries(shape)
        .filter(([key]) => key !== skip)
        .map(([key, child]) => (
          <Field key={key} schema={child} name={joinPath(name, key)} label={humanize(key)} />
        ))}
    </>
  );
}

function ObjectField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Record<string, Schema> }) {
  const field = useField(name);
  const { optional, hasDefault, base } = unwrap(schema);
  const absent = field.value === undefined || field.value === null;
  if (optional && !hasDefault && absent) {
    return (
      <div className="mb-2" data-field={name}>
        <Button size="sm" variant="outline" onClick={() => field.onChange(initialValue(base))}>
          Add {label.toLowerCase()}
        </Button>
      </div>
    );
  }
  return (
    <fieldset className="mb-2 rounded border border-slate-200 p-2" data-field={name}>
      <legend className="px-1 text-xs font-semibold text-slate-700">{label}</legend>
      {optional && !hasDefault ? (
        <Button size="sm" variant="ghost" onClick={() => field.onChange(undefined)}>
          Remove {label.toLowerCase()}
        </Button>
      ) : null}
      <ObjectBody shape={shape} name={name} />
      <FieldError name={name} />
    </fieldset>
  );
}

function ArrayField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Extract<FieldShape, { kind: 'array' }> }) {
  const field = useField(name);
  const { defaultValue } = unwrap(schema);
  const items: unknown[] = Array.isArray(field.value)
    ? (field.value as unknown[])
    : Array.isArray(defaultValue)
      ? (defaultValue as unknown[])
      : [];
  const element = shapeOf(shape.element);

  if (element.kind === 'enum') {
    const toggle = (option: string, on: boolean) => {
      const next = on ? [...items, option] : items.filter((v) => v !== option);
      field.onChange(next);
    };
    return (
      <fieldset className="mb-2" data-field={name}>
        <legend className="text-xs font-medium text-slate-700">{label}</legend>
        <div className="flex flex-wrap gap-3">
          {element.options.map((option) => (
            <label key={option} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={items.includes(option)}
                onChange={(e) => toggle(option, e.target.checked)}
              />
              {option}
            </label>
          ))}
        </div>
        <FieldError name={name} />
      </fieldset>
    );
  }

  if (!Array.isArray(field.value) && Array.isArray(defaultValue) && defaultValue.length > 0) {
    // Item fields bind to paths inside the value; drawing them over a default the value does not
    // hold yet would make them validate `undefined`. Show the default and copy it on request.
    return (
      <fieldset className="mb-2 rounded border border-slate-200 p-2" data-field={name}>
        <legend className="px-1 text-xs font-semibold text-slate-700">{label}</legend>
        <p className="mb-1 text-xs text-slate-600">
          Default: <code>{JSON.stringify(defaultValue)}</code>
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => field.onChange(structuredClone(defaultValue))}
        >
          Customize {label.toLowerCase()}
        </Button>
      </fieldset>
    );
  }
  const canAdd = shape.max === undefined || items.length < shape.max;
  return (
    <fieldset className="mb-2 rounded border border-slate-200 p-2" data-field={name}>
      <legend className="px-1 text-xs font-semibold text-slate-700">{label}</legend>
      {items.map((_, index) => (
        <div key={index} className="mb-2 border-l-2 border-slate-200 pl-2">
          <Field
            schema={shape.element}
            name={joinPath(name, index)}
            label={`${label} ${index + 1}`}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            onClick={() => field.onChange(items.filter((__, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={!canAdd}
        onClick={() => field.onChange([...items, initialValue(shape.element)])}
      >
        Add {label.toLowerCase()}
      </Button>
      <FieldError name={name} />
    </fieldset>
  );
}

function RecordField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Extract<FieldShape, { kind: 'record' }> }) {
  const field = useField(name);
  const { optional } = unwrap(schema);
  const record =
    typeof field.value === 'object' && field.value !== null
      ? (field.value as Record<string, unknown>)
      : {};
  const entries = Object.entries(record);
  const valueShape = shapeOf(shape.value);
  const commit = (next: [string, unknown][]) =>
    field.onChange(next.length === 0 && optional ? undefined : Object.fromEntries(next));
  const rename = (index: number, key: string) =>
    commit(entries.map((entry, i) => (i === index ? [key, entry[1]] : entry)));
  const setValue = (index: number, value: unknown) =>
    commit(entries.map((entry, i) => (i === index ? [entry[0], value] : entry)));
  const add = () => {
    let n = entries.length + 1;
    while (`key${n}` in record) n += 1;
    commit([
      ...entries,
      [`key${n}`, valueShape.kind === 'string' ? '' : initialValue(shape.value)],
    ]);
  };
  return (
    <fieldset className="mb-2 rounded border border-slate-200 p-2" data-field={name}>
      <legend className="px-1 text-xs font-semibold text-slate-700">{label}</legend>
      {entries.map(([key, value], index) => (
        <div key={index} className="mb-1 flex items-start gap-1">
          <Input
            aria-label={`${label} key ${index + 1}`}
            className="w-1/3"
            value={key}
            onChange={(e) => rename(index, e.target.value)}
          />
          {valueShape.kind === 'string' ? (
            <Input
              aria-label={`${label} value ${index + 1}`}
              className="font-mono"
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => setValue(index, e.target.value)}
            />
          ) : (
            <JsonText
              path={joinPath(name, key)}
              label={`${label} value ${index + 1}`}
              value={value}
              onChange={(v) => setValue(index, v)}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${label.toLowerCase()} ${key}`}
            onClick={() => commit(entries.filter((_, i) => i !== index))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={add}>
        Add entry
      </Button>
      <FieldError name={name} />
    </fieldset>
  );
}

function UnionField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Extract<FieldShape, { kind: 'union' }> }) {
  const field = useField(name);
  const id = useId();
  const { optional, hasDefault, defaultValue } = unwrap(schema);
  const value: unknown = field.value === undefined && hasDefault ? defaultValue : field.value;
  const unset = value === undefined;
  const index = matchOption(shape.options, value, shape.discriminator);
  const option = shape.options[index] as Schema;
  const optionShape = shapeOf(option);
  return (
    <fieldset className="mb-2 rounded border border-slate-200 p-2" data-field={name}>
      <legend className="px-1 text-xs font-semibold text-slate-700">{label}</legend>
      <Label htmlFor={id}>{shape.discriminator ? humanize(shape.discriminator) : 'Kind'}</Label>
      <Select
        id={id}
        value={unset ? '' : String(index)}
        onChange={(e) => {
          if (e.target.value === '') return field.onChange(undefined);
          field.onChange(initialValue(shape.options[Number(e.target.value)] as Schema));
        }}
      >
        {optional && !hasDefault ? <option value="">(not set)</option> : null}
        {shape.options.map((o, i) => (
          <option key={i} value={i}>
            {optionLabel(o, shape.discriminator)}
          </option>
        ))}
      </Select>
      {unset ? null : optionShape.kind === 'object' ? (
        <ObjectBody shape={optionShape.shape} name={name} skip={shape.discriminator} />
      ) : optionShape.kind === 'literal' ? null : (
        <Field schema={option} name={name} label="Value" />
      )}
      <FieldError name={name} />
    </fieldset>
  );
}

function JsonText({
  path,
  label,
  value,
  onChange,
  id,
}: {
  path: string;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  id?: string;
}) {
  const parseErrors = useParseErrors();
  // Unparsed text from an earlier visit to this field wins over the last valid value.
  const [stored] = useState(() => parseErrors.get(path));
  const [text, setText] = useState(() => stored?.text ?? prettyJson(value));
  const [error, setError] = useState<string | undefined>(stored?.message);
  const fail = (next: string, message: string | undefined) => {
    setError(message);
    parseErrors.report(path, message === undefined ? undefined : { message, text: next });
  };
  return (
    <div className="flex-1">
      <CodeEditor
        language="json"
        label={label}
        {...(id ? { id } : {})}
        value={text}
        onChange={(next) => {
          setText(next);
          if (next.trim() === '') {
            fail(next, undefined);
            onChange(undefined);
            return;
          }
          const parsed = parseJson(next);
          if (parsed.ok) {
            fail(next, undefined);
            onChange(parsed.value);
          } else fail(next, `invalid JSON: ${parsed.error}`);
        }}
      />
      {error ? (
        <p className="text-xs text-orange-800">
          {error.replace(/^invalid JSON/, 'Invalid JSON')}{' '}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Back to the last valid value; the typed text is dropped.
              const restored = prettyJson(value);
              setText(restored);
              fail(restored, undefined);
            }}
          >
            Discard text
          </Button>
        </p>
      ) : null}
    </div>
  );
}

function JsonField({ name, label }: FieldProps) {
  const field = useField(name);
  const id = useId();
  return (
    <Row label={`${label} (JSON)`} htmlFor={id} name={name}>
      <JsonText path={name} label={label} id={id} value={field.value} onChange={field.onChange} />
    </Row>
  );
}
