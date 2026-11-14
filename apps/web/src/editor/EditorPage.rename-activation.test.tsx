import {
  CURRENT_DEFINITION_FORMAT,
  type LoopDefinitionInput,
  type MutationOperationInput,
} from '@graphgoblin/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { loadLocalDraft } from '../drafts/local-drafts.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { useEditorStore } from './store.js';

/**
 * #273 A2: leaving a changed Node id for a button of the same form, by pointer. The browser
 * presses the button (pointerdown, mousedown), moves focus there (the id's blur commits the
 * rename and repairs this node's own source), and only then releases it (pointerup, mouseup) and
 * clicks it. These tests drive that native order with a separate press and release, so they can
 * look at the dialog in between and at the moment the click reaches the button. jsdom has no
 * layout: a component test shows which elements stay and what renders before that click, not where
 * a real pointer lands; the native driver checks that.
 */

type User = ReturnType<typeof userEvent.setup>;
type Operation = Record<string, unknown>;

const SAVE_WAIT = { timeout: 4000 };
const UNDO = '{Control>}z{/Control}';
const REDO = '{Control>}{Shift>}z{/Shift}{/Control}';
const store = () => useEditorStore.getState();
const node = (id: string) => store().definition!.nodes.find((n) => n.id === id);
const operations = (id: string) => (node(id)!.config as { operations: Operation[] }).operations;
const labels = () => store().past.map((step) => step.label);

/**
 * The independent native fixture's rows: a Coerce of the node's own visit count, then a note. The
 * repair policy is written with the defaults the API's parse fills, so the draft keeps it exactly.
 */
const COERCE = {
  op: 'coerce',
  source: '/counters/nodeVisits/work',
  jsonSchema: { type: 'integer' },
  target: '/vars/visits',
  repair: { enabled: false, maxAttempts: 1, onFailure: 'fail-run' },
} satisfies MutationOperationInput;
const REPAIRED = {
  ...COERCE,
  source: '/counters/nodeVisits/worker',
} satisfies MutationOperationInput;
const NOTE = {
  op: 'append-message',
  role: 'note',
  content: 'Ordinary removable row versus repaired Coerce row',
} satisfies MutationOperationInput;
/** What Add operations appends: the first kind, Set, with its defaults. */
const ADDED = {
  op: 'set',
  path: '',
  value: { kind: 'literal', value: null },
} satisfies MutationOperationInput;

function selfPointer(): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'activation',
    variables: { visits: { type: 'integer' } },
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 120 },
      },
      {
        id: 'work',
        kind: 'mutate',
        label: 'Self pointer repair',
        config: { operations: [COERCE, NOTE] },
        ui: { x: 310, y: 120 },
      },
      { id: 'end', kind: 'exit', label: 'End', config: {}, ui: { x: 600, y: 120 } },
    ],
    edges: [
      { id: 'entry', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
      { id: 'out', from: { node: 'work', port: 'out' }, to: { node: 'end', port: 'in' } },
    ],
  };
}

async function openWork() {
  const api = new FakeApi();
  const loop = api.addLoop(selfPointer());
  const token = api.draftToken(loop.id);
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'activation' });
  act(() => store().openNode('work'));
  const dialog = await screen.findByRole('dialog', { name: 'Edit mutate work' });
  await within(dialog).findByRole('form', { name: 'work config' });
  const puts = () => api.callsTo('PUT', `/loops/${loop.id}/draft`);
  return { api, loop, token, dialog, puts };
}

/** Press the primary button on `target` and keep it down: pointerdown, mousedown, focus. */
const press = (user: User, target: Element) => user.pointer({ keys: '[MouseLeft>]', target });
/** Release it over `target`: pointerup, mouseup, then click where press and release agree. */
const release = (user: User, target: Element) => user.pointer({ keys: '[/MouseLeft]', target });

function header(scope: HTMLElement, n: number): HTMLElement {
  return within(scope).getByRole('button', { name: new RegExp(`^Operations ${n}\\b`) });
}

function rowIds(scope: HTMLElement): (string | null)[] {
  return [...scope.querySelectorAll('[data-row-path^="operations."]')]
    .filter((row) => /^operations\.\d+$/.test(row.getAttribute('data-row-path')!))
    .map((row) => row.getAttribute('data-row-id'));
}

function renamedNotice(scope: HTMLElement): HTMLElement | null {
  return (
    within(scope).queryByText('Renamed work to worker')?.closest<HTMLElement>('[role="status"]') ??
    null
  );
}

async function typeId(user: User, dialog: HTMLElement, value: string) {
  const id = within(dialog).getByLabelText('Node id');
  await user.clear(id);
  await user.type(id, value);
  expect(id).toHaveFocus();
  return id;
}

/**
 * What the dialog showed each time a click reached `button` itself: whether the rename notice had
 * appeared above it yet, and whether it was still the focused element of the page.
 */
function clicksAt(button: HTMLElement, dialog: HTMLElement) {
  const seen: { notice: boolean; focused: boolean }[] = [];
  button.addEventListener('click', () =>
    seen.push({
      notice: renamedNotice(dialog) !== null,
      focused: document.activeElement === button,
    }),
  );
  return seen;
}

/** Let frames, timers and effects run, so a late callback would have written by now. */
async function settle() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 120)));
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

describe('a pointer press that commits a self-reference rename (#273 A2)', () => {
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it('adds exactly one operation on the repaired source, as one step after the rename', async () => {
    const user = userEvent.setup();
    const { api, loop, token, dialog, puts } = await openWork();
    // The Coerce row is open, the note collapsed; both keep their state through the gesture.
    await user.click(header(dialog, 1));
    const rows = rowIds(dialog);
    expect(rows).toHaveLength(2);
    const source = within(dialog).getByLabelText('Source');
    await typeId(user, dialog, 'worker');
    const add = within(dialog).getByRole('button', { name: 'Add operations' });
    const clicks = clicksAt(add, dialog);

    await press(user, add);
    // The id's blur renamed the node and repaired its own Coerce source in one step...
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
    expect(labels()).toEqual(['rename work to worker']);
    expect(screen.getByRole('dialog', { name: 'Edit mutate worker' })).toBe(dialog);
    expect(within(dialog).getByLabelText('Source')).toHaveValue('/counters/nodeVisits/worker');
    // ...while the pressed button, the rows and the focus stayed exactly where they were. (Soft,
    // so a regression reports each lost guarantee and still reaches the outcome below.)
    expect.soft(add.isConnected).toBe(true);
    expect.soft(within(dialog).getByRole('button', { name: 'Add operations' })).toBe(add);
    expect.soft(add).toHaveFocus();
    expect.soft(rowIds(dialog)).toEqual(rows);
    expect.soft(within(dialog).getByLabelText('Source')).toBe(source);
    // Nothing new renders above the held button until the press ends.
    expect.soft(renamedNotice(dialog)).toBeNull();

    await release(user, add);
    expect(operations('worker')).toEqual([REPAIRED, NOTE, ADDED]);
    expect(labels()).toEqual(['rename work to worker', 'edit config of worker']);
    // Exactly one click reached the pressed button, with nothing new rendered above it yet.
    expect(clicks).toEqual([{ notice: false, focused: true }]);
    // The notice shows once that click has been delivered.
    expect(renamedNotice(dialog)).toHaveTextContent(
      'Updated 1 reference in expressions, templates and mutation paths, and 2 connections.',
    );
    const after = rowIds(dialog);
    expect(after.slice(0, 2)).toEqual(rows);
    expect(after).toHaveLength(3);
    expect(header(dialog, 1)).toHaveAttribute('aria-expanded', 'true');
    expect(header(dialog, 2)).toHaveAttribute('aria-expanded', 'false');
    expect(header(dialog, 3)).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-row-path]')).toHaveAttribute(
        'data-row-path',
        'operations.2',
      ),
    );

    // No later callback writes the old source back.
    await settle();
    expect(operations('worker')).toEqual([REPAIRED, NOTE, ADDED]);
    expect(labels()).toEqual(['rename work to worker', 'edit config of worker']);

    // One debounced save of the whole graph from the original token, mirrored on the device.
    const final = store().definition!;
    await waitFor(() => expect(puts()).toHaveLength(1), SAVE_WAIT);
    expect(puts()[0]!.headers.get('if-match')).toBe(`"${token!}"`);
    expect((puts()[0]!.body as { definition: unknown }).definition).toEqual(final);
    await waitFor(async () =>
      expect(await loadLocalDraft(loop.id)).toMatchObject({
        definition: final,
        synced: true,
        baseToken: api.draftToken(loop.id),
      }),
    );

    // Undo reverses the Add, then the rename; Redo brings both back.
    act(() => within(dialog).getByRole('button', { name: 'Done' }).focus());
    await user.keyboard(UNDO);
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
    act(() => within(dialog).getByRole('button', { name: 'Done' }).focus());
    await user.keyboard(UNDO);
    expect(node('worker')).toBeUndefined();
    expect(operations('work')).toEqual([COERCE, NOTE]);
    expect(store().definition!.edges.map((edge) => [edge.from.node, edge.to.node])).toEqual([
      ['start', 'work'],
      ['work', 'end'],
    ]);
    act(() => within(dialog).getByRole('button', { name: 'Done' }).focus());
    await user.keyboard(REDO);
    act(() => within(dialog).getByRole('button', { name: 'Done' }).focus());
    await user.keyboard(REDO);
    expect(store().definition).toEqual(final);
  });

  it('removes exactly the pressed row, keeping the repaired Coerce row and its held JSON', async () => {
    const user = userEvent.setup();
    const { dialog } = await openWork();
    await user.click(header(dialog, 1));
    // Unfinished JSON in the Coerce row: held as typed, never applied, through the rename.
    setCode('Json schema', '{"type":');
    await waitFor(() =>
      expect(store().fieldErrors['node:work']?.['operations.0.jsonSchema']?.text).toBe('{"type":'),
    );
    const rows = rowIds(dialog);
    await typeId(user, dialog, 'worker');
    const remove = within(dialog).getByRole('button', { name: 'Remove operations 2' });
    const clicks = clicksAt(remove, dialog);

    await press(user, remove);
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
    expect(labels().at(-1)).toBe('rename work to worker');
    expect(getCode('Json schema')).toBe('{"type":');
    expect(store().fieldErrors['node:worker']?.['operations.0.jsonSchema']?.text).toBe('{"type":');
    expect.soft(remove.isConnected).toBe(true);
    expect.soft(remove).toHaveFocus();
    expect.soft(rowIds(dialog)).toEqual(rows);
    expect.soft(renamedNotice(dialog)).toBeNull();

    await release(user, remove);
    expect(operations('worker')).toEqual([REPAIRED]);
    expect(labels().slice(-2)).toEqual(['rename work to worker', 'edit config of worker']);
    expect(clicks).toEqual([{ notice: false, focused: true }]);
    expect(rowIds(dialog)).toEqual(rows.slice(0, 1));
    expect(header(dialog, 1)).toHaveAttribute('aria-expanded', 'true');
    expect(getCode('Json schema')).toBe('{"type":');
    expect(store().fieldErrors).toEqual({
      'node:worker': { 'operations.0.jsonSchema': expect.objectContaining({ text: '{"type":' }) },
    });
    expect(renamedNotice(dialog)).not.toBeNull();
    await settle();
    expect(operations('worker')).toEqual([REPAIRED]);

    // Undo brings the note back on the repaired source, then the original id and source.
    act(() => within(dialog).getByRole('button', { name: 'Done' }).focus());
    await user.keyboard(UNDO);
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
    act(() => within(dialog).getByRole('button', { name: 'Done' }).focus());
    await user.keyboard(UNDO);
    expect(operations('work')).toEqual([COERCE, NOTE]);
    expect(getCode('Json schema')).toBe('{"type":');
  });

  it('keeps a press released elsewhere canceled: the rename stays, nothing is added later', async () => {
    const user = userEvent.setup();
    const { token, dialog, puts } = await openWork();
    await typeId(user, dialog, 'worker');
    const add = within(dialog).getByRole('button', { name: 'Add operations' });
    const clicks = clicksAt(add, dialog);
    const rule = within(dialog).getByText('At least 1 item.');

    await press(user, add);
    expect.soft(add.isConnected).toBe(true);
    expect.soft(renamedNotice(dialog)).toBeNull();
    // The pointer leaves the button before it is released: the click goes to an element around
    // both, never to Add.
    await user.pointer([{ target: rule }, { keys: '[/MouseLeft]', target: rule }]);
    expect(clicks).toEqual([]);
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
    expect(labels()).toEqual(['rename work to worker']);
    // The press is over, so the notice shows.
    expect(renamedNotice(dialog)).not.toBeNull();

    await settle();
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
    expect(labels()).toEqual(['rename work to worker']);
    await waitFor(() => expect(puts()).toHaveLength(1), SAVE_WAIT);
    expect(puts()[0]!.headers.get('if-match')).toBe(`"${token!}"`);
    expect((puts()[0]!.body as { definition: unknown }).definition).toEqual(store().definition);
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
  });

  it('keeps a press the browser cancels canceled: the notice shows at once, nothing is added', async () => {
    const user = userEvent.setup();
    const { dialog } = await openWork();
    await typeId(user, dialog, 'worker');
    const add = within(dialog).getByRole('button', { name: 'Add operations' });
    const clicks = clicksAt(add, dialog);

    await press(user, add);
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
    expect.soft(renamedNotice(dialog)).toBeNull();
    // A touch the browser takes for a scroll, say: no release and no click follow.
    fireEvent.pointerCancel(add);
    expect(renamedNotice(dialog)).not.toBeNull();
    await settle();
    expect(clicks).toEqual([]);
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
    expect(labels()).toEqual(['rename work to worker']);
  });

  it('acts once from the keyboard after the id commits, holding nothing back', async () => {
    const user = userEvent.setup();
    const { dialog } = await openWork();
    await typeId(user, dialog, 'worker');
    const add = within(dialog).getByRole('button', { name: 'Add operations' });
    const clicks = clicksAt(add, dialog);

    // Focus moves without a press (as Tab or a screen reader moves it): the notice shows at once.
    act(() => add.focus());
    expect(operations('worker')).toEqual([REPAIRED, NOTE]);
    expect(renamedNotice(dialog)).not.toBeNull();
    expect(add).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(clicks).toEqual([{ notice: true, focused: true }]);
    expect(operations('worker')).toEqual([REPAIRED, NOTE, ADDED]);
    expect(labels()).toEqual(['rename work to worker', 'edit config of worker']);
    await settle();
    expect(operations('worker')).toEqual([REPAIRED, NOTE, ADDED]);
  });

  it('keeps an invalid or duplicate id with its message and acts once on the unchanged node', async () => {
    const user = userEvent.setup();
    const { dialog } = await openWork();
    const id = await typeId(user, dialog, '9lives');
    const add = within(dialog).getByRole('button', { name: 'Add operations' });
    await press(user, add);
    await release(user, add);
    expect(id).toHaveValue('9lives');
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(
      within(dialog).getByText('Use a letter first, then letters, digits, _ or -'),
    ).toBeVisible();
    expect(node('9lives')).toBeUndefined();
    expect(operations('work')).toEqual([COERCE, NOTE, ADDED]);
    expect(labels()).toEqual(['edit config of work']);
    expect(store().renameReport).toBeUndefined();

    await typeId(user, dialog, 'end');
    const remove = within(dialog).getByRole('button', { name: 'Remove operations 2' });
    await press(user, remove);
    await release(user, remove);
    expect(id).toHaveValue('end');
    expect(within(dialog).getByText('"end" is already used')).toBeVisible();
    expect(operations('work')).toEqual([COERCE, ADDED]);
    expect(labels()).toEqual(['edit config of work', 'edit config of work']);
    expect(store().renameReport).toBeUndefined();
    await settle();
    expect(operations('work')).toEqual([COERCE, ADDED]);
  });

  it('remounts with the repaired source when the open form no longer shows the stored config', async () => {
    const user = userEvent.setup();
    const { dialog } = await openWork();
    await user.click(header(dialog, 1));
    const source = within(dialog).getByLabelText('Source');
    // An edit the open form did not make (it keeps the value it mounted with).
    act(() =>
      store().updateNode('work', {
        config: { operations: [COERCE, { ...NOTE, content: 'Elsewhere' }] },
      }),
    );
    await typeId(user, dialog, 'worker');
    await user.keyboard('{Enter}');

    // The form could not take the repair as its own, so it shows the stored, repaired config anew.
    expect(operations('worker')).toEqual([REPAIRED, { ...NOTE, content: 'Elsewhere' }]);
    const remounted = within(dialog).getByLabelText('Source');
    expect(remounted).not.toBe(source);
    expect(remounted).toHaveValue('/counters/nodeVisits/worker');
    expect(labels()).toEqual(['edit config of work', 'rename work to worker']);
    await settle();
    expect(operations('worker')).toEqual([REPAIRED, { ...NOTE, content: 'Elsewhere' }]);
  });

  it('acts once with a steady id, as the control', async () => {
    const user = userEvent.setup();
    const { dialog } = await openWork();
    act(() => within(dialog).getByLabelText('Node id').focus());
    const add = within(dialog).getByRole('button', { name: 'Add operations' });
    await press(user, add);
    await release(user, add);
    expect(operations('work')).toEqual([COERCE, NOTE, ADDED]);
    const remove = within(dialog).getByRole('button', { name: 'Remove operations 2' });
    await press(user, remove);
    await release(user, remove);
    expect(operations('work')).toEqual([COERCE, ADDED]);
    expect(labels()).toEqual(['edit config of work', 'edit config of work']);
  });
});
