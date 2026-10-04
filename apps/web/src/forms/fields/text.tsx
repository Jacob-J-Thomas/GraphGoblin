/** Text-entry fields: strings (plain, multi-line, template, expression) and numbers. */
import { useId, useState } from 'react';
import { Input, Textarea } from '../../components/ui/index.js';
import { CodeField, LanguageTag } from '../CodeField.js';
import { unwrap, type FieldShape } from '../introspect.js';
import { fieldMeta, Row, useField, useFieldErrorMessage, type FieldProps } from './shared.js';

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
  const { required, help } = fieldMeta(schema);
  const value = typeof field.value === 'string' ? field.value : '';
  const errorMessage = useFieldErrorMessage(name);
  const [draft, setDraft] = useState<{ text: string; stored: unknown }>();
  const displayed = draft && draft.stored === field.value ? draft.text : value;
  const set = (next: string) => {
    const blank = shape.format === 'expression' ? next.trim() === '' : next === '';
    const stored = blank ? (optional ? undefined : '') : next;
    // Validation sees a blank expression, while its editor retains the user's exact document.
    setDraft({ text: next, stored });
    field.onChange(stored);
  };
  const format = shape.format;
  if (format !== 'text') {
    return (
      <Row
        label={label}
        htmlFor={id}
        name={name}
        required={required}
        help={help}
        aside={<LanguageTag>{LANGUAGE_TAG[format]}</LanguageTag>}
      >
        {(control) => (
          <CodeField
            kind={format}
            value={displayed}
            onChange={set}
            label={label}
            id={id}
            optional={optional}
            errorMessage={errorMessage}
            requiredMessage={schema.safeParse('').error?.issues[0]?.message}
            describedBy={control['aria-describedby']}
            invalid={control['aria-invalid']}
          />
        )}
      </Row>
    );
  }
  const placeholder = typeof defaultValue === 'string' ? defaultValue : undefined;
  const multiline = /description|content|replacement/i.test(name.split('.').pop() ?? '');
  return (
    <Row label={label} htmlFor={id} name={name} required={required} help={help}>
      {(control) =>
        multiline ? (
          <Textarea
            {...control}
            value={value}
            placeholder={placeholder}
            onChange={(e) => set(e.target.value)}
            onBlur={field.onBlur}
          />
        ) : (
          <Input
            {...control}
            value={value}
            placeholder={placeholder}
            onChange={(e) => set(e.target.value)}
            onBlur={field.onBlur}
          />
        )
      }
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
  const { required, help } = fieldMeta(schema);
  const value =
    typeof field.value === 'number' && Number.isFinite(field.value) ? String(field.value) : '';
  return (
    <Row label={label} htmlFor={id} name={name} required={required} help={help}>
      {(control) => (
        <Input
          {...control}
          type="number"
          inputMode="numeric"
          step={shape.integer ? 1 : 'any'}
          min={shape.min}
          max={shape.max}
          value={value}
          placeholder={typeof defaultValue === 'number' ? String(defaultValue) : undefined}
          onChange={(e) =>
            field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
          }
          onBlur={field.onBlur}
        />
      )}
    </Row>
  );
}
