import { EditorView } from '@codemirror/view';
import { CURRENT_DEFINITION_FORMAT, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { loadLocalDraft } from '../drafts/local-drafts.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

const SAVE_WAIT = { timeout: 4000 };
const UNDO = '{Control>}z{/Control}';
const REDO = '{Control>}{Shift>}z{/Shift}{/Control}';
const PENDING = 'Choose Apply JSON or Cancel JSON to finish this edit.';
const store = () => useEditorStore.getState();
const node = (id: string) => store().definition!.nodes.find((n) => n.id === id);
const config = (id: string) => node(id)!.config as Record<string, unknown>;
const labels = () => store().past.map((step) => step.label);

/** The text of the code editor that has focus. */
function focusedCode(): string | undefined {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.classList.contains('cm-content')
    ? EditorView.findFromDOM(active)?.state.doc.toString()
    : undefined;
}

/** The header of operation `n` (1-based) in `scope`, which toggles its row. */
function operation(scope: HTMLElement, n: number): HTMLElement {
  return within(scope).getByRole('button', { name: new RegExp(`^Operations ${n}\\b`) });
}

/** The stable row ids of the first `count` operations, as rendered. */
function operationRows(scope: HTMLElement, count: number): (string | null | undefined)[] {
  return Array.from({ length: count }, (_, index) =>
    scope.querySelector(`[data-row-path="operations.${index}"]`)?.getAttribute('data-row-id'),
  );
}

/** The open state of the first `count` operations. */
function opened(scope: HTMLElement, count: number): (string | null)[] {
  return Array.from({ length: count }, (_, index) =>
    operation(scope, index + 1).getAttribute('aria-expanded'),
  );
}

/** The Coerce operation's Source input, inside its open row. */
function coerceSource(scope: HTMLElement): HTMLElement {
  return within(within(scope).getByRole('group', { name: 'Operations 3' })).getByLabelText(
    'Source',
  );
}

/**
 * Work feeds a review and an exit. A sibling's Liquid and the exit's JSONata read it, the exit
 * also reads a key it cannot know, and the loop's working directory reads it too.
 */
function referencing(): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'references',
    settings: {
      workingDirectory: { kind: 'template', template: '/tmp/{{ outputs.work.value }}' },
    },
    variables: { key: { type: 'string' } },
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 0 },
      },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'Do the work.' } },
        ui: { x: 300, y: 0 },
      },
      {
        id: 'review',
        kind: 'inference',
        label: 'Review',
        config: { prompt: { template: 'Check {{ outputs.work.value }}. Mention work by name.' } },
        ui: { x: 600, y: 0 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: '[outputs.work.value, $lookup(outputs, vars.key)]' },
        ui: { x: 900, y: 0 },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'review', port: 'in' } },
      { id: 'e3', from: { node: 'review', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
}

/** A repeat gate that reads its own visit count, so its own form holds a repaired source. */
function selfReading(): LoopDefinitionInput {
  const definition = referencing();
  return {
    ...definition,
    nodes: [
      ...definition.nodes,
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: 'counters.nodeVisits.gate > 2 ? "stop" : "again"',
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'stop', label: 'Stop' },
          ],
          maxPasses: 3,
        },
        ui: { x: 600, y: 200 },
      },
    ],
    edges: [
      ...definition.edges.filter((edge) => edge.id !== 'e3'),
      { id: 'e3', from: { node: 'review', port: 'out' }, to: { node: 'gate', port: 'in' } },
      { id: 'e4', from: { node: 'gate', port: 'again' }, to: { node: 'work', port: 'in' } },
      { id: 'e5', from: { node: 'gate', port: 'stop' }, to: { node: 'done', port: 'in' } },
      { id: 'e6', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'done', port: 'in' } },
    ],
  };
}

/**
 * A Mutate node that coerces its own visit count, after two identical notes (#273 U1): the rename
 * repairs the Coerce source in place, so the operations keep their rows.
 */
function selfCoercing(): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'coerce',
    variables: { visits: { type: 'integer' } },
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 0 },
      },
      {
        id: 'work',
        kind: 'mutate',
        label: 'Work',
        config: {
          operations: [
            { op: 'append-message', role: 'note', content: 'Same note' },
            { op: 'append-message', role: 'note', content: 'Same note' },
            {
              op: 'coerce',
              source: '/counters/nodeVisits/work',
              jsonSchema: { type: 'integer' },
              repair: { enabled: false },
              target: '/vars/visits',
            },
          ],
        },
        ui: { x: 300, y: 0 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: 'vars.visits' },
        ui: { x: 600, y: 0 },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
}

/**
 * Audit sits between review and the exit with three notes; only the second reads a computed key,
 * so every rename lists it for review (#273 U2).
 */
function auditing(): LoopDefinitionInput {
  const definition = referencing();
  return {
    ...definition,
    nodes: [
      ...definition.nodes,
      {
        id: 'audit',
        kind: 'mutate',
        label: 'Audit',
        config: {
          operations: [
            { op: 'append-message', role: 'note', content: 'First note' },
            { op: 'append-message', role: 'note', content: 'Read {{ outputs[vars.key] }}' },
            { op: 'append-message', role: 'note', content: 'Third note' },
          ],
        },
        ui: { x: 750, y: 200 },
      },
    ],
    edges: [
      ...definition.edges.filter((edge) => edge.id !== 'e3'),
      { id: 'e3', from: { node: 'review', port: 'out' }, to: { node: 'audit', port: 'in' } },
      { id: 'e4', from: { node: 'audit', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
}

/** Work's own Input mutation reads its visit count (#273 U3). */
function selfInput(): LoopDefinitionInput {
  const definition = referencing();
  return {
    ...definition,
    nodes: definition.nodes.map((n) =>
      n.id === 'work' && n.kind === 'inference'
        ? {
            ...n,
            config: {
              ...n.config,
              input: [
                {
                  op: 'append-message',
                  role: 'note',
                  content: 'Visit {{ counters.nodeVisits.work }}',
                },
              ],
            },
          }
        : n,
    ),
  };
}

async function openEditor(definition: LoopDefinitionInput = referencing()) {
  const api = new FakeApi();
  const loop = api.addLoop(definition);
  const token = api.draftToken(loop.id);
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: definition.name });
  return { api, loop, token };
}

async function editNode(id: string, name: string) {
  act(() => store().openNode(id));
  const dialog = await screen.findByRole('dialog', { name });
  await within(dialog).findByRole('form', { name: `${id} config` });
  return dialog;
}

/** The rename notice holding `title`, inside `scope`. */
function notice(scope: HTMLElement, title: string): HTMLElement {
  return within(scope).getByText(title).closest<HTMLElement>('[role="status"]')!;
}

describe('renaming a node in the editor (#273)', () => {
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it('lists a computed key for review even when renaming a node it does not name today', async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await editNode('start', 'Edit trigger start');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'begin{Enter}');
    const inDialog = notice(dialog, 'Renamed start to begin');
    expect(inDialog).toHaveTextContent(
      'Updated 1 connection. Plain text, JSON values and scripts are not changed.',
    );
    expect(inDialog).toHaveTextContent('Review one place where start may remain:');
    expect(
      within(inDialog).getByRole('button', { name: /node done config\.returns/ }),
    ).toBeVisible();
  });

  it('focuses a listed field of the open node in place, and lists scripts without a link', async () => {
    const user = userEvent.setup();
    const definition = referencing();
    definition.nodes.push({
      id: 'probe',
      kind: 'script',
      label: 'Probe',
      config: { command: 'probe', args: [], cwd: 'workspace', stdin: 'thread' },
      ui: { x: 900, y: 200 },
    });
    definition.edges.push({
      id: 'e4',
      from: { node: 'probe', port: 'out' },
      to: { node: 'done', port: 'in' },
    });
    await openEditor(definition);
    const dialog = await editNode('done', 'Edit exit done');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'finish{Enter}');
    const inDialog = notice(dialog, 'Renamed done to finish');
    expect(inDialog).toHaveTextContent('Review 2 places where done may remain:');
    // The script row informs: scripts are never rewritten.
    expect(inDialog).toHaveTextContent(
      'Check scripts and generated patches for references to the old ID.',
    );
    expect(
      within(inDialog).queryByRole('button', { name: /scripts and generated patches/ }),
    ).toBeNull();
    expect(config('probe')).toMatchObject({ command: 'probe', stdin: 'thread' });

    // The exit's own computed key is listed under its new id and focused without reopening.
    await user.click(within(inDialog).getByRole('button', { name: /node finish config\.returns/ }));
    expect(screen.getByRole('dialog', { name: 'Edit exit finish' })).toBe(dialog);
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-field]')).toHaveAttribute(
        'data-field',
        'returns',
      ),
    );

    // Dismiss returns focus to the id field.
    await user.click(within(inDialog).getByRole('button', { name: 'Dismiss notice' }));
    expect(within(dialog).queryByText('Renamed done to finish')).toBeNull();
    expect(within(dialog).getByLabelText('Node id')).toHaveFocus();
  });

  it('repairs readers on Enter and lists what to review, which opens the field', async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await editNode('work', 'Edit inference work');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft{Enter}');

    // The dialog follows the rename, focus stays in the id field, and the readers changed.
    expect(screen.getByRole('dialog', { name: 'Edit inference draft' })).toBe(dialog);
    expect(id).toHaveFocus();
    expect(config('review')['prompt']).toEqual({
      template: 'Check {{ outputs.draft.value }}. Mention work by name.',
    });
    expect(config('done')['returns']).toBe('[outputs.draft.value, $lookup(outputs, vars.key)]');
    expect(store().past.map((step) => step.label)).toEqual(['rename work to draft']);

    const inDialog = notice(dialog, 'Renamed work to draft');
    expect(inDialog).toHaveTextContent(
      'Updated 3 references in expressions, templates and mutation paths, and 2 connections. ' +
        'Plain text, JSON values and scripts are not changed.',
    );
    expect(inDialog).toHaveTextContent('Review one place where work may remain:');
    expect(inDialog).toHaveTextContent('Undo reverses the whole rename.');
    const row = within(inDialog).getByRole('button', { name: /node done config\.returns/ });
    expect(row).toHaveTextContent('Warning');
    expect(row).toHaveTextContent('NODE_REFERENCE_UNCERTAIN');

    // Choosing the row opens the exit at its Returns field; the notice stays for the next one.
    await user.click(row);
    const exit = await screen.findByRole('dialog', { name: 'Edit exit done' });
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-field]')).toHaveAttribute(
        'data-field',
        'returns',
      ),
    );
    expect(within(exit).getByText('Renamed work to draft')).toBeVisible();

    // Above the canvas it remains after the dialog closes, and Dismiss ends it.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const onPage = notice(document.body, 'Renamed work to draft');
    await user.click(within(onPage).getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByText('Renamed work to draft')).toBeNull();
    expect(store().renameReport).toBeUndefined();
  });

  it('applies an id typed when the dialog closes and reports it above the canvas', async () => {
    const user = userEvent.setup();
    await openEditor();
    const dialog = await editNode('work', 'Edit inference work');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store().selectedNodeId).toBe('draft');

    const onPage = notice(document.body, 'Renamed work to draft');
    await user.click(within(onPage).getByRole('button', { name: /node done config\.returns/ }));
    await screen.findByRole('dialog', { name: 'Edit exit done' });
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-field]')).toHaveAttribute(
        'data-field',
        'returns',
      ),
    );
  });

  it('says nothing more than before for a rename that only moves connections', async () => {
    const user = userEvent.setup();
    // A computed key could name any node, so every rename lists it; this loop has none.
    const definition = referencing();
    definition.nodes = definition.nodes.map((n) =>
      n.kind === 'exit' ? { ...n, config: { returns: 'outputs.work.value' } } : n,
    );
    await openEditor(definition);
    const dialog = await editNode('start', 'Edit trigger start');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'begin{Enter}');
    expect(store().definition!.edges[0]!.from.node).toBe('begin');
    expect(store().renameReport).toMatchObject({ references: 0, connections: 1, warnings: [] });
    expect(screen.queryByText(/Renamed start to begin/)).toBeNull();
    expect(
      [...document.querySelectorAll('[role="status"]')].filter((el) =>
        el.textContent.includes('Renamed'),
      ),
    ).toEqual([]);
  });

  it('remounts the open form with its repaired source and keeps focus where the user went', async () => {
    const user = userEvent.setup();
    await openEditor(selfReading());
    const dialog = await editNode('gate', 'Edit decision gate');
    const passes = within(dialog).getByLabelText('Maximum passes', { exact: true });
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'check');
    // Leaving the id field for a field of this form renames the node as focus moves.
    await user.click(passes);

    expect(screen.getByRole('dialog', { name: 'Edit decision check' })).toBe(dialog);
    expect(getCode('Jsonata')).toBe('counters.nodeVisits.check > 2 ? "stop" : "again"');
    const remounted = within(dialog).getByLabelText('Maximum passes', { exact: true });
    expect(remounted).not.toBe(passes);
    expect(remounted).toHaveFocus();

    // Editing the remounted form never writes the old source back.
    await user.clear(remounted);
    await user.type(remounted, '4');
    expect(config('check')).toMatchObject({
      jsonata: 'counters.nodeVisits.check > 2 ? "stop" : "again"',
      maxPasses: 4,
    });
    setCode('Jsonata', 'counters.nodeVisits.check > 3 ? "stop" : "again"');
    expect(config('check')['jsonata']).toBe('counters.nodeVisits.check > 3 ? "stop" : "again"');
  });

  it('remounts only the settings form, keeping unfinished variables text', async () => {
    const user = userEvent.setup();
    await openEditor();
    const panel = screen.getByRole('complementary', { name: 'Loop settings' });
    setCode('Variables value 1', '[1, ');
    await waitFor(() => expect(store().fieldErrors['variables']).toBeDefined());
    const variables = store().fieldErrors['variables'];
    const variablesValue = within(panel)
      .getAllByLabelText('Variables value 1')
      .find((el) => el.classList.contains('cm-content'));

    const dialog = await editNode('work', 'Edit inference work');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(getCode('Template')).toBe('/tmp/{{ outputs.draft.value }}');
    expect(getCode('Variables value 1')).toBe('[1, ');
    expect(
      within(panel)
        .getAllByLabelText('Variables value 1')
        .find((el) => el.classList.contains('cm-content')),
    ).toBe(variablesValue);
    expect(store().fieldErrors['variables']).toBe(variables);

    // Another settings field's edit keeps the repaired directory.
    const visits = within(panel).getByLabelText('Maximum node visits');
    await user.clear(visits);
    await user.type(visits, '4');
    expect(store().definition!.settings).toMatchObject({
      maxNodeVisits: 4,
      workingDirectory: { kind: 'template', template: '/tmp/{{ outputs.draft.value }}' },
    });
  });

  it('saves the whole rename once with If-Match, mirrors it, and saves its undo and redo', async () => {
    const user = userEvent.setup();
    const { api, loop, token } = await openEditor();
    const puts = () => api.callsTo('PUT', `/loops/${loop.id}/draft`);
    const dialog = await editNode('work', 'Edit inference work');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft{Enter}');
    const renamed = store().definition;
    await waitFor(() => expect(puts()).toHaveLength(1), SAVE_WAIT);
    expect(puts()[0]!.headers.get('if-match')).toBe(`"${token!}"`);
    expect((puts()[0]!.body as { definition: unknown }).definition).toEqual(renamed);
    await waitFor(async () =>
      expect(await loadLocalDraft(loop.id)).toMatchObject({
        definition: renamed,
        synced: true,
        baseToken: api.draftToken(loop.id),
      }),
    );

    // Undo restores the whole draft and saves it against the token of the rename's save.
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const afterRename = api.draftToken(loop.id);
    await user.click(screen.getByRole('button', { name: 'Undo rename work to draft' }));
    expect(node('work')).toBeDefined();
    expect(config('review')['prompt']).toEqual({
      template: 'Check {{ outputs.work.value }}. Mention work by name.',
    });
    expect(store().renameReport).toBeUndefined();
    await waitFor(() => expect(puts()).toHaveLength(2), SAVE_WAIT);
    expect(puts()[1]!.headers.get('if-match')).toBe(`"${afterRename!}"`);
    expect((puts()[1]!.body as { definition: unknown }).definition).toEqual(store().definition);

    await user.click(screen.getByRole('button', { name: 'Redo rename work to draft' }));
    expect(store().definition).toEqual(renamed);
    await waitFor(() => expect(puts()).toHaveLength(3), SAVE_WAIT);
    expect((puts()[2]!.body as { definition: unknown }).definition).toEqual(renamed);
  });

  it('keeps a rename made against a stale draft until the author overwrites or reloads', async () => {
    const user = userEvent.setup();
    const { api, loop } = await openEditor();
    api.saveDraftElsewhere(loop.id, { ...referencing(), description: 'theirs' });
    const dialog = await editNode('work', 'Edit inference work');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft{Enter}');
    const renamed = store().definition;
    expect(
      await within(dialog).findByText('The draft changed on the server', undefined, SAVE_WAIT),
    ).toBeVisible();
    expect(store().definition).toBe(renamed);
    await user.click(within(dialog).getByRole('button', { name: 'Overwrite with this copy' }));
    await waitFor(
      () => expect(api.callsTo('PUT', `/loops/${loop.id}/draft`).at(-1)).toBeDefined(),
      SAVE_WAIT,
    );
    await waitFor(() => expect(store().conflict).toBeUndefined(), SAVE_WAIT);
    const last = api.callsTo('PUT', `/loops/${loop.id}/draft`).at(-1)!;
    expect((last.body as { definition: unknown }).definition).toEqual(renamed);
  });

  it('keeps a rename on the device while the loop name is refused, and saves it whole with the suggestion', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.addLoop(newLoopDefinition('Nightly Triage'));
    const loop = api.addLoop(referencing());
    const puts = () => api.callsTo('PUT', `/loops/${loop.id}/draft`);
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'references' });

    // The loop's own name is refused first (#209): saves are held, the device keeps the edits.
    act(() => store().updateMeta({ name: 'nightly triage' }));
    expect(
      await screen.findByText('Another loop already has this name', undefined, SAVE_WAIT),
    ).toBeInTheDocument();
    const held = puts().length;

    // A node rename meanwhile is still one atomic step, shown beside the name notice.
    const dialog = await editNode('work', 'Edit inference work');
    expect(within(dialog).getByText('Another loop already has this name')).toBeInTheDocument();
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft{Enter}');
    const renamed = store().definition!;
    expect(id).toHaveFocus();
    expect(notice(dialog, 'Renamed work to draft')).toHaveTextContent(
      'Updated 3 references in expressions, templates and mutation paths, and 2 connections.',
    );
    expect(config('review')['prompt']).toEqual({
      template: 'Check {{ outputs.draft.value }}. Mention work by name.',
    });
    expect(store().past.at(-1)?.label).toBe('rename work to draft');
    await waitFor(async () =>
      expect(await loadLocalDraft(loop.id)).toMatchObject({ definition: renamed, synced: false }),
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(puts()).toHaveLength(held);

    // Taking the suggestion sends the whole renamed draft once, under the suggested name.
    await user.click(within(dialog).getByRole('button', { name: 'Use “nightly triage copy”' }));
    await waitFor(() => expect(puts()).toHaveLength(held + 1), SAVE_WAIT);
    expect((puts().at(-1)!.body as { definition: unknown }).definition).toEqual({
      ...renamed,
      name: 'nightly triage copy',
    });
    await waitFor(
      () => expect(within(dialog).queryByText('Another loop already has this name')).toBeNull(),
      SAVE_WAIT,
    );
    // The rename's report outlives the name change; it ends only by its own rules.
    expect(notice(dialog, 'Renamed work to draft')).toBeVisible();
    await waitFor(async () =>
      expect(await loadLocalDraft(loop.id)).toMatchObject({
        definition: { ...renamed, name: 'nightly triage copy' },
        synced: true,
      }),
    );
  });

  it('keeps each operation row and its open state when Enter repairs a Coerce source in place', async () => {
    const user = userEvent.setup();
    await openEditor(selfCoercing());
    const dialog = await editNode('work', 'Edit mutate work');
    // Identical neighbours differ only in their open state; the Coerce row is open too.
    await user.click(operation(dialog, 1));
    await user.click(operation(dialog, 3));
    expect(opened(dialog, 3)).toEqual(['true', 'false', 'true']);
    const rows = operationRows(dialog, 3);
    const source = coerceSource(dialog);
    expect(source).toHaveValue('/counters/nodeVisits/work');

    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft{Enter}');
    expect(screen.getByRole('dialog', { name: 'Edit mutate draft' })).toBe(dialog);
    expect(id).toHaveFocus();
    expect(config('draft')['operations']).toEqual([
      { op: 'append-message', role: 'note', content: 'Same note' },
      { op: 'append-message', role: 'note', content: 'Same note' },
      expect.objectContaining({ op: 'coerce', source: '/counters/nodeVisits/draft' }),
    ]);
    expect(labels()).toEqual(['rename work to draft']);

    // The form remounted with the repaired source, on the same rows in the same open state.
    expect(coerceSource(dialog)).not.toBe(source);
    expect(coerceSource(dialog)).toHaveValue('/counters/nodeVisits/draft');
    expect(operationRows(dialog, 3)).toEqual(rows);
    expect(opened(dialog, 3)).toEqual(['true', 'false', 'true']);

    // Undo and redo from the Coerce header keep the rows, their state and the header's focus.
    act(() => operation(dialog, 3).focus());
    await user.keyboard(UNDO);
    expect(screen.getByRole('dialog', { name: 'Edit mutate work' })).toBe(dialog);
    expect(coerceSource(dialog)).toHaveValue('/counters/nodeVisits/work');
    expect(operationRows(dialog, 3)).toEqual(rows);
    expect(opened(dialog, 3)).toEqual(['true', 'false', 'true']);
    expect(operation(dialog, 3)).toHaveFocus();
    await user.keyboard(REDO);
    expect(screen.getByRole('dialog', { name: 'Edit mutate draft' })).toBe(dialog);
    expect(coerceSource(dialog)).toHaveValue('/counters/nodeVisits/draft');
    expect(operationRows(dialog, 3)).toEqual(rows);
    expect(opened(dialog, 3)).toEqual(['true', 'false', 'true']);
    expect(operation(dialog, 3)).toHaveFocus();
  });

  it('moves focus to the remounted nested Source the pointer chose when leaving the id renames', async () => {
    const user = userEvent.setup();
    await openEditor(selfCoercing());
    const dialog = await editNode('work', 'Edit mutate work');
    await user.click(operation(dialog, 2));
    await user.click(operation(dialog, 3));
    expect(opened(dialog, 3)).toEqual(['false', 'true', 'true']);
    const rows = operationRows(dialog, 3);
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft');

    // Pressing the visible Source commits the id as it loses focus; the form remounts under it.
    const source = coerceSource(dialog);
    await user.click(source);
    expect(screen.getByRole('dialog', { name: 'Edit mutate draft' })).toBe(dialog);
    // Focus is on the same row's remounted Source, not on a fallback for a vanished row.
    const focused = document.activeElement;
    expect(focused?.closest('[data-field]')).toHaveAttribute('data-field', 'operations.2.source');
    expect(focused?.closest('[data-row-id]')).toHaveAttribute('data-row-id', rows[2]);
    expect(focused).not.toBe(source);
    expect(focused).toHaveValue('/counters/nodeVisits/draft');
    expect(coerceSource(dialog)).toBe(focused);
    expect(operationRows(dialog, 3)).toEqual(rows);
    expect(opened(dialog, 3)).toEqual(['false', 'true', 'true']);
    expect(labels()).toEqual(['rename work to draft']);

    // Typing then edits the repaired source; the old one is never written back.
    await user.keyboard('/x');
    expect(config('draft')['operations']).toEqual([
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ op: 'coerce', source: '/counters/nodeVisits/draft/x' }),
    ]);
  });

  it('never leads a review row to another operation after the warned row moves', async () => {
    const user = userEvent.setup();
    await openEditor(auditing());
    const dialog = await editNode('work', 'Edit inference work');
    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft{Enter}');
    const summary =
      'Updated 3 references in expressions, templates and mutation paths, and 2 connections.';
    const auditRow = (scope: HTMLElement) =>
      within(notice(scope, 'Renamed work to draft')).queryAllByRole('button', {
        name: /node audit config\.operations\.1\.content/,
      });

    // At first the row is exact: it opens Audit at the second operation's computed read.
    expect(notice(dialog, 'Renamed work to draft')).toHaveTextContent(summary);
    await user.click(auditRow(dialog)[0]!);
    const audit = await screen.findByRole('dialog', { name: 'Edit mutate audit' });
    await waitFor(() => expect(focusedCode()).toBe('Read {{ outputs[vars.key] }}'));
    const warned = document.activeElement!.closest('[data-row-id]')!.getAttribute('data-row-id');

    // Removing the first operation moves that read to index 0 and the third note to index 1.
    await user.click(within(audit).getByRole('button', { name: 'Remove operations 1' }));
    expect(config('audit')['operations']).toEqual([
      { op: 'append-message', role: 'note', content: 'Read {{ outputs[vars.key] }}' },
      { op: 'append-message', role: 'note', content: 'Third note' },
    ]);
    expect(audit.querySelector('[data-row-path="operations.0"]')).toHaveAttribute(
      'data-row-id',
      warned,
    );

    // Whatever the notice still offers for Audit must reach the computed read, never the note.
    for (const row of auditRow(audit)) {
      await user.click(row);
      await waitFor(() => expect(focusedCode()).toBe('Read {{ outputs[vars.key] }}'));
    }
    // It keeps the place and the summary, and says why the place no longer opens.
    const inDialog = notice(audit, 'Renamed work to draft');
    expect(auditRow(audit)).toEqual([]);
    expect(inDialog).toHaveTextContent(summary);
    expect(inDialog).toHaveTextContent('Review 2 places where work may remain:');
    expect(inDialog).toHaveTextContent('node audit config.operations.1.content');
    expect(inDialog).toHaveTextContent(
      'audit changed after the rename. Its places show where they were then and no longer open a field.',
    );
    expect(
      within(inDialog).getByRole('button', { name: /node done config\.returns/ }),
    ).toBeEnabled();
    expect(focusedCode()).not.toBe('Third note');

    // Undoing the removal restores the configuration the rename left, and with it the exact row.
    act(() => operation(audit, 1).focus());
    await user.keyboard(UNDO);
    expect(config('audit')['operations']).toHaveLength(3);
    await user.click(auditRow(audit)[0]!);
    await waitFor(() => expect(focusedCode()).toBe('Read {{ outputs[vars.key] }}'));
    act(() => operation(audit, 1).focus());
    await user.keyboard(REDO);
    expect(config('audit')['operations']).toHaveLength(2);

    // Above the canvas the same row only informs too.
    await user.click(within(audit).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(auditRow(document.body)).toEqual([]);
    expect(notice(document.body, 'Renamed work to draft')).toHaveTextContent(
      'node audit config.operations.1.content',
    );
  });

  it('keeps held section JSON exactly when a rename makes the applied section equal to it', async () => {
    const user = userEvent.setup();
    await openEditor(selfInput());
    const dialog = await editNode('work', 'Edit inference work');
    await user.click(within(dialog).getByRole('tab', { name: /^Context/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Edit as JSON: Input' }));
    // Valid, differently spaced, and already naming the id the node is about to get.
    const text = [
      '[',
      '    {',
      '        "op": "append-message",',
      '        "role": "note",',
      '        "content": "Visit {{ counters.nodeVisits.draft }}"',
      '    }',
      ']',
    ].join('\n');
    setCode('Input JSON', text);
    const held = { message: PENDING, text, input: 'unapplied JSON' };
    expect(within(dialog).getByText(PENDING)).toBeVisible();
    expect(store().fieldErrors).toEqual({ 'node:work': { input: held } });
    expect(config('work')['input']).toEqual([
      { op: 'append-message', role: 'note', content: 'Visit {{ counters.nodeVisits.work }}' },
    ]);
    const original = store().definition;
    const before = labels();

    const id = within(dialog).getByLabelText('Node id');
    await user.clear(id);
    await user.type(id, 'draft{Enter}');
    const renamed = store().definition;
    // The accepted section is repaired and now equals the buffer, which still waits for the author.
    expect(config('draft')['input']).toEqual([
      { op: 'append-message', role: 'note', content: 'Visit {{ counters.nodeVisits.draft }}' },
    ]);
    expect(renamed!.edges.filter((edge) => edge.to.node === 'draft')).toHaveLength(1);
    expect(getCode('Input JSON')).toBe(text);
    expect(within(dialog).getByText(PENDING)).toBeVisible();
    expect(store().fieldErrors).toEqual({ 'node:draft': { input: held } });
    expect(labels()).toEqual([...before, 'rename work to draft']);
    expect(store().future).toEqual([]);

    // One undo, from a control without text, restores the id, source, edges and the exact buffer.
    act(() => within(dialog).getByRole('button', { name: 'Apply JSON' }).focus());
    await user.keyboard(UNDO);
    expect(screen.getByRole('dialog', { name: 'Edit inference work' })).toBe(dialog);
    expect(store().definition).toBe(original);
    expect(store().fieldErrors).toEqual({ 'node:work': { input: held } });
    expect(getCode('Input JSON')).toBe(text);
    expect(within(dialog).getByText(PENDING)).toBeVisible();
    expect(labels()).toEqual(before);
    expect(store().future.map((step) => step.label)).toEqual(['rename work to draft']);

    // One redo restores the repair and the same held buffer, with nothing left to redo.
    act(() => within(dialog).getByRole('button', { name: 'Apply JSON' }).focus());
    await user.keyboard(REDO);
    expect(screen.getByRole('dialog', { name: 'Edit inference draft' })).toBe(dialog);
    expect(store().definition).toBe(renamed);
    expect(store().fieldErrors).toEqual({ 'node:draft': { input: held } });
    expect(getCode('Input JSON')).toBe(text);
    expect(labels()).toEqual([...before, 'rename work to draft']);
    expect(store().future).toEqual([]);

    // Apply stays the author's own step: it ends the hold and leaves the equal section as it is.
    await user.click(within(dialog).getByRole('button', { name: 'Apply JSON' }));
    expect(store().fieldErrors).toEqual({});
    expect(store().definition).toBe(renamed);
    expect(within(dialog).queryByText(PENDING)).toBeNull();
    expect(labels()).toEqual([...before, 'rename work to draft', 'edit config of draft']);
    act(() => within(dialog).getByRole('button', { name: 'Apply JSON' }).focus());
    await user.keyboard(UNDO);
    expect(store().fieldErrors).toEqual({ 'node:draft': { input: held } });
    expect(getCode('Input JSON')).toBe(text);
    expect(store().definition).toBe(renamed);
  });
});
