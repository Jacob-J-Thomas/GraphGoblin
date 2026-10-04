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
    waiting: { nodeId: 'ask', kind: 'input', prompt: 'Why?', inputSchema: noteSchema, startedSeq },
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
