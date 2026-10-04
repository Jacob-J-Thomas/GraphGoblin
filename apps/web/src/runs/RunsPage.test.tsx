import { minimalLoop } from '@graphgoblin/contracts/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

describe('RunsPage', () => {
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

  it('says when nothing matches', async () => {
    renderApp('/runs?status=failed');
    expect(await screen.findByText('No runs match.')).toBeInTheDocument();
  });
});
