/**
 * The dispatcher and the structural fields (objects, arrays, records, unions). They render `Field`
 * for their children, so they live in one module with it: the field families they draw on are
 * imported, never the other way round.
 */
import { useId, useRef, useState } from 'react';
import { Icon } from '../../components/icons/index.js';
import { Button, Checkbox, HelpText, Input, Label, Select } from '../../components/ui/index.js';
import { repathParseErrors, useParseErrors } from '../parse-errors.js';
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
import { useCollectionFocus } from './collection.js';
import { JsonField, JsonText } from './json.js';
import {
  FIELDSET,
  FieldError,
  joinPath,
  LEGEND,
  useCollectionField,
  useField,
  type FieldProps,
} from './shared.js';
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
  const parseErrors = useParseErrors();
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              repathParseErrors(parseErrors, [{ from: name }]);
              field.onChange(undefined);
            }}
          >
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
  const field = useCollectionField(name);
  const { defaultValue } = unwrap(schema);
  const itemsOf = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [];
  const items = itemsOf(field.value);
  const element = shapeOf(shape.element);
  const parseErrors = useParseErrors();
  const focus = useCollectionFocus();
  const [identity, setIdentity] = useState(() => ({
    ids: items.map((_, i) => i),
    nextId: items.length,
  }));
  let rowIds = identity.ids;
  // External resets and shared union fields can change the count without a collection action.
  // Reconcile before rendering children so every row has a unique identity on its first mount.
  if (rowIds.length !== items.length) {
    let nextId = identity.nextId;
    rowIds = Array.from({ length: items.length }, (_, i) => rowIds[i] ?? nextId++);
    setIdentity({ ids: rowIds, nextId });
  }
  const remove = (index: number) => {
    const current = itemsOf(field.read());
    repathParseErrors(
      parseErrors,
      current.slice(index).map((_, offset) => ({
        from: joinPath(name, index + offset),
        ...(offset === 0 ? {} : { to: joinPath(name, index + offset - 1) }),
      })),
    );
    setIdentity((previous) => ({ ...previous, ids: previous.ids.filter((_, i) => i !== index) }));
    field.onChange(current.filter((_, i) => i !== index));
    focus.announce(`Removed ${label.toLowerCase()} ${index + 1}`);
  };
  const add = () => {
    const current = itemsOf(field.read());
    setIdentity((previous) => ({
      ids: [...previous.ids, previous.nextId],
      nextId: previous.nextId + 1,
    }));
    field.onChange([...current, initialValue(shape.element)]);
    focus.announce(`Added ${label.toLowerCase()} ${current.length + 1}`, current.length);
  };

  if (element.kind === 'enum') {
    const toggle = (option: string, on: boolean) => {
      const current = itemsOf(field.read());
      const next = on ? [...current, option] : current.filter((v) => v !== option);
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
    <fieldset ref={focus.ref} tabIndex={-1} className={FIELDSET} data-field={name}>
      <legend className={LEGEND}>{label}</legend>
      {items.map((_, index) => (
        <div
          key={rowIds[index]}
          data-collection-row={index}
          className="grid gap-2 border-l-2 border-default pl-3"
        >
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
              onClick={() => remove(index)}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button ref={focus.addRef} size="sm" variant="outline" disabled={!canAdd} onClick={add}>
          Add {label.toLowerCase()}
        </Button>
      </div>
      <FieldError name={name} />
      {focus.status}
    </fieldset>
  );
}

function RecordField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Extract<FieldShape, { kind: 'record' }> }) {
  const field = useCollectionField(name);
  const { optional } = unwrap(schema);
  const recordOf = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const record = recordOf(field.value);
  const entries = Object.entries(record);
  const currentEntries = () => Object.entries(recordOf(field.read()));
  const valueShape = shapeOf(shape.value);
  const parseErrors = useParseErrors();
  const focus = useCollectionFocus();
  const [rowIds, setRowIds] = useState(() => new Map(entries.map(([key], i) => [key, i])));
  const nextIdRef = useRef(entries.length);
  const commit = (next: [string, unknown][]) =>
    field.onChange(next.length === 0 && optional ? undefined : Object.fromEntries(next));
  const rename = (oldKey: string, key: string): boolean => {
    const current = currentEntries();
    if (current.some(([existing]) => existing === key && existing !== oldKey)) return false;
    repathParseErrors(parseErrors, [
      { from: joinPath(name, oldKey), to: joinPath(name, key), exact: true },
    ]);
    setRowIds((ids) => {
      const next = new Map(ids);
      const id = next.get(oldKey)!;
      next.delete(oldKey);
      next.set(key, id);
      return next;
    });
    commit(current.map((entry) => (entry[0] === oldKey ? [key, entry[1]] : entry)));
    return true;
  };
  const setValue = (index: number, value: unknown) =>
    commit(currentEntries().map((entry, i) => (i === index ? [entry[0], value] : entry)));
  const add = () => {
    const current = recordOf(field.read());
    const currentRows = Object.entries(current);
    let n = currentRows.length + 1;
    while (`key${n}` in current) n += 1;
    const key = `key${n}`;
    const id = nextIdRef.current++;
    setRowIds((ids) => new Map(ids).set(key, id));
    commit([...currentRows, [key, valueShape.kind === 'string' ? '' : initialValue(shape.value)]]);
    focus.announce(`Added ${label.toLowerCase()} ${key}`, currentRows.length);
  };
  const remove = (key: string) => {
    repathParseErrors(parseErrors, [{ from: joinPath(name, key), exact: true }]);
    setRowIds((ids) => {
      const next = new Map(ids);
      next.delete(key);
      return next;
    });
    commit(currentEntries().filter(([existing]) => existing !== key));
    focus.announce(`Removed ${label.toLowerCase()} ${key}`);
  };
  return (
    <fieldset ref={focus.ref} tabIndex={-1} className={FIELDSET} data-field={name}>
      <legend className={LEGEND}>{label}</legend>
      {entries.map(([key, value], index) => (
        <div
          key={rowIds.get(key)}
          data-collection-row={index}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2"
        >
          <RecordKey
            label={`${label} key ${index + 1}`}
            value={key}
            rename={(next) => rename(key, next)}
            otherKeys={entries.filter(([other]) => other !== key).map(([other]) => other)}
            announce={(message) => focus.announce(message, undefined, false)}
          />
          <Button
            size="icon"
            variant="ghost"
            className="col-start-2 row-start-1"
            aria-label={`Remove ${label.toLowerCase()} ${key}`}
            onClick={() => remove(key)}
          >
            <Icon name="close" />
          </Button>
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
        </div>
      ))}
      <div>
        <Button ref={focus.addRef} size="sm" variant="outline" onClick={add}>
          Add entry
        </Button>
      </div>
      <FieldError name={name} />
      {focus.status}
    </fieldset>
  );
}

/** A rejected rename keeps its draft text while the record keeps both committed values. */
function RecordKey({
  label,
  value,
  rename,
  otherKeys,
  announce,
}: {
  label: string;
  value: string;
  rename: (next: string) => boolean;
  otherKeys: string[];
  announce: (message: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  const error = otherKeys.includes(text)
    ? `Key "${text}" already exists. Choose a unique key.`
    : undefined;
  return (
    <div className="min-w-0">
      <Input
        aria-label={label}
        className="font-mono text-sm"
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? id : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          rename(next);
        }}
        onBlur={() => {
          if (error) {
            setText(value);
            announce(`Reverted key to "${value}"`);
          } else if (text !== value) {
            rename(text);
          }
        }}
      />
      {error ? (
        <HelpText id={id} tone="bad">
          {error}
        </HelpText>
      ) : null}
    </div>
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
  const parseErrors = useParseErrors();
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
            repathParseErrors(parseErrors, [{ from: name }]);
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
