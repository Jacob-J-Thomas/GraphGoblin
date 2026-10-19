import { minimalLoop } from '@graphgoblin/contracts/testing';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

describe('RunsPage', () => {
  it('lists and filters exhausted runs with their status badge', async () => {
    const api = new FakeApi(),
      user = userEvent.setup();
    const run = api.addRun({ status: 'exhausted', outcome: 'exhausted' });
    api.addRun({ status: 'succeeded' });
    renderApp('/runs', api);
    const row = (await screen.findByRole('link', { name: run.id })).closest('tr')!;
    expect(within(row).getByText('exhausted').closest('[data-status]')).toHaveAttribute(
      'data-status',
      'exhausted',
    );
    await user.selectOptions(screen.getByLabelText('Status'), 'exhausted');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('status=exhausted'),
    );
    await waitFor(() =>
      expect(api.calls.some((call) => call.search.get('status') === 'exhausted')).toBe(true),
    );
  });
  it('lists runs with loop names, parents, and children links, and filters through the URL', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    const loop = api.addLoop({ ...minimalLoop(), name: 'alpha' }, { published: true });
    const parent = api.addRun({ loopId: loop.id, status: 'waiting' });
    const child = api.addRun({
      loopId: 'UNKNOWNLOOP',
      status: 'succeeded',
      parentRunId: parent.id,
      startedAt: undefined,
    });
    renderApp('/runs', api);

    const parentRow = (await screen.findByRole('link', { name: parent.id })).closest('tr')!;
    expect(within(parentRow).getByText('alpha')).toBeInTheDocument();
    expect(within(parentRow).getByText('waiting')).toBeInTheDocument();
    const childRow = screen.getByRole('link', { name: child.id }).closest('tr')!;
    expect(within(childRow).getByRole('link', { name: parent.id.slice(-6) })).toHaveAttribute(
      'href',
      `/runs/${parent.id}`,
    );
    expect(within(childRow).getByText('UNKNOWNLOOP')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'waiting');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/runs?status=waiting'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: child.id })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'New run' })).toHaveAttribute('href', '/runs/new');
    await user.selectOptions(screen.getByLabelText('Loop'), loop.id);
    expect(api.calls.at(-1)!.search.get('loopId')).toBe(loop.id);
    // Filtered to a loop, New run starts with that loop chosen.
    expect(screen.getByRole('link', { name: 'New run' })).toHaveAttribute(
      'href',
      `/runs/new?loop=${loop.id}`,
    );
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await user.selectOptions(screen.getByLabelText('Parent'), 'none');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('parent=none'));

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/runs$/));

    const freshRow = (await screen.findByRole('link', { name: parent.id })).closest('tr')!;
    await user.click(within(freshRow).getByRole('link', { name: 'children' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`parent=${parent.id}`),
    );
    expect(screen.getByLabelText('Parent')).toHaveValue(parent.id);
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: parent.id })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: child.id })).toBeInTheDocument();
  });

  it('appends filtered pages, retains loaded rows on failure, retries, and resets on filter changes', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    const loop = api.addLoop(minimalLoop());
    for (let i = 0; i < 101; i++) api.addRun({ loopId: loop.id, status: 'succeeded' });
    api.addRun({ loopId: loop.id, status: 'failed' });
    renderApp(`/runs?loop=${loop.id}&status=succeeded&parent=none`, api);
    const more = await screen.findByRole('button', { name: 'Load more' });
    expect(screen.getAllByRole('row')).toHaveLength(101);
    const loaded = screen.getAllByRole('row')[1]!;
    let fail = true;
    api.override('GET /runs', (call) =>
      call.search.has('cursor') && fail
        ? problem(503, 'UNAVAILABLE', 'Try again')
        : api.builtIn(call),
    );
    await user.click(more);
    expect(await screen.findByText(/Try again/)).toBeVisible();
    expect(loaded).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(102));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    const pageCalls = api.callsTo('GET', '/runs').filter((call) => call.search.has('cursor'));
    expect(pageCalls.length).toBeGreaterThan(0);
    for (const call of pageCalls) {
      expect(call.search.get('loopId')).toBe(loop.id);
      expect(call.search.get('status')).toBe('succeeded');
      expect(call.search.get('parent')).toBe('none');
    }
    await user.selectOptions(screen.getByLabelText('Status'), 'failed');
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(api.callsTo('GET', '/runs').at(-1)!.search.has('cursor')).toBe(false);
  });

  it('guards repeated next-page clicks and cancels that request on unmount', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    for (let i = 0; i < 101; i++) api.addRun();
    let finish!: (response: Response) => void;
    let nextSignal: AbortSignal | undefined;
    api.override('GET /runs', (call) => {
      if (!call.search.has('cursor')) return api.builtIn(call);
      nextSignal = call.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const view = renderApp('/runs', api);
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    const busy = await screen.findByRole('button', { name: 'Loading more...' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.click(busy);
    expect(api.callsTo('GET', '/runs')).toHaveLength(2);
    view.unmount();
    expect(nextSignal?.aborted).toBe(true);
    act(() =>
      finish(
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    view.queryClient.clear();
  });

  it('says when nothing matches', async () => {
    renderApp('/runs?status=failed');
    expect(await screen.findByText('No runs match.')).toBeInTheDocument();
  });
});
