import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

const UNDO = '{Control>}z{/Control}';
const REDO = '{Control>}{Shift>}z{/Shift}{/Control}';
const store = () => useEditorStore.getState();

/** A loop with one more node, `extra`, unconnected. */
function loopWith(extra: NodeInput): LoopDefinitionInput {
  const definition = newLoopDefinition('dialog');
  return { ...definition, nodes: [...definition.nodes, extra] };
}

async function openDialog(extra: NodeInput, name: string) {
  const api = new FakeApi();
  api.catalog = [
    {
      harness: 'codex',
      model: 'alpha',
      source: 'harness',
      displayName: 'Alpha',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      enabled: true,
    },
  ];
  const loop = api.addLoop(loopWith(extra));
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'dialog' });
  act(() => store().openNode(extra.id));
  const dialog = await screen.findByRole('dialog', { name });
  await within(dialog).findByRole('form', { name: `${extra.id} config` });
  return dialog;
}

const advanced = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: /^Advanced\b/ });

describe('NodeEditorDialog disclosures across undo and redo', () => {
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it('keeps Advanced open through an undo and a redo of a basic picker, with focus restored', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      { id: 'infer', kind: 'inference', label: 'Infer', config: { prompt: { template: 'hi' } } },
      'Edit inference infer',
    );
    await user.click(advanced(dialog));
    expect(advanced(dialog)).toHaveAttribute('aria-expanded', 'true');
    const model = () => within(dialog).getByLabelText('Model', { exact: true });
    await waitFor(() => expect(model()).not.toHaveAttribute('aria-readonly'));
    await user.selectOptions(model(), 'alpha');
    expect(model()).toHaveFocus();

    // The select has no text to undo, so the keys undo the editor; the form remounts.
    const before = model();
    await user.keyboard(UNDO);
    expect(model()).not.toBe(before);
    expect(model()).toHaveValue('');
    expect(model()).toHaveFocus();
    expect(advanced(dialog)).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(REDO);
    expect(model()).toHaveValue('alpha');
    expect(model()).toHaveFocus();
    expect(advanced(dialog)).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('spinbutton', { name: 'Timeout seconds' })).toBeVisible();

    // Collapsed by hand, it stays collapsed through an undo too.
    await user.click(advanced(dialog));
    act(() => model().focus());
    await user.keyboard(UNDO);
    expect(advanced(dialog)).toHaveAttribute('aria-expanded', 'false');

    // Following an issue into it still opens it, and the dialog keeps that state.
    act(() => store().openNode('infer', { field: 'config.timeoutSeconds' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('spinbutton', { name: 'Timeout seconds' })).toHaveFocus(),
    );
    expect(advanced(dialog)).toHaveAttribute('aria-expanded', 'true');
    act(() => model().focus());
    await user.keyboard(REDO);
    expect(model()).toHaveValue('alpha');
    expect(advanced(dialog)).toHaveAttribute('aria-expanded', 'true');

    // Another opening of the dialog starts collapsed again.
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    act(() => store().openNode('infer'));
    const reopened = await screen.findByRole('dialog', { name: 'Edit inference infer' });
    expect(advanced(reopened)).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps opened and added list items open through an undo and a redo', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'mut',
        kind: 'mutate',
        label: 'Mut',
        config: { operations: [{ op: 'delete', path: '/vars/a' }] },
      },
      'Edit mutate mut',
    );
    const item = (n: number) =>
      within(dialog).getByRole('button', { name: new RegExp(`^Operations ${n}\\b`) });
    expect(item(1)).toHaveAttribute('aria-expanded', 'false');
    await user.click(item(1));
    await user.click(within(dialog).getByRole('button', { name: 'Add operations' }));
    expect(item(2)).toHaveAttribute('aria-expanded', 'true');
    const op = () =>
      within(within(dialog).getByRole('group', { name: 'Operations 2' })).getByLabelText('Op');
    await waitFor(() => expect(op()).toHaveFocus());

    // Undo the add from its select: the item goes; the first one stays open.
    await user.keyboard(UNDO);
    expect(within(dialog).queryByRole('button', { name: /^Operations 2\b/ })).toBeNull();
    expect(item(1)).toHaveAttribute('aria-expanded', 'true');
    // Redo brings the added item back open, beside the first.
    await user.keyboard(REDO);
    expect(item(2)).toHaveAttribute('aria-expanded', 'true');
    expect(item(1)).toHaveAttribute('aria-expanded', 'true');

    // Removing the first item moves the second's state up with it.
    await user.click(item(1));
    expect(item(1)).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(dialog).getByRole('button', { name: 'Remove operations 1' }));
    expect(item(1)).toHaveAttribute('aria-expanded', 'true');

    // Undo the removal from the remaining row's picker: each restored row keeps its own state.
    const remainingOp = () =>
      within(within(dialog).getByRole('group', { name: 'Operations 1' })).getByLabelText('Op');
    act(() => remainingOp().focus());
    await user.keyboard(UNDO);
    expect(item(1)).toHaveAttribute('aria-expanded', 'false');
    expect(item(2)).toHaveAttribute('aria-expanded', 'true');
    expect(op()).toHaveFocus();
    await user.keyboard(REDO);
    expect(within(dialog).queryByRole('button', { name: /^Operations 2\b/ })).toBeNull();
    expect(item(1)).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(UNDO);
    expect(item(1)).toHaveAttribute('aria-expanded', 'false');
    expect(item(2)).toHaveAttribute('aria-expanded', 'true');
  });

  it('redoing a removal from the removed row keeps its neighbour collapsed', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'mut',
        kind: 'mutate',
        label: 'Mut',
        config: {
          operations: [
            { op: 'delete', path: '/vars/a' },
            { op: 'delete', path: '/vars/b' },
          ],
        },
      },
      'Edit mutate mut',
    );
    const item = (n: number) =>
      within(dialog).getByRole('button', { name: new RegExp(`^Operations ${n}\\b`) });
    await user.click(item(1));
    await user.click(within(dialog).getByRole('button', { name: 'Remove operations 1' }));
    await user.keyboard(UNDO);
    const op = within(within(dialog).getByRole('group', { name: 'Operations 1' })).getByLabelText(
      'Op',
    );
    act(() => op.focus());
    await user.keyboard(REDO);
    expect(item(1)).toHaveAttribute('aria-expanded', 'false');
    expect(item(1)).toHaveFocus();
    await user.keyboard(UNDO);
    expect(item(1)).toHaveAttribute('aria-expanded', 'true');
    expect(item(2)).toHaveAttribute('aria-expanded', 'false');
    expect(item(2)).toHaveFocus();
  });

  it('undoing an add from its picker focuses a shown header without opening that row', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'mut',
        kind: 'mutate',
        label: 'Mut',
        config: { operations: [{ op: 'delete', path: '/vars/a' }] },
      },
      'Edit mutate mut',
    );
    const item = (n: number) =>
      within(dialog).getByRole('button', { name: new RegExp(`^Operations ${n}\\b`) });
    await user.click(within(dialog).getByRole('button', { name: 'Add operations' }));
    const op = within(within(dialog).getByRole('group', { name: 'Operations 2' })).getByLabelText(
      'Op',
    );
    await waitFor(() => expect(op).toHaveFocus());
    await user.keyboard(UNDO);
    expect(item(1)).toHaveAttribute('aria-expanded', 'false');
    expect(item(1)).toHaveFocus();
    await user.keyboard(REDO);
    expect(item(1)).toHaveAttribute('aria-expanded', 'false');
    expect(item(2)).toHaveAttribute('aria-expanded', 'true');
  });

  it.each(['toggle', 'remove'] as const)(
    'follows the same row when undo and redo move its header %s',
    async (headerControl) => {
      const user = userEvent.setup();
      const dialog = await openDialog(
        {
          id: 'mut',
          kind: 'mutate',
          label: 'Mut',
          // Identical rows must still have separate disclosure and focus identities.
          config: {
            operations: Array.from({ length: 2 }, () => ({ op: 'delete', path: '/vars/a' })),
          },
        },
        'Edit mutate mut',
      );
      const item = (n: number) =>
        within(dialog).getByRole('button', { name: new RegExp(`^Operations ${n}\\b`) });
      const header = (n: number) =>
        headerControl === 'toggle'
          ? item(n)
          : within(dialog).getByRole('button', { name: `Remove operations ${n}` });
      await user.click(within(dialog).getByRole('button', { name: 'Remove operations 1' }));
      act(() => header(1).focus());
      await user.keyboard(UNDO);
      expect(header(2)).toHaveFocus();
      expect(item(1)).toHaveAttribute('aria-expanded', 'false');
      expect(item(2)).toHaveAttribute('aria-expanded', 'false');
      await user.keyboard(REDO);
      expect(header(1)).toHaveFocus();
      expect(item(1)).toHaveAttribute('aria-expanded', 'false');
    },
  );

  it('undoing the only added row returns focus to the collection Add button', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'mut',
        kind: 'mutate',
        label: 'Mut',
        config: { operations: [{ op: 'delete', path: '/vars/a' }] },
      },
      'Edit mutate mut',
    );
    const add = () => within(dialog).getByRole('button', { name: 'Add operations' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove operations 1' }));
    await user.click(add());
    await waitFor(() =>
      expect(
        within(within(dialog).getByRole('group', { name: 'Operations 1' })).getByLabelText('Op'),
      ).toHaveFocus(),
    );
    await user.keyboard(UNDO);
    expect(within(dialog).queryByRole('button', { name: /^Operations 1\b/ })).toBeNull();
    expect(add()).toHaveFocus();
  });
});
