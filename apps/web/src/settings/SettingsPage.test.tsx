import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeApi, problem, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useApiKeyStore } from '../api/api-key.js';

// The API key store is module state that outlives each test's app, so reset it here, and unmount
// first: changing the key while the app is mounted refetches every query, and a refetch answered
// 401 without a key marks the store rejected again. The next test would then render the API key
// panel, which takes focus as soon as no dialog is open.
afterEach(() => {
  cleanup();
  useApiKeyStore.getState().forget();
});

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
      const api = seeded();
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

    await user.click(screen.getByLabelText('Enable gpt-6-sol'));
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
      enabled: true,
    });

    await user.click(screen.getByRole('button', { name: 'Add model' }));
    const add = screen.getByRole('form', { name: 'Add model' });
    await user.type(within(add).getByLabelText('Model id'), 'gpt-7');
    await user.click(within(add).getByRole('button', { name: 'Save model' }));
    expect(
      await screen.findByText(
        /LiteLLM is not configured; adding local models is not available yet/,
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
      'Harness models cannot be deleted. Removing a LiteLLM model leaves its loops referencing it.',
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
      'Harness models cannot be deleted. Removing a LiteLLM model leaves its loops referencing it.',
    );
  });

  it('shows catalog save errors', async () => {
    const user = userEvent.setup();
    const api = seeded();
    api.override('PUT /model-catalog/:harness/:model', () =>
      problem(400, 'INVALID_INPUT', 'defaultEffort must be one of efforts'),
    );
    api.override('PATCH /model-catalog/:harness/:model', () =>
      problem(404, 'MODEL_NOT_FOUND', 'model not in catalog'),
    );
    renderApp('/settings', api);
    await user.click(await screen.findByRole('button', { name: 'Edit gpt-6-luna' }));
    await user.click(screen.getByRole('button', { name: 'Save model' }));
    expect(await screen.findByText(/defaultEffort must be one of efforts/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Enable gpt-6-luna'));
    expect(await screen.findByText(/model not in catalog/)).toBeInTheDocument();
  });

  it('toggles harness models with PATCH and surfaces managed edit/delete errors', async () => {
    const user = userEvent.setup();
    const api = seeded();
    const before = { ...api.catalog[0]! };
    renderApp('/settings', api);
    const enabled = await screen.findByLabelText('Enable gpt-6-luna');
    await user.click(enabled);
    await waitFor(() => expect(enabled).not.toBeChecked());
    expect(api.callsTo('PATCH', '/model-catalog/codex/gpt-6-luna')[0]?.body).toEqual({
      enabled: false,
    });
    expect(api.catalog[0]).toEqual({ ...before, enabled: false });
    await user.click(enabled);
    await waitFor(() => expect(enabled).toBeChecked());
    expect(api.catalog[0]).toEqual(before);
    await user.click(screen.getByRole('button', { name: 'Edit gpt-6-luna' }));
    await user.click(screen.getByRole('button', { name: 'Save model' }));
    expect(
      await screen.findByText(/Harness models can only be enabled or disabled/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete gpt-6-luna' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete gpt-6-luna' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Harness models can only be enabled or disabled',
    );
    expect(api.catalog[0]).toEqual(before);
  });

  it('saves default model and effort', async () => {
    const user = userEvent.setup();
    const api = seeded();
    api.settingsValues = { defaultModel: 'gpt-6-luna' };
    renderApp('/settings', api);
    const model = await screen.findByLabelText('Default model');
    await waitFor(() => expect(model).toHaveValue('gpt-6-luna'));
    expect(within(model).queryByText('Sol')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Default effort'), 'high');
    await waitFor(() => expect(api.settingsValues).toMatchObject({ defaultEffort: 'high' }));
    await waitFor(() => expect(screen.getByLabelText('Default effort')).toHaveValue('high'));
    // "(server default)" removes the setting instead of storing an empty model.
    await user.selectOptions(model, '');
    await waitFor(() => expect(api.settingsValues).not.toHaveProperty('defaultModel'));
    await waitFor(() => expect(model).toHaveValue(''));
  });

  it('sets and deletes secrets without ever showing values', async () => {
    const user = userEvent.setup();
    const api = seeded();
    renderApp('/settings', api);
    expect(await screen.findByText('jev-api-key')).toBeInTheDocument();
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
    await waitFor(() => expect(screen.queryByText('jev-api-key')).not.toBeInTheDocument());
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
      const api = seeded();
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
