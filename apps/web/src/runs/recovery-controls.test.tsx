import { act, fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import type { RunRecord, RunRecovery } from '@graphgoblin/contracts';
import { RecoveryCommandSchema } from '@graphgoblin/contracts';
function fixture() {
  const api = new FakeApi();
  const run = api.addRun({ status: 'failed' });
  const recovery: RunRecovery = {
    observedSeq: 7,
    resume: { allowed: true },
    replayDefault: {
      allowed: false,
      code: 'REPLAY_NODE_NOT_REACHED',
      message: 'Server says this node was not reached.',
    },
    replay: [
      { nodeId: 'done', label: 'Done', action: { allowed: true } },
      {
        nodeId: 'missing',
        label: 'Missing',
        action: {
          allowed: false,
          code: 'REPLAY_NODE_NOT_REACHED',
          message: 'Server says this node was not reached.',
        },
      },
    ],
  };
  api.recovery.set(run.id, recovery);
  return { api, run, recovery };
}
describe('server-owned recovery controls (#256)', () => {
  it('renders the server refusal and links its exact owning parent accessibly', async () => {
    const { api, run, recovery } = fixture();
    const parent = api.addRun({ status: 'failed' });
    recovery.resume = {
      allowed: false,
      code: 'PARENT_RECOVERY_REQUIRED',
      message: `Recover the exact parent ${parent.id}.`,
      parentRunId: parent.id,
    };
    renderApp(`/runs/${run.id}`, api);
    const resume = await screen.findByRole('button', { name: 'Resume' });
    expect(resume).toBeDisabled();
    expect(resume).toHaveAccessibleDescription(expect.stringContaining(parent.id));
    expect(screen.getByRole('link', { name: `Open parent ${parent.id}` })).toHaveAttribute(
      'href',
      `/runs/${parent.id}`,
    );
    expect(api.callsTo('POST', `/runs/${run.id}/resume`)).toHaveLength(0);
  });
  it('Resume sends the reviewed sequence and stays on the existing run', async () => {
    const { api, run } = fixture();
    const user = userEvent.setup();
    renderApp(`/runs/${run.id}`, api);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/resume`)).toHaveLength(1));
    expect(api.callsTo('POST', `/runs/${run.id}/resume`)[0]!.body).toEqual({ observedSeq: 7 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(run.id);
  });
  it('keeps the second click in one intent even when a new eligible failure has already rendered', async () => {
    const { api, run, recovery } = fixture();
    const user = userEvent.setup();
    let currentSeq = recovery.observedSeq;
    let accepted = 0;
    api.override('POST /runs/:id/resume', (call) => {
      const command = RecoveryCommandSchema.parse(call.body);
      if (command.observedSeq !== currentSeq)
        return problem(409, 'RECOVERY_STALE', 'The run changed since it was shown.');
      accepted++;
      currentSeq++;
      const failedAgain: RunRecord = {
        ...run,
        status: 'failed',
        lastEventSeq: currentSeq,
        failure: {
          code: 'HARNESS_QUOTA_EXHAUSTED',
          message: 'Failure after first continuation',
          resumable: true,
        },
      };
      api.runs.set(run.id, failedAgain);
      api.recovery.set(run.id, { ...recovery, observedSeq: currentSeq });
      return new Response(JSON.stringify(failedAgain), {
        headers: { 'content-type': 'application/json' },
      });
    });
    renderApp(`/runs/${run.id}`, api);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await screen.findByText(/Failure after first continuation/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled());
    // DOM click count 2 is still the original pointer intent, rather than a new review of this failure.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }), { detail: 2 });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled());
    expect(accepted).toBe(1);
    expect(currentSeq).toBe(8);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(run.id);
    screen.getByRole('button', { name: 'Resume' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(accepted).toBe(2));
  });
  it('Replay explains unavailable selections, cancels without work and freezes its reviewed sequence', async () => {
    const { api, run, recovery } = fixture();
    const user = userEvent.setup();
    api.override('POST /runs/:id/replay', () =>
      problem(409, 'RECOVERY_STALE', 'The run changed since it was shown.'),
    );
    renderApp(`/runs/${run.id}`, api);
    await user.click(await screen.findByRole('button', { name: 'Replay...' }));
    let dialog = screen.getByRole('dialog', { name: 'Replay as a new run' });
    await user.selectOptions(within(dialog).getByLabelText('Replay from node'), 'missing');
    expect(within(dialog).getByRole('button', { name: 'Create replay run' })).toBeDisabled();
    expect(within(dialog).getByText('Server says this node was not reached.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.callsTo('POST', `/runs/${run.id}/replay`)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Replay...' }));
    dialog = screen.getByRole('dialog', { name: 'Replay as a new run' });
    api.recovery.set(run.id, { ...recovery, observedSeq: 8 });
    await user.click(within(dialog).getByRole('button', { name: 'Create replay run' }));
    await waitFor(() => expect(api.callsTo('POST', `/runs/${run.id}/replay`)).toHaveLength(1));
    expect(api.callsTo('POST', `/runs/${run.id}/replay`)[0]!.body).toEqual({
      nodeId: 'done',
      observedSeq: 7,
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'changed since it was shown',
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
