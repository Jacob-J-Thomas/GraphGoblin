import {
  DecisionConfigSchema,
  type LoopDefinitionInput,
  type NodeInput,
} from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { getCode } from '../__fixtures__/codemirror.js';
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

describe('NodeEditorDialog decision field order', () => {
  it('shows the evaluator before answer options and preserves issue focus paths', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          answer: {
            type: 'choice',
            options: [
              { id: 'ready', label: 'Ready', criteria: 'Choose ready' },
              { id: 'blocked', label: 'Blocked', criteria: 'Choose blocked' },
            ],
          },
          evaluation: {
            kind: 'llm',
            harness: 'codex',
            model: { mode: 'inherit' },
            effort: { mode: 'inherit' },
            question: 'Choose one',
            context: {},
          },
          recordAlternatives: true,
        },
      },
      'Edit decision pick',
    );
    const form = within(dialog).getByRole('form', { name: 'pick config' });
    const evaluation = form.querySelector<HTMLElement>('[data-field="evaluation"]');
    const answer = form.querySelector<HTMLElement>('[data-field="answer"]');
    if (!evaluation || !answer) throw new Error('Decision fields were not rendered.');
    expect(evaluation.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    expect(within(evaluation).getByRole('radiogroup', { name: 'Evaluation method' })).toBeVisible();

    const expression = within(evaluation).getByRole('radio', { name: 'Expression' });
    expression.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(expression).toBeChecked());

    act(() => store().openNode('pick', { field: 'config.evaluation.jsonata' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Jsonata')).toHaveFocus());

    const node = store().definition?.nodes.find((candidate) => candidate.id === 'pick');
    if (node?.kind !== 'decision') throw new Error('Decision node is missing from the editor.');
    const config = DecisionConfigSchema.parse(node.config);
    expect(config.evaluation.kind).toBe('expression');
    expect(config.answer.options).toEqual([
      { id: 'ready', label: 'Ready', criteria: 'Choose ready' },
      { id: 'blocked', label: 'Blocked', criteria: 'Choose blocked' },
    ]);
  });
});

describe('NodeEditorDialog GitHub trigger presets', () => {
  it('applies an editable body-signed preset as one undoable config change', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'github',
        kind: 'trigger',
        label: 'GitHub',
        config: { subtype: 'manual' },
      },
      'Edit trigger github',
    );

    await user.selectOptions(within(dialog).getByLabelText('Preset'), 'issues-labeled');
    await user.type(within(dialog).getByLabelText('Repository owner'), 'octo-team');
    await user.type(within(dialog).getByLabelText('Repository'), 'service');
    await user.type(within(dialog).getByLabelText('Issue label'), 'ready');
    await user.type(within(dialog).getByLabelText('Signing secret name'), 'issue-hook');
    await user.click(within(dialog).getByRole('button', { name: 'Apply GitHub preset' }));

    const node = () => store().definition?.nodes.find((candidate) => candidate.id === 'github');
    expect(node()?.config).toMatchObject({
      subtype: 'webhook',
      signature: {
        scheme: 'hmac-sha256-body',
        header: 'x-hub-signature-256',
        secretRef: 'issue-hook',
      },
      dedupeKey: '$headers."x-github-delivery"',
      filter: expect.stringContaining('repository.full_name = "octo-team/service"'),
    });
    expect(store().past).toHaveLength(1);
    expect(within(dialog).getByLabelText('Subtype')).toHaveDisplayValue('webhook (body)');
    expect(within(dialog).queryByLabelText('Replay window seconds')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Secret ref')).toHaveValue('issue-hook');

    await user.clear(within(dialog).getByLabelText('Secret ref'));
    await user.type(within(dialog).getByLabelText('Secret ref'), 'renamed-hook');
    expect(node()?.config).toMatchObject({ signature: { secretRef: 'renamed-hook' } });

    act(() => store().undo());
    expect(node()?.config).toMatchObject({
      subtype: 'webhook',
      signature: { secretRef: 'issue-hook' },
    });
    act(() => store().undo());
    expect(node()?.config).toEqual({ subtype: 'manual', exposeTo: ['ui', 'api', 'mcp'] });
  });

  it('shows bounded item controls for the GitHub poll preset', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'backlog',
        kind: 'trigger',
        label: 'Backlog',
        config: { subtype: 'manual' },
      },
      'Edit trigger backlog',
    );
    await user.selectOptions(within(dialog).getByLabelText('Preset'), 'issues-poll');
    await user.type(within(dialog).getByLabelText('Repository owner'), 'octo');
    await user.type(within(dialog).getByLabelText('Repository'), 'service');
    await user.type(within(dialog).getByLabelText('Issue label'), 'ready');
    await user.click(within(dialog).getByRole('button', { name: 'Apply GitHub preset' }));

    expect(within(dialog).getByLabelText('Max runs per poll')).toHaveValue(5);
    expect(within(dialog).getByLabelText('Max runs per poll')).toHaveAttribute('max', '25');
    expect(getCode('Select')).toBe('probe.json');
    // The poll also exposes a top-level key for single-result mode; item mode is the second editor.
    expect(getCode('Dedupe key', 1)).toBe('"octo/service:issue:" & $string(item.number)');
  });
});

describe('NodeEditorDialog disclosures across undo and redo', () => {
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it('keeps incomplete Monday 07:30 across closing, reopening, undo and redo', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'cron',
        kind: 'trigger',
        label: 'Cron',
        config: {
          subtype: 'cron',
          expression: '30 7 * * 1',
          timezone: 'UTC',
        },
      },
      'Edit trigger cron',
    );
    await user.click(within(dialog).getByLabelText('Monday'));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose at least one day.');
    expect(store().fieldErrors['node:cron']?.['expression']?.message).toBe(
      'Choose at least one day.',
    );
    expect(store().past).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    act(() => store().openNode('cron'));
    const reopened = await screen.findByRole('dialog', { name: 'Edit trigger cron' });
    const monday = () => within(reopened).getByLabelText('Monday');
    expect(monday()).not.toBeChecked();
    expect(within(reopened).getByLabelText('At time')).toHaveValue('07:30');
    expect(within(reopened).getByRole('alert')).toHaveTextContent('Choose at least one day.');
    monday().focus();
    await user.keyboard(UNDO);
    expect(monday()).toBeChecked();
    expect(store().fieldErrors).toEqual({});
    expect(store().past).toHaveLength(0);
    await user.keyboard(REDO);
    expect(monday()).not.toBeChecked();
    expect(within(reopened).getByRole('alert')).toHaveTextContent('Choose at least one day.');
    // A badge discard restores the stored expression even while this field is mounted.
    act(() => store().setFieldError('node:cron', 'expression', undefined, 'discard'));
    expect(monday()).toBeChecked();
    act(() => store().undo());
    expect(monday()).not.toBeChecked();
  });

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

  it.each([false, true])(
    'redoing removal from an injected message focuses the surviving operation header (open: %s)',
    async (neighbourOpen) => {
      const user = userEvent.setup();
      const dialog = await openDialog(
        {
          id: 'mut',
          kind: 'mutate',
          label: 'Mut',
          config: {
            operations: [
              { op: 'inject', position: 'end', messages: [{ role: 'note', content: 'First' }] },
              { op: 'inject', position: 'end', messages: [{ role: 'note', content: 'Second' }] },
            ],
          },
        },
        'Edit mutate mut',
      );
      const item = (n: number) =>
        within(dialog).getByRole('button', { name: new RegExp(`^Operations ${n}\\b`) });
      await user.click(item(1));
      if (neighbourOpen) await user.click(item(2));
      await user.click(within(dialog).getByRole('button', { name: 'Remove operations 1' }));
      await user.keyboard(UNDO);
      const role = within(within(dialog).getByRole('group', { name: 'Operations 1' })).getByRole(
        'combobox',
        { name: 'Role' },
      );
      act(() => role.focus());
      await user.keyboard(REDO);
      expect(item(1)).toHaveFocus();
      expect(item(1)).toHaveAttribute('aria-expanded', String(neighbourOpen));
      await user.keyboard(UNDO);
      expect(item(1)).toHaveAttribute('aria-expanded', 'true');
      expect(item(2)).toHaveAttribute('aria-expanded', String(neighbourOpen));
      expect(item(2)).toHaveFocus();
    },
  );

  it('undoing an injected message add returns to its surviving operation collection', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'mut',
        kind: 'mutate',
        label: 'Mut',
        config: {
          operations: [
            { op: 'inject', position: 'end', messages: [{ role: 'note', content: 'First' }] },
          ],
        },
      },
      'Edit mutate mut',
    );
    const item = () => within(dialog).getByRole('button', { name: /^Operations 1\b/ });
    await user.click(item());
    const add = () => within(dialog).getByRole('button', { name: 'Add messages' });
    await user.click(add());
    await waitFor(() =>
      expect(
        within(within(dialog).getByRole('group', { name: 'Messages 2' })).getByRole('combobox', {
          name: 'Role',
        }),
      ).toHaveFocus(),
    );
    await user.keyboard(UNDO);
    expect(add()).toHaveFocus();
    expect(item()).toHaveAttribute('aria-expanded', 'true');
  });
});
