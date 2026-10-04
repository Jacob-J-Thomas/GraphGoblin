/** Text-entry fields: strings (plain, multi-line, template, expression) and numbers. */
import { useId } from 'react';
import { Input, Textarea } from '../../components/ui/index.js';
import { CodeField } from '../CodeField.js';
import { unwrap, type FieldShape } from '../introspect.js';
import { Row, useField, type FieldProps } from './shared.js';

const LANGUAGE_TAG: Record<'template' | 'expression', string> = {
  template: 'Liquid',
  expression: 'JSONata',
};

export function StringField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Extract<FieldShape, { kind: 'string' }> }) {
  const field = useField(name);
  const id = useId();
  const { optional, defaultValue } = unwrap(schema);
  const value = typeof field.value === 'string' ? field.value : '';
  const set = (next: string) => {
    const blank = shape.format === 'text' ? next === '' : next.trim() === '';
    field.onChange(blank ? (optional ? undefined : '') : next);
  };
  if (shape.format !== 'text') {
    return (
      <Row
        label={label}
        htmlFor={id}
        name={name}
        aside={
          <span className="rounded-sm border border-default bg-surface-sunken px-1.5 font-mono text-[11px] font-medium text-muted">
            {LANGUAGE_TAG[shape.format]}
          </span>
        }
      >
        <CodeField
          kind={shape.format}
          value={value}
          onChange={set}
          label={label}
          id={id}
          optional={optional}
        />
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

export function NumberField({
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
