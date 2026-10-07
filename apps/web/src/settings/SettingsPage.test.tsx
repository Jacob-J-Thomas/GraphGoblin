import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import { FakeApi, problem, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useApiKeyStore } from '../api/api-key.js';

function seeded(source: 'harness' | 'litellm' = 'harness'): FakeApi {
  const api = new FakeApi();
  api.catalog = [
    {
      harness: 'codex',
      source,
      model: 'gpt-6-luna',
      displayName: 'Luna',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      enabled: true,
    },
    {
      harness: 'codex',
      source,
      model: 'gpt-6-sol',
      displayName: 'Sol',
      efforts: ['medium'],
      defaultEffort: 'medium',
      enabled: false,
    },
  ];
  api.secretList = [{ name: 'jev-api-key', createdAt: TS, updatedAt: TS }];
  api.apiKeyList = [
    { id: 'k1', ownerId: 'local', label: 'mcp', scopes: ['*'], createdAt: TS, current: false },
    {
      id: 'k2',
      ownerId: 'local',
      label: 'old',
      scopes: ['runs:write'],
      createdAt: TS,
      revokedAt: TS,
      current: false,
    },
  ];
  api.preflight = [
    { harness: 'codex', ok: true, version: '1.2', authenticated: true, problems: [] },
    { harness: 'other', ok: false, version: '', authenticated: false, problems: ['not logged in'] },
  ];
  return api;
}

describe('SettingsPage', () => {
  it.each([
    ['Delete gpt-6-luna', 'Confirm delete gpt-6-luna', 'Model catalog'],
    ['Delete secret jev-api-key', 'Confirm delete jev-api-key', 'Secrets'],
    ['Revoke mcp', 'Confirm revoke mcp', 'API keys'],
  ] as const)(
    'recovers heading focus when %s refreshes before React commits its row removal',
    async (label, confirmation, heading) => {
      const api = seeded('litellm');
      const { queryClient } = renderApp('/settings', api);
      const user = userEvent.setup();
      const trigger = await screen.findByRole('button', { name: label });
      await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      await user.click(trigger);
      const notifications: (() => void)[] = [];
      const frames: FrameRequestCallback[] = [];
      const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      notifyManager.setScheduler((callback) => notifications.push(callback));
      try {
        await user.click(screen.getByRole('button', { name: confirmation }));
        await waitFor(() => expect(queryClient.isFetching()).toBe(0));
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
        act(() => frames.splice(0).forEach((callback) => callback(0)));
        // The request settled and the old frame ran; the query's render notification is held.
        expect(trigger).toHaveFocus();
        expect(trigger).toBeInTheDocument();
        expect(notifications.length).toBeGreaterThan(0);
        await act(() => Promise.resolve(notifications.splice(0).forEach((callback) => callback())));
        expect(trigger).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: heading })).toHaveFocus();
      } finally {
        notifyManager.setScheduler(defaultScheduler);
        frame.mockRestore();
        await act(() => Promise.resolve(notifications.splice(0).forEach((callback) => callback())));
      }
    },
  );

  it.each(['success', '401'] as const)(
    'finishes revocation before a held list refresh, then restores focus after %s',
    async (outcome) => {
      const api = seeded();
      if (outcome === '401') useApiKeyStore.getState().save('gg_fixture');
      renderApp('/settings', api);
      const user = userEvent.setup();
      const trigger = await screen.findByRole('button', { name: 'Revoke mcp' });
      let finish!: () => void;
      const held = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let arrived!: () => void;
      const started = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      api.override('GET /api-keys', async () => {
        arrived();
        await held;
        return outcome === '401'
          ? problem(401, 'UNAUTHORIZED')
          : new Response(JSON.stringify({ items: api.apiKeyList }), {
              headers: { 'content-type': 'application/json' },
            });
      });
      try {
        await user.click(trigger);
        await user.click(screen.getByRole('button', { name: 'Confirm revoke mcp' }));
        await started;
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
        await waitFor(() => expect(trigger).toHaveFocus());
        await act(() => Promise.resolve(finish()));
        if (outcome === '401') {
          await waitFor(() => expect(screen.getByLabelText('API key')).toHaveFocus());
        } else {
          await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Revoke mcp' })).not.toBeInTheDocument(),
          );
          await waitFor(() =>
            expect(screen.getByRole('heading', { name: 'API keys' })).toHaveFocus(),
          );
        }
      } finally {
        await act(() => Promise.resolve(finish()));
      }
    },
  );

  it.each([
    [
      'Delete gpt-6-luna',
      'Confirm delete gpt-6-luna',
      'DELETE /model-catalog/:harness/:model',
      'catalog',
      '/model-catalog',
      'Model catalog',
    ],
    [
      'Delete secret jev-api-key',
      'Confirm delete jev-api-key',
      'DELETE /secrets/:name',
      'secretList',
      '/secrets',
      'Secrets',
    ],
    [
      'Revoke mcp',
      'Confirm revoke mcp',
      'DELETE /api-keys/:id',
      'apiKeyList',
      '/api-keys',
      'API keys',
    ],
  ] as const)(
    'review: refreshes the vanished %s after a 404 is dismissed',
    async (label, confirmation, route, list, listRoute, heading) => {
      const api = seeded(list === 'catalog' ? 'litellm' : 'harness');
      let finish!: () => void;
      const refreshed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      api.override(route, () => {
        api[list] = [];
        api.override(`GET ${listRoute}`, async () => {
          await refreshed;
          return new Response(JSON.stringify({ items: api[list] }), {
            headers: { 'content-type': 'application/json' },
          });
        });
        return problem(404, 'NOT_FOUND', 'Already removed.');
      });
      renderApp('/settings', api);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: label }));
      await user.click(screen.getByRole('button', { name: confirmation }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Already removed.');
      await user.click(screen.getByRole('button', { name: 'Keep' }));
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toHaveFocus());
      await act(() => Promise.resolve(finish()));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(screen.getByRole('heading', { name: heading })).toHaveFocus());
    },
  );

  it('review: shows no browser-key warning when no key is stored', async () => {
    useApiKeyStore.getState().forget();
    renderApp('/settings', seeded());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke mcp' }));
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(
      'This browser still sends a stored API key. If this is that key, revoking it signs this browser out and shows the API key panel; Forget key in Settings also clears it.',
    );
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent('show the API key panel');
  });

  it('review: describes startup re-seeding in the Jev deletion confirmation', async () => {
    renderApp('/settings', seeded());
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Delete secret jev-api-key' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('GG_JEV_API_KEY');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('next server start');
  });
  it('edits and deletes LiteLLM rows and toggles through PATCH', async () => {
    const user = userEvent.setup();
    const api = seeded('litellm');
    renderApp('/settings', api);
    expect(await screen.findByText('Luna', { selector: 'span' })).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Enable Sol' }));
    await waitFor(() =>
      expect(api.callsTo('PATCH', '/model-catalog/codex/gpt-6-sol')[0]!.body).toMatchObject({
        enabled: true,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Edit gpt-6-luna' }));
    const form = screen.getByRole('form', { name: 'Edit gpt-6-luna' });
    expect(within(form).getByLabelText('Model id')).toBeDisabled();
    await user.clear(within(form).getByLabelText('Display name'));
    await user.type(within(form).getByLabelText('Display name'), 'Luna 2');
    await user.click(within(form).getByRole('checkbox', { name: 'xhigh' }));
    await user.click(within(form).getByRole('checkbox', { name: 'low' }));
    await user.selectOptions(within(form).getByLabelText('Default effort'), 'high');
    await user.click(within(form).getByRole('button', { name: 'Save model' }));
    expect(await screen.findByText('Luna 2', { selector: 'span' })).toBeInTheDocument();
    expect(api.callsTo('PUT', '/model-catalog/codex/gpt-6-luna')[0]!.body).toEqual({
      displayName: 'Luna 2',
      efforts: ['high', 'xhigh'],
      defaultEffort: 'high',
    });

    await user.click(screen.getByRole('button', { name: 'Add model' }));
    const add = screen.getByRole('form', { name: 'Add model' });
    await user.type(within(add).getByLabelText('Model id'), 'gpt-7');
    await user.click(within(add).getByRole('button', { name: 'Save model' }));
    expect(
      await screen.findByText(
        /LiteLLM is not configured. Adding local models is not available yet./,
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('PUT', '/model-catalog/codex/gpt-7')[0]?.body).toMatchObject({
      source: 'litellm',
    });
    await user.click(within(add).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    await user.click(
      within(screen.getByRole('form', { name: 'Add model' })).getByRole('button', {
        name: 'Cancel',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Delete gpt-6-sol' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Removing a LiteLLM model leaves its loops referencing it.',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm delete gpt-6-sol' }));
    await waitFor(() =>
      expect(screen.queryByText('Sol', { selector: 'span' })).not.toBeInTheDocument(),
    );
  });

  it('explains catalog removal without promising harness models will return', async () => {
    const user = userEvent.setup();
    renderApp('/settings', seeded('litellm'));
    await user.click(await screen.findByRole('button', { name: 'Delete gpt-6-sol' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Removing a LiteLLM model leaves its loops referencing it.',
    );
  });

  it('shows catalog save errors', async () => {
    const user = userEvent.setup();
    const api = seeded('litellm');
    api.override('PUT /model-catalog/:harness/:model', () =>
      problem(400, 'INVALID_INPUT', 'defaultEffort must be one of efforts'),
    );
    api.override('PATCH /model-catalog/:harness/:model', () =>
      problem(403, 'FORBIDDEN', 'No permission to change this model.'),
    );
    renderApp('/settings', api);
    await user.click(await screen.findByRole('button', { name: 'Edit gpt-6-luna' }));
    await user.click(screen.getByRole('button', { name: 'Save model' }));
    expect(await screen.findByText(/defaultEffort must be one of efforts/)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Enable Luna' }));
    expect(await screen.findByText(/No permission to change this model./)).toBeInTheDocument();
  });

  it('shows only enable switches for harness models and keeps Defaults in sync', async () => {
    const user = userEvent.setup();
    const api = seeded();
    const before = { ...api.catalog[0]! };
    renderApp('/settings', api);
    const enabled = await screen.findByRole('switch', { name: 'Enable Luna' });
    const catalog = screen.getByRole('region', { name: 'Model catalog' });
    expect(within(catalog).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(catalog).queryByRole('columnheader', { name: 'Actions' }),
    ).not.toBeInTheDocument();
    expect(within(catalog).getAllByRole('switch')).toHaveLength(2);
    expect(
      within(catalog).getByText(/Local models served through LiteLLM will appear here/),
    ).toBeInTheDocument();
    expect(catalog).toHaveTextContent('see the Settings guide, Choose a model and effort.');
    expect(within(catalog).queryByRole('link')).not.toBeInTheDocument();
    const defaults = screen.getByLabelText('Default model');
    expect(within(defaults).getByRole('option', { name: 'Luna' })).toBeInTheDocument();
    enabled.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(enabled).not.toBeChecked());
    expect(api.callsTo('PATCH', '/model-catalog/codex/gpt-6-luna')[0]?.body).toEqual({
      enabled: false,
    });
    expect(api.catalog[0]).toEqual({ ...before, enabled: false });
    await waitFor(() =>
      expect(within(defaults).queryByRole('option', { name: 'Luna' })).not.toBeInTheDocument(),
    );
    expect(within(enabled.closest('tr')!).getByRole('status')).toHaveTextContent('Luna: Disabled');
    await waitFor(() => expect(enabled).toBeEnabled());
    enabled.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(enabled).toBeChecked());
    expect(api.catalog[0]).toEqual(before);
    await waitFor(() =>
      expect(within(defaults).getByRole('option', { name: 'Luna' })).toBeInTheDocument(),
    );
    expect(within(enabled.closest('tr')!).getByRole('status')).toHaveTextContent('Luna: Enabled');
    expect(api.callsTo('PUT', '/model-catalog/codex/gpt-6-luna')).toHaveLength(0);
    expect(api.callsTo('DELETE', '/model-catalog/codex/gpt-6-luna')).toHaveLength(0);
  });

  it('offers Add, Edit and Delete only for LiteLLM rows in a mixed catalog', async () => {
    const api = seeded();
    api.catalog[1]!.source = 'litellm';
    renderApp('/settings', api);
    const user = userEvent.setup();
    const harness = (await screen.findByRole('switch', { name: 'Enable Luna' })).closest('tr')!;
    const local = screen.getByRole('switch', { name: 'Enable Sol' }).closest('tr')!;
    expect(within(harness).queryByRole('button')).not.toBeInTheDocument();
    expect(within(local).getByRole('button', { name: 'Edit gpt-6-sol' })).toBeInTheDocument();
    expect(within(local).getByRole('button', { name: 'Delete gpt-6-sol' })).toBeInTheDocument();
    expect(
      screen.queryByText(/Local models served through LiteLLM will appear here/),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    const add = screen.getByRole('form', { name: 'Add model' });
    await user.type(within(add).getByLabelText('Model id'), 'local');
    await user.click(within(add).getByRole('button', { name: 'Save model' }));
    expect(await within(add).findByRole('alert')).toHaveTextContent(
      'LiteLLM is not configured. Adding local models is not available yet.',
    );
    await user.click(within(add).getByRole('button', { name: 'Cancel' }));
    await user.click(within(local).getByRole('button', { name: 'Delete gpt-6-sol' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete gpt-6-sol' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Add model' })).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Local models served through LiteLLM will appear here/),
    ).toBeInTheDocument();
  });

  it.each(['vanished switch', 'another control'] as const)(
    'refreshes a vanished toggle and preserves focus on %s',
    async (focus) => {
      const api = seeded();
      let finish!: () => void;
      const held = new Promise<void>((resolve) => {
        finish = resolve;
      });
      api.override('PATCH /model-catalog/:harness/:model', async () => {
        await held;
        api.catalog = api.catalog.filter((entry) => entry.model !== 'gpt-6-luna');
        return problem(404, 'MODEL_NOT_FOUND');
      });
      renderApp('/settings', api);
      const user = userEvent.setup();
      const enabled = await screen.findByRole('switch', { name: 'Enable Luna' });
      await user.click(enabled);
      const defaults = screen.getByLabelText('Default model');
      if (focus === 'another control') defaults.focus();
      await act(() => Promise.resolve(finish()));
      await waitFor(() => expect(enabled).not.toBeInTheDocument());
      const catalog = screen.getByRole('region', { name: 'Model catalog' });
      expect(within(catalog).getAllByRole('status')[0]).toHaveTextContent(
        'Luna: This model is no longer in the catalog.',
      );
      expect(catalog).not.toHaveTextContent('Refresh Settings');
      expect(api.callsTo('GET', '/model-catalog')).toHaveLength(2);
      await waitFor(() =>
        expect(
          focus === 'another control'
            ? defaults
            : screen.getByRole('heading', { name: 'Model catalog' }),
        ).toHaveFocus(),
      );
    },
  );

  it('review: focuses the heading when a row vanishes while its toggle is pending, and clears the notice on the next toggle', async () => {
    const api = seeded();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrive!: () => void;
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    api.override('PATCH /model-catalog/:harness/:model', async (call, [, model]) => {
      if (model !== 'gpt-6-luna') return api.builtIn(call);
      arrive();
      await held;
      return problem(404, 'MODEL_NOT_FOUND');
    });
    const { queryClient } = renderApp('/settings', api);
    const user = userEvent.setup();
    const enabled = await screen.findByRole('switch', { name: 'Enable Luna' });
    await user.click(enabled);
    await arrived;
    // Another refresh removes the row while its PATCH is held: focus falls to the page body.
    api.catalog = api.catalog.filter((entry) => entry.model !== 'gpt-6-luna');
    await act(() => queryClient.invalidateQueries({ queryKey: ['model-catalog'] }));
    await waitFor(() => expect(enabled).not.toBeInTheDocument());
    expect(document.activeElement).toBe(document.body);
    await act(() => Promise.resolve(release()));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Model catalog' })).toHaveFocus(),
    );
    const catalog = screen.getByRole('region', { name: 'Model catalog' });
    const notice = within(catalog).getAllByRole('status')[0]!;
    expect(notice).toHaveTextContent('Luna: This model is no longer in the catalog.');
    await user.click(screen.getByRole('switch', { name: 'Enable Sol' }));
    await waitFor(() => expect(notice).toBeEmptyDOMElement());
  });

  it('keeps the local-model note hidden until the catalog is loaded', async () => {
    const api = seeded();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    api.override('GET /model-catalog', async (call) => {
      await held;
      return api.builtIn(call);
    });
    renderApp('/settings', api);
    expect(screen.queryByText(/Local models served through LiteLLM/)).not.toBeInTheDocument();
    await act(() => Promise.resolve(finish()));
    expect(await screen.findByText(/Local models served through LiteLLM/)).toBeInTheDocument();
  });

  it.each(['disabled', 'missing'] as const)(
    'shows the saved %s default truthfully until another model is chosen',
    async (state) => {
      const api = seeded();
      api.settingsValues = { defaults: { byHarness: { codex: { model: 'gpt-6-luna' } } } };
      renderApp('/settings', api);
      const user = userEvent.setup();
      const enabled = await screen.findByRole('switch', { name: 'Enable Luna' });
      const model = screen.getByLabelText('Default model');
      if (state === 'missing') {
        api.override('PATCH /model-catalog/:harness/:model', () => {
          api.catalog = api.catalog.filter((entry) => entry.model !== 'gpt-6-luna');
          return problem(404, 'MODEL_NOT_FOUND');
        });
      }
      await user.click(enabled);
      const name = state === 'disabled' ? 'Luna (disabled)' : 'gpt-6-luna (not in catalog)';
      await waitFor(() => expect(within(model).getByRole('option', { name })).toBeInTheDocument());
      expect(model).toHaveValue('gpt-6-luna');
      expect(api.settingsValues['defaults']).toEqual({
        byHarness: { codex: { model: 'gpt-6-luna' } },
      });
      expect(model).toHaveAccessibleDescription(
        'This saved model is unavailable. Choose an enabled catalog model or (server default) before publishing or running.',
      );
      if (state === 'disabled') {
        await user.click(enabled);
        await waitFor(() =>
          expect(within(model).getByRole('option', { name: 'Luna' })).toBeInTheDocument(),
        );
        expect(screen.queryByText(/This saved model is unavailable/)).not.toBeInTheDocument();
      }
      await user.selectOptions(model, '');
      await waitFor(() => expect(api.settingsValues).not.toHaveProperty('defaults'));
      await waitFor(() => expect(model).toHaveValue(''));
      expect(screen.queryByText(/This saved model is unavailable/)).not.toBeInTheDocument();
    },
  );

  it('saves default model and effort', async () => {
    const user = userEvent.setup();
    const api = seeded();
    api.settingsValues = { defaults: { byHarness: { codex: { model: 'gpt-6-luna' } } } };
    renderApp('/settings', api);
    const model = await screen.findByLabelText('Default model');
    await waitFor(() => expect(model).toHaveValue('gpt-6-luna'));
    expect(within(model).queryByText('Sol')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Default effort'), 'high');
    await waitFor(() =>
      expect(api.settingsValues).toMatchObject({
        defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'high' } } },
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Default effort')).toHaveValue('high'));
    // Choosing the server default for model keeps the independently selected effort.
    await user.selectOptions(model, '');
    await waitFor(() =>
      expect(api.settingsValues).toMatchObject({
        defaults: { byHarness: { codex: { effort: 'high' } } },
      }),
    );
    await waitFor(() => expect(model).toHaveValue(''));
    await user.selectOptions(screen.getByLabelText('Default effort'), '');
    await waitFor(() => expect(api.settingsValues).not.toHaveProperty('defaults'));
  });

  it('sets and deletes secrets without ever showing values', async () => {
    const user = userEvent.setup();
    const api = seeded();
    renderApp('/settings', api);
    // The Secrets list, not the classifier section, which shows Jev's secret reference too.
    const list = screen.getByRole('region', { name: 'Secrets' });
    expect(await within(list).findByText('jev-api-key')).toBeInTheDocument();
    // A name the API would refuse is flagged before sending.
    await user.type(screen.getByLabelText('Name'), 'bad name');
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText('Value'), 'x');
    expect(screen.getByRole('button', { name: 'Set secret' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Value'));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'github-token');
    const value = screen.getByLabelText('Value');
    expect(value).toHaveAttribute('type', 'password');
    await user.type(value, 's3cret');
    await user.click(screen.getByRole('button', { name: 'Set secret' }));
    expect(await screen.findByText('github-token')).toBeInTheDocument();
    expect(screen.queryByText('s3cret')).not.toBeInTheDocument();
    expect(api.callsTo('PUT', '/secrets/github-token')[0]!.body).toEqual({ value: 's3cret' });
    await user.click(screen.getByRole('button', { name: 'Delete secret jev-api-key' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete jev-api-key' }));
    await waitFor(() => expect(within(list).queryByText('jev-api-key')).not.toBeInTheDocument());
  });

  it('creates an API key, shows the token once, and revokes keys', async () => {
    const user = userEvent.setup();
    const api = seeded();
    renderApp('/settings', api);
    expect(await screen.findByText('revoked')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Label'), 'ci');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByTestId('new-api-key')).toHaveTextContent('gg_secret_token_123');
    await user.click(screen.getByRole('button', { name: 'Revoke mcp' }));
    await user.click(screen.getByRole('button', { name: 'Confirm revoke mcp' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Revoke mcp' })).not.toBeInTheDocument(),
    );
  });

  it('shows harness preflight status and the install hint', async () => {
    renderApp('/settings', seeded());
    expect(await screen.findByText('ready')).toBeInTheDocument();
    expect(screen.getByText('not ready')).toBeInTheDocument();
    expect(screen.getByText('not logged in')).toBeInTheDocument();
    expect(screen.getByText(/Install app/)).toBeInTheDocument();
  });

  it.each([
    [
      'Delete gpt-6-luna',
      'Confirm delete gpt-6-luna',
      '/model-catalog/codex/gpt-6-luna',
      'DELETE /model-catalog/:harness/:model',
      'Removing a LiteLLM model leaves its loops referencing it',
    ],
    [
      'Delete secret jev-api-key',
      'Confirm delete jev-api-key',
      '/secrets/jev-api-key',
      'DELETE /secrets/:name',
      'turns Jev decisions off',
    ],
    ['Revoke mcp', 'Confirm revoke mcp', '/api-keys/k1', 'DELETE /api-keys/:id', '401 immediately'],
  ])(
    'confirms %s, cancels without a request, and surfaces a second-delete error',
    async (label, confirmLabel, path, route, consequence) => {
      const api = seeded(route === 'DELETE /model-catalog/:harness/:model' ? 'litellm' : 'harness');
      api.override(route, () => problem(404, 'NOT_FOUND', 'The item was already removed.'));
      renderApp('/settings', api);
      const user = userEvent.setup();
      const trigger = await screen.findByRole('button', { name: label });
      await user.click(trigger);
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(consequence);
      expect(dialog).toHaveTextContent('cannot be undone');
      if (label.includes('secret')) {
        expect(dialog).toHaveTextContent('503 HOOK_NOT_READY');
        expect(dialog).toHaveTextContent('unsigned deliveries');
        expect(dialog).toHaveTextContent('secret:jev-api-key');
        expect(dialog).toHaveTextContent('SECRET_MISSING');
      }
      await user.click(screen.getByRole('button', { name: 'Keep' }));
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(api.callsTo('DELETE', path)).toHaveLength(0);
      await user.click(trigger);
      await user.click(screen.getByRole('button', { name: confirmLabel }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The item was already removed. (NOT_FOUND)',
      );
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    },
  );

  it('locks a secret deletion until the API finishes and returns focus to Secrets', async () => {
    const api = seeded();
    let finish!: () => void;
    api.override(
      'DELETE /secrets/:name',
      () =>
        new Promise<Response>((resolve) => {
          finish = () => {
            api.secretList = [];
            resolve(new Response(null, { status: 204 }));
          };
        }),
    );
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete secret jev-api-key' }));
    const confirm = screen.getByRole('button', { name: 'Confirm delete jev-api-key' });
    await user.click(confirm);
    expect(confirm).toHaveTextContent('Deleting…');
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled();
    fireEvent.click(confirm);
    expect(api.callsTo('DELETE', '/secrets/jev-api-key')).toHaveLength(1);
    await act(() => Promise.resolve(finish()));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Secrets' })).toHaveFocus());
  });

  it('warns about browser access only when revoking the current key', async () => {
    useApiKeyStore.getState().save('gg_browser_key');
    const api = seeded();
    api.apiKeyList[0]!.current = true;
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke mcp' }));
    expect(screen.getByText('This browser')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Revoking this key will sign this browser out and show the API key panel. Enter another valid key to continue.',
    );
    await user.click(screen.getByRole('button', { name: 'Keep' }));
  });
});
