import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { newLoopDefinition } from './model.js';
import { RenameNotice } from './RenameNotice.js';
import { useEditorStore } from './store.js';

const store = () => useEditorStore.getState();

/** The notice over the live draft, as the editor page shows it. */
function Notice({ onChoose }: { onChoose: Parameters<typeof RenameNotice>[0]['onChoose'] }) {
  const definition = useEditorStore((s) => s.definition);
  return definition ? <RenameNotice definition={definition} onChoose={onChoose} /> : null;
}

/** A Mutate node whose one note reads a computed output key, which every rename lists. */
function reader(id: string) {
  return {
    id,
    kind: 'mutate' as const,
    label: id,
    config: {
      operations: [{ op: 'append-message' as const, content: '{{ outputs[vars.key] }}' }],
    },
  };
}

it('opens only places whose node is as the rename left it, and names the nodes changed since', async () => {
  const definition = newLoopDefinition('notice');
  definition.variables = { key: { type: 'string' } };
  definition.nodes.push(...['a', 'b', 'c', 'd', 'e'].map(reader));
  store().load('L1', definition);
  expect(store().renameNode('start', 'begin')).toBeUndefined();
  expect(store().renameReport!.warnings.map((issue) => issue.nodeId)).toEqual([
    'a',
    'b',
    'c',
    'd',
    'e',
  ]);
  // Edit three readers, delete one, leave one as the rename left it.
  for (const id of ['a', 'b', 'c'])
    store().updateNode(id, {
      config: { operations: [{ op: 'append-message', content: `Edited ${id}` }] },
    });
  store().removeNode('d');

  const onChoose = vi.fn();
  render(<Notice onChoose={onChoose} />);
  const notice = screen.getByRole('status');
  expect(notice).toHaveTextContent('Review 5 places where start may remain:');
  expect(within(notice).getAllByRole('button', { name: /config\.operations/ })).toHaveLength(1);
  expect(notice).toHaveTextContent(
    'a, b and c changed after the rename. Their places show where they were then and no longer open a field.',
  );
  expect(notice).not.toHaveTextContent(/\bd changed/);
  await userEvent
    .setup()
    .click(within(notice).getByRole('button', { name: /node e config\.operations\.0\.content/ }));
  expect(onChoose).toHaveBeenCalledWith(
    expect.objectContaining({ nodeId: 'e', path: 'config.operations.0.content' }),
  );

  // Undoing the edits restores the configs the rename left, so their places open again.
  act(() => {
    for (let step = 0; step < 4; step += 1) store().undo();
  });
  expect(store().renameReport).toBeDefined();
  expect(screen.getAllByRole('button', { name: /config\.operations/ })).toHaveLength(5);
  expect(screen.getByRole('status')).not.toHaveTextContent('changed after the rename');
});
