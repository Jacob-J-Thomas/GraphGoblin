/** The browser describes only schedules it can build; the API owns cron semantics. */
export type Preset = 'minutes' | 'hours' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
export type Schedule =
  | { kind: 'minutes'; every: number }
  | { kind: 'hours'; every: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; time: string; days: number[] }
  | { kind: 'monthly'; time: string; day: number }
  | { kind: 'empty' }
  | { kind: 'custom' };

export type BuiltSchedule = Exclude<Schedule, { kind: 'custom' | 'empty' }>;
export type SchedulePreferences = { time?: string; days?: number[]; day?: number };

export function schedulePreferences(schedule: Schedule): SchedulePreferences {
  return {
    ...('time' in schedule ? { time: schedule.time } : {}),
    ...(schedule.kind === 'weekly' ? { days: schedule.days } : {}),
    ...(schedule.kind === 'monthly' ? { day: schedule.day } : {}),
  };
}

export const PRESETS: ReadonlyArray<{ value: Preset; label: string }> = [
  { value: 'minutes', label: 'Every N minutes' },
  { value: 'hours', label: 'Every N hours' },
  { value: 'daily', label: 'Daily at a time' },
  { value: 'weekdays', label: 'Weekdays at a time' },
  { value: 'weekly', label: 'Weekly on chosen days' },
  { value: 'monthly', label: 'Monthly on day N' },
];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function defaultSchedule(kind: Preset, previous: SchedulePreferences = {}): BuiltSchedule {
  switch (kind) {
    case 'minutes':
    case 'hours':
      return { kind, every: 1 };
    case 'daily':
    case 'weekdays':
      return { kind, time: previous.time ?? '09:00' };
    case 'weekly':
      return { kind, time: previous.time ?? '09:00', days: previous.days ?? [1] };
    case 'monthly':
      return { kind, time: previous.time ?? '09:00', day: previous.day ?? 1 };
  }
}

export function scheduleExpression(schedule: BuiltSchedule): string {
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
  if (expression.trim() === '') return { kind: 'empty' };
  const parts = expression.trim().split(/\s+/);
  const [minute = '', hour = '', day = '', month = '', week = ''] = parts;
  if (parts.length !== 5 || month !== '*') return { kind: 'custom' };
  if (day === '*' && week === '*') {
    if (hour === '*' && minute.startsWith('*/') && integer(minute.slice(2), 1, 59))
      return { kind: 'minutes', every: Number(minute.slice(2)) };
    if (minute === '0' && hour.startsWith('*/') && integer(hour.slice(2), 1, 23))
      return { kind: 'hours', every: Number(hour.slice(2)) };
    if (minute === '*' && hour === '*') return { kind: 'minutes', every: 1 };
    if (minute === '0' && hour === '*') return { kind: 'hours', every: 1 };
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
      summary = `Every ${new Intl.ListFormat('en', { type: 'conjunction' }).format(schedule.days.map((day) => DAYS[day]!))} at ${schedule.time}`;
      break;
    case 'monthly':
      summary = `Monthly on day ${schedule.day} at ${schedule.time}`;
      break;
    case 'custom':
      return `Custom expression: ${expression} · ${timezone}`;
    case 'empty':
      return 'Choose a schedule to see upcoming runs.';
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
export function timezoneError(timezone: string): string | undefined {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return undefined;
  } catch {
    return 'Enter a valid IANA time zone.';
  }
}

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
