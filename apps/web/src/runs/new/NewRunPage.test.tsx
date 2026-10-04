import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem } from '../../__fixtures__/fake-api.js';
import { renderApp } from '../../__fixtures__/render.js';
import { newRunPath } from './paths.js';

/** A loop whose manual trigger takes a repo name (required) and a limit. */
function withInput(name: string, label = 'Start'): LoopDefinitionInput {
  return {
    ...minimalLoop(),
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label,
        config: {
          subtype: 'manual',
          inputSchema: {
            type: 'object',
            properties: { repo: { type: 'string' }, limit: { type: 'integer' } },
            required: ['repo'],
          },
        },
      },
      {
        id: 'cron',
        kind: 'trigger',
        label: 'Nightly',
        config: { subtype: 'cron', expression: '0 2 * * *', timezone: 'UTC' },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done', port: 'in' } },
      { id: 'e2', from: { node: 'cron', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
}

const runStarts = (api: FakeApi) => api.callsTo('POST', /^\/loops\/[^/]+\/runs$/);

describe('New run', () => {
  it('builds its address, with or without a loop', () => {
    expect(newRunPath()).toBe('/runs/new');
    expect(newRunPath('L 1')).toBe('/runs/new?loop=L%201');
  });

  it('lists only published loops and keeps the choice in the address', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(withInput('alpha'), { published: true });
    api.addLoop({ ...minimalLoop(), name: 'draft only' });
    renderApp('/runs', api);

    // Runs' New run action opens the flow; filtered to a loop, it opens with that loop chosen.
    await user.click(await screen.findByRole('link', { name: 'New run' }));
    expect(await screen.findByRole('heading', { name: 'New run' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/runs\/new$/);
    expect(screen.getByText(/Choose a published loop/)).toBeInTheDocument();
    const select = screen.getByLabelText('Loop');
    expect(within(select).queryByText('draft only')).toBeNull();
    expect(screen.getByRole('link', { name: 'All runs' })).toHaveAttribute('href', '/runs');

    await user.selectOptions(select, loop.id);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/runs/new?loop=${loop.id}`),
    );
    expect(await screen.findByRole('region', { name: 'Start a run' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Runs of this loop' })).toHaveAttribute(
      'href',
      `/runs?loop=${loop.id}`,
    );
    await user.selectOptions(select, '');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/runs\/new$/));
    expect(screen.queryByRole('region', { name: 'Start a run' })).toBeNull();
  });

  it('opens with the loop of a deep link chosen and starts a run of the current version', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(withInput('alpha', 'Old start'), { published: true });
    const current = api.publishVersion(loop.id, withInput('alpha'));
    renderApp(newRunPath(loop.id), api);

    const launcher = await screen.findByRole('region', { name: 'Start a run' });
    expect(screen.getByLabelText('Loop')).toHaveValue(loop.id);
    const version = within(launcher).getByLabelText('Version');
    expect(version).toHaveValue(current.id);
    expect(
      within(version)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      expect.stringMatching(/^v2 \(current\), published /),
      expect.stringMatching(/^v1, published /),
    ]);
    expect(version).toHaveAccessibleDescription(/can run at the same time/);
    // Manual triggers only.
    const trigger = within(launcher).getByLabelText('Trigger');
    expect(
      within(trigger)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Start (start)']);

    // The input is checked against the trigger's schema before anything is sent.
    await user.click(within(launcher).getByRole('button', { name: 'Start run' }));
    expect(await within(launcher).findByRole('alert')).toHaveTextContent(/repo/);
    expect(runStarts(api)).toHaveLength(0);

    await user.type(within(launcher).getByLabelText('repo'), 'graphgoblin');
    await user.type(within(launcher).getByLabelText('limit'), '3');
    await user.click(within(launcher).getByRole('button', { name: 'Start run' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/runs\/[0-9A-Z]{26}$/),
    );
    expect(runStarts(api).at(-1)!.body).toEqual({
      triggerNodeId: 'start',
      versionId: current.id,
      input: { repo: 'graphgoblin', limit: 3 },
    });
  });

  it('starts an older published version when chosen, and runs may overlap', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop(), { published: true });
    const first = api.loops.get(loop.id)!.current!;
    api.publishVersion(loop.id, minimalLoop());
    const view = renderApp(newRunPath(loop.id), api);
    const launcher = await screen.findByRole('region', { name: 'Start a run' });
    await user.selectOptions(within(launcher).getByLabelText('Version'), first.id);
    await user.click(within(launcher).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(runStarts(api)).toHaveLength(1));
    expect(runStarts(api)[0]!.body).toMatchObject({ versionId: first.id });
    view.unmount();

    // A second run while the first is still queued: nothing stops it.
    renderApp(newRunPath(loop.id), api);
    const again = await screen.findByRole('region', { name: 'Start a run' });
    await user.click(within(again).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(runStarts(api)).toHaveLength(2));
    expect([...api.runs.values()].filter((r) => r.status === 'queued')).toHaveLength(2);
  });

  it('starts from the manual trigger chosen, with that trigger’s input form', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const twoStarts = withInput('two starts');
    twoStarts.nodes.push({
      id: 'quick',
      kind: 'trigger',
      label: 'Quick',
      config: { subtype: 'manual' },
    });
    twoStarts.edges.push({
      id: 'e3',
      from: { node: 'quick', port: 'out' },
      to: { node: 'done', port: 'in' },
    });
    const loop = api.addLoop(twoStarts, { published: true });
    renderApp(newRunPath(loop.id), api);
    const launcher = await screen.findByRole('region', { name: 'Start a run' });
    expect(within(launcher).getByLabelText('repo')).toBeInTheDocument();
    await user.selectOptions(within(launcher).getByLabelText('Trigger'), 'quick');
    // No input schema: a free JSON input instead of the repo field.
    expect(within(launcher).queryByLabelText('repo')).toBeNull();
    await user.type(within(launcher).getByLabelText('Input (JSON)'), '{{"n": 1}');
    await user.click(within(launcher).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(runStarts(api)).toHaveLength(1));
    expect(runStarts(api)[0]!.body).toMatchObject({ triggerNodeId: 'quick', input: { n: 1 } });
  });

  it('shows why a run could not start', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop(), { published: true });
    api.override('POST /loops/:id/runs', () =>
      problem(400, 'INVALID_INPUT', 'input does not match the trigger schema'),
    );
    renderApp(newRunPath(loop.id), api);
    const launcher = await screen.findByRole('region', { name: 'Start a run' });
    await user.click(within(launcher).getByRole('button', { name: 'Start run' }));
    expect(await screen.findByText('Could not start the run')).toBeInTheDocument();
    expect(screen.getByText(/input does not match the trigger schema/)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`/runs/new?loop=${loop.id}`);
  });

  it('explains a deep link to a loop that cannot be started', async () => {
    const api = new FakeApi();
    const draft = api.addLoop({ ...minimalLoop(), name: 'draft only' });
    const view = renderApp(newRunPath(draft.id), api);
    expect(await screen.findByText('“draft only” has no published version')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open it in the editor' })).toHaveAttribute(
      'href',
      `/loops/${draft.id}/edit`,
    );
    expect(screen.getByLabelText('Loop')).toHaveValue('');
    expect(screen.getByText(/No loop is published yet/)).toBeInTheDocument();
    view.unmount();

    renderApp(newRunPath('01UNKNOWN0000000000000000'), api);
    expect(await screen.findByText('Loop not found')).toBeInTheDocument();
    expect(screen.getByText('01UNKNOWN0000000000000000')).toBeInTheDocument();
  });

  it('says when the chosen version has no manual trigger, and when versions fail to load', async () => {
    const api = new FakeApi();
    const cronOnly = api.addLoop(
      {
        ...minimalLoop(),
        name: 'cron only',
        nodes: [
          {
            id: 'start',
            kind: 'trigger',
            label: 'Nightly',
            config: { subtype: 'cron', expression: '0 2 * * *', timezone: 'UTC' },
          },
          { id: 'done', kind: 'exit', label: 'Done', config: {} },
        ],
      },
      { published: true },
    );
    const view = renderApp(newRunPath(cronOnly.id), api);
    expect(await screen.findByText(/has no manual trigger/)).toBeInTheDocument();
    view.unmount();

    // The loop list says it is published, but its versions are gone (deleted meanwhile).
    api.override('GET /loops/:id/versions', () => json({ items: [] }));
    const emptied = renderApp(newRunPath(cronOnly.id), api);
    expect(await screen.findByText('This loop has no published version yet.')).toBeInTheDocument();
    emptied.unmount();

    api.override('GET /loops/:id/versions', () => problem(500, 'INTERNAL_ERROR', 'down'));
    renderApp(newRunPath(cronOnly.id), api);
    expect(await screen.findByText(/Could not load versions/)).toBeInTheDocument();
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
