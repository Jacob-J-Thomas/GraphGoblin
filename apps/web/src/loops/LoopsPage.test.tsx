import { kitchenSinkLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi, problem, starterTemplateEntry, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

describe('LoopsPage', () => {
  it('lists loops with publish state and last run status', async () => {
    const api = new FakeApi();
    const draft = api.addLoop({
      ...minimalLoop(),
      name: 'draft loop',
      description: 'just a draft',
    });
    const published = api.addLoop({ ...minimalLoop(), name: 'live loop' }, { published: true });
    api.addLoop({ ...minimalLoop(), name: 'changed loop' }, { published: true, draft: true });
    api.addRun({ loopId: published.id, status: 'failed', createdAt: '2026-10-01T00:00:00.000Z' });
    api.addRun({ loopId: published.id, status: 'succeeded', createdAt: TS });
    api.addRun({ loopId: published.id, status: 'running', createdAt: '2026-09-01T00:00:00.000Z' });
    renderApp('/loops', api);

    const liveRow = (await screen.findByRole('link', { name: 'live loop' })).closest('tr')!;
    expect(within(liveRow).getByText('published')).toBeInTheDocument();
    expect(within(liveRow).getByText('succeeded')).toBeInTheDocument();
    const draftRow = screen.getByRole('link', { name: 'draft loop' }).closest('tr')!;
    expect(within(draftRow).getByText('draft only')).toBeInTheDocument();
    expect(within(draftRow).getByText('never run')).toBeInTheDocument();
    expect(within(draftRow).getByText('just a draft')).toBeInTheDocument();
    expect(screen.getByText('published, unpublished changes')).toBeInTheDocument();
    void draft;
  });

  it('creates a loop and opens it in the editor', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    renderApp('/loops', api);
    expect(await screen.findByText(/No loops yet/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('New loop name'), '  triage  ');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(api.callsTo('POST', '/loops')[0]!.body).toMatchObject({
      definition: { name: 'triage' },
    });
    expect(api.callsTo('POST', '/loops')[0]!.headers.get('x-graphgoblin-client')).toBe('ui');
  });

  it('creates an editable template draft without setup, defaults, or readiness', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const entry = starterTemplateEntry();
    entry.defaultSettings = null;
    entry.prerequisites.canInstantiate = false;
    entry.prerequisites.canRun = false;
    api.templates = [entry];
    renderApp('/loops', api);

    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    expect(await screen.findByRole('heading', { name: 'Choose a template' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quick start' })).toBeInTheDocument();
    expect(screen.getByText(/Drafts use their model defaults/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use Quick start' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const [createCall] = api.callsTo('POST', '/templates/quick-start/draft');
    expect(createCall?.body).toEqual({});
    const [created] = [...api.loops.values()];
    expect(created?.loop.draftVersionId).toBeTruthy();
    expect(created?.loop.currentVersionId).toBeUndefined();
    expect(api.callsTo('POST', '/templates/quick-start/prerequisites')).toHaveLength(0);
    expect(api.callsTo('POST', '/templates/quick-start/instantiate')).toHaveLength(0);
  });

  it('keeps all gallery actions guarded while creating and opening a draft', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.templates = [starterTemplateEntry()];
    let finish!: (response: Response) => void;
    api.override(
      'POST /templates/:id/draft',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    renderApp('/loops', api);

    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    const create = await screen.findByRole('button', { name: 'Use Quick start' });
    await user.click(create);
    const createCall = await waitFor(() => {
      const calls = api.callsTo('POST', '/templates/quick-start/draft');
      expect(calls).toHaveLength(1);
      return calls[0]!;
    });

    expect(create).toHaveAttribute('aria-disabled', 'true');
    expect(create).not.toBeDisabled();
    fireEvent.click(create);
    expect(api.callsTo('POST', '/templates/quick-start/draft')).toHaveLength(1);

    await act(async () => finish(await api.builtIn(createCall)));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(api.callsTo('POST', '/templates/quick-start/draft')).toHaveLength(1);
  });

  it('shows readiness blockers without letting them block the editable starting draft', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const entry = starterTemplateEntry();
    const report = {
      checks: [
        {
          id: 'assistant-model',
          label: 'Assistant model',
          status: 'missing' as const,
          blocking: 'authoring' as const,
          message: 'No enabled assistant model is available.',
          remediation: 'Enable an available model in Settings.',
        },
        {
          id: 'run-isolation',
          label: 'Run isolation',
          status: 'unavailable' as const,
          blocking: 'runtime' as const,
          message: 'This installation cannot enforce evidence-only isolation yet.',
          remediation: 'Wait for an enforced isolation runner before starting runs.',
        },
      ],
      canInstantiate: false,
      canRun: false,
    };
    entry.prerequisites = report;
    api.templates = [entry];
    renderApp('/loops', api);

    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    expect(await screen.findByText('No enabled assistant model is available.')).toBeInTheDocument();
    expect(screen.getByText(/Enable an available model in Settings\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Quick start' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Use Quick start' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.callsTo('POST', '/templates/quick-start/draft')).toHaveLength(1);
    expect(api.callsTo('POST', '/templates/quick-start/prerequisites')).toHaveLength(0);
    expect(api.callsTo('POST', '/templates/quick-start/instantiate')).toHaveLength(0);
  });

  it('shows runtime blockers as run requirements while allowing draft creation', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const entry = starterTemplateEntry();
    entry.prerequisites = {
      checks: [
        {
          id: 'run-isolation',
          label: 'Run isolation',
          status: 'unavailable',
          blocking: 'runtime',
          message: 'This installation cannot enforce evidence-only isolation yet.',
          remediation: 'Wait for an enforced isolation runner before starting runs.',
        },
      ],
      canInstantiate: true,
      canRun: false,
    };
    api.templates = [entry];
    api.catalog = [
      {
        harness: 'codex',
        model: 'test-codex',
        source: 'harness',
        displayName: 'Test Codex',
        efforts: ['low'],
        defaultEffort: 'low',
        enabled: true,
      },
    ];
    renderApp('/loops', api);

    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    expect(screen.getByText('Run setup needed')).toBeInTheDocument();
    expect(screen.getByText('Run requirement')).toBeInTheDocument();
    expect(screen.getByText(/Drafts use their model defaults/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Use Quick start' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(api.callsTo('POST', '/templates/quick-start/draft')).toHaveLength(1);
  });

  it('reports a failed draft request and never retries it automatically', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.templates = [starterTemplateEntry()];
    api.override('POST /templates/:id/draft', () =>
      problem(503, 'DRAFT_UNAVAILABLE', 'The template draft could not be created.'),
    );
    renderApp('/loops', api);
    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    await user.click(await screen.findByRole('button', { name: 'Use Quick start' }));
    expect(
      await screen.findByText(/The template draft could not be created\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/check the loop list/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/templates/quick-start/draft')).toHaveLength(1);
    expect(api.callsTo('POST', '/templates/quick-start/prerequisites')).toHaveLength(0);
    expect(api.callsTo('POST', '/templates/quick-start/instantiate')).toHaveLength(0);
  });

  it('shows an empty gallery and still creates a template draft without typed settings defaults', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const emptyGallery = renderApp('/loops', api);
    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    expect(await screen.findByText('No templates are available right now.')).toBeInTheDocument();
    emptyGallery.unmount();

    const withNoDefaults = new FakeApi();
    const entry = starterTemplateEntry();
    entry.defaultSettings = null;
    entry.prerequisites.canInstantiate = false;
    entry.prerequisites.canRun = false;
    withNoDefaults.templates = [entry];
    renderApp('/loops', withNoDefaults);
    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    await user.click(await screen.findByRole('button', { name: 'Use Quick start' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(withNoDefaults.callsTo('POST', '/templates/quick-start/draft')).toHaveLength(1);
  });

  it('reports a failed create', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.override('POST /loops', () => problem(400, 'VALIDATION_FAILED', 'bad name'));
    renderApp('/loops', api);
    await user.type(await screen.findByLabelText('New loop name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/bad name/)).toBeInTheDocument();
  });

  it('imports an export file and reports bad files and server errors', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    renderApp('/loops', api);
    const input = await screen.findByLabelText('Import an exported loop (JSON)');
    const exported = {
      format: 'graphgoblin-loop',
      formatVersion: 3,
      exportedAt: TS,
      loop: kitchenSinkLoop(),
    };
    await user.upload(
      input,
      new File([JSON.stringify(exported)], 'sink.json', { type: 'application/json' }),
    );
    expect(await screen.findByText('Imported "kitchen-sink".')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'kitchen-sink' })).toBeInTheDocument();

    await user.upload(input, new File(['not json'], 'bad.json', { type: 'application/json' }));
    expect(await screen.findByText('bad.json is not a JSON document.')).toBeInTheDocument();
    // The refusal describes the picker, after the chosen file's name, and marks it invalid.
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('bad.json bad.json is not a JSON document.');

    await user.upload(input, new File(['{"nope":1}'], 'other.json', { type: 'application/json' }));
    expect(await screen.findByText(/neither a loop export/)).toBeInTheDocument();

    api.override(
      'POST /loops/import',
      () =>
        new Response(
          JSON.stringify({
            loop: { id: 'x', name: 'warned', ownerId: 'local', createdAt: TS, updatedAt: TS },
            issues: [{ code: 'NO_EXIT', severity: 'error', message: 'needs exit' }],
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    );
    await user.upload(input, new File(['{}'], 'warned.json', { type: 'application/json' }));
    expect(await screen.findByText('NO_EXIT: needs exit')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [] } });
  });

  it('directs a v1 export to the offline upgrade command', async () => {
    const user = userEvent.setup();
    renderApp('/loops', new FakeApi());
    const document = {
      format: 'graphgoblin-loop',
      formatVersion: 1,
      exportedAt: TS,
      loop: { ...minimalLoop(), settings: { defaults: { harness: 'codex', extra: true } } },
    };
    await user.upload(
      await screen.findByLabelText('Import an exported loop (JSON)'),
      new File([JSON.stringify(document)], 'old-loop.json', { type: 'application/json' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('LOOP_FORMAT_UPGRADE_REQUIRED');
    expect(alert).toHaveTextContent('Use the offline graphgoblin-upgrade export command');
  });

  it('exports the published version or the draft as a download', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.addLoop({ ...minimalLoop(), name: 'Live Loop!' }, { published: true });
    api.addLoop({ ...minimalLoop(), name: 'drafty' });
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderApp('/loops', api);
    await user.click(await screen.findByRole('button', { name: 'Export Live Loop!' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(revoke).toHaveBeenCalledWith('blob:x');
    expect(api.callsTo('GET', /\/export$/)[0]!.search.get('draft')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Export drafty' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    expect(api.callsTo('GET', /\/export$/)[1]!.search.get('draft')).toBe('true');

    api.override('GET /loops/:id/export', () => problem(404, 'VERSION_NOT_FOUND', 'no version'));
    await user.click(screen.getByRole('button', { name: 'Export drafty' }));
    expect(await screen.findByText(/no version/)).toBeInTheDocument();
  });

  it('deletes a loop after confirmation and shows refusals', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.addLoop({ ...minimalLoop(), name: 'doomed' });
    api.addLoop({ ...minimalLoop(), name: 'busy' });
    renderApp('/loops', api);
    await user.click(await screen.findByRole('button', { name: 'Delete doomed' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('all its versions and its triggers');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('subloop');
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(api.callsTo('DELETE', '/loops')).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete doomed' })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: 'Delete doomed' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete doomed' }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'doomed' })).not.toBeInTheDocument(),
    );

    api.override('DELETE /loops/:id', () =>
      problem(409, 'LOOP_IN_USE', 'the loop has active runs'),
    );
    await user.click(screen.getByRole('button', { name: 'Delete busy' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete busy' }));
    expect(await screen.findByText(/the loop has active runs/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('LOOP_IN_USE');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm delete busy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the loop has active runs');
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows export progress and ignores repeated clicks until the request finishes', async () => {
    const api = new FakeApi();
    api.addLoop({ ...minimalLoop(), name: 'slow' });
    let finish!: (response: Response) => void;
    api.override(
      'GET /loops/:id/export',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    renderApp('/loops', api);
    const button = await screen.findByRole('button', { name: 'Export slow' });
    const edit = screen.getByRole('link', { name: 'Edit slow' });
    expect(edit).toHaveClass('h-8', 'border-strong', 'cursor-pointer');
    const user = userEvent.setup();
    await user.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    expect(button).toHaveTextContent('Exporting…');
    expect(screen.getByText('Exporting slow…')).toHaveAttribute('role', 'status');
    fireEvent.click(button);
    expect(api.callsTo('GET', /\/export$/)).toHaveLength(1);
    await act(() => Promise.resolve(finish(problem(404, 'VERSION_NOT_FOUND', 'no version'))));
    expect(await screen.findByRole('alert')).toHaveTextContent('no version');
    expect(button).toHaveAttribute('aria-disabled', 'false');
    expect(button).toHaveFocus();
  });

  it('shows a clear offline state', async () => {
    const api = new FakeApi();
    api.offline = true;
    renderApp('/loops', api);
    expect(await screen.findByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/Loops needs the GraphGoblin API/)).toBeInTheDocument();
  });
});
