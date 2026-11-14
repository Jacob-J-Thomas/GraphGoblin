import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

it('appears and changes only once a pointer press has delivered its click or ended (#273 A2)', async () => {
  const definition = newLoopDefinition('notice');
  definition.variables = { key: { type: 'string' } };
  definition.nodes.push(reader('a'));
  store().load('L1', definition);
  render(
    <>
      <Notice onChoose={vi.fn()} />
      <button type="button">Add</button>
    </>,
  );
  const add = screen.getByRole('button', { name: 'Add' });
  const atClick: boolean[] = [];
  add.addEventListener('click', () => atClick.push(screen.queryByRole('status') !== null));

  // A rename while the primary button is down shows nothing through the release, until the click
  // it produces has reached the button.
  fireEvent.pointerDown(add, { button: 0 });
  fireEvent.mouseDown(add, { button: 0 });
  act(() => void store().renameNode('start', 'begin'));
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.pointerUp(add, { button: 0 });
  fireEvent.mouseUp(add, { button: 0 });
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(add);
  expect(atClick).toEqual([false]);
  expect(screen.getByRole('status')).toHaveTextContent('Renamed start to begin');
  expect(
    screen.getByRole('button', { name: /node a config\.operations\.0\.content/ }),
  ).toBeVisible();

  // A later rename under a press keeps the shown notice exactly, rows included, until it ends;
  // a press the browser cancels ends at once, as no click follows it.
  fireEvent.pointerDown(document.body, { button: 0 });
  act(() => void store().renameNode('a', 'alpha'));
  expect(screen.getByRole('status')).toHaveTextContent('Renamed start to begin');
  expect(screen.getByRole('status')).not.toHaveTextContent('changed after the rename');
  fireEvent.pointerCancel(document.body);
  expect(screen.getByRole('status')).toHaveTextContent('Renamed a to alpha');
  expect(
    screen.getByRole('button', { name: /node alpha config\.operations\.0\.content/ }),
  ).toBeVisible();

  // A release that no click follows shows the change at the next task.
  fireEvent.pointerDown(document.body, { button: 0 });
  act(() => void store().renameNode('alpha', 'a'));
  fireEvent.pointerUp(document.body, { button: 0 });
  expect(screen.getByRole('status')).toHaveTextContent('Renamed a to alpha');
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(screen.getByRole('status')).toHaveTextContent('Renamed alpha to a');

  // A secondary button is no press that a click could follow; dismissal is immediate.
  fireEvent.pointerDown(document.body, { button: 2 });
  act(() => store().dismissRenameReport());
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.pointerUp(document.body, { button: 2 });
});
