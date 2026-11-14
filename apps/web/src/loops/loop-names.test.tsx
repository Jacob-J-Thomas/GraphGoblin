import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { kitchenSinkLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

describe('Import: a newer file choice owns the panel (#209)', () => {
  const PANEL = { name: 'Import under another name' };
  const FIELD = { name: 'Name for the imported loop' };

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const picker = () => screen.findByLabelText('Import an exported loop (JSON)');

  async function choose(user: ReturnType<typeof userEvent.setup>, document: unknown, file: string) {
    await user.upload(
      await picker(),
      new File([JSON.stringify(document)], file, { type: 'application/json' }),
    );
  }

  /** A file whose read finishes (or fails) only when the test says so. */
  function slowFile(file: string) {
    const read = deferred<string>();
    const slow = new File(['{}'], file, { type: 'application/json' });
    Object.defineProperty(slow, 'text', { value: () => read.promise });
    return { file: slow, read };
  }

  /**
   * The API admits or refuses the first import at once; only its answer to the browser waits for
   * the returned release. Later imports answer at once.
   */
  function holdFirstImportAnswer(api: FakeApi) {
    const gate = deferred<void>();
    let first = true;
    api.override('POST /loops/import', async (call) => {
      const response = await api.builtIn(call);
      if (first) {
        first = false;
        await gate.promise;
      }
      return response;
    });
    return async () => {
      const lists = api.callsTo('GET', '/loops').length;
      await act(() => Promise.resolve(gate.resolve()));
      // The late answer is handled once it refreshes the loop list (it may have committed).
      await waitFor(() => expect(api.callsTo('GET', '/loops').length).toBeGreaterThan(lists));
    };
  }

  function twoGraphs() {
    const a = { ...kitchenSinkLoop(), name: 'Archived A', description: 'graph A' };
    const b = { ...minimalLoop(), name: 'Visible B', description: 'graph B' };
    return { a, b, exportA: exportOf(a), exportB: exportOf(b) };
  }

  it('keeps the newer file’s panel, typed name and document when an older refusal answers late', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const { a, b, exportA, exportB } = twoGraphs();
    api.addLoop(a);
    api.addLoop(b);
    const before = snapshot(api);
    const releaseA = holdFirstImportAnswer(api);
    renderApp('/loops', api);
    await choose(user, exportA, 'prior-A.json');
    await waitFor(() => expect(api.callsTo('POST', '/loops/import')).toHaveLength(1));
    await choose(user, exportB, 'selected-B.json');
    const panel = await screen.findByRole('region', PANEL);
    expect(panel).toHaveTextContent('selected-B.json was not imported');
    const field = within(panel).getByRole('textbox', FIELD);
    await user.clear(field);
    await user.type(field, 'Visible B kept for B');

    await releaseA();
    expect(screen.getByRole('region', PANEL)).toBe(panel);
    expect(panel).toHaveTextContent('selected-B.json was not imported');
    expect(panel).toHaveTextContent('Another loop already has the name “Visible B”.');
    expect(panel).not.toHaveTextContent('prior-A.json');
    expect(field).toHaveValue('Visible B kept for B');
    expect(screen.getByText('selected-B.json')).toBeInTheDocument();
    expect(screen.queryByText(/^Imported/)).toBeNull();

    // Another writer takes the typed name first: the same upload keeps its text and takes the
    // fresh suggestion, and every attempt sends B's document unchanged.
    api.addLoop({ ...minimalLoop(), name: 'visible b KEPT for b' });
    await user.click(within(panel).getByRole('button', { name: 'Import as new loop' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Another loop already has the name “Visible B kept for B”.',
    );
    expect(field).toHaveValue('Visible B kept for B');
    await user.click(
      within(panel).getByRole('button', { name: 'Use “Visible B kept for B copy”' }),
    );
    await user.click(within(panel).getByRole('button', { name: 'Import as new loop' }));
    expect(await screen.findByText('Imported "Visible B kept for B copy".')).toBeInTheDocument();

    const calls = api.callsTo('POST', '/loops/import');
    expect(calls.map((call) => call.search.get('name'))).toEqual([
      null,
      null,
      'Visible B kept for B',
      'Visible B kept for B copy',
    ]);
    expect(calls[0]!.body).toEqual(exportA);
    for (const call of calls.slice(1)) expect(call.body).toEqual(exportB);
    const created = snapshot(api).find((loop) => loop.name === 'Visible B kept for B copy');
    expect(created?.definition).toEqual({ ...before[1]!.definition, name: created?.name });
    expect(snapshot(api).slice(0, 2)).toEqual(before);
  });

  it('lists an older file’s late import without closing the newer file’s panel', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const { a, b, exportB } = twoGraphs();
    api.addLoop(b);
    const releaseA = holdFirstImportAnswer(api);
    renderApp('/loops', api);
    await choose(user, exportOf({ ...a, name: 'Fresh A' }), 'prior-A.json');
    await waitFor(() => expect(api.callsTo('POST', '/loops/import')).toHaveLength(1));
    // A committed; only its answer is still on the way.
    expect(snapshot(api).map((loop) => loop.name)).toEqual(['Visible B', 'Fresh A']);
    await choose(user, exportB, 'selected-B.json');
    const panel = await screen.findByRole('region', PANEL);
    const field = within(panel).getByRole('textbox', FIELD);
    await user.clear(field);
    await user.type(field, 'B under my name');

    await releaseA();
    expect(await screen.findByRole('link', { name: 'Fresh A' })).toBeInTheDocument();
    expect(screen.getByRole('region', PANEL)).toBe(panel);
    expect(panel).toHaveTextContent('selected-B.json was not imported');
    expect(field).toHaveValue('B under my name');
    expect(screen.queryByText('Imported "Fresh A".')).toBeNull();

    await user.click(within(panel).getByRole('button', { name: 'Import as new loop' }));
    expect(await screen.findByText('Imported "B under my name".')).toBeInTheDocument();
    const retry = api.callsTo('POST', '/loops/import').at(-1)!;
    expect(retry.search.get('name')).toBe('B under my name');
    expect(retry.body).toEqual(exportB);
  });

  it('does not reopen the panel for an older file after Cancel', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const { a, b, exportA, exportB } = twoGraphs();
    api.addLoop(a);
    api.addLoop(b);
    const releaseA = holdFirstImportAnswer(api);
    renderApp('/loops', api);
    await choose(user, exportA, 'prior-A.json');
    await waitFor(() => expect(api.callsTo('POST', '/loops/import')).toHaveLength(1));
    await choose(user, exportB, 'selected-B.json');
    const panel = await screen.findByRole('region', PANEL);
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', PANEL)).toBeNull();

    await releaseA();
    expect(screen.queryByRole('region', PANEL)).toBeNull();
    expect(screen.queryByText(/was not imported/)).toBeNull();
    expect(api.callsTo('POST', '/loops/import')).toHaveLength(2);
  });

  it('sends nothing for a file whose read finishes after a newer choice', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const { b, exportA, exportB } = twoGraphs();
    api.addLoop(b);
    renderApp('/loops', api);
    const slow = slowFile('slow-A.json');
    await user.upload(await picker(), slow.file);
    await choose(user, exportB, 'selected-B.json');
    const panel = await screen.findByRole('region', PANEL);
    const field = within(panel).getByRole('textbox', FIELD);
    await user.clear(field);
    await user.type(field, 'B under my name');

    // A's name is free, so an upload of it would be admitted and could close B's panel.
    await act(() => Promise.resolve(slow.read.resolve(JSON.stringify(exportA))));
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(api.callsTo('POST', '/loops/import').map((call) => call.body)).toEqual([exportB]);
    expect(screen.getByRole('region', PANEL)).toBe(panel);
    expect(panel).toHaveTextContent('selected-B.json was not imported');
    expect(field).toHaveValue('B under my name');
    expect(snapshot(api).map((loop) => loop.name)).toEqual(['Visible B']);
  });

  it('reports a file that cannot be read, unless a newer choice replaced it', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const { b, exportB } = twoGraphs();
    api.addLoop(b);
    renderApp('/loops', api);
    const broken = slowFile('broken.json');
    await user.upload(await picker(), broken.file);
    await act(() =>
      Promise.resolve(broken.read.reject(new DOMException('unreadable', 'NotReadableError'))),
    );
    expect(await screen.findByText('broken.json could not be read.')).toBeInTheDocument();
    expect(await picker()).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', '/loops/import')).toHaveLength(0);

    const slow = slowFile('slow-A.json');
    await user.upload(await picker(), slow.file);
    expect(screen.queryByText('broken.json could not be read.')).toBeNull();
    await choose(user, exportB, 'selected-B.json');
    const panel = await screen.findByRole('region', PANEL);
    await act(() =>
      Promise.resolve(slow.read.reject(new DOMException('unreadable', 'NotReadableError'))),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(screen.queryByText('slow-A.json could not be read.')).toBeNull();
    expect(screen.getByRole('region', PANEL)).toBe(panel);
    expect(await picker()).not.toHaveAttribute('aria-invalid');
    expect(api.callsTo('POST', '/loops/import').map((call) => call.body)).toEqual([exportB]);
  });

  it('sends one retry when Import as new loop is activated twice at once', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.addLoop({ ...minimalLoop(), name: 'minimal' });
    const exported = exportOf(minimalLoop());
    renderApp('/loops', api);
    await choose(user, exported, 'minimal.json');
    const panel = await screen.findByRole('region', PANEL);
    const submit = within(panel).getByRole('button', { name: 'Import as new loop' });
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(await screen.findByText('Imported "minimal copy".')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const calls = api.callsTo('POST', '/loops/import');
    expect(calls.map((call) => call.search.get('name'))).toEqual([null, 'minimal copy']);
    for (const call of calls) expect(call.body).toEqual(exported);
    expect(snapshot(api).map((loop) => loop.name)).toEqual(['minimal', 'minimal copy']);
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
