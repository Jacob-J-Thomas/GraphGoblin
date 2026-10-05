/** The browser describes only schedules it can build; the API owns cron semantics. */
export type Preset = 'minutes' | 'hours' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
export type Schedule =
  | { kind: 'minutes'; every: number }
  | { kind: 'hours'; every: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; time: string; days: number[] }
  | { kind: 'monthly'; time: string; day: number }
  | { kind: 'custom' };

export const PRESETS: ReadonlyArray<{ value: Preset; label: string }> = [
  { value: 'minutes', label: 'Every N minutes' },
  { value: 'hours', label: 'Every N hours' },
  { value: 'daily', label: 'Daily at a time' },
  { value: 'weekdays', label: 'Weekdays at a time' },
  { value: 'weekly', label: 'Weekly on chosen days' },
  { value: 'monthly', label: 'Monthly on day N' },
];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function defaultSchedule(kind: Preset): Exclude<Schedule, { kind: 'custom' }> {
  switch (kind) {
    case 'minutes':
    case 'hours':
      return { kind, every: 1 };
    case 'daily':
    case 'weekdays':
      return { kind, time: '09:00' };
    case 'weekly':
      return { kind, time: '09:00', days: [1] };
    case 'monthly':
      return { kind, time: '09:00', day: 1 };
  }
}

export function scheduleExpression(schedule: Exclude<Schedule, { kind: 'custom' }>): string {
  if (schedule.kind === 'minutes') return `*/${schedule.every} * * * *`;
  if (schedule.kind === 'hours') return `0 */${schedule.every} * * *`;
  const [hour, minute] = schedule.time.split(':').map(Number);
  const at = `${minute} ${hour}`;
  switch (schedule.kind) {
    case 'daily':
      return `${at} * * *`;
    case 'weekdays':
      return `${at} * * 1-5`;
    case 'weekly':
      return `${at} * * ${schedule.days.join(',')}`;
    case 'monthly':
      return `${at} ${schedule.day} * *`;
  }
}

const integer = (text: string, min: number, max: number) =>
  /^\d+$/.test(text) && Number(text) >= min && Number(text) <= max;

/** Never writes back: loading even noncanonical spacing or a custom expression is lossless. */
export function parseSchedule(expression: string): Schedule {
  const parts = expression.trim().split(/\s+/);
  const [minute = '', hour = '', day = '', month = '', week = ''] = parts;
  if (parts.length !== 5 || month !== '*') return { kind: 'custom' };
  if (day === '*' && week === '*') {
    if (hour === '*' && minute.startsWith('*/') && integer(minute.slice(2), 1, 59))
      return { kind: 'minutes', every: Number(minute.slice(2)) };
    if (minute === '0' && hour.startsWith('*/') && integer(hour.slice(2), 1, 23))
      return { kind: 'hours', every: Number(hour.slice(2)) };
    if (minute === '*' && hour === '*') return { kind: 'minutes', every: 1 };
  }
  if (!integer(minute, 0, 59) || !integer(hour, 0, 23)) return { kind: 'custom' };
  const time = `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
  if (week === '*' && integer(day, 1, 31)) return { kind: 'monthly', time, day: Number(day) };
  if (day !== '*') return { kind: 'custom' };
  if (week === '*') return { kind: 'daily', time };
  if (week === '1-5') return { kind: 'weekdays', time };
  const days = week.split(',');
  if (days.every((value) => integer(value, 0, 6)))
    return { kind: 'weekly', time, days: [...new Set(days.map(Number))].sort() };
  return { kind: 'custom' };
}

export function scheduleSummary(schedule: Schedule, expression: string, timezone: string): string {
  let summary: string;
  switch (schedule.kind) {
    case 'minutes':
    case 'hours': {
      const unit = schedule.kind === 'minutes' ? 'minute' : 'hour';
      summary = `Every ${schedule.every === 1 ? unit : `${schedule.every} ${unit}s`}`;
      break;
    }
    case 'daily':
      summary = `Every day at ${schedule.time}`;
      break;
    case 'weekdays':
      summary = `Every weekday at ${schedule.time}`;
      break;
    case 'weekly':
      summary = `Every ${schedule.days.map((day) => DAYS[day]).join(', ')} at ${schedule.time}`;
      break;
    case 'monthly':
      summary = `Monthly on day ${schedule.day} at ${schedule.time}`;
      break;
    case 'custom':
      summary = `Custom expression: ${expression}`;
  }
  return `${summary}, ${timezone}`;
}

export function scheduleError(schedule: Schedule): string | undefined {
  if (schedule.kind === 'minutes' || schedule.kind === 'hours') {
    const max = schedule.kind === 'minutes' ? 59 : 23;
    if (!Number.isInteger(schedule.every) || schedule.every < 1 || schedule.every > max)
      return `Choose a whole number from 1 to ${max}.`;
  }
  if ('time' in schedule && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time))
    return 'Choose a time.';
  if (schedule.kind === 'weekly' && schedule.days.length === 0) return 'Choose at least one day.';
  if (
    schedule.kind === 'monthly' &&
    (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > 31)
  )
    return 'Choose a whole number from 1 to 31.';
  return undefined;
}

/** UTC is the schema default, but Intl's enumeration deliberately omits it. */
export const TIMEZONES = ['UTC', ...Intl.supportedValuesOf('timeZone')];
export const timezoneError = (timezone: string) =>
  TIMEZONES.includes(timezone) ? undefined : 'Choose an IANA time zone from the list.';

export function formatSlot(timestamp: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).format(new Date(timestamp));
}
