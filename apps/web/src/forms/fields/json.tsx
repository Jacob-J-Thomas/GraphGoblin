/** JSON fields: live opaque values, or validated sections with explicit Apply/Cancel. */
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Button, HelpText } from '../../components/ui/index.js';
import { cn, parseJson, prettyJson } from '../../lib/utils.js';
import { CodeEditor } from '../CodeEditor.js';
import { LanguageTag } from '../CodeField.js';
import { matchOption, shapeOf, unwrap, withUnsetFields, type Schema } from '../introspect.js';
import { useDisclosureState } from '../disclosures.js';
import { useFormChange } from '../changes.js';
import { useParseErrors } from '../parse-errors.js';
import { stripUnset } from '../unset.js';
import { sameJson } from '../layout.js';
import { focusField } from '../../editor/focus-field.js';
import { CapabilitySectionNotice } from './suggestions.js';
import { fieldMeta, FormScopeContext, Row, useField, type FieldProps } from './shared.js';

const PENDING_JSON = 'Choose Apply JSON or Cancel JSON to finish this edit.';

interface RemovedConnection {
  id: string;
  description: string;
}

/** The editor supplies graph consequences; the form only presents and confirms them. */
export const JsonApplyReviewContext = createContext<
  (path: string, value: unknown) => readonly RemovedConnection[]
>(() => []);

/** Replace one section in a fresh candidate, never in the live form or store. */
function replaceSection(value: unknown, path: readonly string[], next: unknown): unknown {
  const [key, ...rest] = path;
  if (key === undefined) return next;
  if (Array.isArray(value))
    return value.map((item: unknown, index) =>
      String(index) === key ? replaceSection(item, rest, next) : item,
    );
  const object = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return { ...object, [key]: replaceSection(object[key], rest, next) };
}

function validateText(
  text: string,
  schema?: Schema,
  validateValue?: (value: unknown) => string | undefined,
): { value?: unknown; error?: string } {
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
  const error = validateValue?.(parsed.value);
  return error ? { error } : { value: parsed.value };
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
  validateValue,
  validationVersion,
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
  /** Validate a section replacement in its complete, current form before any write. */
  validateValue?: ((value: unknown) => string | undefined) | undefined;
  validationVersion?: unknown;
}) {
  const parseErrors = useParseErrors();
  const review = use(JsonApplyReviewContext);
  const change = useFormChange();
  const parseErrorId = useId();
  // Held text from an earlier visit to this field wins over the last valid value.
  const [stored] = useState(() => parseErrors.get(path));
  const [text, setText] = useState(() => stored?.text ?? prettyJson(value));
  const [ownError, setOwnError] = useState<string | undefined>(stored?.message);
  // The held document stays local, while parent rules always see the current config. Derive
  // their message so a sibling correction updates Apply without another JSON keystroke.
  const candidate =
    validateValue && ownError !== undefined ? validateText(text, schema, validateValue) : undefined;
  const error = candidate
    ? (candidate.error ?? (sameJson(candidate.value, value) ? undefined : PENDING_JSON))
    : ownError;
  const [confirmation, setConfirmation] = useState<{
    text: string;
    connections: readonly RemovedConnection[];
  }>();
  useEffect(() => onHeldChange?.(error !== undefined), [error, onHeldChange]);
  const formatted = prettyJson(value);
  const [lastValue, setLastValue] = useState(formatted);
  // Removing an earlier indexed row can give this editor a different value. Follow that value
  // while applied; held text still wins until the user fixes or discards it. Compare JSON,
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
    setOwnError(undefined);
  }
  const fail = useCallback(
    (next: string, message: string | undefined) => {
      // Store first: a render that sees the local error must also see the stored entry, or it would
      // read as discarded.
      parseErrors.report(
        path,
        message === undefined
          ? undefined
          : {
              message,
              text: next,
              input: message === PENDING_JSON ? 'unapplied JSON' : 'unparsed text',
            },
      );
      setOwnError(message);
      onHeldChange?.(message !== undefined);
    },
    [parseErrors, path, onHeldChange],
  );
  useEffect(() => {
    if (!validateValue) return;
    parseErrors.report(
      path,
      error === undefined
        ? undefined
        : {
            message: error,
            text,
            input: error === PENDING_JSON ? 'unapplied JSON' : 'unparsed text',
          },
    );
  }, [validationVersion, text, validateValue, parseErrors, path, error]);
  const apply = (confirmed = false) => {
    const parsed = validateText(text, schema, validateValue);
    if (parsed.error) {
      fail(text, parsed.error);
      return;
    }
    const connections = review(path, parsed.value);
    if (
      connections.length > 0 &&
      !(confirmed && confirmation?.text === text && sameJson(confirmation.connections, connections))
    ) {
      setConfirmation({ text, connections });
      return;
    }
    change({ path, kind: 'commit', collection: { type: 'replace' } }, () => {
      fail(text, undefined);
      setConfirmation(undefined);
      onChange(parsed.value);
    });
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
          setConfirmation(undefined);
          const parsed = validateText(next, schema, validateValue);
          if (parsed.error) fail(next, parsed.error);
          else if (explicit) fail(next, sameJson(parsed.value, value) ? undefined : PENDING_JSON);
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
                setConfirmation(undefined);
                parseErrors.discard(path);
                setOwnError(undefined);
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
            onClick={() => apply()}
          >
            Apply JSON
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              change({ path, kind: 'commit' }, () => {
                setText(formatted);
                setConfirmation(undefined);
                parseErrors.discard(path);
                setOwnError(undefined);
                onHeldChange?.(false);
              })
            }
          >
            Cancel JSON
          </Button>
          {error === PENDING_JSON ? <HelpText id={parseErrorId}>{PENDING_JSON}</HelpText> : null}
        </div>
      ) : null}
      {confirmation ? (
        <div
          role="group"
          aria-label="Confirm connection removal"
          className="mt-2 grid min-w-0 gap-2"
        >
          <HelpText tone="warn">Applying this JSON will remove these connections:</HelpText>
          <ul className="min-w-0 break-words text-sm">
            {confirmation.connections.map((connection) => (
              <li key={connection.id}>{connection.description}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => apply(true)}>
              Confirm Apply JSON
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmation(undefined)}>
              Keep editing JSON
            </Button>
          </div>
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
  const scope = use(FormScopeContext)!;
  const validateValue = useCallback(
    (next: unknown) => {
      const candidate = stripUnset(replaceSection(getValues(), name.split('.'), next));
      const result = scope.rootSchema.safeParse(candidate);
      if (result.success) return undefined;
      return result.error.issues
        .map((issue) => {
          const path = issue.path.map(String).join('.');
          const relative = path.startsWith(`${name}.`)
            ? path.slice(name.length + 1)
            : path === name || path === ''
              ? 'section'
              : `section (config.${path})`;
          return `${relative}: ${issue.message}`;
        })
        .join('; ');
    },
    [getValues, name, scope.rootSchema],
  );
  // The parent controller subscribes to whole-section writes, not descendant keystrokes.
  // Read the live section when opening/changing mode so structured child edits are included.
  const value = stripUnset(getValues(name));
  const errors = useParseErrors();
  const rootRef = useRef<HTMLDivElement>(null);
  const descendants = Object.keys(errors.errors ?? {}).filter((path) =>
    path.startsWith(`${name}.`),
  );
  const { open: storedOpen, onOpenChange } = useDisclosureState(`${name}#json`, false);
  const [ownOpen, setOwnOpen] = useState(() => errors.get(name) !== undefined);
  const [held, setHeld] = useState(() => errors.get(name) !== undefined);
  const requestedOpen = (storedOpen ?? ownOpen) || errors.get(name) !== undefined;
  const open = requestedOpen && descendants.length === 0;
  // Only an open section JSON editor needs full-config updates for parent rules. Structured
  // panels keep their narrow subscriptions; fixing a sibling also refreshes the held message.
  const validationVersion = useWatch({ disabled: !open });
  useEffect(() => {
    if (errors.get(name) && !(storedOpen ?? ownOpen)) onOpenChange?.(true);
  }, [errors, name, storedOpen, onOpenChange, ownOpen]);
  const [notice, setNotice] = useState(false);
  const [refused, setRefused] = useState(false);
  const { required, help } = fieldMeta(schema);
  const shape = shapeOf(schema);
  const sectionSchema =
    shape.kind === 'union'
      ? shape.options[matchOption(shape.options, value, shape.discriminator)]!
      : schema;
  const select = () => {
    if (!open && descendants.length > 0) {
      setRefused(true);
      return;
    }
    if (open && (held || errors.get(name))) {
      setNotice(true);
      return;
    }
    onOpenChange?.(!open);
    setOwnOpen(!open);
    setNotice(false);
    setRefused(false);
  };
  return (
    <div ref={rootRef} data-field={name} data-json-section={name} className="grid min-w-0 gap-2">
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
      {(refused || requestedOpen) && descendants.length > 0 ? (
        <div role="alert" className="grid min-w-0 gap-2">
          <HelpText tone="bad">
            Finish or discard held input before editing this section as JSON:{' '}
            {descendants.join(', ')}.
          </HelpText>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (rootRef.current) focusField(rootRef.current, descendants[0]!);
            }}
          >
            Focus first held field
          </Button>
        </div>
      ) : null}
      <CapabilitySectionNotice schema={schema} />
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
              validateValue={validateValue}
              validationVersion={validationVersion}
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
