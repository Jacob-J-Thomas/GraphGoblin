import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loops } from '@graphgoblin/api-client';
import { TriggerConfigSchema } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
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

async function openTrigger() {
  const api = new FakeApi();
  const definition = newLoopDefinition('trigger types');
  definition.nodes[0]!.config = triggerConfig('manual', { inputSchema: { type: 'object' } });
  const loop = api.addLoop(definition);
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'trigger types' });
  act(() => store().openNode('start'));
  return screen.findByRole('dialog', { name: 'Edit trigger start' });
}

it.each([
  triggerConfig('manual', { exposeTo: ['ui', 'mcp'], inputSchema: { type: 'object' } }),
  triggerConfig('cron', { expression: '30 7 * * 1', timezone: 'Europe/Paris' }),
  triggerConfig('event', { eventType: 'build-ready', filter: 'true', dedupeKey: 'id' }),
  triggerConfig('poll', { intervalSeconds: 30, probe: { kind: 'none' }, fireWhen: 'true' }),
  triggerConfig('webhook', {
    signature: { scheme: 'hmac-sha256', secretRef: 'hook' },
    filter: 'true',
  }),
  triggerConfig('webhook', {
    signature: { scheme: 'hmac-sha256-body', secretRef: 'github' },
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
    expect(within(dialog).getByLabelText('Filter')).toBeVisible();
    expect(within(dialog).getByLabelText('Dedupe key')).toBeVisible();
    expect(within(dialog).queryByLabelText('Interval seconds')).not.toBeInTheDocument();

    await user.selectOptions(type, 'webhook');
    expect(within(dialog).getByLabelText('Signing protocol')).toHaveDisplayValue(
      'Timestamp and body',
    );
    expect(within(dialog).getByLabelText('Replay window seconds')).toBeVisible();
    expect(within(dialog).getByLabelText('Secret ref')).toBeVisible();
    expect(within(dialog).getByLabelText('Filter')).toBeVisible();
    await user.selectOptions(
      within(dialog).getByLabelText('Signing protocol'),
      within(dialog).getByRole('option', { name: 'Body only (GitHub)' }),
    );
    expect(current()).toMatchObject({
      type: 'webhook',
      signature: { scheme: 'hmac-sha256-body' },
    });
    expect(within(dialog).queryByLabelText('Replay window seconds')).not.toBeInTheDocument();
    const bodySigned = current();
    const steps = store().past.length;
    await user.selectOptions(type, 'webhook');
    expect(current()).toBe(bodySigned);
    expect(store().past).toHaveLength(steps);
    act(() => store().openNode('start', { field: 'config.signature.scheme' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Signing protocol')).toHaveFocus());
    await user.selectOptions(type, 'manual');
    expect(within(dialog).queryByLabelText('Signing protocol')).not.toBeInTheDocument();
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
      await user.type(within(dialog).getByLabelText('Repository owner'), 'octo-team');
      await user.type(within(dialog).getByLabelText('Repository'), 'service');
      await user.type(within(dialog).getByLabelText('Issue label'), 'ready');
      if (preset === 'issues-labeled')
        await user.type(within(dialog).getByLabelText('Signing secret name'), 'synthetic-hook');
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
      else expect(within(dialog).getByLabelText('Secret ref')).toHaveValue('synthetic-hook');
    },
  );
});
