/** JSON fields: a CodeMirror JSON editor that keeps unparsed text until it parses or is dropped. */
import { useId, useState } from 'react';
import { Button, HelpText } from '../../components/ui/index.js';
import { cn, parseJson, prettyJson } from '../../lib/utils.js';
import { CodeEditor } from '../CodeEditor.js';
import { LanguageTag } from '../CodeField.js';
import { unwrap } from '../introspect.js';
import { useParseErrors } from '../parse-errors.js';
import { fieldMeta, Row, useField, type FieldProps } from './shared.js';

export function JsonText({
  path,
  label,
  value,
  onChange,
  id,
  describedBy,
  invalid = false,
  required = false,
  placeholder,
}: {
  path: string;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  id?: string;
  /** Ids of the field's help and error text; the parse error is added while there is one. */
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
  required?: boolean | undefined;
  placeholder?: string | undefined;
}) {
  const parseErrors = useParseErrors();
  const parseErrorId = useId();
  // Unparsed text from an earlier visit to this field wins over the last valid value.
  const [stored] = useState(() => parseErrors.get(path));
  const [text, setText] = useState(() => stored?.text ?? prettyJson(value));
  const [error, setError] = useState<string | undefined>(stored?.message);
  const formatted = prettyJson(value);
  const [lastValue, setLastValue] = useState(formatted);
  // Removing an earlier indexed row can give this editor a different value. Follow that value
  // while parsed; unparsed text still wins until the user fixes or discards it. Compare JSON,
  // since form subscriptions clone objects even when their contents have not changed.
  if (formatted !== lastValue) {
    setLastValue(formatted);
    if (error === undefined) {
      // A value echoed after an accepted edit must keep the user's JSON spacing.
      const parsed = parseJson(text);
      if (!parsed.ok || prettyJson(parsed.value) !== formatted) setText(formatted);
    }
  }
  // Discarded from outside (the validation panel): show the last valid value again.
  if (parseErrors.tracked && error !== undefined && parseErrors.errors?.[path] === undefined) {
    setText(prettyJson(value));
    setError(undefined);
  }
  const fail = (next: string, message: string | undefined) => {
    // Store first: a render that sees the local error must also see the stored entry, or it would
    // read as discarded.
    parseErrors.report(path, message === undefined ? undefined : { message, text: next });
    setError(message);
  };
  return (
    <div className="grid min-w-0 flex-1">
      <CodeEditor
        language="json"
        label={label}
        {...(id ? { id } : {})}
        minLines={2}
        placeholder={placeholder}
        describedBy={cn(describedBy, error && parseErrorId) || undefined}
        invalid={invalid || error !== undefined}
        required={required}
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
      {/* Polite, so the message is read once typing pauses rather than on every keystroke. */}
      <div aria-live="polite">
        {error ? (
          <HelpText
            id={parseErrorId}
            tone="bad"
            className="mt-1.5 flex flex-wrap items-center gap-2"
          >
            {error.replace(/^invalid JSON/, 'Invalid JSON')}{' '}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Back to the last valid value; the typed text is dropped (an undo step of its own).
                setText(prettyJson(value));
                parseErrors.discard(path);
                setError(undefined);
              }}
            >
              Discard text
            </Button>
          </HelpText>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A JSON field over a value it is handed, in the field row (label, JSON tag, required marker,
 * help, and the error at `name`, linked to the editor). `name` is also where unparsed text is kept
 * (the parse-error path). JsonField binds it to the form; a record row hands it one entry's value.
 */
export function JsonControl({
  schema,
  name,
  label,
  caption,
  value,
  onChange,
}: FieldProps & {
  caption?: string | undefined;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = useId();
  const { required, help } = fieldMeta(schema);
  const { hasDefault, defaultValue } = unwrap(schema);
  return (
    <Row
      label={label}
      caption={caption}
      htmlFor={id}
      name={name}
      required={required}
      help={help}
      aside={<LanguageTag>JSON</LanguageTag>}
    >
      {(control) => (
        <JsonText
          path={name}
          label={label}
          id={id}
          value={value}
          onChange={onChange}
          describedBy={control['aria-describedby']}
          invalid={control['aria-invalid']}
          required={required}
          placeholder={hasDefault ? prettyJson(defaultValue) : undefined}
        />
      )}
    </Row>
  );
}

export function JsonField({ schema, name, label }: FieldProps) {
  const field = useField(name);
  return (
    <JsonControl
      schema={schema}
      name={name}
      label={label}
      value={field.value}
      onChange={field.onChange}
    />
  );
}
