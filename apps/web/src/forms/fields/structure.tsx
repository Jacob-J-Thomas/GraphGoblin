/**
 * The dispatcher and the structural fields (objects, arrays, records, unions). They render `Field`
 * for their children, so they live in one module with it: the field families they draw on are
 * imported, never the other way round.
 */
import { useId } from 'react';
import { Icon } from '../../components/icons/index.js';
import { Button, Checkbox, Input, Label, Select } from '../../components/ui/index.js';
import {
  humanize,
  initialValue,
  matchOption,
  optionLabel,
  shapeOf,
  unwrap,
  type FieldShape,
  type Schema,
} from '../introspect.js';
import { BooleanField, EnumField, LiteralField } from './choice.js';
import { JsonField, JsonText } from './json.js';
import { FIELDSET, FieldError, joinPath, LEGEND, useField, type FieldProps } from './shared.js';
import { NumberField, StringField } from './text.js';

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
      <div data-field={name}>
        <Button size="sm" variant="outline" onClick={() => field.onChange(initialValue(base))}>
          Add {label.toLowerCase()}
        </Button>
      </div>
    );
  }
  return (
    <fieldset className={FIELDSET} data-field={name}>
      <legend className={LEGEND}>{label}</legend>
      {optional && !hasDefault ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => field.onChange(undefined)}>
            Remove {label.toLowerCase()}
          </Button>
        </div>
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
      <fieldset className="grid gap-2" data-field={name}>
        <legend className="mb-2 text-sm font-medium">{label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {element.options.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2 font-mono text-sm font-medium"
            >
              <Checkbox
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
      <fieldset className={FIELDSET} data-field={name}>
        <legend className={LEGEND}>{label}</legend>
        <p className="text-xs text-muted">
          Default: <code className="text-default">{JSON.stringify(defaultValue)}</code>
        </p>
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => field.onChange(structuredClone(defaultValue))}
          >
            Customize {label.toLowerCase()}
          </Button>
        </div>
      </fieldset>
    );
  }
  const canAdd = shape.max === undefined || items.length < shape.max;
  return (
    <fieldset className={FIELDSET} data-field={name}>
      <legend className={LEGEND}>{label}</legend>
      {items.map((_, index) => (
        <div key={index} className="grid gap-2 border-l-2 border-default pl-3">
          <Field
            schema={shape.element}
            name={joinPath(name, index)}
            label={`${label} ${index + 1}`}
          />
          <div>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              onClick={() => field.onChange(items.filter((__, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={!canAdd}
          onClick={() => field.onChange([...items, initialValue(shape.element)])}
        >
          Add {label.toLowerCase()}
        </Button>
      </div>
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
    <fieldset className={FIELDSET} data-field={name}>
      <legend className={LEGEND}>{label}</legend>
      {entries.map(([key, value], index) => (
        <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <Input
            aria-label={`${label} key ${index + 1}`}
            className="font-mono text-sm"
            value={key}
            onChange={(e) => rename(index, e.target.value)}
          />
          <div className="col-span-2 col-start-1 row-start-2 min-w-0">
            {valueShape.kind === 'string' ? (
              <Input
                aria-label={`${label} value ${index + 1}`}
                className="font-mono text-sm"
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
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="col-start-2 row-start-1"
            aria-label={`Remove ${label.toLowerCase()} ${key}`}
            onClick={() => commit(entries.filter((_, i) => i !== index))}
          >
            <Icon name="close" />
          </Button>
        </div>
      ))}
      <div>
        <Button size="sm" variant="outline" onClick={add}>
          Add entry
        </Button>
      </div>
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
    <fieldset className={FIELDSET} data-field={name}>
      <legend className={LEGEND}>{label}</legend>
      <div className="grid gap-1.5">
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
      </div>
      {unset ? null : optionShape.kind === 'object' ? (
        <ObjectBody shape={optionShape.shape} name={name} skip={shape.discriminator} />
      ) : optionShape.kind === 'literal' ? null : (
        <Field schema={option} name={name} label="Value" />
      )}
      <FieldError name={name} />
    </fieldset>
  );
}
