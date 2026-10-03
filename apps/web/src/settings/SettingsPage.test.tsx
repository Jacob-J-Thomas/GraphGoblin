import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

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
    await user.type(screen.getByLabelText('Name'), 'github-token');
    const value = screen.getByLabelText('Value');
    expect(value).toHaveAttribute('type', 'password');
    await user.type(value, 's3cret');
    await user.click(screen.getByRole('button', { name: 'Set secret' }));
    expect(await screen.findByText('github-token')).toBeInTheDocument();
    expect(screen.queryByText('s3cret')).not.toBeInTheDocument();
    expect(api.callsTo('PUT', '/secrets/github-token')[0]!.body).toEqual({ value: 's3cret' });
    await user.click(screen.getByRole('button', { name: 'Delete secret jev-api-key' }));
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
});
