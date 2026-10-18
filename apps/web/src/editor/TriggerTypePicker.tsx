import { useId } from 'react';
import { FieldGroup, HelpText, Label, Select } from '../components/ui/index.js';
import type { UnionPickerProps } from '../forms/fields.js';
import { discriminatorValue } from '../forms/introspect.js';

const TYPES = [
  {
    value: 'manual',
    label: 'Manual',
    description: 'Start a run yourself from the web app, API or MCP.',
  },
  { value: 'cron', label: 'Cron', description: 'Start on a schedule in your chosen time zone.' },
  {
    value: 'poll',
    label: 'Poll',
    description: 'Check a probe at an interval and start when its condition is true.',
  },
  {
    value: 'event',
    label: 'Event',
    description: 'Start when GraphGoblin receives a matching inbound event.',
  },
  {
    value: 'webhook',
    label: 'Webhook',
    description: 'Start from an HTTP POST request.',
  },
] as const;

/** Presentation only: the schema stores `type`, with one configuration per type. */
export function TriggerTypePicker({ options, value, onChange }: UnionPickerProps) {
  const id = useId();
  const variants = options.map((option) => ({
    ...option,
    type: option.schema ? discriminatorValue(option.schema, 'type') : undefined,
  }));
  const selected = variants.find((option) => option.value === value);
  const type = TYPES.find((candidate) => candidate.value === selected?.type);
  const poll = type?.value === 'poll';
  return (
    <div className="grid gap-field">
      <FieldGroup>
        <Label htmlFor={id} required>
          Trigger type
        </Label>
        <Select
          id={id}
          aria-required="true"
          aria-describedby={[
            `${id}-help`,
            ...(poll ? [`${id}-poll-help`, `${id}-poll-runtime`] : []),
          ].join(' ')}
          value={type?.value ?? ''}
          onChange={(event) => {
            const next = variants.find((option) => option.type === event.target.value);
            if (next && event.target.value !== type?.value) onChange(next.value);
          }}
        >
          {TYPES.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>
              {candidate.label}
            </option>
          ))}
        </Select>
        <HelpText id={`${id}-help`}>{type?.description}</HelpText>
        {poll ? (
          <>
            <HelpText id={`${id}-poll-help`}>
              With Items configured, leave Whole-probe dedupe key empty and use Per-item dedupe key.
            </HelpText>
            <HelpText id={`${id}-poll-runtime`}>
              Poll probes run on the GraphGoblin server. For GitHub polls, gh must be installed and
              authenticated there; the browser does not call GitHub.
            </HelpText>
          </>
        ) : null}
      </FieldGroup>
    </div>
  );
}

/** Native selects share the schema form's commit, focus and undo handling. */
function WebhookPicker({
  name,
  options,
  value,
  onChange,
  required,
  describedBy,
  invalid,
  label,
}: UnionPickerProps) {
  const id = useId();
  return (
    <div data-field={`${name}.${name === 'authentication' ? 'message' : 'source'}`}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        aria-required={required}
        aria-describedby={describedBy}
        aria-invalid={invalid}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
export function WebhookAuthenticationPicker(props: UnionPickerProps) {
  return <WebhookPicker {...props} label="Authentication recipe" />;
}
export function WebhookEventTypePicker(props: UnionPickerProps) {
  return <WebhookPicker {...props} label="Event type source" />;
}
