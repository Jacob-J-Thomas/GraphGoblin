/** Choice fields: booleans (checkbox, or a tri-state select), enums, and single literals. */
import { useId } from 'react';
import { Label, Select } from '../../components/ui/index.js';
import { unwrap } from '../introspect.js';
import { CHECKBOX, FieldError, Row, useField, type FieldProps } from './shared.js';

export function BooleanField({ schema, name, label }: FieldProps) {
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
    <div className="flex flex-wrap items-center gap-2" data-field={name}>
      <input
        id={id}
        type="checkbox"
        className={CHECKBOX}
        checked={checked}
        onChange={(e) => field.onChange(e.target.checked)}
      />
      <Label htmlFor={id} className="cursor-pointer">
        {label}
      </Label>
      <FieldError name={name} />
    </div>
  );
}

export function EnumField({ schema, name, label, options }: FieldProps & { options: string[] }) {
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
