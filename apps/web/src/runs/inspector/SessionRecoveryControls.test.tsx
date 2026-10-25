import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { event, FakeApi } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { SessionRecoveryControls } from './SessionRecoveryControls.js';

function fixture() {
  const api = new FakeApi();
  const run = api.addRun({ status: 'failed', currentNodeId: 'worker' });
  run.failure = {
    code: 'HARNESS_SESSION_MISSING',
    message: 'The provider session old-handle from resume-own is missing.',
    nodeId: 'worker',
    resumable: false,
    missingSession: {
      visitId: run.id + ':2',
      harness: 'codex',
      sessionId: 'old-handle',
      origin: 'resume-own',
      model: 'gpt-6-luna',
      effort: 'low',
    },
  };
  const failed = event(run.id, 7, 'run.failed', { failure: run.failure });
  return { api, run, failed };
}

describe('missing-session recovery control', () => {
  it('explains context loss and retained settings; leaving it alone sends no choice', () => {
    const { api, run, failed } = fixture();
    renderWith(<SessionRecoveryControls run={run} events={[failed]} />, '/', api);
    expect(
      screen.getByText(/prior provider conversation will not be carried over/),
    ).toHaveTextContent('model gpt-6-luna and effort low stay the same');
    expect(screen.getByRole('button', { name: 'Start fresh session for worker' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Resume$/ })).not.toBeInTheDocument();
    expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)).toHaveLength(0);
  });

  it('sends the observed failure and disables submission in flight, then shows a refusal', async () => {
    const { api, run, failed } = fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.override('POST /runs/:id/recover-session', async () => {
      await held;
      return Response.json(
        { code: 'INVALID_STATE', status: 409, detail: 'Failure changed; reload the run.' },
        { status: 409 },
      );
    });
    renderWith(<SessionRecoveryControls run={run} events={[failed]} />, '/', api);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Start fresh session for worker' });
    button.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(button).toBeDisabled());
    expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)).toMatchObject([
      { body: { nodeId: 'worker', failureSeq: 7 } },
    ]);
    release();
    expect(await screen.findByText(/Failure changed; reload the run\./)).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('refreshes run and thread after a successful choice', async () => {
    const { api, run, failed } = fixture();
    api.override('POST /runs/:id/recover-session', () =>
      Response.json({ ...run, status: 'running' }),
    );
    const { queryClient } = renderWith(
      <SessionRecoveryControls run={run} events={[failed]} />,
      '/',
      api,
    );
    const { keys } = await import('../../api/queries.js');
    queryClient.setQueryData(keys.run(run.id), run);
    queryClient.setQueryData(keys.thread(run.id), {});
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Start fresh session for worker' }));
    await waitFor(() =>
      expect(queryClient.getQueryState(keys.run(run.id))?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(keys.thread(run.id))?.isInvalidated).toBe(true);
  });

  it('waits for the observed failure event and hides the choice for other failures or child provenance', () => {
    const { api, run } = fixture();
    const view = renderWith(<SessionRecoveryControls run={run} events={[]} />, '/', api);
    expect(screen.getByRole('button', { name: 'Start fresh session for worker' })).toBeDisabled();
    view.unmount();
    run.failure!.missingSession!.visitId = 'another-run:2';
    const child = renderWith(<SessionRecoveryControls run={run} events={[]} />, '/', api);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    child.unmount();
    run.failure = { code: 'INTERNAL_ERROR', message: 'unrelated', resumable: true };
    renderWith(<SessionRecoveryControls run={run} events={[]} />, '/', api);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the durable actor, node and lost-context decision after completion', () => {
    const { api, run } = fixture();
    const choice = event(run.id, 8, 'run.resumed', {
      actor: { kind: 'api-key', id: 'operator-key' },
      freshSession: {
        ...run.failure!.missingSession!,
        nodeId: 'worker',
        failureSeq: 7,
        priorContextCarried: false,
      },
    });
    renderWith(
      <SessionRecoveryControls run={{ ...run, status: 'succeeded' }} events={[choice]} />,
      '/',
      api,
    );
    expect(screen.getByText(/operator-key chose a fresh session for worker/)).toHaveTextContent(
      'prior provider context was not carried over (resume-own, old-handle)',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
