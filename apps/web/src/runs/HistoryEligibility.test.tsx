import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { DeletionConfirmationSchema, DeletionSelectionSchema } from '@graphgoblin/contracts';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp, renderWith } from '../__fixtures__/render.js';
import { HistoryEligibility } from './HistoryEligibility.js';

function fakeConsent() {
  const api = new FakeApi();
  api.override('POST /runs/deletion-eligibility/preview', ({ body }) => {
    const { runIds } = DeletionSelectionSchema.parse(body);
    return Response.json({
      token: 'a'.repeat(64),
      items: runIds.map((runId) => ({ runId, reasons: [] })),
    });
  });
  api.override('POST /runs/deletion-eligibility', ({ body }) => {
    const { runIds, action } = DeletionConfirmationSchema.parse(body);
    for (const id of runIds) {
      const run = api.runs.get(id)!;
      if (action === 'mark')
        run.deletionApproval = {
          confirmedAt: run.createdAt,
          confirmedBy: { ownerId: 'local', kind: 'user', id: 'local' },
        };
      else delete run.deletionApproval;
    }
    return Response.json({
      token: 'b'.repeat(64),
      items: runIds.map((runId) => ({ runId, reasons: [] })),
    });
  });
  return api;
}

it('cancels without confirmation, freezes an explicit bulk selection while new history arrives, and shows persisted marks', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const first = api.addRun({ status: 'succeeded' }),
    second = api.addRun({ status: 'failed' });
  const rendered = renderApp('/runs', api);
  expect(screen.getByRole('button', { name: 'Review delete-ready history' })).toBeDisabled();
  for (const run of [first, second])
    await user.click(await screen.findByRole('checkbox', { name: `Select history ${run.id}` }));
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  let dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('button', { name: 'Confirm delete-ready selection' });
  expect(dialog).toHaveTextContent(
    'permanently remove this history and its owned, unshared workspaces and artifacts',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(api.calls.filter((call) => call.path === '/runs/deletion-eligibility')).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  dialog = await screen.findByRole('dialog');
  const fresh = api.addRun({ status: 'succeeded' });
  await act(() => rendered.queryClient.invalidateQueries({ queryKey: ['runs'] }));
  expect(dialog).not.toHaveTextContent(fresh.id);
  await user.click(within(dialog).getByRole('button', { name: 'Confirm delete-ready selection' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(
    DeletionConfirmationSchema.parse(
      api.calls.find((call) => call.path === '/runs/deletion-eligibility')!.body,
    ).runIds,
  ).toEqual([first.id, second.id]);
  expect(await screen.findAllByText('Delete-ready')).toHaveLength(2);
  expect(screen.getByText('0 selected')).toHaveAttribute('aria-live', 'polite');
  expect(api.runs.get(fresh.id)?.deletionApproval).toBeUndefined();
  await user.selectOptions(screen.getByLabelText('Status'), 'failed');
  expect(screen.getByText('0 selected')).toBeInTheDocument();
});

it('removes vanished rows from selection before the next review', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const gone = api.addRun(),
    kept = api.addRun();
  const rendered = renderApp('/runs', api);
  await user.click(await screen.findByRole('checkbox', { name: `Select history ${gone.id}` }));
  api.runs.delete(gone.id);
  await act(() => rendered.queryClient.invalidateQueries({ queryKey: ['runs'] }));
  await waitFor(() =>
    expect(
      screen.queryByRole('checkbox', { name: `Select history ${gone.id}` }),
    ).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole('checkbox', { name: `Select history ${kept.id}` }));
  expect(screen.getByText('1 selected')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  expect(await screen.findByRole('dialog')).not.toHaveTextContent(gone.id);
});

it('formats deletion confirmation time using the inspector local date convention', async () => {
  const api = fakeConsent();
  const ts = '2026-10-26T07:15:09.424Z';
  const run = api.addRun({
    status: 'succeeded',
    deletionApproval: {
      confirmedAt: ts,
      confirmedBy: { ownerId: 'local', kind: 'user', id: 'local' },
    },
  });
  renderApp(`/runs/${run.id}`, api);
  const label = await screen.findByText(/Delete-ready: confirmed by/);
  expect(label).toHaveTextContent(new Date(ts).toLocaleString());
  expect(label).not.toHaveTextContent(ts);
});

it('shows every protection reason and permits explicit withdrawal', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'paused' });
  api.override('POST /runs/deletion-eligibility/preview', () =>
    Response.json({
      token: 'a'.repeat(64),
      items: [{ runId: run.id, reasons: ['Run is paused; protected.'] }],
    }),
  );
  renderWith(<HistoryEligibility runIds={[run.id]} />, '/', api);
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  let dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('Run is paused; protected.')).toBeVisible();
  expect(
    within(dialog).getByRole('button', { name: 'Confirm delete-ready selection' }),
  ).toBeDisabled();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Withdraw delete-ready mark' }));
  dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm withdrawal' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(DeletionConfirmationSchema.parse(api.calls.at(-1)!.body).action).toBe('withdraw');
});

it('reports a preview error or a stale save, leaves history untouched, and requires a new review', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'succeeded' });
  api.override('POST /runs/deletion-eligibility/preview', () => problem(503, 'UNAVAILABLE'));
  renderWith(<HistoryEligibility runIds={[run.id]} />, '/', api);
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('UNAVAILABLE');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  api.override('POST /runs/deletion-eligibility/preview', () =>
    Response.json({ token: 'a'.repeat(64), items: [{ runId: run.id, reasons: [] }] }),
  );
  api.override('POST /runs/deletion-eligibility', () =>
    problem(409, 'DELETION_SELECTION_STALE', 'Review the selection again.'),
  );
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm delete-ready selection' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('DELETION_SELECTION_STALE');
  expect(screen.getByRole('button', { name: 'Confirm delete-ready selection' })).toBeDisabled();
  expect(run.deletionApproval).toBeUndefined();
});

it('does not reopen a cancelled dialog when its pending preview arrives', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun();
  let finish!: (response: Response) => void;
  api.override(
    'POST /runs/deletion-eligibility/preview',
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  renderWith(<HistoryEligibility runIds={[run.id]} />, '/', api);
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  expect(await within(screen.getByRole('dialog')).findByRole('status')).toHaveTextContent(
    'Checking selected history',
  );
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => {
    finish(Response.json({ token: 'a'.repeat(64), items: [{ runId: run.id, reasons: [] }] }));
    await Promise.resolve();
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each([200, 409])(
  'keeps a newer review intact when a dismissed pending save returns HTTP %i',
  async (status) => {
    const api = fakeConsent(),
      user = userEvent.setup();
    const run = api.addRun({ status: 'succeeded' });
    let finish!: (response: Response) => void;
    api.override(
      'POST /runs/deletion-eligibility',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    renderWith(<HistoryEligibility runIds={[run.id]} />, '/', api);
    await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm delete-ready selection' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    const modal = screen.getByRole('dialog');
    if (!(modal instanceof HTMLDialogElement)) throw new Error('Expected a native dialog.');
    // The native dialog can already be closed (for example by repeated Escape).
    act(() => modal.close());
    await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
    await screen.findByRole('dialog');
    await act(async () => {
      finish(
        status === 200
          ? Response.json({ token: 'b'.repeat(64), items: [] })
          : problem(409, 'DELETION_SELECTION_STALE'),
      );
      await Promise.resolve();
    });
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Confirm delete-ready selection' }),
    ).toBeEnabled();
  },
);

it('clears the Runs selection after a successful withdrawal', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({
    status: 'succeeded',
    deletionApproval: {
      confirmedAt: '2026-10-26T07:15:09.424Z',
      confirmedBy: { ownerId: 'local', kind: 'user', id: 'local' },
    },
  });
  renderApp('/runs', api);
  await user.click(await screen.findByRole('checkbox', { name: `Select history ${run.id}` }));
  await user.click(screen.getByRole('button', { name: 'Withdraw delete-ready mark' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm withdrawal' }));
  await waitFor(() => expect(screen.getByText('0 selected')).toBeInTheDocument());
  expect(api.runs.get(run.id)?.deletionApproval).toBeUndefined();
});

it('keeps a retained run selected when polling moves its protected status outside the filter', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'failed' });
  const rendered = renderApp('/runs?status=failed', api);
  await user.click(await screen.findByRole('checkbox', { name: `Select history ${run.id}` }));
  run.status = 'running';
  api.override('POST /runs/deletion-eligibility/preview', () =>
    Response.json({
      token: 'a'.repeat(64),
      items: [{ runId: run.id, reasons: ['Run is running; protected.'] }],
    }),
  );
  await act(() => rendered.queryClient.invalidateQueries({ queryKey: ['runs'] }));
  await waitFor(() =>
    expect(
      screen.queryByRole('checkbox', { name: `Select history ${run.id}` }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByText('1 selected')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  expect(await screen.findByText('Run is running; protected.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm delete-ready selection' })).toBeDisabled();
});
