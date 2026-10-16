import { useId } from 'react';
import { FieldGroup, HelpText, Label, Select } from '../components/ui/index.js';
import type { UnionPickerProps } from '../forms/fields.js';

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
    description: 'Start from a signed HTTP request.',
  },
] as const;

/** Presentation only: the schema still stores type and its two webhook signing variants. */
export function TriggerTypePicker({ options, value, onChange }: UnionPickerProps) {
  const id = useId();
  const selected = options.find((option) => option.value === value)!;
  const type = TYPES.find((candidate) => selected.label.startsWith(candidate.value))!;
  const webhookOptions = options.filter((option) => option.label.startsWith('webhook'));
  return (
    <div className="grid gap-field">
      <FieldGroup>
        <Label htmlFor={id} required>
          Trigger type
        </Label>
        <Select
          id={id}
          aria-required="true"
          aria-describedby={`${id}-help`}
          value={type.value}
          onChange={(event) => {
            if (event.target.value !== type.value)
              onChange(
                options.find((option) => option.label.startsWith(event.target.value))!.value,
              );
          }}
        >
          {TYPES.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>
              {candidate.label}
            </option>
          ))}
        </Select>
        <HelpText id={`${id}-help`}>{type.description}</HelpText>
        {type.value === 'poll' ? (
          <HelpText>
            With Items configured, leave Whole-probe dedupe key empty and use Per-item dedupe key.
          </HelpText>
        ) : null}
      </FieldGroup>
      {type.value === 'webhook' ? (
        <FieldGroup data-field="signature.scheme">
          <Label htmlFor={`${id}-signing`} required>
            Signing protocol
          </Label>
          <Select
            id={`${id}-signing`}
            aria-required="true"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            {webhookOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label === 'webhook (body)' ? 'Body only (GitHub)' : 'Timestamp and body'}
              </option>
            ))}
          </Select>
        </FieldGroup>
      ) : null}
    </div>
  );
}
