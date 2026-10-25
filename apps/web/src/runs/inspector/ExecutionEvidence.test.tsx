import { LoopDefinitionSchema, type RunEvent } from '@graphgoblin/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { minimalLoop, samplePin } from '@graphgoblin/contracts/testing';
import { describe, expect, it, vi } from 'vitest';
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
        cancellation={[event(run.id, 2, 'run.cancelled', {})]}
        definition={undefined}
        definitionLoading={loading}
      />
    );
    const { rerender } = render(view(true));
    expect(screen.getByText('Loading pinned definition…')).toBeInTheDocument();
    rerender(view(false));
    expect(screen.getByText(/Pinned definition unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Cancelled; actor not recorded/)).toBeInTheDocument();
    // History is reconstructed on the server from the run's stored initial thread (#186 round 2),
    // so a retained window says nothing about a missing seed.
    expect(screen.queryByText(/Initial thread not recorded/)).not.toBeInTheDocument();
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
        cancellation={[
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

it('downloads every number GraphGoblin records with its stored token (#255)', async () => {
  const user = userEvent.setup();
  const values = [0.12345678901234566, 5e-324, 1e-308, 0.5000000000000001, 9007199254740991];
  const recorded = event('run', 9, 'node.finished', {
    nodeId: 'n',
    durationMs: 1,
    patch: [{ op: 'add', path: '/vars/values', value: values }],
  });
  // The store holds the event as serialized from JavaScript values.
  const stored = JSON.stringify(recorded);
  let blob: Blob | undefined;
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    blob = value as Blob;
    return 'blob:recorded';
  });
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  try {
    render(<RecordedEvent event={JSON.parse(stored) as RunEvent} />);
    await user.click(screen.getByRole('button', { name: 'Exact recorded event #9' }));
    await user.click(screen.getByRole('button', { name: 'Download Exact recorded event as JSON' }));
    const tokens = (text: string) => text.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
    expect(tokens(await blob!.text())).toEqual(tokens(stored));
  } finally {
    create.mockRestore();
    revoke.mockRestore();
  }
});

it('waits for the cancellation record rather than guessing an actor (#255, #186)', () => {
  const run = runRecord({ status: 'cancelled', lastEventSeq: 3 });
  const view = (cancellation: RunEvent[] | undefined, unavailable = false) => (
    <ExecutionContext
      run={run}
      cancellation={cancellation}
      cancellationUnavailable={unavailable}
      definition={undefined}
      definitionLoading={false}
    />
  );
  const { rerender } = render(view(undefined));
  expect(screen.getByText(/Reading the cancellation record/)).toBeInTheDocument();
  expect(screen.queryByText(/actor not recorded/)).not.toBeInTheDocument();
  rerender(view(undefined, true));
  expect(screen.getByText(/cancellation record could not be read/)).toBeInTheDocument();
  rerender(
    view([
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
      cancellation={[
        event(run.id, 1, 'run.cancel_requested', { actor: { kind: 'user', id: 'local' } }),
      ]}
      definition={undefined}
      definitionLoading={false}
    />,
  );
  expect(screen.getByText(/terminal cancellation event not recorded/)).toBeInTheDocument();
  expect(screen.queryByText(/actor not recorded/)).not.toBeInTheDocument();
});
