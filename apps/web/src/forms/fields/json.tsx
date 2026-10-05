/** JSON fields: a CodeMirror JSON editor that keeps unparsed text until it parses or is dropped. */
import { useId, useState } from 'react';
import { Button, HelpText } from '../../components/ui/index.js';
import { parseJson, prettyJson } from '../../lib/utils.js';
import { CodeEditor } from '../CodeEditor.js';
import { useParseErrors } from '../parse-errors.js';
import { Row, useField, type FieldProps } from './shared.js';

export function JsonText({
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
    <div className="grid min-w-0 flex-1 gap-1.5">
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
        <HelpText tone="bad" className="flex flex-wrap items-center gap-2">
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
  );
}

export function JsonField({ name, label }: FieldProps) {
  const field = useField(name);
  const id = useId();
  return (
    <Row label={`${label} (JSON)`} htmlFor={id} name={name}>
      <JsonText path={name} label={label} id={id} value={field.value} onChange={field.onChange} />
    </Row>
  );
}
