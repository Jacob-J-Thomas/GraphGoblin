import type { RunRecord } from '@graphgoblin/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { FakeApi, runRecord } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { Button } from '../../components/ui/index.js';
import { WaitPanel } from './WaitPanel.js';

const noteSchema = { type: 'object', properties: { note: { type: 'string' } } };

const waiting = (startedSeq: number, lastEventSeq = 5): RunRecord =>
  runRecord({
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    status: 'waiting',
    lastEventSeq,
    waiting: {
      waitId: String(startedSeq),
      nodeId: 'ask',
      kind: 'input',
      prompt: 'Why?',
      inputSchema: noteSchema,
      startedSeq,
    },
  });

/** The run as the inspector refetches it: the same wait again, then the next wait. */
function Harness({ runs }: { runs: RunRecord[] }) {
  const [index, setIndex] = useState(0);
  return (
    <>
      <Button onClick={() => setIndex(index + 1)}>Refetch</Button>
      <WaitPanel run={runs[index]!} />
    </>
  );
}

describe('WaitPanel', () => {
  it('keeps the form for the same wait, and starts a fresh one for the next wait', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    renderWith(<Harness runs={[waiting(3), waiting(3, 6), waiting(9, 7)]} />, '/', api);
    await user.type(screen.getByLabelText('note'), 'typed for the first wait');

    // A refetch of the same wait (a newer snapshot) keeps what was typed.
    await user.click(screen.getByRole('button', { name: 'Refetch' }));
    expect(screen.getByLabelText('note')).toHaveValue('typed for the first wait');

    // The next wait at the same node (another visit, another schema perhaps): it starts empty.
    await user.click(screen.getByRole('button', { name: 'Refetch' }));
    await waitFor(() => expect(screen.getByLabelText('note')).toHaveValue(''));
  });
});

it('submits the identity associated with the displayed input form', async () => {
  const user = userEvent.setup();
  const api = new FakeApi();
  const run = waiting(3);
  renderWith(<WaitPanel run={run} />, '/', api);
  await user.type(screen.getByLabelText('note'), 'answer');
  await user.click(screen.getByRole('button', { name: 'Submit input' }));
  await waitFor(() => expect(api.callsTo('POST', '/runs/' + run.id + '/input')).toHaveLength(1));
  expect(api.callsTo('POST', '/runs/' + run.id + '/input')[0]!.body).toEqual({
    waitId: '3',
    input: { note: 'answer' },
  });
});

it('binds the displayed identity before an asynchronous mutation can see a newer wait', async () => {
  const user = userEvent.setup();
  const api = new FakeApi();
  const view = renderWith(<Harness runs={[waiting(3), waiting(3), waiting(9)]} />, '/', api);
  let release!: () => void;
  let submitted = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  view.queryClient.setDefaultOptions({
    mutations: {
      retry: false,
      onMutate: () => {
        submitted = true;
        return gate;
      },
    },
  });
  // Apply the public client's configured mutation delay while still showing visit A.
  await user.click(screen.getByRole('button', { name: 'Refetch' }));
  await user.type(screen.getByLabelText('note'), 'answer for A');
  await user.click(screen.getByRole('button', { name: 'Submit input' }));
  await waitFor(() => expect(submitted).toBe(true));
  await user.click(screen.getByRole('button', { name: 'Refetch' }));
  expect(screen.getByLabelText('note')).toHaveValue('');
  expect(api.callsTo('POST', '/runs/' + waiting(3).id + '/input')).toHaveLength(0);
  release();
  await waitFor(() =>
    expect(api.callsTo('POST', '/runs/' + waiting(3).id + '/input')).toHaveLength(1),
  );
  expect(api.callsTo('POST', '/runs/' + waiting(3).id + '/input')[0]!.body).toEqual({
    waitId: '3',
    input: { note: 'answer for A' },
  });
});

it('bounds a long prompt and offers the whole text (#259)', async () => {
  const user = userEvent.setup();
  const prompt = 'p'.repeat(10_000);
  const run = runRecord({
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    status: 'waiting',
    lastEventSeq: 5,
    waiting: {
      waitId: '3',
      nodeId: 'ask',
      kind: 'input',
      prompt,
      inputSchema: noteSchema,
      startedSeq: 3,
    },
  });
  renderWith(<WaitPanel run={run} />, '/', new FakeApi());
  const shown = screen.getByLabelText('Prompt');
  expect(shown.textContent).toBe(`${prompt.slice(0, 4_096)}…`);
  expect(shown).toHaveClass('wrap-anywhere', 'min-w-0');
  expect(screen.getByText('Showing the first 4,096 of 10,000 characters.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show all of Prompt' }));
  expect(screen.getByRole('region', { name: 'Prompt' }).textContent).toBe(prompt);
});
