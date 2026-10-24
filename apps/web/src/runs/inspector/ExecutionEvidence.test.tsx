import { LoopDefinitionSchema, type RunEvent } from '@graphgoblin/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { minimalLoop, samplePin } from '@graphgoblin/contracts/testing';
import { describe, expect, it } from 'vitest';
import { event, runRecord } from '../../__fixtures__/fake-api.js';
import { ExecutionContext, RecordedEvent } from './ExecutionEvidence.js';

describe('execution evidence (#255)', () => {
  it('distinguishes loading, unavailable labels, and unrecorded cancellation actors', async () => {
    const run = runRecord({
      status: 'cancelled',
      pinned: samplePin({ name: 'Original loop', label: 'Original loop v1' }),
    });
    const view = (loading: boolean) => (
      <ExecutionContext
        run={run}
        events={[event(run.id, 2, 'run.cancelled', {})]}
        definition={undefined}
        definitionLoading={loading}
      />
    );
    const { rerender } = render(view(true));
    expect(screen.getByText('Loading pinned definition…')).toBeInTheDocument();
    rerender(view(false));
    expect(screen.getByText(/Pinned definition unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Cancelled; actor not recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Initial thread not recorded/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Exact run record' }));
    expect(JSON.parse(screen.getByLabelText('Exact run record').textContent)).toEqual(run);
  });

  it('shows the recorded actor and pinned node at cancellation, with exact definition reachable', async () => {
    const definition = LoopDefinitionSchema.parse(minimalLoop());
    const node = definition.nodes[0]!;
    const run = runRecord({ status: 'cancelled', currentNodeId: node.id });
    render(
      <ExecutionContext
        run={run}
        events={[
          event(run.id, 1, 'run.cancel_requested', { actor: { kind: 'run', id: 'child-run' } }),
          event(run.id, 2, 'run.cancelled', {}),
        ]}
        definition={definition}
        definitionLoading={false}
      />,
    );
    expect(screen.getByText(/Cancelled by run child-run/)).toHaveTextContent(
      node.label + ' (' + node.id + ')',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pinned definition JSON' }));
    expect(JSON.parse(screen.getByLabelText('Pinned definition JSON').textContent)).toEqual(
      definition,
    );
  });

  it('keeps exact probabilities and provider diagnostics reachable as the selection changes', async () => {
    const user = userEvent.setup();
    const first = event('run', 7, 'decision.made', {
      nodeId: 'pick',
      portId: 'accept',
      diagnostics: [],
      provenance: {
        kind: 'classifier',
        provider: 'typesafe',
        classifierId: 'jev',
        model: 'jev',
        effort: null,
      },
      observation: {
        kind: 'classifier',
        answer: {
          type: 'choice',
          optionId: 'accept',
          confidence: 0.8765432109876543,
          probabilities: { accept: 0.8765432109876543 },
        },
      },
    });
    const { rerender } = render(<RecordedEvent event={undefined} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<RecordedEvent event={first} />);
    expect(screen.queryByTestId('recorded-event-json')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exact recorded event #7' }));
    expect(JSON.parse(screen.getByTestId('recorded-event-json').textContent)).toEqual(first);
    const failure = event('run', 8, 'run.failed', {
      failure: {
        code: 'HARNESS_TRANSPORT_FAILED',
        message: 'Recorded provider diagnostic',
        resumable: false,
        details: { exact: 'x'.repeat(5000) },
      },
    });
    rerender(<RecordedEvent event={failure} />);
    await user.click(screen.getByRole('button', { name: 'Show all of Exact recorded event' }));
    expect(JSON.parse(screen.getByTestId('recorded-event-json').textContent)).toEqual(failure);
    expect(
      screen.getByRole('button', { name: 'Download Exact recorded event as JSON' }),
    ).toBeInTheDocument();
  });
});

it('distinguishes incomplete cancellation history from an unrecorded actor (#255)', () => {
  const run = runRecord({ status: 'cancelled', lastEventSeq: 3 });
  const partial = [event(run.id, 1, 'run.started', { attempt: 1 })];
  const view = (events: RunEvent[]) => (
    <ExecutionContext run={run} events={events} definition={undefined} definitionLoading={false} />
  );
  const { rerender } = render(view(partial));
  expect(screen.getByText(/Cancellation history is incomplete/)).toBeInTheDocument();
  expect(screen.queryByText(/actor not recorded/)).not.toBeInTheDocument();
  rerender(
    view([
      ...partial,
      event(run.id, 2, 'run.cancel_requested', { actor: { kind: 'user', id: 'local' } }),
      event(run.id, 3, 'run.cancelled', {}),
    ]),
  );
  expect(screen.getByText(/Cancelled by user local/)).toBeInTheDocument();
});
it('names the missing terminal event without denying a request that was recorded (#255)', () => {
  const run = runRecord({ status: 'cancelled', lastEventSeq: 1 });
  render(
    <ExecutionContext
      run={run}
      events={[event(run.id, 1, 'run.cancel_requested', { actor: { kind: 'user', id: 'local' } })]}
      definition={undefined}
      definitionLoading={false}
    />,
  );
  expect(screen.getByText(/terminal cancellation event not recorded/)).toBeInTheDocument();
  expect(screen.queryByText(/actor not recorded/)).not.toBeInTheDocument();
});
