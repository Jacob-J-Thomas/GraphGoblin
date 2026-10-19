import {
  DecisionConfigSchema,
  type LoopDefinitionInput,
  type NodeInput,
} from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { manualTriggerConfig } from '../__fixtures__/triggers.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { renderApp } from '../__fixtures__/render.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { defaultConfig, newLoopDefinition, validateDraft } from './model.js';
import { useEditorStore } from './store.js';

const UNDO = '{Control>}z{/Control}';
const REDO = '{Control>}{Shift>}z{/Shift}{/Control}';
const store = () => useEditorStore.getState();

/** A loop with one more node; triggers have a valid successor for preset admission. */
function loopWith(extra: NodeInput): LoopDefinitionInput {
  const definition = newLoopDefinition('dialog');
  return {
    ...definition,
    nodes: [...definition.nodes, extra],
    edges: [
      ...definition.edges,
      ...(extra.kind === 'trigger'
        ? [{ id: 'extra-start', from: { node: extra.id, port: 'out' }, to: { node: 'done' } }]
        : []),
    ],
  };
}

async function openDialog(
  extra: NodeInput,
  name: string,
  prepare?: (api: FakeApi, loopId: string) => void,
) {
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
  prepare?.(api, loop.id);
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'dialog' });
  act(() => store().openNode(extra.id));
  const dialog = await screen.findByRole('dialog', { name });
  await within(dialog).findByRole('form', { name: `${extra.id} config` });
  return dialog;
}

const advanced = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: /^Advanced\b/ });

/** Asserts that the named config fields render in this order, ignoring any others. */
function expectFieldOrder(dialog: HTMLElement, expected: readonly string[]) {
  const rendered = [...dialog.querySelectorAll('[data-field]')]
    .map((field) => field.getAttribute('data-field') ?? '')
    .filter((path) => expected.includes(path));
  expect([...new Set(rendered)]).toEqual(expected);
}

describe('NodeEditorDialog evaluator-specific decisions', () => {
  it.each(['success', 'failure', 'exhausted'] as const)(
    'authors terminal %s exits with returns and destinations',
    async (outcome) => {
      const user = userEvent.setup();
      const dialog = await openDialog(
        { id: 'finish', kind: 'exit', label: 'Finish', config: {} },
        'Edit exit finish',
      );
      await user.click(
        within(dialog).getByRole('radio', { name: outcome[0]!.toUpperCase() + outcome.slice(1) }),
      );
      await user.click(within(dialog).getByRole('radio', { name: 'JSONata expression' }));
      setCode('Return expression', 'outputs.work.value');
      expect(store().definition!.nodes.find((n) => n.id === 'finish')!.config).toMatchObject({
        outcome,
        returns: 'outputs.work.value',
      });
      expect(dialog.querySelector('[data-field="criteria"]')).toBeNull();
      expect(within(dialog).queryByRole('form', { name: 'Connect finish' })).toBeNull();
      expect(dialog.querySelector('[data-field="destinations"]')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('radio', { name: 'None' }));
      expect(store().definition!.nodes.find((n) => n.id === 'finish')!.config).toHaveProperty(
        'returns',
        'none',
      );
      await user.click(within(dialog).getByRole('radio', { name: 'JSONata expression' }));
      expect(store().definition!.nodes.find((n) => n.id === 'finish')!.config).toHaveProperty(
        'returns',
        'outputs.work.value',
      );
      act(() => store().undo());
      expect(store().definition!.nodes.find((n) => n.id === 'finish')!.config).toHaveProperty(
        'returns',
        'none',
      );
    },
  );
  it.each(['expression', 'llm', 'classifier'] as const)(
    'authors and saves a new %s decision from the default editor fields',
    async (kind) => {
      const user = userEvent.setup();
      let api: FakeApi | undefined,
        loopId = '';
      const dialog = await openDialog(
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: DecisionConfigSchema.parse(defaultConfig('decision')),
        },
        'Edit decision pick',
        (value, id) => {
          api = value;
          loopId = id;
        },
      );
      if (kind !== 'expression') {
        await user.click(within(dialog).getByRole('radio', { name: kind }));
        await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
      }
      if (kind === 'classifier') {
        await user.click(within(dialog).getByRole('radio', { name: 'Noul' }));
        await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
        await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Model' }), 'jev');
        setCode('Question', 'Does the evidence support approval?');
        for (const side of ['true', 'false']) {
          const field = dialog.querySelector<HTMLTextAreaElement>(
            `[data-field="answer.${side}.criteria"] textarea`,
          )!;
          await user.type(field, `Evidence supports ${side}`);
        }
      } else if (kind === 'llm') {
        setCode(
          'Instructions',
          'Choose Yes when the evidence supports approval; otherwise choose No.',
        );
        for (const [index, id, label] of [
          [0, 'yes', 'Yes'],
          [1, 'no', 'No'],
        ] as const) {
          for (const [key, text] of [
            ['id', id],
            ['label', label],
          ] as const) {
            const path = `routes.${index}.${key}`;
            act(() => store().openNode('pick', { field: `config.${path}` }));
            const input = dialog.querySelector<HTMLInputElement>(`[data-field="${path}"] input`)!;
            await waitFor(() => expect(input).toBeVisible());
            await user.clear(input);
            await user.type(input, text);
          }
        }
      } else setCode('Jsonata', '"no"');
      await waitFor(
        () => {
          const saved = api?.loops
            .get(loopId)
            ?.draft?.definition.nodes.find((node) => node.id === 'pick');
          expect(saved?.kind === 'decision' && saved.config.kind).toBe(kind);
          expect(
            saved?.kind === 'decision' && DecisionConfigSchema.safeParse(saved.config).success,
          ).toBe(true);
          if (kind === 'expression') expect(saved?.config).toMatchObject({ jsonata: '"no"' });
        },
        { timeout: 4000 },
      );
    },
  );
  const routes = [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No' },
  ];
  const answers = {
    choice: {
      type: 'choice',
      options: routes.map((route) => ({ ...route, criteria: `Select ${route.label}` })),
    },
    noul: {
      type: 'noul',
      true: { id: 'yes', label: 'Yes', criteria: 'True' },
      false: { id: 'no', label: 'No', criteria: 'False' },
    },
    score: {
      type: 'score',
      anchors: ['Low', 'High'],
      bands: [
        { id: 'low', label: 'Low', min: 0, max: 0.5 },
        { id: 'high', label: 'High', min: 0.5, max: 1 },
      ],
    },
  } as const;
  const configs = [
    { kind: 'expression', jsonata: '"yes"', routes },
    {
      kind: 'llm',
      instructions: 'Choose the route for {{ vars.topic }}.',
      routes,
      harness: 'codex',
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
    },
    ...(['choice', 'noul', 'score'] as const).map((type) => ({
      kind: 'classifier',
      model: 'jev',
      question: 'Classify {{ vars.topic }}.',
      answer: answers[type],
    })),
  ];
  it.each(configs)('edits and saves a valid $kind decision', async (config) => {
    let savedApi: FakeApi | undefined,
      loopId = '';
    const dialog = await openDialog(
      { id: 'pick', kind: 'decision', label: 'Pick', config: DecisionConfigSchema.parse(config) },
      'Edit decision pick',
      (api, id) => {
        savedApi = api;
        loopId = id;
      },
    );
    expect(within(dialog).getByRole('radiogroup', { name: 'Decision kind' })).toBeVisible();
    const source =
      config.kind === 'expression'
        ? 'jsonata'
        : config.kind === 'llm'
          ? 'instructions'
          : 'question';
    const fields = [...dialog.querySelectorAll('[data-field]')].map((field) =>
      field.getAttribute('data-field'),
    );
    // Identity, then the evaluator picker, before any evaluator-specific fields.
    expect(fields.slice(0, 3)).toEqual(['id', 'label', 'kind']);
    const sourceField = dialog.querySelector(`[data-field="${source}"]`)!;
    const method = within(dialog).getByRole('radiogroup', { name: 'Decision kind' });
    expect(
      method.compareDocumentPosition(sourceField) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    if (config.kind === 'classifier') {
      const model = dialog.querySelector('[data-field="model"]')!;
      const answer = dialog.querySelector('[data-field="answer"]')!;
      expect(
        sourceField.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(model.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      act(() => store().openNode('pick', { field: 'config.model' }));
      await waitFor(() => expect(model).toContainElement(document.activeElement as HTMLElement));
      act(() => store().openNode('pick', { field: 'config.question' }));
      await waitFor(() =>
        expect(sourceField).toContainElement(document.activeElement as HTMLElement),
      );
    }
    const text = config.kind === 'expression' ? '"no"' : 'Use the complete evidence.';
    setCode(
      source === 'jsonata' ? 'Jsonata' : source === 'instructions' ? 'Instructions' : 'Question',
      text,
    );
    await waitFor(
      () => {
        const saved = savedApi?.loops
          .get(loopId)
          ?.draft?.definition.nodes.find((node) => node.id === 'pick');
        expect(
          saved?.kind === 'decision' && DecisionConfigSchema.safeParse(saved.config).success,
        ).toBe(true);
        expect(saved?.config).toMatchObject({ [source]: text, kind: config.kind });
      },
      { timeout: 4000 },
    );
  });
  it('selects each kind with only its applicable fields and keeps source issue focus', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: DecisionConfigSchema.parse(configs[0]),
      },
      'Edit decision pick',
    );
    await user.click(within(dialog).getByRole('radio', { name: 'llm' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
    expect(dialog.querySelector('[data-field="instructions"]')).toBeInTheDocument();
    expect(dialog.querySelector('[data-field="jsonata"]')).not.toBeInTheDocument();
    expectFieldOrder(dialog, ['kind', 'instructions', 'routes', 'model']);
    act(() => store().openNode('pick', { field: 'config.instructions' }));
    await waitFor(() =>
      expect(dialog.querySelector('[data-field="instructions"]')).toContainElement(
        document.activeElement as HTMLElement,
      ),
    );
    await user.click(within(dialog).getByRole('radio', { name: 'classifier' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
    expect(within(dialog).getByRole('radiogroup', { name: 'Answer type' })).toBeVisible();
    expectFieldOrder(dialog, ['kind', 'question', 'model', 'answer']);
    await user.click(within(dialog).getByRole('radio', { name: 'Noul' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
    expectFieldOrder(dialog, ['kind', 'question', 'model', 'answer']);
    const node = store().definition?.nodes.find((node) => node.id === 'pick');
    expect(node?.config).toMatchObject({ kind: 'classifier', answer: { type: 'noul' } });
    await user.click(advanced(dialog));
    expect(
      within(dialog).getByLabelText('Noul true-probability threshold', { exact: true }),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('radio', { name: 'Score' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
    expect(
      within(dialog).queryByLabelText('Noul true-probability threshold', { exact: true }),
    ).not.toBeInTheDocument();
    expectFieldOrder(dialog, ['kind', 'question', 'model', 'answer']);
    await user.click(within(dialog).getByRole('radio', { name: 'expression' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
    expect(dialog.querySelector('[data-field="jsonata"]')).toBeInTheDocument();
    expectFieldOrder(dialog, ['kind', 'jsonata', 'routes']);
    expect(
      within(dialog).queryByRole('radiogroup', { name: 'Answer type' }),
    ).not.toBeInTheDocument();
  });
});

describe('NodeEditorDialog webhook receiver', () => {
  it('shows Receiver only while the trigger type is Webhook', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      { id: 'receiver', kind: 'trigger', label: 'Receiver', config: manualTriggerConfig() },
      'Edit trigger receiver',
    );
    const scope = within(dialog);
    expect(scope.queryByRole('region', { name: 'Receiver' })).toBeNull();
    for (const type of ['cron', 'poll', 'event', 'webhook', 'manual']) {
      await user.selectOptions(scope.getByLabelText('Trigger type'), type);
      if (type === 'webhook') {
        expect(scope.getByRole('region', { name: 'Receiver' })).toBeVisible();
        expect(
          await scope.findByText(
            'This node has no published receiver yet. The URL appears after you publish an enabled webhook trigger.',
          ),
        ).toBeVisible();
      } else {
        expect(scope.queryByRole('region', { name: 'Receiver' })).toBeNull();
      }
    }
  });

  it('does not show Receiver for other node kinds', async () => {
    const dialog = await openDialog(
      { id: 'finish', kind: 'exit', label: 'Finish', config: {} },
      'Edit exit finish',
    );
    expect(within(dialog).queryByRole('region', { name: 'Receiver' })).toBeNull();
  });
});

describe('NodeEditorDialog GitHub trigger presets', () => {
  it('applies an editable body-signed fragment as one undoable graph change', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'github',
        kind: 'trigger',
        label: 'GitHub',
        config: manualTriggerConfig(),
      },
      'Edit trigger github',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Start from a preset' }));
    await user.selectOptions(within(dialog).getByLabelText('Preset'), 'issues-labeled');
    await user.type(within(dialog).getByLabelText('Repository owner'), 'octo-team');
    await user.type(within(dialog).getByLabelText('Repository'), 'service');
    await user.type(within(dialog).getByLabelText('Issue label'), 'ready');
    await user.type(within(dialog).getByLabelText('Signing secret name'), 'issue-hook');
    await user.click(within(dialog).getByRole('button', { name: 'Preview GitHub preset' }));
    expect(within(dialog).getByRole('region', { name: 'Preset preview' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Apply GitHub preset' }));

    const node = () => store().definition?.nodes.find((candidate) => candidate.id === 'github');
    expect(node()?.config).toMatchObject({
      type: 'webhook',
      authentication: {
        type: 'hmac-sha256',
        message: 'body',
        header: 'x-hub-signature-256',
        secretRef: 'issue-hook',
      },
      dedupeKey: '$headers."x-github-delivery"',
    });
    expect(node()?.config).not.toHaveProperty('filter');
    expect(
      store().definition!.nodes.find((candidate) => candidate.id === 'event-check')!.config,
    ).toMatchObject({
      jsonata: expect.stringContaining('repository.full_name = "octo-team/service"'),
    });
    expect(store().definition!.edges.find((edge) => edge.id === 'extra-start')!.from.node).toBe(
      'restore-output',
    );
    expect(store().past).toHaveLength(1);
    expect(within(dialog).getByLabelText('Trigger type')).toHaveDisplayValue('Webhook');
    expect(within(dialog).queryByLabelText('Replay window seconds')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Secret name')).toHaveValue('issue-hook');
    expect(getCode('Dedupe key')).toBe('$headers."x-github-delivery"');
    expect(within(dialog).queryByLabelText('Per-item dedupe key')).not.toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('Secret name'));
    await user.type(within(dialog).getByLabelText('Secret name'), 'renamed-hook');
    expect(node()?.config).toMatchObject({ authentication: { secretRef: 'renamed-hook' } });

    act(() => store().undo());
    expect(node()?.config).toMatchObject({
      type: 'webhook',
      authentication: { secretRef: 'issue-hook' },
    });
    act(() => store().undo());
    expect(node()?.config).toEqual({ type: 'manual', exposeTo: ['ui', 'api', 'mcp'] });
  });

  it('shows bounded item controls for the GitHub poll preset', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(
      {
        id: 'backlog',
        kind: 'trigger',
        label: 'Backlog',
        config: manualTriggerConfig(),
      },
      'Edit trigger backlog',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Start from a preset' }));
    await user.selectOptions(within(dialog).getByLabelText('Preset'), 'issues-poll');
    await user.type(within(dialog).getByLabelText('Repository owner'), 'octo');
    await user.type(within(dialog).getByLabelText('Repository'), 'service');
    await user.type(within(dialog).getByLabelText('Issue label'), 'ready');
    await user.click(within(dialog).getByRole('button', { name: 'Preview GitHub preset' }));
    expect(within(dialog).getByRole('region', { name: 'Preset preview' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Apply GitHub preset' }));

    expect(within(dialog).getByLabelText('Max runs per poll')).toHaveValue(5);
    expect(within(dialog).getByLabelText('Max runs per poll')).toHaveAttribute('max', '25');
    expect(getCode('Select')).toBe('probe.json');
    expect(getCode('Whole-probe dedupe key (single-result only)')).toBe('');
    expect(getCode('Per-item dedupe key')).toBe('"octo/service:issue:" & $string(item.number)');
    setCode('Per-item dedupe key', '$string(item.number)');
    await waitFor(() =>
      expect(store().definition?.nodes.find((node) => node.id === 'backlog')?.config).toMatchObject(
        {
          items: { dedupeKey: '$string(item.number)' },
        },
      ),
    );
    expect(
      store().definition?.nodes.find((node) => node.id === 'backlog')?.config,
    ).not.toHaveProperty('dedupeKey');
    await user.selectOptions(within(dialog).getByLabelText('Trigger type'), 'webhook');
    await waitFor(() => expect(getCode('Dedupe key')).toBe(''));
    expect(within(dialog).queryByLabelText('Per-item dedupe key')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText('Whole-probe dedupe key (single-result only)'),
    ).not.toBeInTheDocument();
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
          type: 'cron',
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
    act(() => within(dialog).getByRole('radio', { name: 'codex' }).focus());
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

describe('NodeEditorDialog inference harness changes', () => {
  it('preserves other authored harness options and reports unsupported Claude settings', async () => {
    const otherOptions = {
      networkAccess: false,
      webSearch: true,
      configOverrides: { custom: 'authored' },
    };
    const dialog = await openDialog(
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          harness: 'codex',
          prompt: { template: 'Hi' },
          harnessOptions: {
            ...otherOptions,
            sandbox: 'workspace-write',
            approval: 'on-request',
          },
        },
      },
      'Edit inference infer',
    );
    await userEvent.setup().click(within(dialog).getByRole('radio', { name: 'claude' }));
    expect(store().definition?.nodes.find((node) => node.id === 'infer')?.config).toMatchObject({
      harness: 'claude',
      harnessOptions: { ...otherOptions, sandbox: 'read-only', approval: 'never' },
    });
    const issues = validateDraft(store().definition!).issues;
    for (const option of Object.keys(otherOptions))
      expect(issues).toContainEqual(
        expect.objectContaining({ nodeId: 'infer', path: `config.harnessOptions.${option}` }),
      );
  });

  it.each([true, false])(
    'keeps the saved model and resets to a supported policy with readiness %s',
    async (ready) => {
      const user = userEvent.setup();
      const dialog = await openDialog(
        {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: {
            harness: 'codex',
            model: 'alpha',
            effort: 'high',
            harnessOptions: { sandbox: 'workspace-write', approval: 'on-request' },
            prompt: { template: 'Hi' },
          },
        },
        'Edit inference infer',
        (api) => {
          api.catalog.push({
            harness: 'claude',
            model: 'claude-opus-5-5',
            displayName: 'Opus',
            source: 'harness',
            efforts: ['low', 'high'],
            defaultEffort: 'high',
            enabled: true,
          });
          api.preflight.push({
            harness: 'claude',
            state: ready ? 'ready' : 'cli-incompatible',
            ok: ready,
            authenticated: true,
            problems: ready ? [] : ['Missing capability'],
            models: [{ model: 'claude-opus-5-5', efforts: ['low', 'high'] }],
            supportedPolicies: [
              {
                sandbox: 'read-only',
                approval: 'never',
                permissionMode: 'dontAsk',
                tools: ['Read'],
                authMethod: 'claude.ai',
                boundary: 'builtin-tools',
                network: 'unconfined',
              },
            ],
          });
        },
      );
      await user.click(within(dialog).getByRole('radio', { name: 'claude' }));
      await waitFor(() =>
        expect(store().definition?.nodes.find((node) => node.id === 'infer')?.config).toMatchObject(
          {
            harness: 'claude',
            model: 'alpha',
            effort: 'high',
            harnessOptions: { sandbox: 'read-only', approval: 'never' },
          },
        ),
      );
      expect(within(dialog).getByRole('radio', { name: 'claude' })).toHaveFocus();
      await user.click(advanced(dialog));
      const model = within(dialog).getByLabelText('Model', { exact: true });
      await waitFor(() =>
        expect(
          within(model).getByRole('option', { name: /Saved model belongs to Codex/ }),
        ).toBeDisabled(),
      );
      expect(model).toHaveValue('alpha');
      if (ready) {
        await user.selectOptions(model, 'claude-opus-5-5');
        expect(store().definition?.nodes.find((node) => node.id === 'infer')?.config).toMatchObject(
          { model: 'claude-opus-5-5' },
        );
        act(() => store().undo());
      } else expect(model).toHaveAttribute('aria-readonly', 'true');
      act(() => store().undo());
      expect(store().definition?.nodes.find((node) => node.id === 'infer')?.config).toMatchObject({
        harness: 'codex',
        model: 'alpha',
        harnessOptions: { sandbox: 'workspace-write', approval: 'on-request' },
      });
    },
  );
});
