import { MAX_LOOP_NAME_LENGTH } from '@graphgoblin/contracts';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { LOOP_NAME_RULE, sameLoopName, type LoopNameConflict } from '../lib/loop-names.js';
import { cn } from '../lib/utils.js';
import { Button, FIELD_ROW, FieldGroup, HelpText, Input, Label } from './ui/index.js';

/** Whether `current` is the name the API refused in `conflict` (so its guidance still applies). */
export function refusedNow(conflict: LoopNameConflict | undefined, current: string): boolean {
  return conflict?.name !== undefined && sameLoopName(current, conflict.name);
}

/** Focus a control by id once React has committed it (its opener may just have unmounted). */
export function focusById(id: string, select = false): void {
  window.requestAnimationFrame(() => {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLInputElement)) return element?.focus();
    element.focus();
    if (select) element.select();
  });
}

/**
 * Under a name field whose current text the API refused: which name, the rule, and the API's
 * suggestion as a button that only replaces the field's text. Nothing is sent until the user
 * submits again. `live` announces it when it appears; turn it off where a notice nearby has
 * already announced the refusal. `id` describes the field.
 */
export function LoopNameTakenHelp({
  id,
  conflict,
  live = true,
  onUseSuggestion,
  className,
}: {
  id: string;
  conflict: LoopNameConflict;
  live?: boolean;
  onUseSuggestion?: ((name: string) => void) | undefined;
  className?: string;
}) {
  const suggestion = conflict.suggestedName;
  return (
    <div className={cn('grid min-w-0 justify-items-start gap-1.5', className)}>
      <HelpText id={id} role={live ? 'alert' : undefined} tone="bad" className="wrap-anywhere">
        {conflict.name === undefined
          ? 'Another loop already has this name.'
          : `Another loop already has the name “${conflict.name.trim()}”.`}{' '}
        {LOOP_NAME_RULE}
      </HelpText>
      {suggestion && onUseSuggestion ? (
        <Button size="sm" variant="outline" onClick={() => onUseSuggestion(suggestion)}>
          {`Use “${suggestion}”`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A deliberate second attempt under another name, for an import or a template copy the API refused
 * with 409 `LOOP_NAME_CONFLICT`. The field starts with the API's suggestion, focused and selected,
 * so Enter accepts it and typing replaces it; nothing is sent until the user submits. A refusal of
 * the retried name (another writer took the suggestion meanwhile) shows under the field with the
 * API's fresh suggestion, and focus stays where it is. Cancel leaves everything unchanged.
 */
export function LoopNameRetryForm({
  label,
  submitLabel,
  pendingLabel,
  initialName,
  conflict,
  pending,
  describedBy,
  onSubmit,
  onCancel,
}: {
  /** The field's label, for example "Name for the imported loop". */
  label: string;
  submitLabel: string;
  pendingLabel: string;
  initialName: string;
  /** The latest refusal; its guidance shows while the field holds the refused name. */
  conflict: LoopNameConflict;
  pending: boolean;
  /** The id of the explanation above the form, which also describes the field. */
  describedBy?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const helpId = `${inputId}-taken`;
  const [value, setValue] = useState(initialName);
  useEffect(() => focusById(inputId, true), [inputId]);
  const taken = refusedNow(conflict, value);
  const blank = value.trim() === '';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || blank) return;
    onSubmit(value.trim());
  };
  return (
    <form onSubmit={submit} className={cn(FIELD_ROW, 'items-end')} aria-label={label}>
      <FieldGroup className="w-[300px]">
        <Label htmlFor={inputId} required>
          {label}
        </Label>
        <Input
          id={inputId}
          value={value}
          maxLength={MAX_LOOP_NAME_LENGTH}
          aria-required
          aria-invalid={taken || undefined}
          aria-describedby={
            [describedBy, taken ? helpId : undefined].filter(Boolean).join(' ') || undefined
          }
          onChange={(event) => setValue(event.target.value)}
        />
      </FieldGroup>
      <Button
        type="submit"
        disabled={blank}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
      >
        {pending ? pendingLabel : submitLabel}
      </Button>
      <Button
        variant="ghost"
        aria-disabled={pending || undefined}
        onClick={() => {
          if (!pending) onCancel();
        }}
      >
        Cancel
      </Button>
      {taken ? (
        <LoopNameTakenHelp
          id={helpId}
          className="basis-full"
          conflict={conflict}
          onUseSuggestion={(name) => {
            setValue(name);
            focusById(inputId);
          }}
        />
      ) : null}
      {pending ? (
        <p role="status" className="basis-full text-sm text-muted">
          {pendingLabel}
        </p>
      ) : null}
    </form>
  );
}
