import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { event, FakeApi } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { errorMessage } from '../../lib/utils.js';
import { NOT_SENT, OPEN_GATE, type WriteGate } from './RunControls.js';
import { SessionRecoveryControls, useSessionRecovery } from './SessionRecoveryControls.js';

const CHANGED = 'Not sent: the failure shown has changed. Review the run again.';

/** A run failed at `worker` with a missing provider session, and its recorded failure event. */
function failedRun(api: FakeApi, seq = 7) {
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
  const failed = event(run.id, seq, 'run.failed', { failure: run.failure });
  return { run, failed };
}

function fixture() {
  const api = new FakeApi();
  return { api, ...failedRun(api) };
}

/**
 * The inspector's arrangement: the view owns the choice for the visit `owner`, and the run section
 * presents it only while `presented`. Without an owner, one visit lasts as long as this element.
 */
function Inspector({
  run,
  events,
  availability = OPEN_GATE,
  owner,
  presented = true,
}: {
  run: RunRecord;
  events: readonly RunEvent[];
  availability?: WriteGate;
  owner?: object;
  presented?: boolean;
}) {
  const [visit] = useState<object>(() => ({}));
  const recovery = useSessionRecovery({
    owner: owner ?? visit,
    run: presented ? run : undefined,
    events,
    availability,
  });
  return presented ? (
    <SessionRecoveryControls run={run} events={events} recovery={recovery} />
  ) : null;
}

describe('missing-session recovery control', () => {
  it('explains context loss and retained settings; leaving it alone sends no choice', () => {
    const { api, run, failed } = fixture();
    renderWith(<Inspector run={run} events={[failed]} />, '/', api);
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
    renderWith(<Inspector run={run} events={[failed]} />, '/', api);
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
    const { queryClient } = renderWith(<Inspector run={run} events={[failed]} />, '/', api);
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
    const view = renderWith(<Inspector run={run} events={[]} />, '/', api);
    expect(screen.getByRole('button', { name: 'Start fresh session for worker' })).toBeDisabled();
    view.unmount();
    run.failure!.missingSession!.visitId = 'another-run:2';
    const child = renderWith(<Inspector run={run} events={[]} />, '/', api);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    child.unmount();
    run.failure = { code: 'INTERNAL_ERROR', message: 'unrelated', resumable: true };
    renderWith(<Inspector run={run} events={[]} />, '/', api);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('answers only the recorded failure of the current node and visit (#416)', () => {
    const { api, run, failed } = fixture();
    const otherVisit = event(run.id, 9, 'run.failed', {
      failure: {
        ...run.failure!,
        missingSession: { ...run.failure!.missingSession!, visitId: run.id + ':1' },
      },
    });
    const otherRun = { ...failed, runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' };
    const view = renderWith(<Inspector run={run} events={[otherVisit, otherRun]} />, '/', api);
    expect(screen.getByRole('button', { name: 'Start fresh session for worker' })).toBeDisabled();
    view.unmount();
    renderWith(<Inspector run={run} events={[failed, otherVisit]} />, '/', api);
    expect(screen.getByRole('button', { name: 'Start fresh session for worker' })).toBeEnabled();
  });

  it('sends nothing while its gate is blocked and shows why (#416)', async () => {
    const { api, run, failed } = fixture();
    const blocked: WriteGate = {
      blocked: 'Reading the run evidence again.',
      open: () => false,
      shown: () => true,
    };
    renderWith(<Inspector run={run} events={[failed]} availability={blocked} />, '/', api);
    const button = screen.getByRole('button', { name: 'Start fresh session for worker' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Reading the run evidence again.')).toBeInTheDocument();
    await userEvent.setup().click(button);
    expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)).toHaveLength(0);
  });

  it.each(['the gate expired', 'the failure changed'] as const)(
    'does not send a queued choice when %s before dispatch (#416)',
    async (change) => {
      const { api, run, failed } = fixture();
      let open = true;
      const gate: WriteGate = { blocked: undefined, open: () => open, shown: () => true };
      const later = event(run.id, 12, 'run.failed', { failure: run.failure! });
      function Harness() {
        const [events, setEvents] = useState([failed]);
        return (
          <>
            <button type="button" onClick={() => setEvents([later])}>
              Newer failure
            </button>
            <Inspector run={run} events={events} availability={gate} />
          </>
        );
      }
      const view = renderWith(<Harness />, '/', api);
      let release!: () => void;
      let queued = false;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      // The client's mutation cache delays every mutation before its API call. Unlike default
      // options set after the control mounted, the cache's own callback is read at dispatch.
      view.queryClient.getMutationCache().config.onMutate = () => {
        queued = true;
        return held;
      };
      try {
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Start fresh session for worker' }));
        await waitFor(() => expect(queued).toBe(true));
        if (change === 'the gate expired') open = false;
        else await user.click(screen.getByRole('button', { name: 'Newer failure' }));
        release();
        expect(
          await screen.findByText(
            change === 'the gate expired'
              ? NOT_SENT
              : 'Not sent: the failure shown has changed. Review the run again.',
          ),
        ).toBeInTheDocument();
        expect(api.callsTo('POST', `/runs/${run.id}/recover-session`)).toHaveLength(0);
      } finally {
        release();
      }
    },
  );

  it('keeps a choice queued before its section was withheld pending in the section shown again, then reports it (#416)', async () => {
    const { api, run, failed } = fixture();
    let open = true;
    const gate: WriteGate = { blocked: undefined, open: () => open, shown: () => true };
    function Harness() {
      const [presented, setPresented] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setPresented((value) => !value)}>
            Withhold or show the section
          </button>
          <Inspector run={run} events={[failed]} availability={gate} presented={presented} />
        </>
      );
    }
    const view = renderWith(<Harness />, '/', api);
    const start = () => screen.getByRole('button', { name: 'Start fresh session for worker' });
    const toggle = () => screen.getByRole('button', { name: 'Withhold or show the section' });
    const recoveries = () => api.callsTo('POST', `/runs/${run.id}/recover-session`);
    let release!: () => void;
    let queued = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    view.queryClient.getMutationCache().config.onMutate = () => {
      queued = true;
      return held;
    };
    try {
      const user = userEvent.setup();
      const original = start();
      await user.click(original);
      await waitFor(() => expect(queued).toBe(true));

      // The section is withheld, and the gate the choice was queued under is spent meanwhile.
      await user.click(toggle());
      expect(original).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Start fresh session for worker' }),
      ).not.toBeInTheDocument();
      open = false;

      // The section shown again has a new control, disabled only while the choice is pending.
      await user.click(toggle());
      const replacement = start();
      expect(replacement).not.toBe(original);
      expect(replacement).toBeDisabled();
      expect(screen.queryByText(NOT_SENT)).not.toBeInTheDocument();
      expect(recoveries()).toHaveLength(0);

      release();
      expect(await screen.findByText(NOT_SENT)).toBeInTheDocument();
      expect(recoveries()).toHaveLength(0);

      // A new explicit choice under an open gate replaces that report and sends once.
      open = true;
      api.override('POST /runs/:id/recover-session', () =>
        Response.json({ ...run, status: 'running' }),
      );
      await waitFor(() => expect(start()).toBeEnabled());
      await user.click(start());
      await waitFor(() => expect(recoveries()).toHaveLength(1));
      expect(recoveries()[0]!.body).toEqual({ nodeId: 'worker', failureSeq: 7 });
      await waitFor(() => expect(screen.queryByText(NOT_SENT)).not.toBeInTheDocument());
    } finally {
      release();
    }
  });

  it('shows another run neither the pending state nor the late outcome of a choice made for an earlier one (#416)', async () => {
    const { api, run: first, failed: firstFailed } = fixture();
    const { run: second, failed: secondFailed } = failedRun(api, 9);
    // One view, as the inspector stays mounted across a route change: a new visit of another run.
    function Harness() {
      const [visit, setVisit] = useState<{
        owner: object;
        run: RunRecord;
        events: readonly RunEvent[];
      }>({ owner: {}, run: first, events: [firstFailed] });
      return (
        <>
          <button
            type="button"
            onClick={() => setVisit({ owner: {}, run: second, events: [secondFailed] })}
          >
            Open another run
          </button>
          <Inspector run={visit.run} events={visit.events} owner={visit.owner} />
        </>
      );
    }
    const view = renderWith(<Harness />, '/', api);
    const start = () => screen.getByRole('button', { name: 'Start fresh session for worker' });
    const recoveries = (runId: string) => api.callsTo('POST', `/runs/${runId}/recover-session`);
    const outcomes = () =>
      view.queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) =>
          mutation.state.status === 'error'
            ? errorMessage(mutation.state.error)
            : mutation.state.status,
        );
    let release!: () => void;
    let queued = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    view.queryClient.getMutationCache().config.onMutate = () => {
      queued = true;
      return held;
    };
    try {
      const user = userEvent.setup();
      await user.click(start());
      await waitFor(() => expect(queued).toBe(true));
      expect(start()).toBeDisabled();

      await user.click(screen.getByRole('button', { name: 'Open another run' }));
      // The other run's own failure: the earlier choice does not hold its control.
      expect(start()).toBeEnabled();

      // The earlier choice settles while the other run is shown. It is refused, since the
      // failure it answered is no longer the one shown, and that refusal is not reported here.
      release();
      await waitFor(() => expect(outcomes()).toEqual([CHANGED]));
      expect(screen.queryByText(CHANGED)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Not sent: /)).not.toBeInTheDocument();
      expect(start()).toBeEnabled();
      expect(recoveries(first.id)).toHaveLength(0);

      // The other run's own choice sends once, with its own failure sequence.
      api.override('POST /runs/:id/recover-session', () =>
        Response.json({ ...second, status: 'running' }),
      );
      await user.click(start());
      await waitFor(() => expect(recoveries(second.id)).toHaveLength(1));
      expect(recoveries(second.id)[0]!.body).toEqual({ nodeId: 'worker', failureSeq: 9 });
      expect(recoveries(first.id)).toHaveLength(0);
    } finally {
      release();
    }
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
    renderWith(<Inspector run={{ ...run, status: 'succeeded' }} events={[choice]} />, '/', api);
    expect(screen.getByText(/operator-key chose a fresh session for worker/)).toHaveTextContent(
      'prior provider context was not carried over (resume-own, old-handle)',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
