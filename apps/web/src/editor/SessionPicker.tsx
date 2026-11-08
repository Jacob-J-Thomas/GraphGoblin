import { useId } from 'react';
import { FieldGroup, HelpText, Label, Select } from '../components/ui/index.js';
import type { UnionPicker, UnionPickerOption, UnionPickerProps } from '../forms/fields.js';
import { FieldHelp } from '../forms/fields/shared.js';
import { discriminatorValue } from '../forms/introspect.js';

/** Presentation only: each stored `session.policy` keeps its value, order and behaviour. */
const POLICIES: Readonly<Record<string, { label: string; help: string }>> = {
  fresh: {
    label: 'Start fresh',
    help: 'Starts a new provider conversation on each visit. Your prompt and selected loop context still apply; earlier provider conversation history is not resumed.',
  },
  'resume-previous': {
    label: 'Resume latest in this run',
    help: 'Resumes the most recent conversation recorded in this run for the same harness, including one used by another node. If none has been recorded, starts fresh.',
  },
  'resume-named': {
    label: 'Resume named conversation',
    help: 'Resumes the conversation recorded under the name below for this loop and harness. Nodes and runs of this loop using the same name share it. If none has been recorded, starts fresh.',
  },
  'resume-own': {
    label: "Resume this node's conversation",
    help: "Resumes this node's conversation from its earlier visits in this run with the same harness. The first visit starts fresh. This selects this node's history; it does not prevent another node using Resume latest in this run from continuing that conversation.",
  },
};

/** Shown with every resume policy: a recorded conversation that cannot resume is never replaced. */
export const RESUME_NOTE =
  'If a recorded conversation can no longer be resumed, the visit fails with an error instead of silently starting fresh.';

function policyOf(option: UnionPickerOption): string {
  return option.schema ? discriminatorValue(option.schema, 'policy') : option.value;
}

/**
 * The inference Session's Conversation selector: a native select with descriptive labels, the
 * Session description above it, and the chosen policy's explanation (with the shared note for
 * resume policies) below it, all describing the select. The union field keeps the variant change,
 * its review, undo and the conditional fields that follow.
 */
function SessionConversationPicker({
  options,
  value,
  onChange,
  required,
  describedBy,
  invalid,
  help,
  helpId,
}: UnionPickerProps) {
  const id = useId();
  const selected = options.find((option) => option.value === value);
  const policy = selected ? policyOf(selected) : undefined;
  const explanation = policy === undefined ? undefined : POLICIES[policy]?.help;
  const resumes = policy?.startsWith('resume-') === true;
  const optionHelpId = `${id}-policy-help`;
  const noteId = `${id}-resume-note`;
  const description = [
    describedBy,
    explanation === undefined ? undefined : optionHelpId,
    resumes ? noteId : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      {helpId === undefined ? null : <FieldHelp id={helpId} help={help} />}
      <FieldGroup className={help === undefined ? undefined : 'mt-1.5'}>
        <Label htmlFor={id} required={required}>
          Conversation
        </Label>
        <Select
          id={id}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={description || undefined}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {POLICIES[policyOf(option)]?.label ?? option.label}
            </option>
          ))}
        </Select>
        {explanation === undefined ? null : <HelpText id={optionHelpId}>{explanation}</HelpText>}
        {resumes ? <HelpText id={noteId}>{RESUME_NOTE}</HelpText> : null}
      </FieldGroup>
    </>
  );
}

export const SessionPicker: UnionPicker = Object.assign(SessionConversationPicker, {
  drawsHelp: true,
});
