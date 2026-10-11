/** JSON fields: a CodeMirror JSON editor that keeps unparsed text until it parses or is dropped. */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';
import { Button, HelpText } from '../../components/ui/index.js';
import { cn, parseJson, prettyJson } from '../../lib/utils.js';
import { CodeEditor } from '../CodeEditor.js';
import { LanguageTag } from '../CodeField.js';
import { matchOption, shapeOf, unwrap, withUnsetFields, type Schema } from '../introspect.js';
import { useDisclosureState } from '../disclosures.js';
import { useFormChange } from '../changes.js';
import { repathParseErrors, useParseErrors } from '../parse-errors.js';
import { stripUnset } from '../unset.js';
import { fieldMeta, Row, useField, type FieldProps } from './shared.js';

const PENDING_JSON = 'Choose Apply JSON or Cancel JSON to finish this edit.';

function validateText(text: string, schema?: Schema): { value?: unknown; error?: string } {
  const parsed = text.trim() === '' ? { ok: true as const, value: undefined } : parseJson(text);
  if (!parsed.ok) return { error: `invalid JSON: ${parsed.error}` };
  const result = schema?.safeParse(parsed.value);
  if (result && !result.success)
    return {
      error: result.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || 'section'}: ${issue.message}`)
        .join('; '),
    };
  // Validate without filling defaults or rewriting authored strings: the structured form reports
  // the same raw input and the contracts parse it at the save boundary.
  return { value: parsed.value };
}

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
  schema,
  explicit = false,
  onHeldChange,
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
  schema?: Schema | undefined;
  explicit?: boolean;
  onHeldChange?: ((held: boolean) => void) | undefined;
}) {
  const parseErrors = useParseErrors();
  const change = useFormChange();
  const parseErrorId = useId();
  // Unparsed text from an earlier visit to this field wins over the last valid value.
  const [stored] = useState(() => parseErrors.get(path));
  const [text, setText] = useState(() => stored?.text ?? prettyJson(value));
  const [error, setError] = useState<string | undefined>(stored?.message);
  useEffect(() => onHeldChange?.(error !== undefined), [error, onHeldChange]);
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
    parseErrors.report(
      path,
      message === undefined ? undefined : { message, text: next, input: 'unparsed text' },
    );
    setError(message);
    onHeldChange?.(message !== undefined);
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
        invalid={invalid || (error !== undefined && error !== PENDING_JSON)}
        required={required}
        value={text}
        onChange={(next) => {
          setText(next);
          const parsed = validateText(next, schema);
          if (parsed.error) fail(next, parsed.error);
          else if (explicit) fail(next, next === formatted ? undefined : PENDING_JSON);
          else {
            fail(next, undefined);
            onChange(parsed.value);
          }
        }}
      />
      {/* Polite, so the message is read once typing pauses rather than on every keystroke. */}
      <div aria-live="polite">
        {error && error !== PENDING_JSON ? (
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
                onHeldChange?.(false);
              }}
            >
              Discard the unparsed text
            </Button>
          </HelpText>
        ) : null}
      </div>
      {explicit ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={error !== undefined && error !== PENDING_JSON}
            onClick={() =>
              change({ path, kind: 'commit', collection: { type: 'replace' } }, () => {
                const parsed = validateText(text, schema);
                if (parsed.error) {
                  fail(text, parsed.error);
                  return;
                }
                fail(text, undefined);
                repathParseErrors(parseErrors, [{ from: path }]);
                onChange(parsed.value);
              })
            }
          >
            Apply JSON
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              change({ path, kind: 'commit' }, () => {
                setText(formatted);
                parseErrors.discard(path);
                setError(undefined);
                onHeldChange?.(false);
              })
            }
          >
            Cancel JSON
          </Button>
          {error === PENDING_JSON ? <HelpText id={parseErrorId}>{PENDING_JSON}</HelpText> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One editor and one parse-error channel for structured sections and opaque JSON values. */
export function JsonSection({
  schema,
  name,
  label,
  children,
}: FieldProps & { children: ReactNode }) {
  const field = useField(name, 'commit');
  const { getValues } = useFormContext();
  // The parent controller subscribes to whole-section writes, not descendant keystrokes.
  // Read the live section when opening/changing mode so structured child edits are included.
  const value = stripUnset(getValues(name));
  const errors = useParseErrors();
  const { open: storedOpen, onOpenChange } = useDisclosureState(`${name}#json`, false);
  const [ownOpen, setOwnOpen] = useState(() => errors.get(name) !== undefined);
  const [held, setHeld] = useState(() => errors.get(name) !== undefined);
  const open = (storedOpen ?? ownOpen) || errors.get(name) !== undefined;
  useEffect(() => {
    if (errors.get(name) && !(storedOpen ?? ownOpen)) onOpenChange?.(true);
  }, [errors, name, storedOpen, onOpenChange, ownOpen]);
  const [notice, setNotice] = useState(false);
  const { required, help } = fieldMeta(schema);
  const shape = shapeOf(schema);
  const sectionSchema =
    shape.kind === 'union'
      ? shape.options[matchOption(shape.options, value, shape.discriminator)]!
      : schema;
  const select = () => {
    if (open && (held || errors.get(name))) {
      setNotice(true);
      return;
    }
    onOpenChange?.(!open);
    setOwnOpen(!open);
    setNotice(false);
  };
  return (
    <div data-field={name} data-json-section={name} className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${open ? 'Use structured editor for' : 'Edit as JSON:'} ${label}`}
          aria-pressed={open}
          onClick={select}
        >
          {open ? 'Use structured editor' : 'Edit as JSON'}
        </Button>
        {notice && open && held ? (
          <HelpText tone="bad">Apply or cancel the JSON edit before switching editors.</HelpText>
        ) : null}
      </div>
      <div hidden={open} className="grid min-w-0 gap-field">
        {children}
      </div>
      {open ? (
        <Row name={name} label={`${label} JSON`} required={required} help={help}>
          {(control) => (
            <JsonText
              path={name}
              label={`${label} JSON`}
              id={control.id}
              value={value}
              schema={sectionSchema}
              explicit
              onChange={(next) => field.onChange(withUnsetFields(sectionSchema, next))}
              onHeldChange={setHeld}
              describedBy={control['aria-describedby']}
              invalid={control['aria-invalid']}
              required={required}
            />
          )}
        </Row>
      ) : null}
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
  const field = useField(name, 'typing');
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
