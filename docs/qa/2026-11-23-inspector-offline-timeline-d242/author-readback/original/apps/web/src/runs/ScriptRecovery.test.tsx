import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { FakeApi, event } from '../__fixtures__/fake-api.js';
import { renderApp, renderWith } from '../__fixtures__/render.js';
import { createAppClient } from '../api/context.js';
import type { WriteGate } from './inspector/RunControls.js';
import { ScriptRecovery, useScriptRetry } from './inspector/ScriptRecovery.js';

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

/**
 * The inspector's arrangement for one visit of one run (#416): the view owns the retry, an outage
 * replaces its gate, and the run section presenting the control can be withheld.
 */
function Inspector({ run }: { run: RunSnapshot }) {
  const [state, setState] = useState(() => gateFor(undefined));
  const [presented, setPresented] = useState(true);
  const [visit] = useState(() => ({}));
  const retry = useScriptRetry({ owner: visit, availability: state.gate });
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
      {presented ? <ScriptRecovery run={run} retry={retry} /> : null}
    </>
  );
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
    expect(api.callsTo('POST', `/runs/${run.id}/replay`)[0]!.body).toEqual({
      nodeId: 'script',
      observedSeq: 1,
      retryUncertainScript: true,
    });
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
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByText(/Resume refused/)).toBeInTheDocument();
  });

  it.each(['fails in transport', 'succeeds'] as const)(
    'keeps a retry sent before its section was withheld the only one in the section shown again, and reports it when it %s (#416)',
    async (settle) => {
      const { api, run } = failedScript();
      let answer!: (response: Response) => void;
      let fail!: (error: Error) => void;
      api.override(
        'POST /runs/:id/resume',
        () =>
          new Promise<Response>((resolve, reject) => {
            answer = resolve;
            fail = reject;
          }),
      );
      // The run as the inspector shows it, read once through the real client.
      const client = createAppClient('http://graphgoblin.test', api.fetch);
      const snapshot = await runs.get(client, run.id);
      renderWith(<Inspector run={snapshot} />, '/', api);
      const user = userEvent.setup();
      const recover = () => screen.getByRole('button', { name: 'Recover script' });
      const toggle = () => screen.getByRole('button', { name: 'Withhold or show the run' });
      const resume = async () => {
        const dialog = screen.getByRole('dialog', { name: 'Recover script' });
        await user.click(within(dialog).getByRole('button', { name: 'Resume' }));
      };
      const resumes = () => api.callsTo('POST', `/runs/${run.id}/resume`);
      await user.click(recover());
      await resume();
      await waitFor(() => expect(resumes()).toHaveLength(1));
      expect(resumes()[0]!.body).toEqual({ observedSeq: 1, retryUncertainScript: true });
      const original = recover();
      expect(original).toBeDisabled();
      // An outage expires the review, and the run section presenting the control is withheld.
      await user.click(screen.getByRole('button', { name: 'Lose connection' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await user.click(toggle());
      expect(original).not.toBeInTheDocument();
      // The run is read again under a new gate and shown again with a new control, which the
      // retry sent before, still unresolved, alone keeps disabled.
      await user.click(screen.getByRole('button', { name: 'Read again' }));
      await user.click(toggle());
      const replacement = recover();
      expect(replacement).not.toBe(original);
      expect(replacement).toBeDisabled();
      await user.click(replacement);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(resumes()).toHaveLength(1);
      await act(async () => {
        if (settle === 'succeeds') answer(Response.json({ ...snapshot, status: 'running' }));
        else fail(new TypeError('Failed to fetch'));
        await Promise.resolve();
      });
      if (settle === 'fails in transport')
        expect(await screen.findByRole('alert')).toHaveTextContent(
          /^The GraphGoblin API cannot be reached\.$/,
        );
      // Only once it has settled may a new review open, and a new explicit choice send again.
      await waitFor(() => expect(recover()).toBeEnabled());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      if (settle === 'succeeds') expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(resumes()).toHaveLength(1);
      api.override('POST /runs/:id/resume', (call) => api.builtIn(call));
      await user.click(recover());
      await resume();
      await waitFor(() => expect(resumes()).toHaveLength(2));
      expect(resumes()[1]!.body).toEqual({ observedSeq: 1, retryUncertainScript: true });
    },
  );
});
