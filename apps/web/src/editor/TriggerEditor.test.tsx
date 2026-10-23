import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loops } from '@graphgoblin/api-client';
import { TriggerConfigSchema } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderNodeEditor } from '../__fixtures__/node-editor.js';
import { pasteInto } from '../__fixtures__/user.js';
import { renderApp } from '../__fixtures__/render.js';
import { triggerConfig } from '../__fixtures__/triggers.js';
import { createAppClient } from '../api/context.js';
import { loadLocalDraft } from '../drafts/local-drafts.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

const store = () => useEditorStore.getState();
const current = () => store().definition!.nodes[0]!.config;
const UNDO = '{Control>}z{/Control}';
const REDO = '{Control>}{Shift>}z{/Shift}{/Control}';

async function openTrigger(api = new FakeApi()) {
  const definition = newLoopDefinition('trigger types');
  definition.nodes[0]!.config = triggerConfig('manual', { inputSchema: { type: 'object' } });
  const loop = api.addLoop(definition);
  renderNodeEditor(loop.id, definition, 'start', api);
  return screen.findByRole('dialog', { name: 'Edit trigger start' });
}

it.each([
  triggerConfig('manual', { exposeTo: ['ui', 'mcp'], inputSchema: { type: 'object' } }),
  triggerConfig('cron', { expression: '30 7 * * 1', timezone: 'Europe/Paris' }),
  triggerConfig('event', { eventType: 'build-ready', dedupeKey: 'id' }),
  triggerConfig('poll', { intervalSeconds: 30, probe: { kind: 'none' }, fireWhen: 'true' }),
  triggerConfig('webhook', {
    authentication: { type: 'hmac-sha256', message: 'timestamp-body', secretRef: 'hook' },
  }),
  triggerConfig('webhook', {
    authentication: { type: 'hmac-sha256', message: 'body', secretRef: 'github' },
    dedupeKey: 'id',
  }),
])('keeps type through editor save, device draft, reopen and export: %j', async (config) => {
  const api = new FakeApi();
  const definition = newLoopDefinition('trigger round trip');
  definition.nodes[0]!.config = config;
  const expected = TriggerConfigSchema.parse(config);
  const loop = api.addLoop(definition);
  const first = renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: definition.name });
  act(() => {
    store().openNode('start');
    store().updateNode('start', { label: 'Saved trigger' });
  });
  expect(within(screen.getByRole('dialog')).getByLabelText('Trigger type')).toHaveDisplayValue(
    config.type[0]!.toUpperCase() + config.type.slice(1),
  );
  await waitFor(() => expect(api.callsTo('PUT', `/loops/${loop.id}/draft`)).toHaveLength(1), {
    timeout: 4000,
  });
  await waitFor(() =>
    expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
  );
  expect(api.loops.get(loop.id)!.draft!.definition.nodes[0]!.config).toEqual(expected);
  expect((await loadLocalDraft(loop.id))!.definition.nodes[0]!.config).toEqual(expected);
  first.unmount();
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: definition.name });
  act(() => store().openNode('start'));
  expect(current()).toEqual(expected);
  expect(current()).not.toHaveProperty('subtype');
  const client = createAppClient('http://graphgoblin.test', api.fetch);
  const exported = await loops.export(client, loop.id, { draft: true });
  expect(exported.loop.nodes[0]!.config).toEqual(expected);
});

describe('trigger authoring', () => {
  it('starts with five types, shows only their fields, and keeps signing under Webhook', async () => {
    const user = userEvent.setup();
    const dialog = await openTrigger();
    const type = within(dialog).getByLabelText('Trigger type');
    expect(
      within(type)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Manual', 'Cron', 'Poll', 'Event', 'Webhook']);
    expect(type).toHaveAccessibleDescription('Start a run yourself from the web app, API or MCP.');
    expect(within(dialog).getByLabelText('Input schema')).toBeVisible();
    expect(dialog.querySelector('[data-field="exposeTo"]')).toBeVisible();
    expect(within(dialog).queryByLabelText('Preset')).not.toBeInTheDocument();
    expect(store().past).toHaveLength(0);
    const optional = within(dialog).getByRole('button', { name: 'Start from a preset' });
    expect(type.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.selectOptions(type, 'cron');
    expect(current()).toMatchObject(triggerConfig('cron', { expression: '' }));
    expect(within(dialog).getByLabelText('Repeat')).toBeVisible();
    expect(within(dialog).getByLabelText('Timezone')).toBeVisible();
    expect(within(dialog).getByLabelText('Missed fire policy')).toBeVisible();
    expect(within(dialog).queryByLabelText('Input schema')).not.toBeInTheDocument();

    await user.selectOptions(type, 'poll');
    expect(within(dialog).getByLabelText('Interval seconds')).toBeVisible();
    expect(dialog.querySelector('[data-field="probe"]')).toBeVisible();
    expect(within(dialog).getByLabelText('Fire when')).toBeVisible();
    expect(dialog.querySelector('[data-field="items"]')).toBeVisible();
    expect(type).toHaveAccessibleDescription(expect.stringContaining('With Items configured'));
    expect(within(dialog).getByText(/Poll probes run on the GraphGoblin server/)).toBeVisible();
    expect(within(dialog).queryByLabelText('Repeat')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Timezone')).not.toBeInTheDocument();
    expect(
      within(dialog).getByLabelText('Whole-probe dedupe key (single-result only)'),
    ).toBeVisible();

    await user.selectOptions(type, 'event');
    expect(within(dialog).getByLabelText('Event type')).toBeVisible();
    expect(within(dialog).queryByLabelText('Filter')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Use a downstream decision for payload checks/)).toBeVisible();
    expect(within(dialog).getByLabelText('Dedupe key')).toBeVisible();
    expect(within(dialog).queryByLabelText('Interval seconds')).not.toBeInTheDocument();

    await user.selectOptions(type, 'webhook');
    const authentication = within(dialog).getByLabelText('Authentication recipe');
    expect(authentication).toHaveDisplayValue('None');
    expect(within(dialog).queryByLabelText('Signing secret name')).not.toBeInTheDocument();
    await user.selectOptions(
      authentication,
      within(dialog).getByRole('option', { name: 'Timestamp and body HMAC' }),
    );
    expect(within(dialog).getByLabelText('Timestamp window (seconds)')).toBeVisible();
    expect(within(dialog).getByLabelText('Secret name')).toBeVisible();
    expect(within(dialog).queryByLabelText('Filter')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Use a downstream decision for payload checks/)).toBeVisible();
    await user.selectOptions(
      authentication,
      within(dialog).getByRole('option', { name: 'Body HMAC' }),
    );
    expect(current()).toMatchObject({
      type: 'webhook',
      authentication: { type: 'hmac-sha256', message: 'body' },
    });
    expect(within(dialog).queryByLabelText('Timestamp window (seconds)')).not.toBeInTheDocument();
    const bodySigned = current();
    const steps = store().past.length;
    await user.selectOptions(type, 'webhook');
    expect(current()).toBe(bodySigned);
    expect(store().past).toHaveLength(steps);
    act(() => store().openNode('start', { field: 'config.authentication.message' }));
    await waitFor(() => expect(authentication).toHaveFocus());
    await user.selectOptions(type, 'manual');
    expect(within(dialog).queryByLabelText('Authentication recipe')).not.toBeInTheDocument();
    expect(type).toHaveFocus();
  });

  it('restores held input and selector focus through type undo, and focuses validation paths', async () => {
    const user = userEvent.setup();
    const dialog = await openTrigger();
    setCode('Input schema', '{unfinished');
    await waitFor(() => expect(store().fieldErrors['node:start']?.['inputSchema']).toBeDefined());
    await user.selectOptions(within(dialog).getByLabelText('Trigger type'), 'event');
    expect(store().fieldErrors['node:start']).toBeUndefined();
    await user.keyboard(UNDO);
    expect(getCode('Input schema')).toBe('{unfinished');
    expect(within(dialog).getByLabelText('Trigger type')).toHaveFocus();
    await user.keyboard(REDO);
    expect(within(dialog).getByLabelText('Trigger type')).toHaveDisplayValue('Event');
    act(() => store().openNode('start', { field: 'config.eventType' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Event type')).toHaveFocus());
    await user.type(within(dialog).getByLabelText('Event type'), 'incoming');
    expect(within(dialog).getByLabelText('Event type')).toHaveFocus();
    act(() => store().openNode('start', { field: 'config.type' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Trigger type')).toHaveFocus());
  });

  it.each(['issues-poll', 'issues-labeled'] as const)(
    'previews, cancels and applies %s as one undo step including graph and held input',
    async (preset) => {
      const user = userEvent.setup();
      const dialog = await openTrigger();
      setCode('Input schema', '{unfinished');
      await waitFor(() => expect(store().fieldErrors['node:start']?.['inputSchema']).toBeDefined());
      const before = current();
      const beforeGraph = store().definition;
      const held = store().fieldErrors;
      const past = store().past.length;
      await user.click(within(dialog).getByRole('button', { name: 'Start from a preset' }));
      await user.selectOptions(within(dialog).getByLabelText('Preset'), preset);
      await pasteInto(user, within(dialog).getByLabelText('Repository owner'), 'octo-team');
      await pasteInto(user, within(dialog).getByLabelText('Repository'), 'service');
      await pasteInto(user, within(dialog).getByLabelText('Issue label'), 'ready');
      if (preset === 'issues-labeled')
        await pasteInto(
          user,
          within(dialog).getByLabelText('Signing secret name'),
          'synthetic-hook',
        );
      const preview = within(dialog).getByRole('button', { name: 'Preview GitHub preset' });
      preview.focus();
      await user.keyboard('{Enter}');
      expect(within(dialog).getByRole('region', { name: 'Preset preview' })).toHaveFocus();
      expect(
        within(dialog).getByText(/Unfinished input will be replaced: Input schema/),
      ).toBeVisible();
      expect(current()).toBe(before);
      expect(store().past).toHaveLength(past);
      await user.tab();
      expect(within(dialog).getByRole('region', { name: 'Current configuration' })).toHaveFocus();
      await user.tab();
      expect(within(dialog).getByRole('region', { name: 'Preset configuration' })).toHaveFocus();
      await user.tab();
      expect(within(dialog).getByRole('button', { name: 'Cancel preview' })).toHaveFocus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(preview).toHaveFocus());
      expect(store().fieldErrors).toBe(held);
      await user.keyboard('{Enter}');
      await user.tab();
      expect(within(dialog).getByRole('region', { name: 'Current configuration' })).toHaveFocus();
      await user.tab();
      expect(within(dialog).getByRole('region', { name: 'Preset configuration' })).toHaveFocus();
      await user.tab();
      expect(within(dialog).getByRole('button', { name: 'Cancel preview' })).toHaveFocus();
      await user.tab();
      expect(within(dialog).getByRole('button', { name: 'Apply GitHub preset' })).toHaveFocus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(within(dialog).getByLabelText('Trigger type')).toHaveFocus());
      expect(current()).toMatchObject({
        type: preset === 'issues-poll' ? 'poll' : 'webhook',
        ...(preset === 'issues-poll' ? { intervalSeconds: 60 } : {}),
      });
      expect(store().definition!.nodes).toHaveLength(preset === 'issues-poll' ? 2 : 5);
      expect(store().fieldErrors['node:start']).toBeUndefined();
      expect(store().past).toHaveLength(past + 1);
      await user.keyboard(UNDO);
      expect(current()).toBe(before);
      expect(store().definition).toBe(beforeGraph);
      expect(getCode('Input schema')).toBe('{unfinished');
      expect(store().fieldErrors).toEqual(held);
      await user.keyboard(REDO);
      if (preset === 'issues-poll')
        expect(within(dialog).getByLabelText('Interval seconds')).toHaveValue(60);
      else expect(within(dialog).getByLabelText('Secret name')).toHaveValue('synthetic-hook');
    },
  );
});

it('edits authentication, body and extraction by keyboard with one-step undo and field validation', async () => {
  const user = userEvent.setup();
  const dialog = await openTrigger();
  await user.selectOptions(within(dialog).getByLabelText('Trigger type'), 'webhook');
  const auth = () => within(dialog).getByLabelText('Authentication recipe');
  auth().focus();
  await user.selectOptions(auth(), within(dialog).getByRole('option', { name: 'Body HMAC' }));
  expect(auth()).toHaveFocus();
  // These fixture strings need one input edit; keyboard navigation, pointer text entry and
  // undo/redo below remain real user-event sequences.
  await pasteInto(user, within(dialog).getByLabelText('Secret name'), 'synthetic');
  expect(within(dialog).getByLabelText('Signing header')).toHaveAttribute(
    'placeholder',
    'x-hub-signature-256',
  );
  await user.selectOptions(
    auth(),
    within(dialog).getByRole('option', { name: 'Timestamp and body HMAC' }),
  );
  expect(within(dialog).getByLabelText('Timestamp window (seconds)')).toHaveAttribute(
    'placeholder',
    '300',
  );
  await user.keyboard(UNDO);
  expect(auth()).toHaveDisplayValue('Body HMAC');
  expect(auth()).toHaveFocus();
  expect(within(dialog).getByLabelText('Secret name')).toHaveValue('synthetic');
  await user.keyboard(REDO);
  expect(auth()).toHaveDisplayValue('Timestamp and body HMAC');
  await user.selectOptions(auth(), within(dialog).getByRole('option', { name: 'None' }));
  expect(within(dialog).queryByLabelText('Signing header')).not.toBeInTheDocument();
  expect(within(dialog).queryByLabelText('Secret name')).not.toBeInTheDocument();

  const modes = () => within(dialog).getByRole('radiogroup', { name: 'Body mode' });
  await user.click(within(modes()).getByRole('radio', { name: 'text' }));
  expect(current()).toMatchObject({ body: { type: 'text' } });
  await user.keyboard(UNDO);
  expect(within(modes()).getByRole('radio', { name: 'json' })).toBeChecked();
  await user.keyboard(REDO);
  expect(within(modes()).getByRole('radio', { name: 'text' })).toBeChecked();
  const source = () => within(dialog).getByLabelText('Event type source');
  await user.selectOptions(source(), 'header');
  await pasteInto(user, within(dialog).getByLabelText('Event header'), 'x-provider-event');
  expect(within(dialog).getByLabelText('Fallback event type')).toHaveAttribute(
    'placeholder',
    'webhook',
  );
  await user.selectOptions(source(), 'json-pointer');
  await user.type(within(dialog).getByLabelText('JSON pointer'), '/kind');
  await waitFor(() =>
    expect(
      within(dialog).getAllByText('JSON pointers require JSON body mode').length,
    ).toBeGreaterThan(0),
  );
  await user.click(within(modes()).getByRole('radio', { name: 'json' }));
  await waitFor(() =>
    expect(
      within(dialog).queryByText('JSON pointers require JSON body mode'),
    ).not.toBeInTheDocument(),
  );
  expect(TriggerConfigSchema.parse(current())).toMatchObject({
    authentication: { type: 'none' },
    body: { type: 'json' },
    eventType: { source: 'json-pointer', pointer: '/kind', fallback: 'webhook' },
  });
  act(() => store().openNode('start', { field: 'config.eventType.pointer' }));
  await waitFor(() => expect(within(dialog).getByLabelText('JSON pointer')).toHaveFocus());
  await user.selectOptions(source(), 'constant');
  expect(within(dialog).getByLabelText('Constant event type')).toHaveAttribute(
    'placeholder',
    'webhook',
  );
  await user.keyboard(UNDO);
  expect(source()).toHaveDisplayValue('JSON pointer');
  expect(source()).toHaveFocus();
  expect(within(dialog).getByLabelText('JSON pointer')).toHaveValue('/kind');
});

it('authors the displayed UTC default on an untouched daily cron schedule', async () => {
  const user = userEvent.setup();
  const api = new FakeApi();
  api.override(
    'POST /triggers/cron/preview',
    () =>
      new Response(
        JSON.stringify({
          next: [
            '2026-10-18T09:00:00.000Z',
            '2026-10-19T09:00:00.000Z',
            '2026-10-20T09:00:00.000Z',
            '2026-10-21T09:00:00.000Z',
            '2026-10-22T09:00:00.000Z',
          ],
        }),
      ),
  );
  const dialog = await openTrigger(api);
  await user.selectOptions(within(dialog).getByLabelText('Trigger type'), 'cron');
  await user.selectOptions(within(dialog).getByLabelText('Repeat'), 'daily');
  expect(within(dialog).getByLabelText('Timezone')).toHaveValue('UTC');
  expect(current()).toMatchObject({ type: 'cron', timezone: 'UTC', expression: '0 9 * * *' });
  expect(dialog.textContent).not.toContain('graphgoblin:unset');
  await waitFor(() => expect(dialog.querySelectorAll('time')).toHaveLength(5));
  expect(api.callsTo('POST', '/triggers/cron/preview')[0]?.body).toEqual({
    expression: '0 9 * * *',
    timezone: 'UTC',
    count: 5,
  });
});

it('gives an empty Event type a field instruction and retains the raw diagnostic', async () => {
  const user = userEvent.setup();
  const dialog = await openTrigger();
  await user.selectOptions(within(dialog).getByLabelText('Trigger type'), 'event');
  expect(within(dialog).getByLabelText('Event type')).toHaveAccessibleDescription(
    expect.stringContaining('Enter an event type'),
  );
  const details = within(dialog).getByRole('button', { name: /Validation details/ });
  expect(details).toHaveAttribute('aria-expanded', 'false');
  await user.click(details);
  expect(dialog.textContent).toContain('eventType');
  expect(dialog.textContent).toContain('must start with a letter');
});
