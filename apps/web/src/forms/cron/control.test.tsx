import { NodeConfigSchemas } from '@graphgoblin/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi, problem } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { NODE_FIELD_CONTROLS } from '../../editor/field-controls.js';
import { SchemaForm } from '../SchemaForm.js';

const json = (next: string[]) =>
  new Response(JSON.stringify({ next }), { headers: { 'content-type': 'application/json' } });
function setup(
  expression = '0 9 * * *',
  timezone: string | undefined = 'UTC',
  api = new FakeApi(),
) {
  const change = vi.fn();
  api.override('POST /triggers/cron/preview', () =>
    json(['2026-03-28T09:00:00.000Z', '2026-03-29T08:00:00.000Z']),
  );
  const rendered = renderWith(
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
      controls={NODE_FIELD_CONTROLS}
    />,
    '/',
    api,
  );
  return { ...rendered, change, user: userEvent.setup() };
}
const calls = (api: FakeApi) => api.calls.filter((call) => call.path === '/triggers/cron/preview');
const raw = () => screen.getByLabelText('Cron expression');

describe('cron schedule control', () => {
  it('loads a saved schedule unchanged and shows trigger and viewer times from the API', async () => {
    const { change, api, user } = setup('0 9 * * 1-5', 'Europe/London');
    expect(screen.getByLabelText('Repeat')).toHaveValue('weekdays');
    expect(screen.getByText('Every weekday at 09:00, Europe/London')).toBeVisible();
    expect(change).not.toHaveBeenCalled();
    const runs = screen.getByRole('region', { name: 'Upcoming runs' });
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
    expect(raw()).toHaveValue('0 9 * * 1-5');
    await user.selectOptions(repeat, 'weekly');
    screen.getByLabelText('Wednesday').focus();
    await user.keyboard(' ');
    expect(raw()).toHaveValue('0 9 * * 1,3');
    await user.click(screen.getByLabelText('Monday'));
    await user.click(screen.getByLabelText('Wednesday'));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one day.');
    await user.click(screen.getByLabelText('Friday'));
    expect(raw()).toHaveValue('0 9 * * 5');
    await user.selectOptions(repeat, 'monthly');
    fireEvent.change(screen.getByLabelText('Day of month'), { target: { value: '31' } });
    expect(raw()).toHaveValue('0 9 31 * *');
    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith({
        subtype: 'cron',
        expression: '0 9 31 * *',
        timezone: 'UTC',
        missedFirePolicy: 'skip',
        enabled: true,
      }),
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
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid schedule:'));
    expect(calls(api)).toHaveLength(2);
    await user.clear(screen.getByLabelText('Timezone'));
    await user.type(screen.getByLabelText('Timezone'), 'Mars/Olympus');
    expect(screen.getByLabelText('Timezone')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Timezone')).toHaveAccessibleDescription(
      'Choose an IANA time zone from the list.',
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
      expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable.'),
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
    await user.selectOptions(screen.getByLabelText('Repeat'), 'monthly');
    fireEvent.change(screen.getByLabelText('Day of month'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 31');
  });
});
