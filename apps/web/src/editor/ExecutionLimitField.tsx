import { useFormContext } from 'react-hook-form';
import { useFormChange } from '../forms/changes.js';
import { useId, useState } from 'react';
import { useParseErrors } from '../forms/parse-errors.js';
import { HelpText, Input, Select } from '../components/ui/index.js';
import { unwrap } from '../forms/introspect.js';
import { fieldMeta, Row, useField, type FieldProps } from '../forms/fields/shared.js';

/** Null removes a limit; a deadline is absent by default, visits/passes require a choice. */
export function ExecutionLimitField({ schema, name, label }: FieldProps) {
  const binding = useField(name, 'typing');
  const { setValue } = useFormContext();
  const commit = useFormChange();
  const { defaultValue } = unwrap(schema);
  const effective = binding.value === undefined ? defaultValue : binding.value;
  const completion = name.endsWith('structuredTimeoutMs');
  const deadline = name.endsWith('runDeadlineSeconds') || completion;
  const modeId = useId();
  const { help } = fieldMeta(schema);
  const fallback =
    typeof defaultValue === 'number' ? defaultValue : completion ? 120_000 : deadline ? 3600 : 10;
  const parseErrors = useParseErrors();
  const [error, setError] = useState(() => parseErrors.get(name)?.message);
  const [draft, setDraft] = useState<{ text: string; stored: unknown } | undefined>(() => {
    const held = parseErrors.get(name);
    return held && held.message !== 'Enter a complete number'
      ? { text: held.text, stored: binding.value }
      : undefined;
  });
  const [incomplete, setIncomplete] = useState(false);
  // A cleared finite input remains editable until blur, even when its default is null.
  const unlimited = effective === null && !(draft && draft.stored === binding.value);
  if (parseErrors.tracked && error && !parseErrors.errors?.[name]) {
    setError(undefined);
    setDraft(undefined);
    setIncomplete(false);
  }
  const edit = (input: HTMLInputElement) => {
    const text = input.validity.badInput ? '' : input.value;
    const next = text === '' ? undefined : Number(text);
    const parsed = schema.safeParse(next);
    const message = input.validity.badInput
      ? 'Enter a complete number'
      : parsed.success
        ? undefined
        : parsed.error.issues.map((issue) => issue.message).join('; ');
    parseErrors.report(name, message ? { message, text, input: 'unparsed text' } : undefined);
    setError(message);
    setIncomplete(input.validity.badInput);
    setDraft({ text, stored: message ? binding.value : next });
    if (!message) binding.onChange(next);
  };
  const displayed =
    draft && draft.stored === binding.value
      ? draft.text
      : typeof effective === 'number'
        ? String(effective)
        : '';
  const choose = (mode: string) => {
    setDraft(undefined);
    setError(undefined);
    setIncomplete(false);
    parseErrors.report(name, undefined);
    commit({ path: name, kind: 'commit' }, () =>
      setValue(name, mode === 'unlimited' ? null : fallback),
    );
  };
  return (
    <Row
      name={name}
      label={label}
      help={help}
      required={name.endsWith('maxPasses')}
      after={
        <>
          {error ? (
            <HelpText id={`${modeId}-error`} role="alert" tone="bad">
              {error}
            </HelpText>
          ) : null}
          {unlimited ? (
            deadline ? (
              <HelpText>
                {completion
                  ? 'No completion deadline; LLM decisions and repairs remain cancellable.'
                  : 'No deadline; set one to stop a forgotten run.'}
              </HelpText>
            ) : (
              <HelpText tone="warn">
                Unlimited: this guardrail will not stop execution. Use an authored exit or Cancel;
                provider and service failures can still stop work.
              </HelpText>
            )
          ) : null}
        </>
      }
    >
      {(control) => (
        <div className="grid gap-2">
          {!unlimited ? (
            <Input
              {...control}
              type="number"
              min={1}
              step={1}
              max={completion ? 31_536_000_000 : deadline ? 31536000 : 10000}
              aria-label={label}
              value={incomplete ? '' : displayed}
              aria-invalid={error ? true : control['aria-invalid']}
              aria-describedby={
                [control['aria-describedby'], error ? `${modeId}-error` : '']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              onBlur={() => {
                if (!error) setDraft(undefined);
                binding.onBlur();
              }}
              onInput={(e) => edit(e.currentTarget)}
              onChange={(e) => {
                if (e.nativeEvent.type !== 'input') edit(e.currentTarget);
              }}
            />
          ) : null}
          <Select
            {...control}
            id={unlimited ? control.id : modeId}
            aria-label={`${label} mode`}
            value={unlimited ? 'unlimited' : 'limited'}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="limited">Limited</option>
            <option value="unlimited">
              {completion ? 'Unlimited' : deadline ? 'No run deadline' : 'Unlimited'}
            </option>
          </Select>
        </div>
      )}
    </Row>
  );
}
