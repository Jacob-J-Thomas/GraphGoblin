import { useId } from 'react';
import { FieldGroup, HelpText, Label, Select } from '../components/ui/index.js';
import type { UnionPickerProps } from '../forms/fields.js';
import { discriminatorValue, shapeOf } from '../forms/introspect.js';

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

/** Presentation only: the schema stores `type`, with two webhook signing variants. */
export function TriggerTypePicker({ options, value, onChange }: UnionPickerProps) {
  const id = useId();
  const variants = options.map((option) => {
    const shape = option.schema ? shapeOf(option.schema) : undefined;
    const signature = shape?.kind === 'object' ? shape.shape['signature'] : undefined;
    return {
      ...option,
      type: option.schema ? discriminatorValue(option.schema, 'type') : undefined,
      scheme: signature ? discriminatorValue(signature, 'scheme') : undefined,
    };
  });
  const selected = variants.find((option) => option.value === value);
  const type = TYPES.find((candidate) => candidate.value === selected?.type);
  const webhookOptions = variants.filter((option) => option.type === 'webhook');
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
      {type?.value === 'webhook' ? (
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
                {option.scheme === 'hmac-sha256-body' ? 'Body only (GitHub)' : 'Timestamp and body'}
              </option>
            ))}
          </Select>
        </FieldGroup>
      ) : null}
    </div>
  );
}
