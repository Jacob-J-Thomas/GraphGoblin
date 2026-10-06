import { NodeConfigSchemas } from '@graphgoblin/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi, problem } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { NODE_FIELD_CONTROLS } from '../../editor/field-controls.js';
import { SchemaForm } from '../SchemaForm.js';
import { focusField } from '../../editor/focus-field.js';
import type { ParseError } from '../parse-errors.js';

const json = (next: string[]) =>
  new Response(JSON.stringify({ next }), { headers: { 'content-type': 'application/json' } });
function setup(
  expression = '0 9 * * *',
  timezone: string | undefined = 'UTC',
  api = new FakeApi(),
) {
  const change = vi.fn();
  const parseError = vi.fn();
  api.override('POST /triggers/cron/preview', () =>
    json(['2026-03-28T09:00:00.000Z', '2026-03-29T08:00:00.000Z']),
  );
  function Form() {
    const [errors, setErrors] = useState<Record<string, ParseError>>({});
    return (
      <SchemaForm
        schema={NodeConfigSchemas.trigger}
        value={{
          subtype: 'cron',
          expression,
          ...(timezone === undefined ? {} : { timezone }),
          missedFirePolicy: 'skip',
          enabled: true,
        }}
        label="cron"
        onChange={change}
        parseErrors={errors}
        onParseError={(path, error, reason, action) => {
          parseError(path, error, reason, action);
          setErrors((previous) => {
            const { [path]: _removed, ...rest } = previous;
            return error ? { ...rest, [path]: error } : rest;
          });
        }}
        controls={NODE_FIELD_CONTROLS}
      />
    );
  }
  const rendered = renderWith(<Form />, '/', api);
  return { ...rendered, change, parseError, user: userEvent.setup() };
}
const calls = (api: FakeApi) => api.calls.filter((call) => call.path === '/triggers/cron/preview');
const raw = () => screen.getByLabelText('Cron expression');

describe('cron schedule control', () => {
  it('loads a saved schedule unchanged and shows trigger and viewer times from the API', async () => {
    const { change, api, user } = setup('0 9 * * 1-5', 'Europe/London');
    expect(screen.getByLabelText('Repeat')).toHaveValue('weekdays');
    expect(screen.getByText('Every weekday at 09:00, Europe/London')).toBeVisible();
    expect(change).not.toHaveBeenCalled();
    const runs = await screen.findByRole('region', { name: 'Upcoming runs' });
    await waitFor(() => expect(within(runs).getAllByRole('listitem')).toHaveLength(2));
    expect(runs.querySelectorAll('time')[1]).toHaveAttribute(
      'datetime',
      '2026-03-29T08:00:00.000Z',
    );
    expect(runs.querySelectorAll('time')[1]).toHaveTextContent('09:00:00');
    expect(within(runs).getAllByText(/Your time:/)).toHaveLength(2);
    expect(calls(api)[0]?.body).toEqual({
      expression: '0 9 * * 1-5',
      timezone: 'Europe/London',
      count: 5,
    });
    expect(raw()).not.toBeVisible();
    const advanced = screen.getByRole('button', { name: 'Advanced Cron expression' });
    advanced.focus();
    await user.keyboard('{Enter}');
    expect(raw()).toBeVisible();
    expect(raw()).toHaveValue('0 9 * * 1-5');
  });
  it('builds every preset, edits numbers and times, and keeps the saved shape', async () => {
    const { user, change } = setup();
    const repeat = screen.getByLabelText('Repeat');
    await user.selectOptions(repeat, 'minutes');
    fireEvent.change(screen.getByLabelText('Every (minutes)'), { target: { value: '7' } });
    expect(raw()).toHaveValue('*/7 * * * *');
    await user.selectOptions(repeat, 'hours');
    fireEvent.change(screen.getByLabelText('Every (hours)'), { target: { value: '4' } });
    expect(raw()).toHaveValue('0 */4 * * *');
    await user.selectOptions(repeat, 'daily');
    fireEvent.change(screen.getByLabelText('At time'), { target: { value: '12:34' } });
    expect(raw()).toHaveValue('34 12 * * *');
    await user.selectOptions(repeat, 'weekdays');
    expect(raw()).toHaveValue('34 12 * * 1-5');
    await user.selectOptions(repeat, 'weekly');
    screen.getByLabelText('Wednesday').focus();
    await user.keyboard(' ');
    expect(raw()).toHaveValue('34 12 * * 1,3');
    await user.click(screen.getByLabelText('Monday'));
    await user.click(screen.getByLabelText('Wednesday'));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one day.');
    await user.click(screen.getByLabelText('Friday'));
    expect(raw()).toHaveValue('34 12 * * 5');
    await user.selectOptions(repeat, 'monthly');
    fireEvent.change(screen.getByLabelText('Day of month'), { target: { value: '31' } });
    expect(raw()).toHaveValue('34 12 31 * *');
    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith(
        {
          subtype: 'cron',
          expression: '34 12 31 * *',
          timezone: 'UTC',
          missedFirePolicy: 'skip',
          enabled: true,
        },
        // A number typed in the builder is typing in the expression field.
        expect.objectContaining({ path: 'expression', kind: 'typing' }),
      ),
    );
  });
  it('keeps custom source on load, switch to custom, and unrelated timezone edits; recognises raw presets', async () => {
    const expression = '*/7 3-5 * * 1,3';
    const { user, change } = setup(expression);
    expect(screen.getByLabelText('Repeat')).toHaveValue('custom');
    expect(change).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Timezone'));
    await user.type(screen.getByLabelText('Timezone'), 'Europe/London');
    expect(raw()).toHaveValue(expression);
    await user.click(screen.getByRole('button', { name: 'Advanced Cron expression' }));
    fireEvent.change(raw(), { target: { value: ' 0  9 * * * ' } });
    expect(screen.getByLabelText('Repeat')).toHaveValue('daily');
    expect(raw()).toHaveValue(' 0  9 * * * ');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'custom');
    expect(raw()).toHaveValue(' 0  9 * * * ');
    expect(screen.getByLabelText('Repeat')).toHaveValue('custom');
  });
  it('uses UTC for a new trigger and offers the browser zone with a searchable datalist', async () => {
    const { user } = setup('', undefined);
    expect(screen.getByLabelText('Timezone')).toHaveValue('UTC');
    const input = screen.getByLabelText('Timezone');
    const list = document.getElementById(input.getAttribute('list')!);
    expect(list?.querySelector('option[value="Europe/London"]')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use my time zone' }));
    expect(input).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
  it('debounces edits, suppresses invalid zones locally, and displays the server CRON_INVALID before save', async () => {
    const { user, api } = setup();
    await waitFor(() => expect(calls(api)).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Advanced Cron expression' }));
    api.override('POST /triggers/cron/preview', () =>
      problem(400, 'CRON_INVALID', 'bad expression'),
    );
    await user.clear(raw());
    await user.type(raw(), 'broken');
    expect(calls(api)).toHaveLength(1);
    await waitFor(() => expect(screen.getByText('Invalid schedule: bad expression')).toBeVisible());
    expect(raw()).toHaveAccessibleDescription(
      expect.stringContaining('Invalid schedule: bad expression'),
    );
    expect(calls(api)).toHaveLength(2);
    await user.clear(screen.getByLabelText('Timezone'));
    await user.type(screen.getByLabelText('Timezone'), 'Mars/Olympus');
    expect(screen.getByLabelText('Timezone')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Timezone')).toHaveAccessibleDescription(
      'IANA time zone the expression is evaluated in. Enter a valid IANA time zone.',
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls(api)).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('IANA');
  });
  it('keeps current source and shows a clear unavailable preview when transport fails', async () => {
    const { api } = setup();
    api.override('POST /triggers/cron/preview', () => {
      throw new TypeError('Failed to fetch');
    });
    await waitFor(() =>
      expect(screen.getByText(/^Preview unavailable\./)).toHaveTextContent(
        'Cannot reach the schedule preview API',
      ),
    );
    expect(screen.getByText(/Current expression:/)).toHaveTextContent('0 9 * * *');
    expect(raw()).toHaveValue('0 9 * * *');
  });
  it('does not show stale results from an earlier in-flight request', async () => {
    const { api, user } = setup();
    let release: (response: Response) => void = () => undefined;
    api.override(
      'POST /triggers/cron/preview',
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    await waitFor(() => expect(calls(api)).toHaveLength(1));
    await user.selectOptions(screen.getByLabelText('Repeat'), 'monthly');
    release(json(['2026-03-29T08:00:00.000Z']));
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    api.override('POST /triggers/cron/preview', () => json([]));
    await waitFor(() =>
      expect(screen.getByText('No upcoming runs for this expression.')).toBeVisible(),
    );
  });
  it('flags incomplete number and time controls without requesting their preview', async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText('Repeat'), 'minutes');
    fireEvent.change(screen.getByLabelText('Every (minutes)'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 59');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
    fireEvent.change(screen.getByLabelText('At time'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a time.');
    fireEvent.change(screen.getByLabelText('At time'), { target: { value: '09:00' } });
    await user.selectOptions(screen.getByLabelText('Repeat'), 'monthly');
    fireEvent.change(screen.getByLabelText('Day of month'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 31');
  });
  it.each(['Etc/UTC', 'Asia/Kolkata'])(
    'accepts the valid zone %s even outside the suggestion list',
    async (timezone) => {
      const { api, change } = setup('0 9 * * *', timezone);
      await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
      expect(screen.getByLabelText('Timezone')).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(calls(api)[0]?.body).toEqual({ expression: '0 9 * * *', timezone, count: 5 });
      expect(change).not.toHaveBeenCalled();
    },
  );
  it('opens with no schedule, makes no preview request, and adds no edit until a preset is chosen', async () => {
    const { api, change, user } = setup('');
    expect(screen.getByLabelText('Repeat')).toHaveValue('empty');
    expect(
      screen.getByText('Choose a schedule to see upcoming runs.', { selector: 'p:not([role])' }),
    ).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Upcoming runs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls(api)).toHaveLength(0);
    expect(change).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith(
        expect.objectContaining({ expression: '0 9 * * *' }),
        // Choosing a preset is a commit: an undo step of its own.
        expect.objectContaining({ path: 'expression', kind: 'commit' }),
      ),
    );
    await waitFor(() => expect(calls(api)).toHaveLength(1));
  });
  it.each([
    ['0 9 * * *', 'At time', 'Choose a time.'],
    ['*/5 * * * *', 'Every (minutes)', 'Choose a whole number from 1 to 59.'],
    ['0 9 12 * *', 'Day of month', 'Choose a whole number from 1 to 31.'],
  ])('keeps the stored expression %s after clearing %s', async (expression, label, message) => {
    const { change, api } = setup(expression);
    await waitFor(() => expect(calls(api)).toHaveLength(1));
    fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(raw()).toHaveValue(expression);
    expect(change).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls(api)).toHaveLength(1);
  });
  it('keeps the stored weekly expression after clearing all days, then commits a complete choice', async () => {
    const { change, parseError, user } = setup('30 7 * * 1');
    await user.click(screen.getByLabelText('Monday'));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one day.');
    expect(raw()).toHaveValue('30 7 * * 1');
    expect(change).not.toHaveBeenCalled();
    expect(parseError).toHaveBeenLastCalledWith(
      'expression',
      {
        message: 'Choose at least one day.',
        text: JSON.stringify({ kind: 'weekly', time: '07:30', days: [] }),
      },
      undefined,
      expect.objectContaining({ path: 'expression', kind: 'commit' }),
    );
    await user.click(screen.getByLabelText('Wednesday'));
    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith(
        expect.objectContaining({ expression: '30 7 * * 3' }),
        expect.objectContaining({ path: 'expression', kind: 'commit' }),
      ),
    );
  });
  it('says what to choose and retains the last valid time after an incomplete edit (#41)', async () => {
    const { user } = setup('30 7 * * 1');
    expect(screen.getByText('Every Monday at 07:30, UTC')).toBeVisible();
    await user.click(screen.getByLabelText('Monday'));
    expect(screen.queryByText(/^Every\s+at/)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one day.');
    expect(screen.getAllByText('Choose at least one day.')).toHaveLength(1);
    await user.click(screen.getByLabelText('Monday'));
    fireEvent.change(screen.getByLabelText('At time'), { target: { value: '' } });
    expect(screen.queryByText(/Every Monday at ,/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Choose a time.')).toHaveLength(1);
    // An incomplete draft never replaces the last valid preference.
    await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
    expect(screen.getByLabelText('At time')).toHaveValue('07:30');
    expect(screen.getByText('Every day at 07:30, UTC')).toBeVisible();
    expect(raw()).toHaveValue('30 7 * * *');
  });
  it('retains the last valid weekly days and monthly day after clearing them', async () => {
    const { user } = setup('30 7 * * 3');
    await user.click(screen.getByLabelText('Wednesday'));
    await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'weekly');
    expect(screen.getByLabelText('Wednesday')).toBeChecked();
    expect(screen.getByLabelText('Monday')).not.toBeChecked();
    expect(raw()).toHaveValue('30 7 * * 3');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'monthly');
    fireEvent.change(screen.getByLabelText('Day of month'), { target: { value: '28' } });
    fireEvent.change(screen.getByLabelText('Day of month'), { target: { value: '' } });
    await user.selectOptions(screen.getByLabelText('Repeat'), 'hours');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'monthly');
    expect(screen.getByLabelText('Day of month')).toHaveValue(28);
    expect(raw()).toHaveValue('30 7 28 * *');
  });
  it('retains time, days, and monthly day even through presets without those fields', async () => {
    const { user } = setup('25 17 * * 1,3');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'monthly');
    fireEvent.change(screen.getByLabelText('Day of month'), { target: { value: '28' } });
    await user.selectOptions(screen.getByLabelText('Repeat'), 'hours');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'weekly');
    expect(screen.getByLabelText('At time')).toHaveValue('17:25');
    expect(screen.getByLabelText('Monday')).toBeChecked();
    expect(screen.getByLabelText('Wednesday')).toBeChecked();
    await user.selectOptions(screen.getByLabelText('Repeat'), 'monthly');
    expect(screen.getByLabelText('Day of month')).toHaveValue(28);
    expect(raw()).toHaveValue('25 17 28 * *');
  });
  it('reveals and focuses raw text on Custom selection and when following an expression issue', async () => {
    const { user, container } = setup();
    expect(raw()).not.toBeVisible();
    expect(focusField(container, 'expression')).toBe(true);
    expect(raw()).toBeVisible();
    expect(raw()).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Advanced Cron expression' }));
    await user.selectOptions(screen.getByLabelText('Repeat'), 'custom');
    expect(raw()).toBeVisible();
    expect(raw()).toHaveFocus();
  });
  it('focuses the timezone field without opening the expression disclosure', () => {
    const { container } = setup();
    expect(focusField(container, 'timezone')).toBe(true);
    expect(screen.getByLabelText('Timezone')).toHaveFocus();
    expect(raw()).not.toBeVisible();
  });
  it('shows the expression problem count on Advanced', async () => {
    const { api } = setup('bad');
    api.override('POST /triggers/cron/preview', () =>
      problem(400, 'CRON_INVALID', 'invalid pattern'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Advanced Cron expression 1 error' }),
      ).toBeVisible(),
    );
  });
  it('announces debounced values through one stable status, not raw typing', async () => {
    const { user } = setup('0 9 * * *');
    const schedule = within(screen.getByRole('group', { name: 'Schedule' }));
    await waitFor(() =>
      expect(schedule.getByRole('status')).toHaveTextContent('Upcoming runs ready.'),
    );
    const status = schedule.getByRole('status');
    const before = status.textContent;
    await user.selectOptions(screen.getByLabelText('Repeat'), 'custom');
    fireEvent.change(raw(), { target: { value: 'b' } });
    expect(schedule.getByRole('status')).toBe(status);
    expect(status.textContent).toBe(before);
    fireEvent.change(raw(), { target: { value: 'broken' } });
    expect(status.textContent).toBe(before);
    await waitFor(() => expect(status).toHaveTextContent('Custom expression: broken'));
    expect(schedule.getAllByRole('status')).toHaveLength(1);
  });
  it.each([
    [403, 'FORBIDDEN', 'this key lacks loops:read'],
    [503, 'UNAVAILABLE', 'scheduler is unavailable'],
  ])(
    'shows the HTTP %s detail without calling it a transport failure',
    async (status, code, detail) => {
      const { api } = setup();
      api.override('POST /triggers/cron/preview', () =>
        problem(Number(status), String(code), String(detail)),
      );
      await waitFor(() => expect(screen.getByText(`Preview unavailable. ${detail}`)).toBeVisible());
      expect(screen.queryByText(/Cannot reach/)).not.toBeInTheDocument();
      expect(screen.queryByText(new RegExp(`${code}:`))).not.toBeInTheDocument();
    },
  );
  it('omits the duplicate viewer time when the zones resolve identically', async () => {
    setup('0 9 * * *', Intl.DateTimeFormat().resolvedOptions().timeZone);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(screen.queryByText(/^Your time:/)).not.toBeInTheDocument();
  });
  it('keeps help and schema error descriptions alongside a local zone error, with the button after them', async () => {
    const { user } = setup();
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'x'.repeat(65) } });
    await waitFor(() =>
      expect(screen.getByLabelText('Timezone')).toHaveAccessibleDescription(
        expect.stringContaining('Too big:'),
      ),
    );
    const input = screen.getByLabelText('Timezone');
    expect(input).toHaveAccessibleDescription(
      expect.stringContaining('IANA time zone the expression is evaluated in.'),
    );
    expect(input).toHaveAccessibleDescription(
      expect.stringContaining('Enter a valid IANA time zone.'),
    );
    const help = screen.getByText('IANA time zone the expression is evaluated in.');
    const button = screen.getByRole('button', { name: 'Use my time zone' });
    expect(help.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(button);
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
  });
});
