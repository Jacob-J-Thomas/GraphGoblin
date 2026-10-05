import { describe, expect, it } from 'vitest';
import {
  defaultSchedule,
  formatSlot,
  parseSchedule,
  scheduleError,
  scheduleExpression,
  scheduleSummary,
  timezoneError,
  type Schedule,
  type BuiltSchedule,
  schedulePreferences,
} from './model.js';

const cases: [BuiltSchedule, string, string][] = [
  [{ kind: 'minutes', every: 5 }, '*/5 * * * *', 'Every 5 minutes'],
  [{ kind: 'hours', every: 3 }, '0 */3 * * *', 'Every 3 hours'],
  [{ kind: 'daily', time: '09:30' }, '30 9 * * *', 'Every day at 09:30'],
  [{ kind: 'weekdays', time: '09:00' }, '0 9 * * 1-5', 'Every weekday at 09:00'],
  [
    { kind: 'weekly', time: '18:45', days: [0, 2, 6] },
    '45 18 * * 0,2,6',
    'Every Sunday, Tuesday, and Saturday at 18:45',
  ],
  [{ kind: 'monthly', time: '00:00', day: 31 }, '0 0 31 * *', 'Monthly on day 31 at 00:00'],
];
describe('cron preset model', () => {
  it.each(cases)('builds, describes and reopens %j', (model, expression, summary) => {
    expect(scheduleExpression(model)).toBe(expression);
    expect(parseSchedule(expression)).toEqual(model);
    expect(scheduleSummary(model, expression, 'Europe/London')).toBe(`${summary}, Europe/London`);
    expect(scheduleError(model)).toBeUndefined();
  });
  it.each(['minutes', 'hours', 'daily', 'weekdays', 'weekly', 'monthly'] as const)(
    'round trips the %s default',
    (kind) => {
      const model = defaultSchedule(kind);
      expect(parseSchedule(scheduleExpression(model))).toEqual(model);
    },
  );
  it.each([
    '*/7 3-5 * * 1,3',
    '0 0 9 * * *',
    '@daily',
    '0 9 * 3 *',
    '0 9 2 * 1',
    '61 25 * * *',
    '0 9 * * MON',
    '*/60 * * * *',
    '0 */24 * * *',
    '0 9 * * 7',
  ])('preserves custom %s', (expression) => {
    expect(parseSchedule(expression)).toEqual({ kind: 'custom' });
    expect(scheduleSummary(parseSchedule(expression), expression, 'UTC')).toBe(
      `Custom expression: ${expression} · UTC`,
    );
  });
  it('recognises spacing, wildcard minutes and sorted day sets without rewriting source', () => {
    expect(parseSchedule(' 0  9 * * 3,1,3 ')).toEqual({
      kind: 'weekly',
      time: '09:00',
      days: [1, 3],
    });
    expect(parseSchedule('* * * * *')).toEqual({ kind: 'minutes', every: 1 });
    expect(parseSchedule('0 * * * *')).toEqual({ kind: 'hours', every: 1 });
    expect(scheduleSummary({ kind: 'hours', every: 1 }, '', 'UTC')).toBe('Every hour, UTC');
    expect(scheduleSummary({ kind: 'minutes', every: 1 }, '', 'UTC')).toBe('Every minute, UTC');
  });
  it.each<Schedule>([
    { kind: 'minutes', every: 0 },
    { kind: 'minutes', every: 60 },
    { kind: 'hours', every: 24 },
    { kind: 'hours', every: 1.5 },
    { kind: 'daily', time: '' },
    { kind: 'weekly', time: '09:00', days: [] },
    { kind: 'monthly', time: '09:00', day: 0 },
    { kind: 'monthly', time: '09:00', day: 32 },
    { kind: 'monthly', time: '09:00', day: 1.5 },
  ])('flags invalid builder values %j', (model) =>
    expect(scheduleError(model)).toBeTypeOf('string'),
  );
  it('checks zones locally and formats the zone offset on both sides of DST', () => {
    expect(timezoneError('UTC')).toBeUndefined();
    expect(timezoneError('Europe/London')).toBeUndefined();
    expect(timezoneError('Etc/UTC')).toBeUndefined();
    expect(timezoneError('Asia/Kolkata')).toBeUndefined();
    expect(timezoneError('Mars/Olympus')).toContain('IANA');
    expect(formatSlot('2026-03-28T09:00:00.000Z', 'Europe/London')).toContain('09:00:00');
    expect(formatSlot('2026-03-29T08:00:00.000Z', 'Europe/London')).toContain('GMT+1');
  });
  it('treats an empty expression as no schedule chosen', () => {
    expect(parseSchedule('')).toEqual({ kind: 'empty' });
    expect(parseSchedule('  ')).toEqual({ kind: 'empty' });
    expect(scheduleSummary({ kind: 'empty' }, '', 'UTC')).toBe(
      'Choose a schedule to see upcoming runs.',
    );
  });
  it('retains applicable time, weekly days, and monthly day across presets', () => {
    const previous = {
      ...schedulePreferences({ kind: 'monthly', time: '17:25', day: 28 }),
      ...schedulePreferences({ kind: 'weekly', time: '17:25', days: [1, 3] }),
    };
    expect(defaultSchedule('daily', previous)).toEqual({ kind: 'daily', time: '17:25' });
    expect(defaultSchedule('weekdays', previous)).toEqual({ kind: 'weekdays', time: '17:25' });
    expect(defaultSchedule('weekly', previous)).toEqual({
      kind: 'weekly',
      time: '17:25',
      days: [1, 3],
    });
    expect(defaultSchedule('monthly', previous)).toEqual({
      kind: 'monthly',
      time: '17:25',
      day: 28,
    });
    expect(schedulePreferences({ kind: 'hours', every: 1 })).toEqual({});
    expect(scheduleSummary({ kind: 'weekly', time: '17:25', days: [1, 3] }, '', 'UTC')).toBe(
      'Every Monday and Wednesday at 17:25, UTC',
    );
  });
});
