import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { useEffect, useId, useState } from 'react';
import { useCronPreview } from '../../api/queries.js';
import {
  Button,
  Checkbox,
  Disclosure,
  FieldGroup,
  Fieldset,
  HelpText,
  Input,
  Label,
  Legend,
  Select,
} from '../../components/ui/index.js';
import { useField, type FieldProps } from '../fields.js';
import { FieldError, Row } from '../fields/shared.js';
import {
  DAYS,
  PRESETS,
  TIMEZONES,
  defaultSchedule,
  formatSlot,
  parseSchedule,
  scheduleError,
  scheduleExpression,
  scheduleSummary,
  timezoneError,
  type Preset,
  type Schedule,
} from './model.js';

/** Custom expression field; it binds only the existing string, never a new config object. */
export function CronControl({ name }: FieldProps) {
  const field = useField(name);
  const zonePath = name.replace(/expression$/, 'timezone');
  const zone = useField(zonePath);
  const expression = typeof field.value === 'string' ? field.value : '';
  const timezone = typeof zone.value === 'string' ? zone.value : 'UTC';
  const [draft, setDraft] = useState<{ expression: string; schedule: Schedule }>();
  const schedule = draft?.expression === expression ? draft.schedule : parseSchedule(expression);
  const id = useId();
  const error = scheduleError(schedule);
  const preview = useSchedulePreview(expression, timezone, error === undefined);
  const commit = (next: Exclude<Schedule, { kind: 'custom' }>) => {
    const value = scheduleExpression(next);
    setDraft({ expression: value, schedule: next });
    field.onChange(value);
  };
  return (
    <Fieldset data-field={name}>
      <Legend>Schedule</Legend>
      <FieldGroup>
        <Label htmlFor={`${id}-preset`}>Repeat</Label>
        <Select
          id={`${id}-preset`}
          value={schedule.kind}
          onChange={(e) => {
            if (e.target.value === 'custom') setDraft({ expression, schedule: { kind: 'custom' } });
            else commit(defaultSchedule(e.target.value as Preset));
          }}
        >
          {PRESETS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          <option value="custom">Custom expression</option>
        </Select>
      </FieldGroup>
      {schedule.kind === 'minutes' || schedule.kind === 'hours' ? (
        <FieldGroup>
          <Label htmlFor={`${id}-every`}>Every ({schedule.kind})</Label>
          <Input
            id={`${id}-every`}
            type="number"
            min={1}
            max={schedule.kind === 'minutes' ? 59 : 23}
            value={schedule.every || ''}
            aria-describedby={`${id}-error`}
            aria-invalid={!!error}
            onChange={(e) => commit({ ...schedule, every: Number(e.target.value) })}
          />
          <HelpText>Steps restart each {schedule.kind === 'minutes' ? 'hour' : 'day'}.</HelpText>
        </FieldGroup>
      ) : null}
      {'time' in schedule ? (
        <FieldGroup>
          <Label htmlFor={`${id}-time`}>At time</Label>
          <Input
            id={`${id}-time`}
            type="time"
            step={60}
            value={schedule.time}
            aria-describedby={`${id}-error`}
            aria-invalid={!!error}
            onChange={(e) => commit({ ...schedule, time: e.target.value })}
          />
        </FieldGroup>
      ) : null}
      {schedule.kind === 'weekly' ? (
        <fieldset className="grid gap-2" aria-describedby={`${id}-error`}>
          <Legend variant="label">Days of the week</Legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {DAYS.map((day, index) => (
              <label key={day} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={schedule.days.includes(index)}
                  onChange={(e) =>
                    commit({
                      ...schedule,
                      days: e.target.checked
                        ? [...schedule.days, index].sort()
                        : schedule.days.filter((value) => value !== index),
                    })
                  }
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {schedule.kind === 'monthly' ? (
        <FieldGroup>
          <Label htmlFor={`${id}-day`}>Day of month</Label>
          <Input
            id={`${id}-day`}
            type="number"
            min={1}
            max={31}
            value={schedule.day || ''}
            aria-describedby={`${id}-error`}
            aria-invalid={!!error}
            onChange={(e) => commit({ ...schedule, day: Number(e.target.value) })}
          />
          <HelpText>Months without this day are skipped.</HelpText>
        </FieldGroup>
      ) : null}
      <p className="text-sm text-default" aria-live="polite">
        {scheduleSummary(schedule, expression, timezone)}
      </p>
      <HelpText id={`${id}-error`} tone="bad" role={error ? 'alert' : undefined}>
        {error}
      </HelpText>
      <CronPreview
        expression={expression}
        timezone={timezone}
        preview={preview}
        errorId={`${id}-preview-error`}
      />
      <Disclosure label="Advanced" summary="Cron expression">
        <FieldGroup>
          <Label htmlFor={`${id}-raw`} required>
            Cron expression
          </Label>
          <Input
            id={`${id}-raw`}
            value={expression}
            maxLength={256}
            onBlur={field.onBlur}
            aria-required="true"
            aria-describedby={`${id}-preview-error`}
            aria-invalid={
              preview.enabled &&
              preview.query.error instanceof GraphGoblinApiError &&
              preview.query.error.code === 'CRON_INVALID'
            }
            onChange={(e) => {
              setDraft(undefined);
              field.onChange(e.target.value);
            }}
          />
          <HelpText>Five or six fields. Custom expressions are kept exactly as entered.</HelpText>
          <FieldError name={name} />
        </FieldGroup>
      </Disclosure>
    </Fieldset>
  );
}

function useSchedulePreview(expression: string, timezone: string, valid: boolean) {
  const [settled, setSettled] = useState({ expression: '', timezone: '' });
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ expression, timezone }), 350);
    return () => clearTimeout(timer);
  }, [expression, timezone]);
  const ready = settled.expression === expression && settled.timezone === timezone;
  const zoneError = timezoneError(timezone);
  const enabled = ready && valid && zoneError === undefined;
  const query = useCronPreview(expression, timezone, enabled);
  return { query, enabled, valid: valid && zoneError === undefined };
}

function CronPreview({
  expression,
  timezone,
  preview: state,
  errorId,
}: {
  expression: string;
  timezone: string;
  preview: ReturnType<typeof useSchedulePreview>;
  errorId: string;
}) {
  const { query: preview, enabled, valid } = state;
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const message =
    preview.error instanceof GraphGoblinApiError && preview.error.code === 'CRON_INVALID'
      ? `Invalid schedule: ${preview.error.message}`
      : 'Preview unavailable. Cannot reach the schedule preview API; your current expression is kept.';
  return (
    <section aria-label="Upcoming runs" className="grid min-w-0 gap-2">
      {enabled && preview.isError ? (
        <p className="text-xs text-muted break-all">
          Current expression: <code>{expression}</code> · {timezone}
        </p>
      ) : null}
      {valid ? (
        !enabled || preview.isFetching ? (
          <HelpText role="status">Loading upcoming runs…</HelpText>
        ) : preview.isError ? (
          <HelpText id={errorId} tone="bad" role="alert">
            {message}
          </HelpText>
        ) : preview.data ? (
          <>
            <p className="text-sm font-medium">
              Next five runs · {timezone} / your time ({localZone})
            </p>
            {preview.data.next.length === 0 ? (
              <HelpText>No upcoming runs for this expression.</HelpText>
            ) : (
              <ol className="grid gap-2 text-xs">
                {preview.data.next.map((timestamp) => (
                  <li key={timestamp} className="grid gap-1">
                    <time dateTime={timestamp}>{formatSlot(timestamp, timezone)}</time>
                    <span className="text-muted">
                      Your time: {formatSlot(timestamp, localZone)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : null
      ) : null}
    </section>
  );
}

/** Searchable native datalist: typing and keyboard selection both retain the IANA identifier. */
export function CronTimezoneControl({ name, label, schema }: FieldProps) {
  const field = useField(name);
  const value = typeof field.value === 'string' ? field.value : 'UTC';
  const id = useId();
  const error = timezoneError(value);
  return (
    <Row name={name} label={label} htmlFor={id} help={schema.description}>
      {(control) => (
        <>
          <Input
            {...control}
            value={value}
            list={`${id}-zones`}
            maxLength={64}
            onBlur={field.onBlur}
            aria-invalid={error ? true : control['aria-invalid']}
            aria-describedby={error ? `${id}-zone-error` : control['aria-describedby']}
            onChange={(e) => field.onChange(e.target.value)}
          />
          <datalist id={`${id}-zones`}>
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          {error ? (
            <HelpText id={`${id}-zone-error`} tone="bad" role="alert">
              {error}
            </HelpText>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => field.onChange(Intl.DateTimeFormat().resolvedOptions().timeZone)}
          >
            Use my time zone
          </Button>
        </>
      )}
    </Row>
  );
}
