import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { kitchenSinkLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem, starterTemplateEntry, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

const RULE = 'Names that differ only in letter case or spacing count as the same name.';

/** Every loop the fake API holds, by id, with its name and stored draft definition. */
function snapshot(api: FakeApi) {
  return [...api.loops.values()].map(({ loop, draft }) => ({
    id: loop.id,
    name: loop.name,
    definition: draft?.definition,
  }));
}

function exportOf(definition: ReturnType<typeof kitchenSinkLoop>) {
  return {
    format: 'graphgoblin-loop',
    formatVersion: CURRENT_DEFINITION_FORMAT,
    exportedAt: TS,
    loop: definition,
  };
}

describe('Create: a case- or whitespace-equivalent name (#209)', () => {
  it('keeps the existing loop, explains the rule, and creates only on a deliberate retry', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const existing = api.addLoop({ ...minimalLoop(), name: 'Nightly Triage' });
    renderApp('/loops', api);
    const input = await screen.findByLabelText('New loop name');
    await user.type(input, '  nightly   TRIAGE ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    const help = await screen.findByRole('alert');
    expect(help).toHaveTextContent('Another loop already has the name “nightly TRIAGE”.');
    expect(help).toHaveTextContent(RULE);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining(RULE));
    expect(screen.getByTestId('location')).toHaveTextContent('/loops');
    expect(snapshot(api)).toEqual([
      { id: existing.id, name: 'Nightly Triage', definition: expect.anything() },
    ]);

    // The suggestion only replaces the text: nothing is sent until Create.
    await user.click(screen.getByRole('button', { name: 'Use “nightly TRIAGE copy”' }));
    expect(input).toHaveValue('nightly TRIAGE copy');
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.callsTo('POST', '/loops')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(api.callsTo('POST', '/loops')).toHaveLength(2);
    const created = snapshot(api).find((loop) => loop.id !== existing.id);
    expect(created?.name).toBe('nightly TRIAGE copy');
    expect(api.loops.get(existing.id)?.loop.name).toBe('Nightly Triage');
  });

  it('clears the guidance when the name changes and shows a fresh suggestion after a race', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.addLoop({ ...minimalLoop(), name: 'Board' });
    renderApp('/loops', api);
    const input = await screen.findByLabelText('New loop name');
    await user.type(input, 'board');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('button', { name: 'Use “board copy”' });

    await user.type(input, 's');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-invalid');
    await user.type(input, '{Backspace}');
    expect(screen.getByRole('alert')).toHaveTextContent('“board”');

    // Another writer takes the suggestion before the retry: the API refuses it with new advice.
    await user.click(screen.getByRole('button', { name: 'Use “board copy”' }));
    api.addLoop({ ...minimalLoop(), name: 'BOARD COPY' });
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('“board copy”');
    await user.click(screen.getByRole('button', { name: 'Use “board copy copy”' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(api.callsTo('POST', '/loops').map((call) => call.body)).toMatchObject([
      { definition: { name: 'board' } },
      { definition: { name: 'board copy' } },
      { definition: { name: 'board copy copy' } },
    ]);
    expect(snapshot(api).map((loop) => loop.name)).toEqual([
      'Board',
      'BOARD COPY',
      'board copy copy',
    ]);
  });

  it('keeps other refusals as they were', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.override('POST /loops', () =>
      problem(400, 'LOOP_NAME_INVALID', 'A loop name must contain well-formed Unicode text.'),
    );
    renderApp('/loops', api);
    await user.type(await screen.findByLabelText('New loop name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A loop name must contain well-formed Unicode text. (LOOP_NAME_INVALID)',
    );
    expect(screen.queryByRole('button', { name: /^Use “/ })).not.toBeInTheDocument();
  });
});

describe('Import: an unchanged export while the original exists (#209)', () => {
  async function upload(
    user: ReturnType<typeof userEvent.setup>,
    document: unknown,
    file = 'fixture.graphgoblin.json',
  ) {
    await user.upload(
      await screen.findByLabelText('Import an exported loop (JSON)'),
      new File([JSON.stringify(document)], file, { type: 'application/json' }),
    );
  }

  it('retries with the original document and an explicit name, leaving the original intact', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const definition = { ...kitchenSinkLoop(), name: 'Import Fixture' };
    const original = api.addLoop(definition);
    const before = snapshot(api);
    const exported = exportOf(definition);
    renderApp('/loops', api);
    await upload(user, exported);

    const panel = await screen.findByRole('region', { name: 'Import under another name' });
    expect(panel).toHaveTextContent('fixture.graphgoblin.json was not imported');
    expect(panel).toHaveTextContent('Another loop already has the name “Import Fixture”.');
    expect(panel).toHaveTextContent(RULE);
    const field = within(panel).getByRole('textbox', { name: 'Name for the imported loop' });
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue('Import Fixture copy');
    expect(field).toHaveAccessibleDescription(expect.stringContaining('was not imported'));
    expect(snapshot(api)).toEqual(before);

    await user.click(within(panel).getByRole('button', { name: 'Import as new loop' }));
    expect(await screen.findByText('Imported "Import Fixture copy".')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Import under another name' })).toBeNull();
    const [first, retry] = api.callsTo('POST', '/loops/import');
    expect(first!.search.has('name')).toBe(false);
    expect(retry!.search.get('name')).toBe('Import Fixture copy');
    // The upload is never rewritten: both attempts send the original document.
    expect(first!.body).toEqual(exported);
    expect(retry!.body).toEqual(exported);
    const copy = snapshot(api).find((loop) => loop.id !== original.id)!;
    expect(copy.definition).toEqual({ ...before[0]!.definition, name: 'Import Fixture copy' });
    expect(snapshot(api).find((loop) => loop.id === original.id)).toEqual(before[0]);
  });

  it('shows a refreshed suggestion when the retried name was taken meanwhile', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.addLoop({ ...minimalLoop(), name: 'Import Fixture' });
    const exported = exportOf({ ...kitchenSinkLoop(), name: 'Import Fixture' });
    renderApp('/loops', api);
    await upload(user, exported);
    const panel = await screen.findByRole('region', { name: 'Import under another name' });
    api.addLoop({ ...minimalLoop(), name: 'IMPORT FIXTURE  COPY' });
    const submit = within(panel).getByRole('button', { name: 'Import as new loop' });
    await user.click(submit);

    const help = await within(panel).findByRole('alert');
    expect(help).toHaveTextContent('Another loop already has the name “Import Fixture copy”.');
    expect(submit).toHaveFocus();
    const field = within(panel).getByRole('textbox', { name: 'Name for the imported loop' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await user.click(within(panel).getByRole('button', { name: 'Use “Import Fixture copy copy”' }));
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue('Import Fixture copy copy');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Imported "Import Fixture copy copy".')).toBeInTheDocument();
    const calls = api.callsTo('POST', '/loops/import');
    expect(calls.map((call) => call.search.get('name'))).toEqual([
      null,
      'Import Fixture copy',
      'Import Fixture copy copy',
    ]);
    for (const call of calls) expect(call.body).toEqual(exported);
  });

  it('cancels without another request and keeps other failures retryable', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.addLoop({ ...minimalLoop(), name: 'minimal' });
    const exported = exportOf(minimalLoop());
    renderApp('/loops', api);
    await upload(user, exported, 'minimal.json');
    const panel = await screen.findByRole('region', { name: 'Import under another name' });
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Import under another name' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByLabelText('Import an exported loop (JSON)')).toHaveFocus(),
    );
    expect(api.callsTo('POST', '/loops/import')).toHaveLength(1);

    await upload(user, exported, 'minimal.json');
    const again = await screen.findByRole('region', { name: 'Import under another name' });
    const builtIn = (call: Parameters<FakeApi['builtIn']>[0]) => api.builtIn(call);
    api.override('POST /loops/import', () => problem(503, 'UNAVAILABLE', 'The store is busy.'));
    await user.click(within(again).getByRole('button', { name: 'Import as new loop' }));
    const failure = await within(again).findByRole('alert');
    expect(failure).toHaveTextContent('The store is busy.');
    expect(failure).toHaveTextContent('check the loop list');
    api.override('POST /loops/import', builtIn);
    await user.click(within(again).getByRole('button', { name: 'Import as new loop' }));
    expect(await screen.findByText('Imported "minimal copy".')).toBeInTheDocument();
    expect(snapshot(api).map((loop) => loop.name)).toEqual(['minimal', 'minimal copy']);
  });

  it('starts over when another file is chosen', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.addLoop({ ...minimalLoop(), name: 'minimal' });
    renderApp('/loops', api);
    await upload(user, exportOf(minimalLoop()), 'first.json');
    await screen.findByRole('region', { name: 'Import under another name' });
    await upload(user, exportOf({ ...minimalLoop(), name: 'Fresh' }), 'second.json');
    expect(await screen.findByText('Imported "Fresh".')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Import under another name' })).toBeNull();
  });
});

describe('Template copies: repeating Use (#209)', () => {
  async function openGallery(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    return screen.findByRole('region', { name: 'Quick start' });
  }

  it('leaves the catalog and existing loop unchanged, then creates a named copy on request', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.templates = [starterTemplateEntry()];
    const catalog = structuredClone(api.templates);
    const existing = api.addLoop({ ...minimalLoop(), name: 'Quick start' });
    const before = snapshot(api);
    renderApp('/loops', api);
    const card = await openGallery(user);
    const use = within(card).getByRole('button', { name: 'Use Quick start' });
    await user.click(use);

    const field = await within(card).findByRole('textbox', { name: 'Name for the new draft' });
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue('Quick start copy');
    expect(card).toHaveTextContent('Name the new Quick start draft');
    expect(card).toHaveTextContent('Another loop already has the name this template uses.');
    expect(within(card).queryByRole('button', { name: 'Use Quick start' })).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/loops');
    expect(snapshot(api)).toEqual(before);
    expect(api.templates).toEqual(catalog);

    await user.click(within(card).getByRole('button', { name: 'Create draft' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(api.callsTo('POST', '/templates/quick-start/draft').map((call) => call.body)).toEqual([
      {},
      { name: 'Quick start copy' },
    ]);
    const copy = snapshot(api).find((loop) => loop.id !== existing.id)!;
    expect(copy.name).toBe('Quick start copy');
    expect(screen.getByTestId('location')).toHaveTextContent(`/loops/${copy.id}/edit`);
    expect(snapshot(api).find((loop) => loop.id === existing.id)).toEqual(before[0]);
    expect(api.templates).toEqual(catalog);
  });

  it('cancels back to Use, keeps one request in flight, and refreshes a raced suggestion', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.templates = [starterTemplateEntry()];
    api.addLoop({ ...minimalLoop(), name: 'Quick start' });
    renderApp('/loops', api);
    const card = await openGallery(user);
    await user.click(within(card).getByRole('button', { name: 'Use Quick start' }));
    await user.click(await within(card).findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: 'Use Quick start' })).toHaveFocus(),
    );
    expect(api.callsTo('POST', '/templates/quick-start/draft')).toHaveLength(1);

    await user.click(within(card).getByRole('button', { name: 'Use Quick start' }));
    const field = await within(card).findByRole('textbox', { name: 'Name for the new draft' });
    api.addLoop({ ...minimalLoop(), name: 'quick START copy' });
    let finish!: (response: Response) => void;
    api.override(
      'POST /templates/:id/draft',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const create = within(card).getByRole('button', { name: 'Create draft' });
    await user.click(create);
    expect(create).toHaveAttribute('aria-busy', 'true');
    expect(create).toHaveTextContent('Creating draft…');
    await user.click(create);
    expect(api.callsTo('POST', '/templates/quick-start/draft')).toHaveLength(3);
    const pending = api.callsTo('POST', '/templates/quick-start/draft').at(-1)!;
    await act(async () => finish(await api.builtIn(pending)));

    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Another loop already has the name “Quick start copy”.',
    );
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await user.click(within(card).getByRole('button', { name: 'Use “Quick start copy copy”' }));
    expect(field).toHaveValue('Quick start copy copy');
    expect(api.callsTo('POST', '/templates/quick-start/draft')).toHaveLength(3);
  });
});
