import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { expect, it } from 'vitest';
import { DeletionConfirmationSchema, DeletionSelectionSchema } from '@graphgoblin/contracts';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp, renderWith } from '../__fixtures__/render.js';
import {
  HistoryEligibility,
  HistoryEligibilityControls,
  useHistoryConfirmation,
} from './HistoryEligibility.js';
import { currentCredential, isCurrentCredential, useApiKeyStore } from '../api/api-key.js';
import {
  notSentByKey,
  requestedBeforeKey,
  reviewClosedByKey,
  type WriteGate,
} from './inspector/RunControls.js';

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

it.each(['mark', 'withdraw'] as const)(
  'returns focus to the selection status and announces a successful %s',
  async (action) => {
    const api = fakeConsent(),
      user = userEvent.setup();
    const run = api.addRun({ status: 'succeeded' });
    renderApp('/runs', api);
    await user.click(await screen.findByRole('checkbox', { name: `Select history ${run.id}` }));
    await user.click(
      screen.getByRole('button', {
        name: action === 'mark' ? 'Review delete-ready history' : 'Withdraw delete-ready mark',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(
      await within(dialog).findByRole('button', {
        name: action === 'mark' ? 'Confirm delete-ready selection' : 'Confirm withdrawal',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const selection = screen.getByText(/0 selected/);
    expect(selection).toHaveFocus();
    expect(selection).toHaveAttribute('aria-live', 'polite');
    const outcome = screen.getByText(
      action === 'mark' ? '1 run marked delete-ready.' : 'Deletion approval withdrawn for 1 run.',
    );
    expect(outcome).toHaveAttribute('aria-live', 'polite');
  },
);

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

/**
 * The inspector's arrangement for one visit of one run (#416): the view owns the confirmation, an
 * outage replaces its gate, and the run section presenting the controls can be withheld.
 */
function InspectorGate({ runId }: { runId: string }) {
  const [state, setState] = useState(() => gateFor(undefined));
  const [presented, setPresented] = useState(true);
  const [visit] = useState(() => ({}));
  const confirmation = useHistoryConfirmation({ owner: visit, availability: state.gate });
  return (
    <>
      <button type="button" onClick={() => setState(gateFor('This browser is offline.'))}>
        Lose connection
      </button>
      <button type="button" onClick={() => setState(gateFor(undefined))}>
        Read again
      </button>
      <button type="button" onClick={() => setPresented((value) => !value)}>
        Withhold or show the run
      </button>
      {presented ? (
        <HistoryEligibilityControls runIds={[runId]} confirmation={confirmation} />
      ) : null}
    </>
  );
}
let currentGate: WriteGate | undefined;
function gateFor(blocked: string | undefined) {
  const gate: WriteGate = {
    blocked,
    open: () => blocked === undefined && currentGate === gate,
    shown: () => true,
  };
  currentGate = gate;
  return { gate };
}

const posts = (api: FakeApi, path: string) => api.callsTo('POST', path);

it('expires an open review and its late preview when the inspector loses the run (#416)', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'succeeded' });
  let finish!: (response: Response) => void;
  api.override(
    'POST /runs/deletion-eligibility/preview',
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  renderWith(<InspectorGate runId={run.id} />, '/', api);
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  expect(await within(screen.getByRole('dialog')).findByRole('status')).toHaveTextContent(
    'Checking selected history',
  );
  await user.click(screen.getByRole('button', { name: 'Lose connection' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review delete-ready history' })).toBeDisabled();
  await act(async () => {
    finish(Response.json({ token: 'a'.repeat(64), items: [{ runId: run.id, reasons: [] }] }));
    await Promise.resolve();
  });
  // Reconnecting does not revive the earlier review or its preview.
  await user.click(screen.getByRole('button', { name: 'Read again' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(posts(api, '/runs/deletion-eligibility/preview')).toHaveLength(1);
  expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(0);
  // A new review under the current gate works as before.
  api.override('POST /runs/deletion-eligibility/preview', () =>
    Response.json({ token: 'a'.repeat(64), items: [{ runId: run.id, reasons: [] }] }),
  );
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm delete-ready selection' }));
  await waitFor(() => expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(1));
});

it('sends no preview while the inspector gate is blocked (#416)', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'succeeded' });
  renderWith(<InspectorGate runId={run.id} />, '/', api);
  await user.click(screen.getByRole('button', { name: 'Lose connection' }));
  for (const name of ['Review delete-ready history', 'Withdraw delete-ready mark']) {
    expect(screen.getByRole('button', { name })).toBeDisabled();
    await user.click(screen.getByRole('button', { name }));
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(posts(api, '/runs/deletion-eligibility/preview')).toHaveLength(0);
});

it('reports the uncertain outcome of a confirmation already sent when its review expires (#416)', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'succeeded' });
  let fail!: (error: Error) => void;
  api.override(
    'POST /runs/deletion-eligibility',
    () =>
      new Promise<Response>((_resolve, reject) => {
        fail = reject;
      }),
  );
  renderWith(<InspectorGate runId={run.id} />, '/', api);
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm delete-ready selection' }));
  expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Lose connection' }));
  await act(async () => {
    fail(new TypeError('Failed to fetch'));
    await Promise.resolve();
  });
  expect(await screen.findByText(/The change may or may not have been saved/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(1);
});

it.each(['fails in transport', 'succeeds'] as const)(
  'opens no second review after reconnecting while a confirmation sent before the outage is unresolved, and reports it when it %s (#416)',
  async (settle) => {
    const api = fakeConsent(),
      user = userEvent.setup();
    const run = api.addRun({ status: 'succeeded' });
    let finish!: (response: Response) => void;
    let fail!: (error: Error) => void;
    api.override(
      'POST /runs/deletion-eligibility',
      () =>
        new Promise<Response>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    renderWith(<InspectorGate runId={run.id} />, '/', api);
    const review = () => screen.getByRole('button', { name: 'Review delete-ready history' });
    const withdraw = () => screen.getByRole('button', { name: 'Withdraw delete-ready mark' });
    await user.click(review());
    await user.click(await screen.findByRole('button', { name: 'Confirm delete-ready selection' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Lose connection' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The view reads the run again under a new gate; the confirmation sent earlier is unresolved.
    await user.click(screen.getByRole('button', { name: 'Read again' }));
    expect(review()).toBeDisabled();
    expect(withdraw()).toBeDisabled();
    // An attempt to open a replacement review opens nothing and sends no preview.
    await user.click(review());
    await user.click(withdraw());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(api, '/runs/deletion-eligibility/preview')).toHaveLength(1);
    await act(async () => {
      if (settle === 'succeeds')
        finish(Response.json({ token: 'b'.repeat(64), items: [{ runId: run.id, reasons: [] }] }));
      else fail(new TypeError('Failed to fetch'));
      await Promise.resolve();
    });
    const outcome =
      settle === 'succeeds'
        ? '1 run marked delete-ready.'
        : /The change may or may not have been saved/;
    expect(await screen.findByText(outcome)).toBeInTheDocument();
    await waitFor(() => expect(review()).toBeEnabled());
    expect(withdraw()).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(1);
    expect(posts(api, '/runs/deletion-eligibility/preview')).toHaveLength(1);
  },
);

it('reports the outcome of a pending confirmation the browser dismissed (#416)', async () => {
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'succeeded' });
  let fail!: (error: Error) => void;
  api.override(
    'POST /runs/deletion-eligibility',
    () =>
      new Promise<Response>((_resolve, reject) => {
        fail = reject;
      }),
  );
  renderWith(<HistoryEligibility runIds={[run.id]} />, '/', api);
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm delete-ready selection' }));
  expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
  const modal = screen.getByRole('dialog');
  if (!(modal instanceof HTMLDialogElement)) throw new Error('Expected a native dialog.');
  // The browser has already closed the native dialog (for example by repeated Escape). Once that
  // dismissal is handled, the dismissed review no longer holds the controls.
  act(() => modal.close());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Review delete-ready history' })).toBeEnabled(),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => {
    fail(new TypeError('Failed to fetch'));
    await Promise.resolve();
  });
  expect(await screen.findByText(/The change may or may not have been saved/)).toBeInTheDocument();
  expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(1);
});

/** Confirms the open review once its preview has been read. */
async function confirmReview(user: ReturnType<typeof userEvent.setup>) {
  const confirm = await screen.findByRole('button', { name: 'Confirm delete-ready selection' });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
}

it.each(['fails in transport', 'succeeds'] as const)(
  'keeps a confirmation sent before its controls were withheld the only one in the controls shown again, and reports there when it %s (#416)',
  async (settle) => {
    const api = fakeConsent(),
      user = userEvent.setup();
    const run = api.addRun({ status: 'succeeded' });
    let finish!: (response: Response) => void;
    let fail!: (error: Error) => void;
    api.override(
      'POST /runs/deletion-eligibility',
      () =>
        new Promise<Response>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    renderWith(<InspectorGate runId={run.id} />, '/', api);
    const review = () => screen.getByRole('button', { name: 'Review delete-ready history' });
    const withdraw = () => screen.getByRole('button', { name: 'Withdraw delete-ready mark' });
    const toggle = () => screen.getByRole('button', { name: 'Withhold or show the run' });
    await user.click(review());
    await confirmReview(user);
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    const original = review();
    // An outage expires the review, and the run section presenting the controls is withheld.
    await user.click(screen.getByRole('button', { name: 'Lose connection' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(toggle());
    expect(original).not.toBeInTheDocument();
    // The run is read again under a new gate and shown again with new controls, which the
    // confirmation sent before, still unresolved, alone holds.
    await user.click(screen.getByRole('button', { name: 'Read again' }));
    await user.click(toggle());
    expect(review()).not.toBe(original);
    expect(review()).toBeDisabled();
    expect(withdraw()).toBeDisabled();
    await user.click(review());
    await user.click(withdraw());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(api, '/runs/deletion-eligibility/preview')).toHaveLength(1);
    await act(async () => {
      if (settle === 'succeeds')
        finish(Response.json({ token: 'b'.repeat(64), items: [{ runId: run.id, reasons: [] }] }));
      else fail(new TypeError('Failed to fetch'));
      await Promise.resolve();
    });
    // The controls shown now report its outcome, and a new review may open only now.
    const outcome =
      settle === 'succeeds'
        ? '1 run marked delete-ready.'
        : /The change may or may not have been saved/;
    expect(await screen.findByText(outcome)).toBeInTheDocument();
    await waitFor(() => expect(review()).toBeEnabled());
    expect(withdraw()).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(1);
    api.override('POST /runs/deletion-eligibility', () =>
      Response.json({ token: 'b'.repeat(64), items: [{ runId: run.id, reasons: [] }] }),
    );
    await user.click(review());
    await confirmReview(user);
    await waitFor(() => expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(2));
    expect(posts(api, '/runs/deletion-eligibility/preview')).toHaveLength(2);
  },
);

it('keeps a browser dismissal of a pending confirmation through withheld controls: a newer review is not confirmed before the first settles, which reports beside it (#416)', async () => {
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
  renderWith(<InspectorGate runId={run.id} />, '/', api);
  const review = () => screen.getByRole('button', { name: 'Review delete-ready history' });
  const toggle = () => screen.getByRole('button', { name: 'Withhold or show the run' });
  await user.click(review());
  await confirmReview(user);
  expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
  const modal = screen.getByRole('dialog');
  if (!(modal instanceof HTMLDialogElement)) throw new Error('Expected a native dialog.');
  // The browser has already closed the native dialog (for example by repeated Escape).
  act(() => modal.close());
  await waitFor(() => expect(review()).toBeEnabled());
  // Withheld and shown again, the controls keep that dismissal.
  await user.click(toggle());
  await user.click(toggle());
  expect(review()).toBeEnabled();
  // A newer review reads its own preview but cannot be confirmed while the first is pending.
  await user.click(review());
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(posts(api, '/runs/deletion-eligibility/preview')).toHaveLength(2));
  await waitFor(() => expect(within(dialog).queryByRole('status')).not.toBeInTheDocument());
  expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await act(async () => {
    finish(problem(409, 'DELETION_SELECTION_STALE'));
    await Promise.resolve();
  });
  // The first confirmation reports beside the controls, never in the newer review.
  expect(await screen.findByText(/^Not saved: .*DELETION_SELECTION_STALE/)).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(
    await screen.findByRole('button', { name: 'Confirm delete-ready selection' }),
  ).toBeEnabled();
  expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(1);
});

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

/**
 * The inspector's arrangement under accepted API-key credentials (#562): its gate is issued under
 * the credential accepted at render and replaced when another is accepted.
 */
function KeyedInspector({ runId }: { runId: string }) {
  const generation = useApiKeyStore((state) => state.generation);
  const rejected = useApiKeyStore((state) => state.rejected);
  const [visit] = useState(() => ({}));
  const gate = useMemo<WriteGate>(() => {
    const credential = { generation, rejected };
    return {
      blocked: undefined,
      credential,
      open: () => isCurrentCredential(credential),
      shown: () => true,
    };
  }, [generation, rejected]);
  const confirmation = useHistoryConfirmation({ owner: visit, availability: gate });
  return <HistoryEligibilityControls runIds={[runId]} confirmation={confirmation} />;
}

it('closes a withdrawal review when another key is accepted, names its trigger and returns focus to it (#562)', async () => {
  useApiKeyStore.getState().save('gg_A');
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'succeeded' });
  renderWith(<KeyedInspector runId={run.id} />, '/', api);
  const withdraw = screen.getByRole('button', { name: 'Withdraw delete-ready mark' });
  await user.click(withdraw);
  await screen.findByRole('button', { name: 'Confirm withdrawal' });
  act(() => useApiKeyStore.getState().save('gg_B'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText(reviewClosedByKey('Withdraw delete-ready mark'))).toHaveAttribute(
    'aria-live',
    'polite',
  );
  await waitFor(() => expect(withdraw).toHaveFocus());
  expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(0);
});

it('hides a confirmation saved under one key once another is accepted, and reports one settled after the change only as requested (#562)', async () => {
  useApiKeyStore.getState().save('gg_A');
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'succeeded' });
  renderWith(<KeyedInspector runId={run.id} />, '/', api);
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm delete-ready selection' }));
  expect(await screen.findByText('1 run marked delete-ready.')).toBeInTheDocument();
  act(() => useApiKeyStore.getState().save('gg_B'));
  await waitFor(() => expect(screen.queryByText('1 run marked delete-ready.')).toBeNull());

  let answer!: (response: Response) => void;
  api.override(
    'POST /runs/deletion-eligibility',
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  await user.click(screen.getByRole('button', { name: 'Withdraw delete-ready mark' }));
  await user.click(await screen.findByRole('button', { name: 'Confirm withdrawal' }));
  await waitFor(() => expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(2));
  act(() => useApiKeyStore.getState().save('gg_A'));
  await act(async () => {
    answer(problem(409, 'DELETION_CONFLICT', 'Run run-secret changed.'));
    await Promise.resolve();
  });
  expect(await screen.findByText(requestedBeforeKey('Confirm withdrawal'))).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('run-secret');
  expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(2);
});

it('does not send a confirmation whose key changed before dispatch under a gate that stayed open (#562)', async () => {
  useApiKeyStore.getState().save('gg_A');
  const api = fakeConsent(),
    user = userEvent.setup();
  const run = api.addRun({ status: 'succeeded' });
  // A gate whose own check ignores credentials: only the write's dispatch check can refuse it.
  const gate: WriteGate = {
    blocked: undefined,
    credential: currentCredential(),
    open: () => true,
    shown: () => true,
  };
  function Static() {
    const [visit] = useState(() => ({}));
    const confirmation = useHistoryConfirmation({ owner: visit, availability: gate });
    return <HistoryEligibilityControls runIds={[run.id]} confirmation={confirmation} />;
  }
  renderWith(<Static />, '/', api);
  await user.click(screen.getByRole('button', { name: 'Review delete-ready history' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm delete-ready selection' });
  await waitFor(() => expect(confirm).toBeEnabled());
  useApiKeyStore.getState().save('gg_B');
  await user.click(confirm);
  expect(
    await screen.findByText(notSentByKey('Confirm delete-ready selection')),
  ).toBeInTheDocument();
  expect(posts(api, '/runs/deletion-eligibility')).toHaveLength(0);
});
