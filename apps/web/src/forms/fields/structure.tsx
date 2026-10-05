/**
 * The dispatcher and the structural fields (objects, arrays, records, unions). They render `Field`
 * for their children, so they live in one module with it: the field families they draw on are
 * imported, never the other way round.
 */
import {
  use,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useWatch } from 'react-hook-form';
import { Icon } from '../../components/icons/index.js';
import {
  Badge,
  Button,
  Checkbox,
  Disclosure,
  Fieldset,
  FieldGroup,
  HelpText,
  Input,
  Label,
  Legend,
  RequiredMarker,
  Select,
} from '../../components/ui/index.js';
import { cn } from '../../lib/utils.js';
import { labelOf } from '../layout.js';
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
import { BooleanField, EnumField, LiteralField, NOT_SET } from './choice.js';
import { useCollectionFocus } from './collection.js';
import { JsonControl, JsonField } from './json.js';
import {
  FieldControlsContext,
  FieldError,
  FieldHelp,
  fieldMeta,
  joinPath,
  useCollectionField,
  useField,
  useFieldControl,
  useFieldErrorMessage,
  useProblemCount,
  type FieldProps,
} from './shared.js';
import { NumberField, StringControl, StringField } from './text.js';
import { stripUnset } from '../unset.js';

/**
 * A field: the control registered under its metadata's `control` name (SchemaForm's `controls`),
 * else the default renderer for its shape.
 */
export function Field(props: FieldProps) {
  const controls = use(FieldControlsContext);
  const name = fieldMeta(props.schema).control;
  const Control = name === undefined ? undefined : controls[name];
  return Control ? <Control {...props} /> : <DefaultField {...props} />;
}

/** The default renderer: dispatch on the schema's shape. */
export function DefaultField({ schema, name, label, bare }: FieldProps) {
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
      return (
        <ObjectField schema={schema} name={name} label={label} shape={shape.shape} bare={bare} />
      );
    case 'array':
      return <ArrayField schema={schema} name={name} label={label} shape={shape} />;
    case 'record':
      return <RecordField schema={schema} name={name} label={label} shape={shape} />;
    case 'union':
      return <UnionField schema={schema} name={name} label={label} shape={shape} bare={bare} />;
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
          <Field key={key} schema={child} name={joinPath(name, key)} label={labelOf(key, child)} />
        ))}
    </>
  );
}

/**
 * A group's frame: a bordered fieldset named by its legend, or, `bare` inside a frame that already
 * names it (a collapsible list item), a borderless one whose legend only assistive technology reads.
 */
function GroupFrame({
  name,
  label,
  bare,
  helpId,
  help,
  children,
}: {
  name: string;
  label: string;
  bare?: boolean | undefined;
  helpId?: string | undefined;
  help?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Fieldset
      data-field={name}
      className={bare ? 'border-0 p-0' : undefined}
      aria-describedby={help !== undefined ? helpId : undefined}
    >
      <Legend className={bare ? 'sr-only' : undefined}>{label}</Legend>
      {helpId !== undefined ? <FieldHelp id={helpId} help={help} /> : null}
      {children}
    </Fieldset>
  );
}

function ObjectField({
  schema,
  name,
  label,
  shape,
  bare,
}: FieldProps & { shape: Record<string, Schema> }) {
  const field = useField(name);
  const helpId = `${useId()}-help`;
  const { optional, hasDefault, base } = unwrap(schema);
  const { help } = fieldMeta(schema);
  const absent = field.value === undefined || field.value === null;
  const parseErrors = useParseErrors();
  if (optional && !hasDefault && absent) {
    return (
      <div data-field={name}>
        <AddButton onClick={() => field.onChange(initialValue(base))}>
          Add {label.toLowerCase()}
        </AddButton>
      </div>
    );
  }
  return (
    <GroupFrame name={name} label={label} bare={bare} helpId={helpId} help={help}>
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
            <Icon name="close" />
            Remove {label.toLowerCase()}
          </Button>
        </div>
      ) : null}
      <ObjectBody shape={shape} name={name} />
      <FieldError name={name} />
    </GroupFrame>
  );
}

/** Adds an item, an entry, or an optional group: a secondary button with a plus. */
function AddButton({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button size="sm" variant="secondary" {...props}>
      <Icon name="plus" />
      {children}
    </Button>
  );
}

/**
 * Removes one row of a collection: an icon button named for the row ("Remove args 2"), beside the
 * row's controls, so Tab reaches it after them, as it reads.
 */
function RemoveButton(props: { 'aria-label': string; onClick: () => void }) {
  return (
    <Button size="icon" variant="ghost" {...props}>
      <Icon name="close" />
    </Button>
  );
}

/** One row of a collection, on a left rail: the row's fields, then its Remove button. */
const COLLECTION_ROW =
  'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 border-l-2 border-default pl-3';

/** One collapsible row of a list (`collapseItems`), on the same rail; its header holds Remove. */
const COLLAPSIBLE_ROW = 'grid min-w-0 border-l-2 border-default pl-2';

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
  // Rows there when the form opened have the first ids; collapsible ones start collapsed.
  const [openedWith] = useState(items.length);
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
  const { required, help, collapseItems } = fieldMeta(schema);
  const collapsible = collapseItems === true && element.kind === 'union';
  const rule =
    element.kind === 'enum'
      ? choicesRule(shape.min, shape.max, element.options.length)
      : itemsRule(shape.min);
  const group = useGroupDescription(name, help, rule);

  if (element.kind === 'enum') {
    const toggle = (option: string, on: boolean) => {
      const current = itemsOf(field.read());
      const next = on ? [...current, option] : current.filter((v) => v !== option);
      field.onChange(next);
    };
    return (
      <EnumSetField
        name={name}
        label={label}
        required={required}
        help={help}
        rule={rule}
        group={group}
        options={element.options}
        chosen={items}
        toggle={toggle}
      />
    );
  }

  if (!Array.isArray(field.value) && Array.isArray(defaultValue) && defaultValue.length > 0) {
    // Item fields bind to paths inside the value; drawing them over a default the value does not
    // hold yet would make them validate `undefined`. Show the default and copy it on request.
    return (
      <Fieldset data-field={name}>
        <Legend>{label}</Legend>
        <p className="text-xs text-muted">
          Default: <code className="text-default">{JSON.stringify(defaultValue)}</code>
        </p>
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => field.onChange(structuredClone(defaultValue))}
          >
            <Icon name="edit" />
            Customize {label.toLowerCase()}
          </Button>
        </div>
      </Fieldset>
    );
  }
  const canAdd = shape.max === undefined || items.length < shape.max;
  // A row holding a group of fields keeps Remove at its foot, after them; a row holding one
  // control keeps Remove beside that control (below the row's label).
  const compound = ['object', 'array', 'record', 'union'].includes(element.kind);
  return (
    <Fieldset ref={focus.ref} tabIndex={-1} data-field={name} aria-describedby={group.describedBy}>
      <GroupLegend label={label} required={required} />
      <GroupText group={group} help={help} rule={rule} />
      {items.map((_, index) => {
        const removeButton = (
          <RemoveButton
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            onClick={() => remove(index)}
          />
        );
        return collapsible ? (
          <div key={rowIds[index]} data-collection-row={index} className={COLLAPSIBLE_ROW}>
            <CollapsibleItem
              element={shape.element}
              name={joinPath(name, index)}
              label={`${label} ${index + 1}`}
              defaultOpen={(rowIds[index] ?? 0) >= openedWith}
              remove={removeButton}
            />
          </div>
        ) : (
          <div key={rowIds[index]} data-collection-row={index} className={COLLECTION_ROW}>
            <Field
              schema={shape.element}
              name={joinPath(name, index)}
              label={`${label} ${index + 1}`}
            />
            <div className={compound ? 'self-end' : 'mt-6'}>{removeButton}</div>
          </div>
        );
      })}
      <div>
        <AddButton ref={focus.addRef} disabled={!canAdd} onClick={add}>
          Add {label.toLowerCase()}
        </AddButton>
      </div>
      <FieldError name={name} id={group.ids.error} />
      {focus.status}
    </Fieldset>
  );
}

/** How many items a list needs, when it needs any: "At least 2 items." */
function itemsRule(min: number | undefined): string | undefined {
  if (min === undefined || min < 1) return undefined;
  return `At least ${min} ${min === 1 ? 'item' : 'items'}.`;
}

/**
 * How many members of an enum a set takes, when that limits the choice: "Choose at least 1.",
 * "Choose at most 2.", or both. A maximum of every member limits nothing.
 */
function choicesRule(min: number | undefined, max: number | undefined, count: number) {
  const parts = [
    ...(min !== undefined && min >= 1 ? [`at least ${min}`] : []),
    ...(max !== undefined && max < count ? [`at most ${max}`] : []),
  ];
  return parts.length === 0 ? undefined : `Choose ${parts.join(' and ')}.`;
}

/**
 * Ids for a group's (an array's, a record's, a set of choices') help, rule, and error text, and the
 * description that links them to the group. A group takes no `aria-required` (it is no form
 * control); its legend shows the marker and the rule says what it needs.
 */
function useGroupDescription(name: string, help: string | undefined, rule: string | undefined) {
  const id = useId();
  const message = useFieldErrorMessage(name);
  const ids = { help: `${id}-help`, rule: `${id}-rule`, error: `${id}-error` };
  const describedBy =
    cn(rule !== undefined && ids.rule, help !== undefined && ids.help, message && ids.error) ||
    undefined;
  return { ids, describedBy };
}

type GroupDescription = ReturnType<typeof useGroupDescription>;

/** A group's legend with the required marker after it (outside its accessible name). */
function GroupLegend({
  label,
  required,
  variant = 'group',
}: {
  label: string;
  required: boolean;
  variant?: 'group' | 'label';
}) {
  return (
    <Legend variant={variant}>
      {label}
      {required ? (
        <>
          {' '}
          <RequiredMarker />
        </>
      ) : null}
    </Legend>
  );
}

/** A group's rule ("At least 2 items.") and help, under its legend. */
function GroupText({
  group,
  help,
  rule,
}: {
  group: GroupDescription;
  help: string | undefined;
  rule: string | undefined;
}) {
  return (
    <>
      {rule === undefined ? null : <HelpText id={group.ids.rule}>{rule}</HelpText>}
      <FieldHelp id={group.ids.help} help={help} />
    </>
  );
}

/**
 * An array of enum members as a group of checkboxes, one per member, named by its legend and
 * described by its rule, help, and error text. The group, not each checkbox, is marked required.
 */
function EnumSetField({
  name,
  label,
  required,
  help,
  rule,
  group,
  options,
  chosen,
  toggle,
}: {
  name: string;
  label: string;
  required: boolean;
  help: string | undefined;
  rule: string | undefined;
  group: GroupDescription;
  options: string[];
  chosen: unknown[];
  toggle: (option: string, on: boolean) => void;
}) {
  return (
    <fieldset
      className="grid min-w-0 gap-1.5"
      data-field={name}
      aria-describedby={group.describedBy}
    >
      <GroupLegend label={label} required={required} variant="label" />
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2 font-mono text-sm font-medium"
          >
            <Checkbox
              checked={chosen.includes(option)}
              onChange={(e) => toggle(option, e.target.checked)}
            />
            {option}
          </label>
        ))}
      </div>
      <GroupText group={group} help={help} rule={rule} />
      <FieldError name={name} id={group.ids.error} />
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
  const { required, help } = fieldMeta(schema);
  const group = useGroupDescription(name, help, undefined);
  return (
    <Fieldset ref={focus.ref} tabIndex={-1} data-field={name} aria-describedby={group.describedBy}>
      <GroupLegend label={label} required={required} />
      <GroupText group={group} help={help} rule={undefined} />
      {entries.map(([key, value], index) => (
        <div key={rowIds.get(key)} data-collection-row={index} className={COLLECTION_ROW}>
          <RecordKey
            label={`${label} key ${index + 1}`}
            value={key}
            rename={(next) => rename(key, next)}
            otherKeys={entries.filter(([other]) => other !== key).map(([other]) => other)}
            announce={(message) => focus.announce(message, undefined, false)}
          />
          {/* Beside the key, and before the value in the reading and Tab order. */}
          <div className="col-start-2 row-start-1 mt-6">
            <RemoveButton
              aria-label={`Remove ${label.toLowerCase()} ${key}`}
              onClick={() => remove(key)}
            />
          </div>
          {/* The value is a field of its own at `<record>.<key>`: its marker, help, error, and
              unparsed JSON all follow that path, so a rename or removal moves them with the row. */}
          <div className="col-span-2 col-start-1 row-start-2 min-w-0">
            <RecordValue
              schema={shape.value}
              name={joinPath(name, key)}
              label={`${label} value ${index + 1}`}
              value={value}
              onChange={(next) => setValue(index, next)}
            />
          </div>
        </div>
      ))}
      <div>
        <AddButton ref={focus.addRef} onClick={add}>
          Add entry
        </AddButton>
      </div>
      <FieldError name={name} id={group.ids.error} />
      {focus.status}
    </Fieldset>
  );
}

/**
 * One record entry's value, drawn by the same field renderers as any other field over the value
 * the record hands it: a string as an input or a template or expression editor, anything else as
 * JSON. Its visible caption is "Value"; its accessible name says which record and row.
 */
function RecordValue({
  schema,
  name,
  label,
  value,
  onChange,
}: {
  schema: Schema;
  name: string;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const shape = shapeOf(schema);
  return shape.kind === 'string' ? (
    <StringControl
      schema={schema}
      shape={shape}
      name={name}
      label={label}
      caption="Value"
      value={value}
      onChange={onChange}
    />
  ) : (
    <JsonControl
      schema={schema}
      name={name}
      label={label}
      caption="Value"
      value={value}
      onChange={onChange}
    />
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
  const inputId = `${id}-key`;
  const [text, setText] = useState(value);
  const error = otherKeys.includes(text)
    ? `Key "${text}" already exists. Choose a unique key.`
    : undefined;
  const announcedErrorRef = useRef(false);
  useEffect(() => {
    if (error && !announcedErrorRef.current) announce(`Key "${text}" already exists`);
    announcedErrorRef.current = error !== undefined;
  }, [error, text, announce]);
  return (
    <FieldGroup>
      {/* A short caption over the key; the input's accessible name says which record and row. */}
      <Label htmlFor={inputId}>Key</Label>
      <Input
        id={inputId}
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
            announce(`Reverted key to "${value}": "${text}" already exists`);
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
    </FieldGroup>
  );
}

function UnionField({
  schema,
  name,
  label,
  shape,
  bare,
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
  // The variant picker is the union's own control: it carries the marker, the help, and the error.
  const { required, help } = fieldMeta(schema);
  const { control, helpId, errorId } = useFieldControl(name, id, {
    help: help !== undefined,
    required,
  });
  return (
    <GroupFrame name={name} label={label} bare={bare}>
      <FieldGroup>
        <Label htmlFor={id} required={required}>
          {shape.discriminator ? humanize(shape.discriminator) : 'Kind'}
        </Label>
        <Select
          {...control}
          value={unset ? '' : String(index)}
          onChange={(e) => {
            repathParseErrors(parseErrors, [{ from: name }]);
            if (e.target.value === '') return field.onChange(undefined);
            field.onChange(initialValue(shape.options[Number(e.target.value)] as Schema));
          }}
        >
          {optional && !hasDefault ? <option value="">{NOT_SET}</option> : null}
          {shape.options.map((o, i) => (
            <option key={i} value={i}>
              {optionLabel(o, shape.discriminator)}
            </option>
          ))}
        </Select>
        <FieldHelp id={helpId} help={help} />
      </FieldGroup>
      {unset ? null : optionShape.kind === 'object' ? (
        <ObjectBody shape={optionShape.shape} name={name} skip={shape.discriminator} />
      ) : optionShape.kind === 'literal' ? null : (
        <Field schema={option} name={name} label="Value" />
      )}
      <FieldError name={name} id={errorId} />
    </GroupFrame>
  );
}

/**
 * The one-line summary of a list item of a discriminated union: its kind (the tag's value) and its
 * path, or whatever its first short text says ("set /vars/topic", "drop messages").
 */
export function itemSummary(
  element: Schema,
  value: unknown,
): { kind: string; detail: string | undefined } | undefined {
  const shape = shapeOf(element);
  if (shape.kind !== 'union' || !shape.discriminator) return undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const kind = record[shape.discriminator];
  if (typeof kind !== 'string') return undefined;
  const option = shapeOf(shape.options[matchOption(shape.options, value, shape.discriminator)]!);
  const keys = option.kind === 'object' ? Object.keys(option.shape) : [];
  const detail = keys
    .filter((key) => key !== shape.discriminator)
    .map((key) => record[key])
    .find(
      (item): item is string | number =>
        (typeof item === 'string' && item.trim() !== '') || typeof item === 'number',
    );
  return { kind, detail: detail === undefined ? undefined : String(detail) };
}

/**
 * One item of a list whose items collapse (`collapseItems`): a disclosure whose header names the
 * item, summarises it (its kind and path), and flags its problems while it is collapsed, with the
 * item's Remove button beside it. Items there when the form opened start collapsed; added ones
 * start open.
 */
function CollapsibleItem({
  element,
  name,
  label,
  defaultOpen,
  remove,
}: {
  element: Schema;
  name: string;
  label: string;
  defaultOpen: boolean;
  remove: ReactNode;
}) {
  const value: unknown = useWatch({ name });
  const summary = itemSummary(element, stripUnset(value));
  const problems = useProblemCount([name]);
  return (
    <Disclosure
      variant="row"
      defaultOpen={defaultOpen}
      label={<span className="font-medium">{label}</span>}
      summary={
        <>
          {summary ? (
            <span className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs">
              <code className="rounded-sm bg-surface-sunken px-1 text-default">{summary.kind}</code>
              {summary.detail === undefined ? null : (
                <>
                  {' '}
                  <span className="min-w-0 truncate text-muted">{summary.detail}</span>
                </>
              )}
            </span>
          ) : null}{' '}
          <ProblemBadge count={problems} />
        </>
      }
      actions={remove}
    >
      <Field schema={element} name={name} label={label} bare />
    </Disclosure>
  );
}

/** "1 error", "3 errors" on the bad tone, with its glyph; nothing when there are none. */
export function ProblemBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge size="sm" tone="bad">
      <Icon name="alert" />
      {count} {count === 1 ? 'error' : 'errors'}
    </Badge>
  );
}
