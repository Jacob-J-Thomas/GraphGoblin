/**
 * Choice fields: booleans (a switch, or Not set / Yes / No when they may stay unset), enums (a
 * segmented control for two to four options, a select for more), and single literals.
 */
import { useId } from 'react';
import { FieldGroup, Label, SegmentedControl, Select, Switch } from '../../components/ui/index.js';
import { unwrap } from '../introspect.js';
import {
  FieldError,
  FieldHelp,
  fieldMeta,
  Row,
  useField,
  useFieldControl,
  type FieldProps,
} from './shared.js';

/** The label of the segment that leaves an optional choice unset. */
export const NOT_SET = 'Not set';

/** Small enums (two to four options) are segmented controls; one option, or five and more, a select. */
export function isSegmented(options: readonly unknown[]): boolean {
  return options.length >= 2 && options.length <= 4;
}

const YES_NO = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
] as const;

/**
 * A segmented choice in a schema-driven form: the control (named by its legend), then help and
 * error text linked to it. `notSet` offers the segment that clears the value.
 */
function SegmentedField({
  name,
  label,
  required,
  help,
  options,
  value,
  onChange,
  notSet,
}: {
  name: string;
  label: string;
  required: boolean;
  help: string | undefined;
  options: readonly { value: string; label: string }[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  notSet: boolean;
}) {
  const id = useId();
  const { control, helpId, errorId } = useFieldControl(name, id, {
    help: help !== undefined,
    required,
  });
  const common = {
    legend: label,
    options,
    value,
    required,
    describedBy: control['aria-describedby'],
    invalid: control['aria-invalid'],
  };
  return (
    <FieldGroup data-field={name}>
      {notSet ? (
        <SegmentedControl {...common} notSet={NOT_SET} onChange={onChange} />
      ) : (
        <SegmentedControl {...common} onChange={onChange} />
      )}
      <FieldHelp id={helpId} help={help} />
      <FieldError name={name} id={errorId} />
    </FieldGroup>
  );
}

export function BooleanField({ schema, name, label }: FieldProps) {
  const field = useField(name);
  const id = useId();
  const labelId = `${id}-label`;
  const { hasDefault, defaultValue, optional } = unwrap(schema);
  const { required, help } = fieldMeta(schema);
  const { control, helpId, errorId } = useFieldControl(name, id, {
    help: help !== undefined,
    required,
  });
  if (optional && !hasDefault) {
    return (
      <SegmentedField
        name={name}
        label={label}
        required={false}
        help={help}
        options={YES_NO}
        value={typeof field.value === 'boolean' ? String(field.value) : undefined}
        onChange={(next) => field.onChange(next === undefined ? undefined : next === 'true')}
        notSet
      />
    );
  }
  const checked = typeof field.value === 'boolean' ? field.value : defaultValue === true;
  return (
    <FieldGroup data-field={name}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Label id={labelId} htmlFor={id} required={required} className="cursor-pointer">
          {label}
        </Label>
        <Switch
          {...control}
          aria-labelledby={labelId}
          checked={checked}
          onCheckedChange={(next) => field.onChange(next)}
        />
      </div>
      <FieldHelp id={helpId} help={help} />
      <FieldError name={name} id={errorId} />
    </FieldGroup>
  );
}

export function EnumField({ schema, name, label, options }: FieldProps & { options: string[] }) {
  const field = useField(name);
  const id = useId();
  const { hasDefault, defaultValue, optional } = unwrap(schema);
  const { required, help } = fieldMeta(schema);
  const unsettable = optional && !hasDefault;
  const current =
    typeof field.value === 'string' ? field.value : hasDefault ? String(defaultValue) : undefined;
  const choose = (next: string | undefined) => field.onChange(next === '' ? undefined : next);
  if (isSegmented(options)) {
    return (
      <SegmentedField
        name={name}
        label={label}
        required={required}
        help={help}
        options={options.map((option) => ({ value: option, label: option }))}
        value={current}
        onChange={choose}
        notSet={unsettable}
      />
    );
  }
  return (
    <Row label={label} htmlFor={id} name={name} required={required} help={help}>
      {(control) => (
        <Select {...control} value={current ?? ''} onChange={(e) => choose(e.target.value)}>
          {unsettable ? <option value="">{NOT_SET}</option> : null}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      )}
    </Row>
  );
}

export function LiteralField({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: unknown;
}) {
  return (
    <div className="text-xs text-muted" data-field={name}>
      {label}: <code className="text-default">{String(value)}</code>
    </div>
  );
}
