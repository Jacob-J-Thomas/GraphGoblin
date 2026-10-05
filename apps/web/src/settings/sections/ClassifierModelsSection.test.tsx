import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_JEV,
  customClassifier,
  FakeApi,
  problem,
  TS,
} from '../../__fixtures__/fake-api.js';
import { renderApp } from '../../__fixtures__/render.js';
import { keys } from '../../api/queries.js';

function seeded(): FakeApi {
  const api = new FakeApi();
  api.secretList = [
    { name: 'jev-api-key', createdAt: TS, updatedAt: TS },
    { name: 'kev-key', createdAt: TS, updatedAt: TS },
  ];
  api.classifiers = [
    // Listed out of order: the section keeps the API's order, built-in first.
    customClassifier({
      id: 'zeta',
      displayName: 'Zeta scorer',
      primitives: ['score'],
      enabled: false,
    }),
    customClassifier({
      id: 'kev',
      displayName: 'Kev 4B',
      secretRef: 'kev-key',
      primitives: ['choice', 'noul'],
    }),
    BUILTIN_JEV,
  ];
  return api;
}

const region = () => screen.getByRole('region', { name: 'Classifier models' });
const rowOf = (name: string) =>
  within(region())
    .getByRole('switch', { name: `Enable ${name}` })
    .closest('tr')!;

/** Hold a request until `release` is called; `arrived` resolves when it reaches the fake API. */
function hold() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrive!: () => void;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  return { held, release, arrived, arrive };
}

describe('ClassifierModelsSection', () => {
  it('sits directly below the LLM catalog and lists the built-in first', async () => {
    renderApp('/settings', seeded());
    await within(region()).findByRole('switch', { name: 'Enable Jev' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Classifier models')).toBe(headings.indexOf('Model catalog') + 1);
    const rows = within(region()).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('switch').getAttribute('aria-label'))).toEqual([
      'Enable Jev',
      'Enable Kev 4B',
      'Enable Zeta scorer',
    ]);
    expect(
      within(region())
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Model', 'Provider', 'Capabilities', 'Status', 'Enabled', 'Actions']);
  });

  it('shows the built-in alias and secret, only an enable switch, and what disabling stops', async () => {
    renderApp('/settings', seeded());
    const toggle = await within(region()).findByRole('switch', { name: 'Enable Jev' });
    const row = toggle.closest('tr')!;
    expect(row).toHaveTextContent('Jev jevBuilt in');
    expect(row).toHaveTextContent('TypeSafe');
    expect(row).toHaveTextContent('Model jev-latest');
    expect(row).toHaveTextContent('Secret jev-api-key');
    expect(row).toHaveTextContent('Choice / classificationNoulScore');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(toggle).toHaveAccessibleDescription(
      'Jev: Enabled Disabling Jev also stops Exit predicates that use Jev.',
    );
    // Custom rows have their endpoint and both actions.
    const kev = rowOf('Kev 4B');
    expect(kev).toHaveTextContent('HTTP endpoint');
    expect(kev).toHaveTextContent('http://127.0.0.1:8008');
    expect(kev).toHaveTextContent('Secret kev-key');
    expect(within(kev).getByRole('button', { name: 'Edit classifier kev' })).toBeInTheDocument();
    expect(within(kev).getByRole('button', { name: 'Delete classifier kev' })).toBeInTheDocument();
    expect(rowOf('Zeta scorer')).toHaveTextContent('No secret');
  });

  it('keeps configured and enabled independent, and links a missing key to Secrets', async () => {
    const api = seeded();
    api.secretList = [];
    renderApp('/settings', api);
    await within(region()).findByRole('switch', { name: 'Enable Jev' });
    // Enabled but needing a key.
    const jev = rowOf('Jev');
    expect(within(jev).getByRole('switch')).toBeChecked();
    expect(jev).toHaveTextContent('Needs a key');
    expect(jev).toHaveTextContent(
      "Missing or blank secret 'jev-api-key'. Set it in Settings, Secrets.",
    );
    // Disabled but configured: it needs no secret.
    const zeta = rowOf('Zeta scorer');
    expect(within(zeta).getByRole('switch')).not.toBeChecked();
    expect(zeta).toHaveTextContent('Configured');
    const link = within(jev).getByRole('link', { name: 'Open Secrets' });
    expect(link).toHaveAttribute('href', '#secrets');
    await userEvent.setup().click(link);
    expect(screen.getByRole('heading', { name: 'Secrets' })).toHaveFocus();
  });

  it('shows a configured status again once the secret is set, and needs a key after deletion', async () => {
    const api = seeded();
    api.secretList = [];
    renderApp('/settings', api);
    const user = userEvent.setup();
    await within(region()).findByRole('switch', { name: 'Enable Kev 4B' });
    expect(rowOf('Kev 4B')).toHaveTextContent('Needs a key');
    await user.type(screen.getByLabelText('Name'), 'kev-key');
    await user.type(screen.getByLabelText('Value'), 'fixture');
    await user.click(screen.getByRole('button', { name: 'Set secret' }));
    await waitFor(() => expect(rowOf('Kev 4B')).toHaveTextContent('Configured'));
    // Deleting it names the classifier that uses it, then the status follows.
    await user.click(screen.getByRole('button', { name: 'Delete secret kev-key' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Classifier models using it as their bearer secret (Kev 4B) will need a key',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm delete kev-key' }));
    await waitFor(() => expect(rowOf('Kev 4B')).toHaveTextContent('Needs a key'));
  });

  it('adds a custom classifier that starts disabled, after the contract checks pass', async () => {
    const api = seeded();
    renderApp('/settings', api);
    const user = userEvent.setup();
    const add = await within(region()).findByRole('button', { name: 'Add classifier' });
    expect(add).toHaveAttribute('aria-expanded', 'false');
    await user.click(add);
    expect(add).toHaveAttribute('aria-expanded', 'true');
    const form = screen.getByRole('form', { name: 'Add classifier' });
    const id = within(form).getByLabelText('Id');
    expect(id).toHaveFocus();
    expect(form).toHaveTextContent('New classifiers start disabled');
    // Nothing is sent while a field breaks the contract; the first problem takes focus.
    await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
    expect(api.callsTo('PUT', /^\/classifier-models\//)).toHaveLength(0);
    expect(id).toHaveFocus();
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(id).toHaveAccessibleDescription(/Enter an id\.$/);
    expect(
      within(form)
        .getAllByRole('alert')
        .map((a) => a.textContent),
    ).toEqual([
      'Enter an id.',
      'Enter a display name.',
      'Enter the model name the endpoint expects, such as kev-latest.',
      "Enter the endpoint's API root, such as http://127.0.0.1:8008.",
    ]);
    await user.type(id, 'kev');
    expect(
      within(form).getByText('A classifier with id kev already exists; edit it instead.'),
    ).toBeInTheDocument();
    await user.clear(id);
    await user.type(id, 'local');
    await user.type(within(form).getByLabelText('Display name'), 'Local Kev');
    await user.type(within(form).getByLabelText('Provider model id'), 'kev-latest');
    const endpoint = within(form).getByLabelText('Endpoint');
    await user.type(endpoint, 'http://127.0.0.1:8008/v1/systemone');
    expect(endpoint).toHaveAccessibleDescription(
      'The API root. GraphGoblin sends POST <endpoint>/v1/systemone. Enter the API root only; GraphGoblin adds /v1/systemone itself.',
    );
    await user.clear(endpoint);
    await user.type(endpoint, 'http://127.0.0.1:8008');
    await user.click(within(form).getByLabelText('Choice / classification'));
    await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
    expect(within(form).getByLabelText('Choice / classification')).toHaveFocus();
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose at least one capability.');
    await user.click(within(form).getByLabelText('Choice / classification'));
    await user.click(within(form).getByLabelText('Score'));
    await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Add classifier' })).not.toBeInTheDocument(),
    );
    expect(api.callsTo('PUT', '/classifier-models/local')[0]!.body).toEqual({
      displayName: 'Local Kev',
      providerModel: 'kev-latest',
      endpoint: 'http://127.0.0.1:8008',
      primitives: ['choice', 'score'],
      provider: 'http',
    });
    const created = await within(region()).findByRole('switch', { name: 'Enable Local Kev' });
    expect(created).not.toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit classifier local' })).toHaveFocus(),
    );
  });

  it('review: keeps Add unavailable until the list has loaded, then creates only', async () => {
    const api = seeded();
    const gate = hold();
    api.override('GET /classifier-models', async (call) => {
      gate.arrive();
      await gate.held;
      return api.builtIn(call);
    });
    renderApp('/settings', api);
    const user = userEvent.setup();
    const add = await within(region()).findByRole('button', { name: 'Add classifier' });
    await gate.arrived;
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).toHaveAccessibleDescription('Available once the classifier list has loaded.');
    await user.click(add);
    expect(screen.queryByRole('form', { name: 'Add classifier' })).not.toBeInTheDocument();
    await act(() => Promise.resolve(gate.release()));
    await waitFor(() => expect(add).toHaveAttribute('aria-disabled', 'false'));
    expect(add).not.toHaveAccessibleDescription();
    await user.click(add);
    const form = screen.getByRole('form', { name: 'Add classifier' });
    await user.type(within(form).getByLabelText('Id'), 'fresh');
    await user.type(within(form).getByLabelText('Display name'), 'Fresh');
    await user.type(within(form).getByLabelText('Provider model id'), 'fresh-latest');
    await user.type(within(form).getByLabelText('Endpoint'), 'http://127.0.0.1:8009');
    await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
    await waitFor(() => expect(api.callsTo('PUT', '/classifier-models/fresh')).toHaveLength(1));
    expect(api.callsTo('PUT', '/classifier-models/fresh')[0]!.headers.get('if-none-match')).toBe(
      '*',
    );
  });

  it('review: says why a new entry waits when the list is being refetched with an error', async () => {
    const api = seeded();
    const { queryClient } = renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await within(region()).findByRole('button', { name: 'Add classifier' }));
    const form = screen.getByRole('form', { name: 'Add classifier' });
    await user.type(within(form).getByLabelText('Id'), 'fresh');
    // The list fails to refresh while the form is open: the ids it holds may be out of date.
    api.override('GET /classifier-models', () => problem(503, 'UNAVAILABLE'));
    await act(() => queryClient.refetchQueries({ queryKey: keys.classifiers }));
    await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'The classifier list has not loaded yet, so a new id cannot be checked. Save once it has loaded.',
    );
    expect(api.callsTo('PUT', /^\/classifier-models\//)).toHaveLength(0);
  });

  it('review: an id added elsewhere is refused by the server, explained, and named by the refreshed check', async () => {
    const api = seeded();
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await within(region()).findByRole('button', { name: 'Add classifier' }));
    const form = screen.getByRole('form', { name: 'Add classifier' });
    await user.type(within(form).getByLabelText('Id'), 'late');
    await user.type(within(form).getByLabelText('Display name'), 'Mine');
    await user.type(within(form).getByLabelText('Provider model id'), 'mine-latest');
    await user.type(within(form).getByLabelText('Endpoint'), 'http://127.0.0.1:9009');
    // Another tab registers the same id after this list loaded.
    api.classifiers.push(customClassifier({ id: 'late', displayName: 'Theirs' }));
    await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
    expect(await within(form).findByText(/was added since the list loaded/)).toHaveTextContent(
      'A classifier with this id was added since the list loaded, so nothing was saved. Choose another id, or cancel and edit that classifier.',
    );
    expect(api.classifiers.find((c) => c.id === 'late')).toMatchObject({
      displayName: 'Theirs',
      providerModel: 'late-latest',
    });
    // The list refreshed, so the id check now names the clash.
    await within(region()).findByRole('switch', { name: 'Enable Theirs' });
    await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
    expect(
      within(form).getByText('A classifier with id late already exists; edit it instead.'),
    ).toBeInTheDocument();
    expect(api.callsTo('PUT', '/classifier-models/late')).toHaveLength(1);
  });

  it('review: an old save finishing after Cancel does not close the form opened since', async () => {
    const api = seeded();
    const gate = hold();
    api.override('PUT /classifier-models/:id', async (call) => {
      gate.arrive();
      await gate.held;
      return api.builtIn(call);
    });
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit classifier kev' }));
    await user.click(screen.getByRole('button', { name: 'Save classifier' }));
    await gate.arrived;
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Add classifier' }));
    const form = screen.getByRole('form', { name: 'Add classifier' });
    const id = within(form).getByLabelText('Id');
    await user.type(id, 'typed');
    await act(() => Promise.resolve(gate.release()));
    await waitFor(() => expect(api.callsTo('GET', '/classifier-models').length).toBeGreaterThan(1));
    expect(screen.getByRole('form', { name: 'Add classifier' })).toBe(form);
    expect(id).toHaveValue('typed');
    expect(id).toHaveFocus();
  });

  it('review: an edit saves to the entry it was opened for, whatever the id field is set to', async () => {
    const api = seeded();
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit classifier kev' }));
    const form = screen.getByRole('form', { name: 'Edit classifier kev' });
    // A script (or an extension) changes the read-only input.
    fireEvent.change(within(form).getByLabelText('Id'), { target: { value: 'zeta' } });
    expect(within(form).getByLabelText('Id')).toHaveValue('kev');
    await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
    await waitFor(() => expect(api.callsTo('PUT', '/classifier-models/kev')).toHaveLength(1));
    expect(api.callsTo('PUT', '/classifier-models/zeta')).toHaveLength(0);
    expect(
      api.callsTo('PUT', '/classifier-models/kev')[0]!.headers.get('if-none-match'),
    ).toBeNull();
    expect(api.classifiers.find((c) => c.id === 'zeta')).toMatchObject({ primitives: ['score'] });
  });

  it('review: catalog and secret writes mark the editor’s checks of saved drafts stale', async () => {
    const api = seeded();
    const { queryClient } = renderApp('/settings', api);
    const user = userEvent.setup();
    const key = keys.validation('loop', 3, '[]');
    const stale = () => queryClient.getQueryState(key)?.isInvalidated;
    const reset = () => queryClient.setQueryData(key, []);
    reset();
    // A toggle.
    const zeta = await screen.findByRole('switch', { name: 'Enable Zeta scorer' });
    await user.click(zeta);
    await waitFor(() => expect(stale()).toBe(true));
    // Setting a secret.
    reset();
    expect(stale()).toBe(false);
    await user.type(screen.getByLabelText('Name'), 'new-key');
    await user.type(screen.getByLabelText('Value'), 'fixture');
    await user.click(screen.getByRole('button', { name: 'Set secret' }));
    await waitFor(() => expect(stale()).toBe(true));
    // Deleting one.
    reset();
    await user.click(screen.getByRole('button', { name: 'Delete secret new-key' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete new-key' }));
    await waitFor(() => expect(stale()).toBe(true));
    // Deleting a classifier.
    reset();
    await user.click(screen.getByRole('button', { name: 'Delete classifier zeta' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete zeta' }));
    await waitFor(() => expect(stale()).toBe(true));
  });

  it('opens only the Add form when a classifier has the id new', async () => {
    const api = seeded();
    api.classifiers.push(customClassifier({ id: 'new', displayName: 'Newest' }));
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await within(region()).findByRole('button', { name: 'Add classifier' }));
    expect(screen.getByRole('form', { name: 'Add classifier' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Edit classifier new' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit classifier new' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('cancels Add back to its button', async () => {
    renderApp('/settings', seeded());
    const user = userEvent.setup();
    const add = await within(region()).findByRole('button', { name: 'Add classifier' });
    await user.click(add);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add classifier' })).not.toBeInTheDocument();
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('edits metadata with a fixed id, picks a secret from Secrets, and keeps enabled', async () => {
    const api = seeded();
    api.secretList.push({ name: 'other-key', createdAt: TS, updatedAt: TS });
    renderApp('/settings', api);
    const user = userEvent.setup();
    const edit = await screen.findByRole('button', { name: 'Edit classifier kev' });
    await user.click(edit);
    expect(edit).toHaveAttribute('aria-expanded', 'true');
    const form = screen.getByRole('form', { name: 'Edit classifier kev' });
    const name = within(form).getByLabelText('Display name');
    expect(name).toHaveFocus();
    const id = within(form).getByLabelText('Id');
    expect(id).toHaveValue('kev');
    expect(id).toHaveAttribute('readonly');
    expect(form).not.toHaveTextContent('New classifiers start disabled');
    const secret = within(form).getByLabelText('Bearer secret');
    expect(secret).toHaveValue('kev-key');
    expect(
      within(secret)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['(none)', 'jev-api-key', 'kev-key', 'other-key']);
    expect(secret).toHaveAccessibleDescription(/must use https:\/\/ unless its host is loopback/);
    await user.clear(name);
    await user.type(name, 'Kev local');
    await user.selectOptions(secret, 'other-key');
    await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Edit classifier kev' })).not.toBeInTheDocument(),
    );
    expect(api.callsTo('PUT', '/classifier-models/kev')[0]!.body).toEqual({
      displayName: 'Kev local',
      providerModel: 'kev-latest',
      endpoint: 'http://127.0.0.1:8008',
      primitives: ['choice', 'noul'],
      provider: 'http',
      secretRef: 'other-key',
    });
    expect(await within(region()).findByRole('switch', { name: 'Enable Kev local' })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit classifier kev' })).toHaveFocus(),
    );
    // Choosing (none) clears authentication: the field is left out.
    await user.click(screen.getByRole('button', { name: 'Edit classifier kev' }));
    await user.selectOptions(screen.getByLabelText('Bearer secret'), '');
    expect(screen.getByLabelText('Bearer secret')).not.toHaveAccessibleDescription(/https/);
    await user.click(screen.getByRole('button', { name: 'Save classifier' }));
    await waitFor(() =>
      expect(api.callsTo('PUT', '/classifier-models/kev')[1]!.body).not.toHaveProperty('secretRef'),
    );
  });

  it('keeps the current secret when the secret names cannot be loaded, and says why', async () => {
    const api = seeded();
    api.override('GET /secrets', () =>
      problem(403, 'FORBIDDEN', 'this key lacks the "secrets:read" scope'),
    );
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit classifier kev' }));
    const secret = screen.getByLabelText('Bearer secret');
    expect(secret).toHaveValue('kev-key');
    await waitFor(() =>
      expect(secret).toHaveAccessibleDescription(
        /Secret names could not be loaded: this key lacks the "secrets:read" scope \(FORBIDDEN\)/,
      ),
    );
  });

  it('lists an unset referenced secret as not set', async () => {
    const api = seeded();
    api.secretList = [{ name: 'jev-api-key', createdAt: TS, updatedAt: TS }];
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit classifier kev' }));
    const secret = screen.getByLabelText('Bearer secret');
    await waitFor(() =>
      expect(
        within(secret)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['(none)', 'kev-key (not set)', 'jev-api-key']),
    );
    expect(secret).toHaveValue('kev-key');
  });

  it.each([
    [
      'secrets:write',
      problem(403, 'FORBIDDEN', 'Attaching a classifier secret requires the secrets:write scope'),
      'Setting a bearer secret needs an API key with the secrets:write scope.',
    ],
    [
      'settings:write',
      problem(403, 'FORBIDDEN', 'this key lacks the "settings:write" scope'),
      'Changing classifier models needs an API key with the settings:write scope.',
    ],
    [
      'validation',
      problem(400, 'VALIDATION_FAILED', 'the request did not match the schema', [
        { path: '/endpoint', message: 'Invalid URL' },
      ]),
      'The API refused these settings: /endpoint: Invalid URL.',
    ],
    [
      'validation without details',
      problem(400, 'VALIDATION_FAILED'),
      'The API refused these settings.',
    ],
    [
      'built-in',
      problem(409, 'CLASSIFIER_MANAGED_BY_SYSTEM'),
      'Built-in Jev can only be enabled or disabled.',
    ],
  ])(
    'keeps the form and the server state when a save is refused (%s)',
    async (_case, refusal, message) => {
      const api = seeded();
      api.override('PUT /classifier-models/:id', () => refusal);
      renderApp('/settings', api);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Edit classifier kev' }));
      const form = screen.getByRole('form', { name: 'Edit classifier kev' });
      await user.type(within(form).getByLabelText('Display name'), ' changed');
      await user.click(within(form).getByRole('button', { name: 'Save classifier' }));
      expect(await within(form).findByRole('alert')).toHaveTextContent(message);
      expect(within(form).getByRole('button', { name: 'Save classifier' })).toHaveFocus();
      expect(within(form).getByLabelText('Display name')).toHaveValue('Kev 4B changed');
      expect(screen.getByRole('switch', { name: 'Enable Kev 4B' })).toBeChecked();
      expect(api.classifiers.find((c) => c.id === 'kev')!.displayName).toBe('Kev 4B');
    },
  );

  it('ignores a second Save while the first is pending', async () => {
    const api = seeded();
    const gate = hold();
    api.override('PUT /classifier-models/:id', async (call) => {
      gate.arrive();
      await gate.held;
      return api.builtIn(call);
    });
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit classifier kev' }));
    const save = screen.getByRole('button', { name: 'Save classifier' });
    await user.click(save);
    await gate.arrived;
    const pending = screen.getByRole('button', { name: 'Saving…' });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    await user.click(pending);
    await act(() => Promise.resolve(gate.release()));
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Edit classifier kev' })).not.toBeInTheDocument(),
    );
    expect(api.callsTo('PUT', '/classifier-models/kev')).toHaveLength(1);
  });

  it('confirms deletion with its consequences; Keep changes nothing', async () => {
    const api = seeded();
    renderApp('/settings', api);
    const user = userEvent.setup();
    const remove = await screen.findByRole('button', { name: 'Delete classifier kev' });
    await user.click(remove);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Classifier: “Kev 4B” (kev).');
    expect(dialog).toHaveTextContent(
      'Decision nodes that select kev keep the id. Their Jev strategy is skipped, so they fall to a later strategy, or fail with DECISION_NO_ROUTE when it is their only one',
    );
    expect(dialog).toHaveTextContent('Its secret kev-key stays in Secrets.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(remove).toHaveFocus());
    expect(api.callsTo('DELETE', '/classifier-models/kev')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete classifier zeta' }));
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent('stays in Secrets');
    await user.click(screen.getByRole('button', { name: 'Confirm delete zeta' }));
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: 'Enable Zeta scorer' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Classifier models' })).toHaveFocus(),
    );
    expect(api.secretList.map((s) => s.name)).toContain('kev-key');
  });

  it('keeps a failed deletion open with its error, and refreshes a vanished row on dismissal', async () => {
    const api = seeded();
    api.override('DELETE /classifier-models/:id', () => {
      api.classifiers = api.classifiers.filter((c) => c.id !== 'kev');
      return problem(404, 'CLASSIFIER_MODEL_NOT_FOUND', "Classifier 'kev' not found");
    });
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete classifier kev' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete kev' }));
    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent(
      "Classifier 'kev' not found (CLASSIFIER_MODEL_NOT_FOUND)",
    );
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: 'Enable Kev 4B' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Classifier models' })).toHaveFocus(),
    );
  });

  it('enables and disables through PATCH and refreshes the summaries', async () => {
    const api = seeded();
    renderApp('/settings', api);
    const user = userEvent.setup();
    const zeta = await screen.findByRole('switch', { name: 'Enable Zeta scorer' });
    await user.click(zeta);
    await waitFor(() => expect(zeta).toHaveAttribute('aria-busy', 'false'));
    expect(zeta).toBeChecked();
    expect(zeta).toHaveFocus();
    expect(api.callsTo('PATCH', '/classifier-models/zeta')[0]!.body).toEqual({ enabled: true });
    expect(api.callsTo('GET', '/classifier-models').length).toBeGreaterThanOrEqual(2);
    const jev = screen.getByRole('switch', { name: 'Enable Jev' });
    await user.click(jev);
    await waitFor(() => expect(jev).not.toBeChecked());
    expect(api.classifiers.find((c) => c.id === 'jev')!.enabled).toBe(false);
  });

  it.each([
    [
      problem(403, 'FORBIDDEN', 'this key lacks the "settings:write" scope'),
      'Enabling or disabling classifiers needs an API key with the settings:write scope.',
    ],
    [problem(409, 'CLASSIFIER_MANAGED_BY_SYSTEM'), 'Built-in Jev can only be enabled or disabled.'],
    [problem(400, 'VALIDATION_FAILED'), 'The API refused these settings.'],
  ])('restores a refused toggle and announces a plain sentence', async (refusal, message) => {
    const api = seeded();
    api.override('PATCH /classifier-models/:id', () => refusal);
    renderApp('/settings', api);
    const user = userEvent.setup();
    const kev = await screen.findByRole('switch', { name: 'Enable Kev 4B' });
    await user.click(kev);
    expect(await within(rowOf('Kev 4B')).findByRole('alert')).toHaveTextContent(message);
    expect(kev).toBeChecked();
    expect(kev).toHaveFocus();
    expect(api.classifiers.find((c) => c.id === 'kev')!.enabled).toBe(true);
  });

  it.each(['vanished switch', 'another control'] as const)(
    'refreshes a toggle refused with 404 and keeps focus sensible (%s)',
    async (focus) => {
      const api = seeded();
      const gate = hold();
      api.override('PATCH /classifier-models/:id', async () => {
        await gate.held;
        api.classifiers = api.classifiers.filter((c) => c.id !== 'kev');
        return problem(404, 'CLASSIFIER_MODEL_NOT_FOUND');
      });
      renderApp('/settings', api);
      const user = userEvent.setup();
      const kev = await screen.findByRole('switch', { name: 'Enable Kev 4B' });
      await user.click(kev);
      const other = screen.getByRole('switch', { name: 'Enable Jev' });
      if (focus === 'another control') other.focus();
      await act(() => Promise.resolve(gate.release()));
      await waitFor(() => expect(kev).not.toBeInTheDocument());
      expect(within(region()).getAllByRole('status')[0]).toHaveTextContent(
        'Kev 4B: This classifier is no longer in the catalog.',
      );
      await waitFor(() =>
        expect(
          focus === 'another control'
            ? other
            : screen.getByRole('heading', { name: 'Classifier models' }),
        ).toHaveFocus(),
      );
    },
  );

  it('review: a row that vanishes while its toggle is pending still returns focus to the heading, and the next toggle clears the notice', async () => {
    const api = seeded();
    const gate = hold();
    api.override('PATCH /classifier-models/:id', async (call) => {
      if (call.path.endsWith('/kev')) {
        gate.arrive();
        await gate.held;
        return problem(404, 'CLASSIFIER_MODEL_NOT_FOUND');
      }
      return api.builtIn(call);
    });
    const { queryClient } = renderApp('/settings', api);
    const user = userEvent.setup();
    const kev = await screen.findByRole('switch', { name: 'Enable Kev 4B' });
    await user.click(kev);
    await gate.arrived;
    // Another refresh removes the row while its PATCH is still held.
    api.classifiers = api.classifiers.filter((c) => c.id !== 'kev');
    await act(() => queryClient.invalidateQueries({ queryKey: keys.classifiers }));
    await waitFor(() => expect(kev).not.toBeInTheDocument());
    expect(document.activeElement).toBe(document.body);
    await act(() => Promise.resolve(gate.release()));
    const heading = screen.getByRole('heading', { name: 'Classifier models' });
    await waitFor(() => expect(heading).toHaveFocus());
    const notice = within(region()).getAllByRole('status')[0]!;
    expect(notice).toHaveTextContent('Kev 4B: This classifier is no longer in the catalog.');
    await user.click(screen.getByRole('switch', { name: 'Enable Jev' }));
    await waitFor(() => expect(notice).toBeEmptyDOMElement());
  });
});
