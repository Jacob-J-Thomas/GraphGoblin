/** Text-entry fields: strings (plain, multi-line, template, expression) and numbers. */
import { useId, useState } from 'react';
import { HelpText, Input, Textarea } from '../../components/ui/index.js';
import { CodeField, LanguageTag } from '../CodeField.js';
import { unwrap, type FieldShape, type Schema } from '../introspect.js';
import { fieldMeta, Row, useField, useFieldErrorMessage, type FieldProps } from './shared.js';
import { useParseErrors } from '../parse-errors.js';

const LANGUAGE_TAG: Record<'template' | 'expression', string> = {
  template: 'Liquid',
  expression: 'JSONata',
};

const COMPLETE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export interface StringControlProps {
  schema: Schema;
  shape: Extract<FieldShape, { kind: 'string' }>;
  /** The field's path: where its errors are, and its `data-field`. */
  name: string;
  /** The control's accessible name. */
  label: string;
  /** A shorter visible label, when `label` says more (a record row's "Value"). */
  caption?: string | undefined;
  value: unknown;
  /** The new value: a string, or `undefined` for an optional field left blank. */
  onChange: (value: string | undefined) => void;
  onBlur?: () => void;
  suggestions?: readonly string[] | undefined;
}

/**
 * A string field over a value it is handed: a text input or text area, or a template or expression
 * editor with its preview, in the field row (label, required marker, help, and the error at `name`,
 * linked to the control). StringField binds it to the form; a record row hands it one entry's value.
 */
export function StringControl({
  schema,
  shape,
  name,
  label,
  caption,
  value: given,
  onChange,
  onBlur,
  suggestions,
}: StringControlProps) {
  const id = useId();
  const { optional, defaultValue } = unwrap(schema);
  const { required, help } = fieldMeta(schema);
  const value = typeof given === 'string' ? given : '';
  const errorMessage = useFieldErrorMessage(name);
  const [draft, setDraft] = useState<{ text: string; stored: unknown }>();
  const displayed = draft && draft.stored === given ? draft.text : value;
  const set = (next: string) => {
    const blank = shape.format === 'expression' ? next.trim() === '' : next === '';
    const stored = blank ? (optional ? undefined : '') : next;
    // Validation sees a blank expression, while its editor retains the user's exact document.
    setDraft({ text: next, stored });
    onChange(stored);
  };
  const format = shape.format;
  if (format !== 'text') {
    return (
      <Row
        label={label}
        caption={caption}
        htmlFor={id}
        name={name}
        required={required}
        help={help}
        aside={<LanguageTag>{LANGUAGE_TAG[format]}</LanguageTag>}
      >
        {(control) => (
          <CodeField
            kind={format}
            path={name}
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
  const multiline =
    fieldMeta(schema).multiline ||
    /description|content|replacement/i.test(name.split('.').pop() ?? '');
  return (
    <Row label={label} caption={caption} htmlFor={id} name={name} required={required} help={help}>
      {(control) =>
        multiline ? (
          <Textarea
            {...control}
            value={value}
            placeholder={placeholder}
            onChange={(e) => set(e.target.value)}
            onBlur={onBlur}
          />
        ) : (
          <>
            <Input
              {...control}
              value={value}
              placeholder={placeholder}
              onChange={(e) => set(e.target.value)}
              onBlur={onBlur}
              list={suggestions ? `${id}-suggestions` : undefined}
            />
            {suggestions ? (
              <datalist id={`${id}-suggestions`}>
                {suggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            ) : null}
          </>
        )
      }
    </Row>
  );
}

export function StringField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Extract<FieldShape, { kind: 'string' }> }) {
  const field = useField(name, 'typing');
  return (
    <StringControl
      schema={schema}
      shape={shape}
      name={name}
      label={label}
      value={field.value}
      onChange={field.onChange}
      onBlur={field.onBlur}
    />
  );
}

export function NumberField({
  schema,
  name,
  label,
  shape,
}: FieldProps & { shape: Extract<FieldShape, { kind: 'number' }> }) {
  const field = useField(name, 'typing');
  const id = useId();
  const { defaultValue } = unwrap(schema);
  const { required, help } = fieldMeta(schema);
  const parseErrors = useParseErrors();
  const [draft, setDraft] = useState(() =>
    parseErrors.get(name)?.message === 'Enter a complete number'
      ? undefined
      : parseErrors.get(name)?.text,
  );
  const [error, setError] = useState(() => parseErrors.get(name)?.message);
  const [nativeIncomplete, setNativeIncomplete] = useState(false);
  // Native number inputs conceal incomplete tokens and their selection. Hold the blocker, not
  // reconstructed text; a remount shows the last valid number with the blocker still visible.
  if (parseErrors.tracked && error && !parseErrors.errors?.[name]) {
    setDraft(undefined);
    setError(undefined);
    setNativeIncomplete(false);
  }
  const value =
    typeof field.value === 'number' && Number.isFinite(field.value) ? String(field.value) : '';
  const edit = (input: HTMLInputElement) => {
    const badInput = input.validity.badInput;
    const text = badInput ? '' : input.value;
    const next = text === '' ? undefined : Number(text);
    const result = schema.safeParse(next);
    const incomplete =
      badInput || (text !== '' && (!COMPLETE_NUMBER.test(text) || !Number.isFinite(next)));
    const message = incomplete
      ? 'Enter a complete number'
      : result.success
        ? undefined
        : result.error.issues.map((issue) => issue.message).join('; ');
    parseErrors.report(name, message ? { message, text, input: 'unparsed text' } : undefined);
    setError(message);
    setDraft(message ? text : undefined);
    setNativeIncomplete(badInput);
    if (!message) field.onChange(next);
  };
  return (
    <Row
      label={label}
      htmlFor={id}
      name={name}
      required={required}
      help={help}
      after={
        error ? (
          <HelpText id={`${id}-draft-error`} tone="bad" role="alert">
            {error}
          </HelpText>
        ) : null
      }
    >
      {(control) => (
        <Input
          {...control}
          type="number"
          inputMode={shape.integer ? 'numeric' : 'decimal'}
          step={shape.step ?? (shape.integer ? 1 : 'any')}
          min={shape.min}
          max={shape.max}
          value={nativeIncomplete ? '' : (draft ?? value)}
          placeholder={typeof defaultValue === 'number' ? String(defaultValue) : undefined}
          aria-invalid={error ? true : control['aria-invalid']}
          aria-describedby={
            [control['aria-describedby'], error ? `${id}-draft-error` : '']
              .filter(Boolean)
              .join(' ') || undefined
          }
          // React's change tracking cannot distinguish successive native badInput tokens from
          // an intentional empty: both expose "". Input events still report each edit.
          onInput={(e) => edit(e.currentTarget)}
          onChange={(e) => {
            if (e.nativeEvent.type !== 'input') edit(e.currentTarget);
          }}
          onBlur={field.onBlur}
        />
      )}
    </Row>
  );
}
