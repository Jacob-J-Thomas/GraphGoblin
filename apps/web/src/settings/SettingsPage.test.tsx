import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { useApiKeyStore } from '../api/api-key.js';

function seeded(): FakeApi {
  const api = new FakeApi();
  api.catalog = [
    {
      harness: 'codex',
      model: 'gpt-6-luna',
      displayName: 'Luna',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      enabled: true,
    },
    {
      harness: 'codex',
      model: 'gpt-6-sol',
      displayName: 'Sol',
      efforts: ['medium'],
      defaultEffort: 'medium',
      enabled: false,
    },
  ];
  api.secretList = [{ name: 'jev-api-key', createdAt: TS, updatedAt: TS }];
  api.apiKeyList = [
    { id: 'k1', ownerId: 'local', label: 'mcp', scopes: ['*'], createdAt: TS },
    {
      id: 'k2',
      ownerId: 'local',
      label: 'old',
      scopes: ['runs:write'],
      createdAt: TS,
      revokedAt: TS,
    },
  ];
  api.preflight = [
    { harness: 'codex', ok: true, version: '1.2', authenticated: true, problems: [] },
    { harness: 'other', ok: false, version: '', authenticated: false, problems: ['not logged in'] },
  ];
  return api;
}

describe('SettingsPage', () => {
  it('edits, toggles, adds, and deletes models in the catalog', async () => {
    const user = userEvent.setup();
    const api = seeded();
    renderApp('/settings', api);
    expect(await screen.findByText('Luna', { selector: 'span' })).toBeInTheDocument();

    await user.click(screen.getByLabelText('Enable gpt-6-sol'));
    await waitFor(() =>
      expect(api.callsTo('PUT', '/model-catalog/codex/gpt-6-sol')[0]!.body).toMatchObject({
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
    expect(await screen.findByText('gpt-7', { selector: 'span' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    await user.click(
      within(screen.getByRole('form', { name: 'Add model' })).getByRole('button', {
        name: 'Cancel',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Delete gpt-6-sol' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete gpt-6-sol' }));
    await waitFor(() =>
      expect(screen.queryByText('Sol', { selector: 'span' })).not.toBeInTheDocument(),
    );
  });

  it('shows catalog save errors', async () => {
    const user = userEvent.setup();
    const api = seeded();
    api.override('PUT /model-catalog/:harness/:model', () =>
      problem(400, 'INVALID_INPUT', 'defaultEffort must be one of efforts'),
    );
    renderApp('/settings', api);
    await user.click(await screen.findByRole('button', { name: 'Edit gpt-6-luna' }));
    await user.click(screen.getByRole('button', { name: 'Save model' }));
    expect(await screen.findByText(/defaultEffort must be one of efforts/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Enable gpt-6-luna'));
    expect((await screen.findAllByText(/defaultEffort must be one of efforts/)).length).toBe(2);
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
      'seeded model',
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

  it('warns about losing this browser access when revoking a key while one is stored', async () => {
    useApiKeyStore.getState().save('gg_browser_key');
    try {
      renderApp('/settings', seeded());
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Revoke mcp' }));
      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        'this browser will lose access and show the API key panel',
      );
      await user.click(screen.getByRole('button', { name: 'Keep' }));
    } finally {
      useApiKeyStore.getState().forget();
    }
  });
});
