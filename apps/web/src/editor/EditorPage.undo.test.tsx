import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

const UNDO = '{Control>}z{/Control}';
const REDO = '{Control>}{Shift>}z{/Shift}{/Control}';
const REDO_Y = '{Control>}y{/Control}';

const store = () => useEditorStore.getState();
const node = (id: string) => store().definition!.nodes.find((n) => n.id === id);

async function openEditor(name = 'undo me') {
  const api = new FakeApi();
  const loop = api.addLoop(newLoopDefinition(name));
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name });
  return { api, loop };
}

/** Open a node's editor and move focus to its Done button, away from any text field. */
async function editNode(id: string, name: string) {
  act(() => store().openNode(id));
  const dialog = await screen.findByRole('dialog', { name });
  await within(dialog).findByRole('form', { name: `${id} config` });
  return dialog;
}

const focusDone = (dialog: HTMLElement) =>
  act(() => within(dialog).getByRole('button', { name: 'Done' }).focus());

describe('EditorPage undo and redo', () => {
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it('undoes and redoes from the toolbar and the keyboard, not from inside text fields', async () => {
    const user = userEvent.setup();
    await openEditor();
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toHaveAttribute('aria-disabled', 'true');
    // Nothing to undo on a fresh loop: the keys do nothing.
    await user.keyboard(UNDO);
    expect(store()).toMatchObject({ revision: 0, historyEpoch: 0 });

    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    expect(undo).toHaveAccessibleName('Undo add wait');
    await user.click(undo);
    expect(screen.queryByTestId('node-wait')).toBeNull();
    expect(undo).toHaveAttribute('aria-disabled', 'true');
    expect(redo).toHaveAccessibleName('Redo add wait');
    // The keys work with focus on the toolbar, as on the page.
    expect(undo).toHaveFocus();
    await user.keyboard(REDO);
    expect(screen.getByTestId('node-wait')).toBeInTheDocument();
    await user.keyboard(UNDO);
    expect(screen.queryByTestId('node-wait')).toBeNull();
    act(() => undo.blur());
    await user.keyboard(REDO_Y);
    expect(screen.getByTestId('node-wait')).toBeInTheDocument();

    // A new edit after an undo leaves nothing to redo.
    await user.keyboard(UNDO);
    await user.click(screen.getByRole('button', { name: 'Add Exit node' }));
    expect(redo).toHaveAccessibleName('Redo');
    expect(redo).toHaveAttribute('aria-disabled', 'true');

    // Inside a text field the keys belong to the field.
    await user.click(screen.getByLabelText('Description'));
    await user.keyboard(UNDO);
    expect(screen.getByTestId('node-exit')).toBeInTheDocument();
  });

  it('undoes typing in a label in one step, from outside the field', async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await editNode('start', 'Edit trigger start');
    const label = within(dialog).getByLabelText('Label');
    await user.type(label, ' hello');
    expect(node('start')!.label).toBe('Start hello');
    // Ctrl+Z in the field is the field's own undo: the store keeps the text.
    await user.keyboard(UNDO);
    expect(node('start')!.label).toBe('Start hello');

    focusDone(dialog);
    expect(screen.getByRole('button', { name: 'Undo edit label of start' })).toBeInTheDocument();
    await user.keyboard(UNDO);
    expect(label).toHaveValue('Start');
    expect(within(screen.getByTestId('node-start')).getByText('Start')).toBeInTheDocument();
    await user.keyboard(REDO);
    expect(label).toHaveValue('Start hello');
    expect(within(dialog).getByRole('button', { name: 'Done' })).toHaveFocus();
  });

  it('shows restored values in the node’s config form and the loop panel’s forms', async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await editNode('start', 'Edit trigger start');
    const loaded = node('start')!.config;
    await user.selectOptions(within(dialog).getByLabelText('Subtype'), 'cron');
    expect(node('start')!.config).toMatchObject({ subtype: 'cron' });
    focusDone(dialog);
    await user.keyboard(UNDO);
    expect(node('start')!.config).toBe(loaded);
    expect(within(dialog).getByLabelText('Subtype')).toHaveDisplayValue('manual');
    await user.keyboard(REDO);
    expect(within(dialog).getByLabelText('Subtype')).toHaveDisplayValue('cron');
    // From the select itself: it has no text to undo, so the editor's undo applies, and focus
    // stays on the (remounted) select.
    act(() => within(dialog).getByLabelText('Subtype').focus());
    await user.keyboard(UNDO);
    expect(within(dialog).getByLabelText('Subtype')).toHaveDisplayValue('manual');
    expect(within(dialog).getByLabelText('Subtype')).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    const settings = store().definition!.settings;
    const iterations = screen.getByLabelText('Max iterations');
    expect(iterations).toHaveValue(10);
    await user.clear(iterations);
    await user.type(iterations, '4');
    expect(store().definition!.settings).toMatchObject({ maxIterations: 4 });
    act(() => screen.getByRole('heading', { name: 'Loop settings' }).focus());
    await user.keyboard(UNDO);
    expect(store().definition!.settings).toBe(settings);
    expect(screen.getByLabelText('Max iterations')).toHaveValue(10);
    await user.keyboard(REDO);
    expect(screen.getByLabelText('Max iterations')).toHaveValue(4);
  });

  it('closes the node editor when an undo removes its node, and returns focus to the canvas', async () => {
    const user = userEvent.setup();
    await openEditor();
    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    const dialog = await editNode('wait', 'Edit wait wait');
    expect(within(dialog).getByRole('heading', { name: 'Edit wait wait' })).toHaveFocus();
    await user.keyboard(UNDO);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('node-wait')).toBeNull();
    expect(screen.getByTestId('canvas')).toHaveFocus();
    // Redo brings the node back, not its editor.
    await user.keyboard(REDO);
    expect(screen.getByTestId('node-wait')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('undoes a rename: the id, its edges, and the open editor follow', async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await editNode('done', 'Edit exit done');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'finish{Enter}');
    expect(store().definition!.edges[0]!.to.node).toBe('finish');
    focusDone(dialog);
    await user.keyboard(UNDO);
    expect(screen.getByRole('dialog', { name: 'Edit exit done' })).toBe(dialog);
    expect(within(dialog).getByLabelText('Node id')).toHaveValue('done');
    expect(store().definition!.edges[0]!.to.node).toBe('done');
    await user.keyboard(REDO);
    expect(screen.getByRole('dialog', { name: 'Edit exit finish' })).toBe(dialog);
    expect(within(dialog).getByLabelText('Node id')).toHaveValue('finish');

    // An id draft that could not apply is dropped by an undo, as the form is.
    await user.clear(within(dialog).getByLabelText('Node id'));
    await user.type(within(dialog).getByLabelText('Node id'), '9bad{Enter}');
    expect(within(dialog).getByText(/Use a letter first/)).toBeInTheDocument();
    focusDone(dialog);
    await user.keyboard(UNDO);
    expect(within(dialog).getByLabelText('Node id')).toHaveValue('done');
    expect(within(dialog).queryByText(/Use a letter first/)).toBeNull();
  });

  it('undoes a Discard text made right after the typing, from the field or the badge', async () => {
    const user = userEvent.setup();
    await openEditor();
    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    const dialog = await editNode('start', 'Edit trigger start');
    const badge = () => within(dialog).queryByRole('button', { name: '1 issue on start' });

    // The field's own Discard, within a second of the typing.
    setCode('Input schema', '{"type": ');
    await user.click(await within(dialog).findByRole('button', { name: 'Discard text' }));
    await waitFor(() => expect(badge()).toBeNull());
    expect(store().past.map((step) => step.label)).toEqual([
      'add wait',
      'edit config of start',
      'discard text in inputSchema of start',
    ]);
    focusDone(dialog);
    await user.keyboard(UNDO);
    expect(getCode('Input schema')).toBe('{"type": ');
    expect(badge()).toBeVisible();
    expect(screen.getByTestId('node-wait')).toBeInTheDocument();
    await user.keyboard(REDO);
    expect(store().fieldErrors).toEqual({});
    expect(badge()).toBeNull();
    expect(getCode('Input schema')).not.toContain('"type"');

    // The badge popover's Discard is a step of its own too.
    setCode('Input schema', '[1, ');
    await user.click(await within(dialog).findByRole('button', { name: '1 issue on start' }));
    await user.click(screen.getByRole('button', { name: 'Discard unparsed text at inputSchema' }));
    await waitFor(() => expect(badge()).toBeNull());
    expect(store().past.at(-1)!.label).toBe('discard text in inputSchema of start');
    focusDone(dialog);
    await user.keyboard(UNDO);
    expect(getCode('Input schema')).toBe('[1, ');
    expect(badge()).toBeVisible();
    await user.keyboard(REDO);
    expect(badge()).toBeNull();
  });

  it('leaves the keys to a code editor’s search panel, checkboxes and all', async () => {
    const user = userEvent.setup();
    await openEditor();
    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    const dialog = await editNode('start', 'Edit trigger start');
    const code = within(dialog)
      .getAllByLabelText('Input schema')
      .find((el) => el.classList.contains('cm-content'))!;
    act(() => code.focus());
    // CodeMirror's own Mod-f opens its search panel inside the editor.
    fireEvent.keyDown(code, { key: 'f', code: 'KeyF', ctrlKey: true });
    const matchCase = await within(dialog).findByRole('checkbox', { name: /match case/i });
    act(() => matchCase.focus());
    const steps = store().past.length;
    fireEvent.keyDown(matchCase, { key: 'z', code: 'KeyZ', ctrlKey: true });
    // Nothing undone: the Wait node stays, the form did not remount, the search stays open.
    expect(store().past).toHaveLength(steps);
    expect(store().historyEpoch).toBe(0);
    expect(screen.getByTestId('node-wait')).toBeInTheDocument();
    expect(matchCase).toBeInTheDocument();
    expect(matchCase).toHaveFocus();
  });

  it('takes unparsed text back and forth with the step that typed it', async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await editNode('start', 'Edit trigger start');
    setCode('Input schema', '{"type": ');
    expect(await within(dialog).findByRole('button', { name: '1 issue on start' })).toBeVisible();
    focusDone(dialog);
    await user.keyboard(UNDO);
    expect(store().fieldErrors).toEqual({});
    expect(within(dialog).queryByRole('button', { name: '1 issue on start' })).toBeNull();
    expect(getCode('Input schema')).not.toContain('"type"');
    await user.keyboard(REDO);
    expect(getCode('Input schema')).toBe('{"type": ');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '1 issue on start' })).toBeVisible(),
    );
  });
});
