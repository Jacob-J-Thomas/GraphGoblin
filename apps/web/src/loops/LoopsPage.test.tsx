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

  it('checks changed starter settings and opens the created parent as a draft', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.templates = [starterTemplateEntry()];
    api.catalog = [
      {
        harness: 'codex',
        model: 'test-codex',
        source: 'harness',
        displayName: 'Test Codex',
        efforts: ['low', 'medium'],
        defaultEffort: 'low',
        enabled: false,
      },
      {
        harness: 'codex',
        model: 'available-codex',
        source: 'harness',
        displayName: 'Available Codex',
        efforts: ['low', 'high'],
        defaultEffort: 'low',
        enabled: true,
      },
    ];
    renderApp('/loops', api);

    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    expect(await screen.findByRole('heading', { name: 'Choose a template' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quick start' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use Quick start' }));

    const dialog = screen.getByRole('dialog', { name: 'New from Quick start' });
    expect(dialog).toHaveTextContent('does not need GitHub or a repository checkout');
    expect(screen.getByLabelText('Model')).toHaveAccessibleDescription(/not currently available/);
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();

    await user.clear(screen.getByLabelText('Instruction'));
    await user.type(
      screen.getByLabelText('Instruction'),
      'Summarize this request and give one next step.',
    );
    await user.selectOptions(screen.getByLabelText('Model'), 'available-codex');
    await user.selectOptions(screen.getByLabelText('Effort'), 'high');
    await user.clear(screen.getByLabelText('Maximum iterations'));
    await user.type(screen.getByLabelText('Maximum iterations'), '7');
    const create = screen.getByRole('button', { name: 'Create draft' });
    expect(create).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check requirements' }));

    const check = await waitFor(() => {
      const calls = api.callsTo('POST', '/templates/quick-start/prerequisites');
      expect(calls).toHaveLength(1);
      return calls[0]!;
    });
    expect(check.body).toMatchObject({
      settings: {
        instruction: 'Summarize this request and give one next step.',
        roles: { assistant: { harness: 'codex', model: 'available-codex', effort: 'high' } },
        maxIterations: 7,
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Create draft' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    const instantiate = api.callsTo('POST', '/templates/quick-start/instantiate')[0]!;
    expect(instantiate.body).toEqual(check.body);
    const [instance] = [...api.templateInstances.values()];
    expect(instance).toBeDefined();
    expect(instance!.loops.map((loop) => loop.status)).toEqual(['draft']);
    expect(api.loops.get(instance!.parentLoopId)?.loop.currentVersionId).toBeUndefined();
  });

  it('keeps settings and the dialog locked while draft creation is in flight', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.templates = [starterTemplateEntry()];
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
    let finish!: (response: Response) => void;
    api.override(
      'POST /templates/:id/instantiate',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    renderApp('/loops', api);

    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    await user.click(await screen.findByRole('button', { name: 'Use Quick start' }));
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    const createCall = await waitFor(() => {
      const calls = api.callsTo('POST', '/templates/quick-start/instantiate');
      expect(calls).toHaveLength(1);
      return calls[0]!;
    });

    expect(screen.getByLabelText('Instruction')).toBeDisabled();
    expect(screen.getByLabelText('Maximum iterations')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Creating draft…' })).toBeDisabled();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Close template setup' }));
    expect(screen.getByRole('dialog', { name: 'New from Quick start' })).toBeInTheDocument();
    expect(api.callsTo('POST', '/templates/quick-start/instantiate')).toHaveLength(1);

    await act(async () => finish(await api.builtIn(createCall)));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(api.callsTo('POST', '/templates/quick-start/instantiate')).toHaveLength(1);
  });

  it('shows actionable authoring blockers without exposing secret values', async () => {
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
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('jev-api-key');
    expect(api.callsTo('POST', '/templates/quick-start/instantiate')).toHaveLength(0);
  });

  it('explains a runtime-only blocker while still allowing the draft to be created', async () => {
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
    await user.click(await screen.findByRole('button', { name: 'Use Quick start' }));
    const dialog = screen.getByRole('dialog', { name: 'New from Quick start' });
    expect(dialog).toHaveTextContent('runs will stay blocked');
    expect(dialog).toHaveTextContent('evidence-only isolation yet');
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/loops\/.+\/edit$/),
    );
    expect(api.callsTo('POST', '/templates/quick-start/instantiate')).toHaveLength(1);
  });

  it('keeps unready harnesses out of model choices and blocks draft creation', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.templates = [starterTemplateEntry()];
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
      {
        harness: 'claude',
        model: 'blocked-claude',
        source: 'harness',
        displayName: 'Blocked Claude',
        efforts: ['low'],
        defaultEffort: 'low',
        enabled: true,
      },
    ];
    api.preflight = [
      { harness: 'codex', ok: false, authenticated: false, problems: ['not ready'] },
      {
        harness: 'claude',
        ok: true,
        authenticated: true,
        problems: [],
        models: [
          {
            model: 'blocked-claude',
            efforts: ['low'],
            admission: 'blocked',
            reasonCode: 'BILLING_UNVERIFIED',
            billingStatus: 'unverified',
          },
        ],
      },
    ];
    renderApp('/loops', api);
    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    await user.click(await screen.findByRole('button', { name: 'Use Quick start' }));

    const harness = screen.getByLabelText('Harness');
    expect([...harness.querySelectorAll('option')].map((option) => option.value)).toEqual([
      'codex',
    ]);
    expect(screen.getByText(/This harness is not ready yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
    expect(api.callsTo('POST', '/templates/quick-start/instantiate')).toHaveLength(0);
  });

  it('limits Claude effort choices to the current supported preflight capability', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.templates = [starterTemplateEntry()];
    api.catalog = [
      {
        harness: 'claude',
        model: 'safe-claude',
        source: 'harness',
        displayName: 'Safe Claude',
        efforts: ['low', 'high'],
        defaultEffort: 'low',
        enabled: true,
      },
    ];
    api.preflight = [
      {
        harness: 'claude',
        ok: true,
        authenticated: true,
        problems: [],
        models: [
          {
            model: 'safe-claude',
            efforts: ['low'],
            admission: 'supported',
            reasonCode: null,
            billingStatus: 'account-dependent',
          },
        ],
      },
    ];
    renderApp('/loops', api);

    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    await user.click(await screen.findByRole('button', { name: 'Use Quick start' }));
    await user.selectOptions(screen.getByLabelText('Harness'), 'claude');
    await user.selectOptions(screen.getByLabelText('Model'), 'safe-claude');
    await user.click(screen.getByRole('button', { name: 'Check requirements' }));

    expect(
      [...screen.getByLabelText('Effort').querySelectorAll('option')].map((o) => o.value),
    ).toEqual(['low']);
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled();
  });

  it('reports failed prerequisite checks and instantiation errors', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.templates = [starterTemplateEntry()];
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
    api.override('POST /templates/:id/prerequisites', () =>
      problem(503, 'PREFLIGHT_UNAVAILABLE', 'Could not check the current harness.'),
    );
    renderApp('/loops', api);
    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    await user.click(await screen.findByRole('button', { name: 'Use Quick start' }));
    await user.click(screen.getByRole('button', { name: 'Check requirements' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not check the current harness.',
    );

    api.override('POST /templates/:id/prerequisites', (call) => api.builtIn(call));
    api.override('POST /templates/:id/instantiate', () =>
      problem(409, 'TEMPLATE_PREREQUISITES_FAILED', 'The role changed before creation.'),
    );
    await user.click(screen.getByRole('button', { name: 'Check requirements' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByText(/The role changed before creation\./)).toBeInTheDocument();
    expect(api.callsTo('POST', '/templates/quick-start/instantiate')).toHaveLength(1);
  });

  it('shows an empty gallery and refuses templates without typed defaults', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const emptyGallery = renderApp('/loops', api);
    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    expect(await screen.findByText('No templates are available right now.')).toBeInTheDocument();
    emptyGallery.unmount();

    const withNoDefaults = new FakeApi();
    const entry = starterTemplateEntry();
    entry.defaultSettings = null;
    withNoDefaults.templates = [entry];
    renderApp('/loops', withNoDefaults);
    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    await user.click(await screen.findByRole('button', { name: 'Use Quick start' }));
    expect(await screen.findByText('This template has no default settings.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
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
