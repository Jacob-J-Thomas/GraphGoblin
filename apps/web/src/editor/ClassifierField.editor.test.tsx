import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_JEV, customClassifier, FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { isValidationKey, keys, refreshCatalogState } from '../api/queries.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { useEditorStore } from './store.js';

const UNDO = '{Control>}z{/Control}';
const store = () => useEditorStore.getState();
const pick = () => store().definition!.nodes.find((n) => n.id === 'pick')!;
/** The decision's `jev` block, as the editor holds it. */
const jevOf = () => (pick().config as { jev?: Record<string, unknown> }).jev;
const nodeBadge = (id: string) =>
  screen
    .getByTestId(`node-${id}`)
    .querySelector<HTMLButtonElement>(`button[aria-label$=" on ${id}"]`);

function decisionLoop(jev?: Record<string, unknown>): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name: 'classifier editor',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          routes: [
            { label: 'yes', description: 'Yes' },
            { label: 'no', description: 'No' },
          ],
          question: 'Which?',
          strategy: ['jev', 'expression'],
          expression: { jsonata: '"yes"' },
          ...(jev ? { jev } : {}),
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
      { id: 'e2', from: { node: 'pick', port: 'yes' }, to: { node: 'done' } },
      { id: 'e3', from: { node: 'pick', port: 'no' }, to: { node: 'done' } },
    ],
  };
}

function setup(jev?: Record<string, unknown>) {
  const api = new FakeApi();
  api.classifiers = [
    BUILTIN_JEV,
    customClassifier({ id: 'kev', displayName: 'Kev 4B' }),
    customClassifier({ id: 'other', displayName: 'Other' }),
  ];
  const loop = api.addLoop(decisionLoop(jev));
  const rendered = renderApp(`/loops/${loop.id}/edit`, api);
  return { ...rendered, loop };
}

/** Wait for the editor to load the loop. */
const loaded = () => screen.findByRole('heading', { name: 'classifier editor' });

async function openPicker() {
  await loaded();
  act(() => store().openNode('pick'));
  const dialog = await screen.findByRole('dialog', { name: 'Edit decision pick' });
  const picker = within(within(dialog).getByRole('group', { name: 'Jev' })).getByRole('combobox', {
    name: 'Model',
  });
  await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(3));
  return { dialog, picker };
}

/** Hold the next validation request until `release`; later ones answer at once. */
function holdFirstValidation(api: FakeApi, beforeAnswer?: () => void) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrive!: () => void;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let first = true;
  api.override('POST /loops/:id/validate', async (call) => {
    if (!first) return api.builtIn(call);
    first = false;
    arrive();
    await held;
    // Answered with the server's state when it is released, as a slow request would be.
    beforeAnswer?.();
    return api.builtIn(call);
  });
  return { release, arrived };
}

const setKev = (api: FakeApi, enabled: boolean) => {
  api.classifiers = api.classifiers.map((c) => (c.id === 'kev' ? { ...c, enabled } : c));
};

/** The cached API checks of the loop, by the catalog fingerprint they were issued for. */
const cachedChecks = (queryClient: QueryClient) =>
  queryClient
    .getQueryCache()
    .findAll({ predicate: ({ queryKey }) => isValidationKey(queryKey) })
    .map((query) => ({
      catalog: query.queryKey[4],
      data: query.state.data as unknown[] | undefined,
    }));

describe('API checks held across a catalog change (#43 re-review)', () => {
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it('drops a check that was running when Settings changed the catalog, and clears after re-enabling', async () => {
    const api = new FakeApi();
    const gate = holdFirstValidation(api);
    const { queryClient } = (() => {
      api.classifiers = [BUILTIN_JEV, customClassifier({ id: 'kev', displayName: 'Kev 4B' })];
      const loop = api.addLoop(decisionLoop({ primitive: 'choice', model: 'kev' }));
      return renderApp(`/loops/${loop.id}/edit`, api);
    })();
    await loaded();
    // The first check is held while Kev is enabled.
    await gate.arrived;
    setKev(api, false);
    await act(() => refreshCatalogState(queryClient));
    await waitFor(() => expect(nodeBadge('pick')).toHaveAttribute('aria-label', '1 issue on pick'));
    // The held check now answers with the disabled state; it was cancelled, so nothing keeps it.
    await act(() => Promise.resolve(gate.release()));
    expect(api.callsTo('POST', /\/validate$/)).toHaveLength(2);
    const enabledKey = cachedChecks(queryClient).find(
      (c) => typeof c.catalog === 'string' && c.catalog.includes('"kev","Kev 4B",["choice"],true'),
    );
    expect(enabledKey?.data).toBeUndefined();
    // Re-enabled, seen by a refresh of the summaries alone: checked again, and the badge clears.
    setKev(api, true);
    await act(() => queryClient.invalidateQueries({ queryKey: keys.classifiers }));
    await waitFor(() => expect(nodeBadge('pick')).toBeNull());
    expect(api.callsTo('POST', /\/validate$/)).toHaveLength(3);
    expect(api.callsTo('PUT', /\/draft$/)).toHaveLength(0);
  });

  it('drops a held check when another tab changes the catalog (a summaries refresh only)', async () => {
    const api = new FakeApi();
    const gate = holdFirstValidation(api);
    api.classifiers = [BUILTIN_JEV, customClassifier({ id: 'kev', displayName: 'Kev 4B' })];
    const loop = api.addLoop(decisionLoop({ primitive: 'choice', model: 'kev' }));
    const { queryClient } = renderApp(`/loops/${loop.id}/edit`, api);
    await loaded();
    await gate.arrived;
    setKev(api, false);
    await act(() => queryClient.invalidateQueries({ queryKey: keys.classifiers }));
    await waitFor(() => expect(nodeBadge('pick')).toHaveAttribute('aria-label', '1 issue on pick'));
    await act(() => Promise.resolve(gate.release()));
    setKev(api, true);
    await act(() => queryClient.invalidateQueries({ queryKey: keys.classifiers }));
    await waitFor(() => expect(nodeBadge('pick')).toBeNull());
    expect(api.callsTo('PUT', /\/draft$/)).toHaveLength(0);
  });

  it('drops a check whose answer arrives after the catalog changed, before the editor saw it', async () => {
    const api = new FakeApi();
    // The client exists once the app renders; the held request reads it later.
    const app: { queryClient?: QueryClient } = {};
    const gate = holdFirstValidation(api, () => {
      // The summaries change in the cache just before the held answer is read.
      setKev(api, false);
      app.queryClient!.setQueryData(keys.classifiers, [
        api.classifierSummary(BUILTIN_JEV),
        api.classifierSummary(api.classifiers.find((c) => c.id === 'kev')!),
      ]);
    });
    api.classifiers = [BUILTIN_JEV, customClassifier({ id: 'kev', displayName: 'Kev 4B' })];
    const loop = api.addLoop(decisionLoop({ primitive: 'choice', model: 'kev' }));
    const { queryClient } = renderApp(`/loops/${loop.id}/edit`, api);
    app.queryClient = queryClient;
    await loaded();
    await gate.arrived;
    await act(() => Promise.resolve(gate.release()));
    await waitFor(() => expect(nodeBadge('pick')).toHaveAttribute('aria-label', '1 issue on pick'));
    // The held answer was not stored under the enabled catalog's key.
    const enabledKey = cachedChecks(queryClient).find(
      (c) => typeof c.catalog === 'string' && c.catalog.includes('"kev","Kev 4B",["choice"],true'),
    );
    expect(enabledKey?.data).toBeUndefined();
  });
});

describe('the classifier picker in the node editor', () => {
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it('shows the built-in without a jev block, adds the block only for another choice, and keeps focus', async () => {
    const user = userEvent.setup();
    setup();
    const { dialog, picker } = await openPicker();
    expect(picker).toHaveValue('');
    expect(picker.closest('[data-field]')).toHaveAttribute('data-field', 'jev.model');
    // Drawing it adds nothing to the node.
    expect(pick().config).not.toHaveProperty('jev');
    expect(within(dialog).getByRole('button', { name: 'Add jev options' })).toBeInTheDocument();
    await user.selectOptions(picker, 'kev');
    expect(pick().config).toMatchObject({ jev: { model: 'kev' } });
    // The same element, now inside the added block, still has focus.
    expect(picker).toBeInTheDocument();
    expect(picker).toHaveFocus();
    expect(picker).toHaveValue('kev');
    expect(within(dialog).getByRole('button', { name: 'Remove jev' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Min confidence')).toBeInTheDocument();
    // Back to the default: the model goes, the block (with any other settings) stays.
    await user.selectOptions(picker, '');
    expect(pick().config).toHaveProperty('jev');
    expect(jevOf()).not.toHaveProperty('model');
  });

  it('makes each pick an undo step of its own, however quick', async () => {
    const user = userEvent.setup();
    setup({ primitive: 'choice' });
    const { picker } = await openPicker();
    await user.selectOptions(picker, 'kev');
    await user.selectOptions(picker, 'other');
    expect(jevOf()).toMatchObject({ model: 'other' });
    // Focus is on the select, which has no text undo: the keys undo the editor.
    expect(picker).toHaveFocus();
    await user.keyboard(UNDO);
    expect(jevOf()).toMatchObject({ model: 'kev' });
    await user.keyboard(UNDO);
    expect(jevOf()).not.toHaveProperty('model');
  });

  it('shows a classifier disabled elsewhere on the node badge without a draft edit', async () => {
    const { api, queryClient } = setup({ primitive: 'choice', model: 'kev' });
    await loaded();
    await screen.findByText('Ready to publish');
    expect(nodeBadge('pick')?.getAttribute('aria-label') ?? null).toBeNull();
    const revision = store().revision;
    const validations = api.callsTo('POST', /\/validate$/).length;
    // Settings disables it: the catalog write refreshes the summaries and the editor's checks.
    api.classifiers = api.classifiers.map((c) => (c.id === 'kev' ? { ...c, enabled: false } : c));
    await act(() => refreshCatalogState(queryClient));
    await waitFor(() => expect(nodeBadge('pick')).toHaveAttribute('aria-label', '1 issue on pick'));
    expect(api.callsTo('POST', /\/validate$/).length).toBeGreaterThan(validations);
    expect(store().revision).toBe(revision);
    expect(api.callsTo('PUT', /\/draft$/)).toHaveLength(0);
    // A refresh of the summaries alone (another tab's write, seen on focus) also runs the checks
    // again, because the checks' query is keyed by what they read of the catalog.
    api.classifiers = api.classifiers.map((c) => (c.id === 'kev' ? { ...c, enabled: true } : c));
    await act(() => queryClient.invalidateQueries({ queryKey: keys.classifiers }));
    await waitFor(() => expect(nodeBadge('pick')).toBeNull());
    // Every check's result is the one for its own catalog state: nothing stale came back.
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ['loops'] })) {
      const [, , kind, , catalog] = query.queryKey as unknown[];
      if (kind !== 'validate' || !query.state.data || catalog === '') continue;
      const disabled = String(catalog).includes('["kev","Kev 4B",["choice"],false');
      expect((query.state.data as unknown[]).length).toBe(disabled ? 1 : 0);
    }
  });
});
