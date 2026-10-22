import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, event } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

function failedScript(
  code: 'SCRIPT_OUTCOME_UNCERTAIN' | 'SCRIPT_START_FAILED' = 'SCRIPT_OUTCOME_UNCERTAIN',
) {
  const api = new FakeApi();
  const run = api.addRun({
    status: 'failed',
    currentNodeId: 'script',
    failure: {
      code,
      message:
        code === 'SCRIPT_OUTCOME_UNCERTAIN'
          ? 'The script outcome was not recorded.'
          : 'The process could not start.',
      resumable: true,
      nodeId: 'script',
      script: {
        visitId: 'visit',
        state: code === 'SCRIPT_OUTCOME_UNCERTAIN' ? 'outcome-uncertain' : 'definitely-not-started',
      },
    },
  });
  api.pushEvent(run.id, event(run.id, 1, 'run.failed', { failure: run.failure! }));
  return { api, run };
}

describe('deliberate script recovery (#321)', () => {
  it('follows a resumed script from running through its next outcome without a reload', async () => {
    const { api, run } = failedScript();
    api.override('POST /runs/:id/resume', () => {
      const running = { ...run, status: 'running' as const, lastEventSeq: 2 };
      delete running.failure;
      api.runs.set(run.id, running);
      api.pushEvent(
        run.id,
        event(run.id, 2, 'run.resumed', { actor: { kind: 'user', id: 'owner' } }),
      );
      return new Response(JSON.stringify(running), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const user = userEvent.setup();
    renderApp(`/runs/${run.id}`, api);
    await screen.findByRole('button', { name: /run.failed/ });
    await user.click(screen.getByRole('button', { name: 'Recover script' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('button', { name: /run.resumed/ });
    api.runs.set(run.id, { ...api.runs.get(run.id)!, status: 'succeeded', lastEventSeq: 3 });
    api.pushEvent(
      run.id,
      event(run.id, 3, 'run.finished', { status: 'succeeded', outcome: 'success' }),
    );
    expect(await screen.findByText('succeeded', { exact: true })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /run.finished.*succeeded/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run.failed/ })).toBeInTheDocument();
    expect(api.callsTo('POST', `/runs/${run.id}/resume`)).toHaveLength(1);
  });
  it('offers deliberate recovery when an awaited child propagated the uncertainty code', async () => {
    const api = new FakeApi();
    const run = api.addRun({
      status: 'failed',
      currentNodeId: 'sub',
      failure: {
        code: 'SCRIPT_OUTCOME_UNCERTAIN',
        message: 'A child script outcome is uncertain.',
        nodeId: 'sub',
        resumable: true,
      },
    });
    renderApp(`/runs/${run.id}`, api);
    expect(await screen.findByRole('button', { name: 'Recover script' })).toBeInTheDocument();
    expect(api.callsTo('POST', `/runs/${run.id}/resume`)).toHaveLength(0);
  });
  it('explains uncertainty and cancelling the recovery dialog does not dispatch any work', async () => {
    const { api, run } = failedScript();
    const user = userEvent.setup();
    renderApp(`/runs/${run.id}`, api);
    expect(await screen.findByText('Failed: SCRIPT_OUTCOME_UNCERTAIN')).toBeInTheDocument();
    expect(
      within(screen.getByRole('alert')).getByText(
        /previous script attempt may already have produced its effect/,
      ),
    ).toHaveTextContent(/Resume runs the script again/);
    await user.click(screen.getByRole('button', { name: 'Recover script' }));
    const dialog = screen.getByRole('dialog', { name: 'Recover script' });
    expect(within(dialog).getByText(/Cancel leaves this run failed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.callsTo('POST', `/runs/${run.id}/resume`)).toHaveLength(0);
    expect(api.callsTo('POST', `/runs/${run.id}/replay`)).toHaveLength(0);
  });

  it('resumes only after the owner explicitly chooses Resume', async () => {
    const { api, run } = failedScript();
    const user = userEvent.setup();
    renderApp(`/runs/${run.id}`, api);
    await user.click(await screen.findByRole('button', { name: 'Recover script' }));
    expect(api.callsTo('POST', `/runs/${run.id}/resume`)).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/resume`)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('forks from the failed script only after Replay and opens the new run', async () => {
    const { api, run } = failedScript();
    const next = api.addRun({ status: 'queued' });
    api.override(
      'POST /runs/:id/replay',
      () =>
        new Response(JSON.stringify({ run: next }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const user = userEvent.setup();
    renderApp(`/runs/${run.id}`, api);
    await user.click(await screen.findByRole('button', { name: 'Recover script' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/replay`)).toHaveLength(1));
    expect(api.callsTo('POST', `/runs/${run.id}/replay`)[0]!.body).toEqual({ nodeId: 'script' });
    expect(await screen.findByText(next.id)).toBeInTheDocument();
  });

  it('distinguishes a proven start failure and retains a failed recovery request for a deliberate retry', async () => {
    const { api, run } = failedScript('SCRIPT_START_FAILED');
    api.override(
      'POST /runs/:id/resume',
      () =>
        new Response(
          JSON.stringify({
            type: 'https://graphgoblin.dev/problems/invalid-state',
            title: 'Resume refused',
            status: 409,
            code: 'INVALID_STATE',
            detail: 'Resume refused',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
    );
    const user = userEvent.setup();
    renderApp(`/runs/${run.id}`, api);
    expect(
      await screen.findByText('The script process did not start. Resume tries to start it again.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recover script' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume' }));
    expect(await screen.findByText(/Resume refused/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
