import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { useEffect, useId, useRef, useState } from 'react';
import { useWatch } from 'react-hook-form';
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
  revealDisclosures,
} from '../../components/ui/index.js';
import { useFormChange } from '../changes.js';
import { useDisclosureState } from '../disclosures.js';
import { useField, type FieldProps } from '../fields.js';
import { Row, fieldMeta, useProblemCount } from '../fields/shared.js';
import { ProblemBadge } from '../fields/structure.js';
import {
  DAYS,
  PRESETS,
  TIMEZONES,
  defaultSchedule,
  formatSlot,
  parseSchedule,
  scheduleError,
  scheduleExpression,
  schedulePreferences,
  scheduleSummary,
  timezoneError,
  type Preset,
  type Schedule,
  type BuiltSchedule,
} from './model.js';

/** Custom expression field; it binds only the existing string, never a new config object. */
export function CronControl({ name }: FieldProps) {
  const field = useField(name, 'typing');
  const zonePath = name.replace(/expression$/, 'timezone');
  const zone: unknown = useWatch({ name: zonePath });
  const expression = typeof field.value === 'string' ? field.value : '';
  const timezone = typeof zone === 'string' ? zone : 'UTC';
  const [draft, setDraft] = useState<{ expression: string; schedule: Schedule }>();
  const schedule = draft?.expression === expression ? draft.schedule : parseSchedule(expression);
  const id = useId();
  const rawRef = useRef<HTMLDivElement>(null);
  const preferencesRef = useRef(schedulePreferences(parseSchedule(expression)));
  const error = scheduleError(schedule);
  const summary = scheduleSummary(schedule, expression, timezone);
  const preview = useSchedulePreview(expression, timezone, summary, error === undefined);
  const problems = useProblemCount([name]);
  const cronInvalid =
    preview.enabled &&
    preview.query.error instanceof GraphGoblinApiError &&
    preview.query.error.code === 'CRON_INVALID';
  const commit = (next: BuiltSchedule) => {
    preferencesRef.current = { ...preferencesRef.current, ...schedulePreferences(next) };
    if (scheduleError(next) !== undefined) {
      setDraft({ expression, schedule: next });
      return;
    }
    const value = scheduleExpression(next);
    setDraft({ expression: value, schedule: next });
    field.onChange(value);
  };
  // The field binds as typing (the raw expression, the step and time inputs); the preset select
  // and the day checkboxes are choices, each an undo step of its own.
  const change = useFormChange();
  const choose = (next: BuiltSchedule) =>
    change({ path: name, kind: 'commit' }, () => commit(next));
  // The raw expression's disclosure, kept with the form's (so an undo's remount keeps it open).
  const rawDisclosure = useDisclosureState(`${name}#advanced`, false);
  return (
    <Fieldset data-field={`${name}.schedule`}>
      <Legend>Schedule</Legend>
      <FieldGroup>
        <Label htmlFor={`${id}-preset`}>Repeat</Label>
        <Select
          id={`${id}-preset`}
          value={schedule.kind}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setDraft({ expression, schedule: { kind: 'custom' } });
              const raw = rawRef.current?.querySelector('input');
              if (raw) {
                revealDisclosures(raw);
                raw.focus();
              }
            } else choose(defaultSchedule(e.target.value as Preset, preferencesRef.current));
          }}
        >
          <option value="empty" disabled>
            Choose a schedule…
          </option>
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
                    choose({
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
      <p className="text-sm text-default">{summary}</p>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {preview.announcement}
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
      <Disclosure
        {...rawDisclosure}
        label="Advanced"
        summary={
          <>
            Cron expression <ProblemBadge count={Math.max(problems, cronInvalid ? 1 : 0)} />
          </>
        }
      >
        <div ref={rawRef}>
          <Row
            name={name}
            label="Cron expression"
            htmlFor={`${id}-raw`}
            required
            help="Five, six, or seven fields, or a cron nickname such as @daily. Custom expressions are kept exactly as entered."
          >
            {(control) => (
              <Input
                {...control}
                value={expression}
                maxLength={256}
                onBlur={field.onBlur}
                aria-describedby={
                  [
                    control['aria-describedby'],
                    preview.enabled && preview.query.isError ? `${id}-preview-error` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                aria-invalid={cronInvalid ? true : control['aria-invalid']}
                onChange={(e) => {
                  setDraft(undefined);
                  preferencesRef.current = {
                    ...preferencesRef.current,
                    ...schedulePreferences(parseSchedule(e.target.value)),
                  };
                  field.onChange(e.target.value);
                }}
              />
            )}
          </Row>
        </div>
      </Disclosure>
    </Fieldset>
  );
}

function useSchedulePreview(expression: string, timezone: string, summary: string, valid: boolean) {
  const requestable = expression.trim() !== '' && valid && timezoneError(timezone) === undefined;
  const [settled, setSettled] = useState({
    expression: '',
    timezone: '',
    summary: '',
    valid: false,
  });
  useEffect(() => {
    const timer = setTimeout(
      () => setSettled({ expression, timezone, summary, valid: requestable }),
      350,
    );
    return () => clearTimeout(timer);
  }, [expression, timezone, summary, requestable]);
  const ready =
    settled.expression === expression &&
    settled.timezone === timezone &&
    settled.summary === summary &&
    settled.valid === requestable;
  const enabled = ready && requestable;
  const query = useCronPreview(settled.expression, settled.timezone, enabled);
  const announcement = !settled.valid
    ? settled.expression.trim() === ''
      ? 'Choose a schedule to see upcoming runs.'
      : 'Complete the schedule to preview upcoming runs.'
    : `${settled.summary}. ${query.isError ? previewErrorMessage(query.error) : query.isPending || query.isFetching ? 'Loading upcoming runs…' : query.data.next.length === 0 ? 'No upcoming runs for this expression.' : 'Upcoming runs ready.'}`;
  return { query, enabled, valid: requestable, announcement };
}

function previewErrorMessage(error: unknown): string {
  if (error instanceof GraphGoblinApiError) {
    if (error.status === 0)
      return 'Preview unavailable. Cannot reach the schedule preview API; your current expression is kept.';
    const detail = error.detail ?? `The server returned HTTP ${error.status}.`;
    return error.code === 'CRON_INVALID'
      ? `Invalid schedule: ${detail}`
      : `Preview unavailable. ${detail}`;
  }
  return 'Preview unavailable. Please try again.';
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
  if (!valid) return null;
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sameZone =
    new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone === localZone;
  const message = previewErrorMessage(preview.error);
  return (
    <section aria-label="Upcoming runs" className="grid min-w-0 gap-2">
      {enabled && preview.isError ? (
        <p className="text-xs text-muted break-all">
          Current expression: <code>{expression}</code> · {timezone}
        </p>
      ) : null}
      {!enabled || preview.isPending || preview.isFetching ? (
        <HelpText>Loading upcoming runs…</HelpText>
      ) : preview.isError ? (
        <HelpText id={errorId} tone="bad">
          {message}
        </HelpText>
      ) : preview.data ? (
        <>
          <p className="text-sm font-medium">
            Next five runs · {timezone}
            {sameZone ? '' : ` / your time (${localZone})`}
          </p>
          {preview.data.next.length === 0 ? (
            <HelpText>No upcoming runs for this expression.</HelpText>
          ) : (
            <ol className="grid gap-2 text-xs">
              {preview.data.next.map((timestamp) => (
                <li key={timestamp} className="grid gap-1">
                  <time dateTime={timestamp}>{formatSlot(timestamp, timezone)}</time>
                  {sameZone ? null : (
                    <span className="text-muted">
                      Your time: {formatSlot(timestamp, localZone)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </section>
  );
}

/** Searchable native datalist: typing and keyboard selection both retain the IANA identifier. */
export function CronTimezoneControl({ name, label, schema }: FieldProps) {
  const field = useField(name, 'typing');
  const change = useFormChange();
  const value = typeof field.value === 'string' ? field.value : 'UTC';
  const id = useId();
  const error = timezoneError(value);
  const meta = fieldMeta(schema);
  return (
    <div className="grid gap-2">
      <Row name={name} label={label} htmlFor={id} help={meta.help} required={meta.required}>
        {(control) => (
          <>
            <Input
              {...control}
              value={value}
              list={`${id}-zones`}
              maxLength={64}
              onBlur={field.onBlur}
              aria-invalid={error ? true : control['aria-invalid']}
              aria-describedby={
                [control['aria-describedby'], error ? `${id}-zone-error` : undefined]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
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
          </>
        )}
      </Row>
      <div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            change({ path: name, kind: 'commit' }, () =>
              field.onChange(Intl.DateTimeFormat().resolvedOptions().timeZone),
            )
          }
        >
          Use my time zone
        </Button>
      </div>
    </div>
  );
}
