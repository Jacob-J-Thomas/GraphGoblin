import { DecisionConfigSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { setCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import {
  clearActiveLocalDraft,
  loadLocalDraft,
  saveSetAsideDraft,
} from '../drafts/local-drafts.js';
import { LOOP_PANEL_STORAGE_KEY } from './LoopPanel.js';
import { newLoopDefinition, validateDraft } from './model.js';
import { useEditorStore } from './store.js';

const store = () => useEditorStore.getState();
const pick = () => store().definition!.nodes.find((node) => node.id === 'pick')!;
const held = { text: '[ unfinished', message: 'invalid JSON', input: 'unparsed text' as const };
const routes = [
  { id: 'ship', label: 'Ship' },
  { id: 'review', label: 'Review' },
  { id: 'stop', label: 'Stop' },
];
const options = routes.map((route) => ({ ...route, criteria: `Evidence supports ${route.id}` }));

async function setup(config: unknown = { kind: 'expression', jsonata: '"ship"', routes }) {
  const api = new FakeApi();
  const definition: LoopDefinitionInput = newLoopDefinition('Decision authoring');
  definition.nodes.push({
    id: 'pick',
    kind: 'decision',
    label: 'Pick',
    config: DecisionConfigSchema.parse(config),
  });
  definition.edges[0]!.to.node = 'pick';
  for (const route of routes)
    definition.edges.push({
      id: `${route.id}-edge`,
      from: { node: 'pick', port: route.id },
      to: { node: 'done' },
      ui: { route: [200, 300, 400] },
    });
  const loop = api.addLoop(definition);
  const rendered = renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByRole('heading', { name: 'Decision authoring' });
  act(() => store().openNode('pick'));
  const dialog = await screen.findByRole('dialog', { name: 'Edit decision pick' });
  return { api, loop, dialog, rendered };
}
const confirm = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) =>
  user.click(within(dialog).getByRole('button', { name: 'Confirm change' }));

describe('decision authoring checkpoint', () => {
  beforeEach(() => localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded'));

  it.each([
    { copy: 'active', unfinished: '' },
    { copy: 'active', unfinished: 'review' },
    { copy: 'set-aside', unfinished: '' },
    { copy: 'set-aside', unfinished: 'review' },
  ])(
    'restores $copy device ownership across reload with unfinished ID "$unfinished"',
    async ({ copy, unfinished }) => {
      const user = userEvent.setup();
      const { api, loop, dialog, rendered } = await setup();
      await user.clear(dialog.querySelector<HTMLInputElement>('[data-field="routes.0.id"] input')!);
      if (unfinished)
        await user.type(
          dialog.querySelector<HTMLInputElement>('[data-field="routes.0.id"] input')!,
          unfinished,
        );
      await waitFor(async () => {
        const local = await loadLocalDraft(loop.id);
        expect(local?.decisionRoutes?.['pick']?.rows[0]?.edgeIds).toContain('ship-edge');
        expect(local?.definition.nodes.find((node) => node.id === 'pick')).toHaveProperty(
          'config.routes.0.id',
          unfinished,
        );
      });
      const stored = (await loadLocalDraft(loop.id))!;
      rendered.unmount();
      if (copy === 'set-aside') {
        await saveSetAsideDraft(stored);
        await clearActiveLocalDraft(loop.id);
      }
      renderApp(`/loops/${loop.id}/edit`, api);
      await screen.findByRole('heading', { name: 'Decision authoring' });
      if (copy === 'set-aside')
        await user.click(
          await screen.findByRole('button', { name: "Use this device's copy instead" }),
        );
      await waitFor(() => expect(pick().config).toHaveProperty('routes.0.id', unfinished));
      act(() => store().openNode('pick'));
      const reopened = await screen.findByRole('dialog', { name: 'Edit decision pick' });
      await user.clear(
        reopened.querySelector<HTMLInputElement>('[data-field="routes.0.id"] input')!,
      );
      await user.type(
        reopened.querySelector<HTMLInputElement>('[data-field="routes.0.id"] input')!,
        'ready',
      );
      expect(store().definition!.edges.find((edge) => edge.id === 'ship-edge')?.from.port).toBe(
        'ready',
      );
      expect(store().definition!.edges.find((edge) => edge.id === 'review-edge')?.from.port).toBe(
        'review',
      );
      setCode('Jsonata', '"ready"');
      await waitFor(() => expect(store().saveState).toBe('saved'), { timeout: 4000 });
      expect(
        api.loops.get(loop.id)!.draft!.definition.edges.find((edge) => edge.id === 'ship-edge')
          ?.from.port,
      ).toBe('ready');
    },
  );

  it('invalidates a connection-removal review when connections change, and keeps compatible held context on kind change', async () => {
    const user = userEvent.setup();
    const context = { messages: 'all', includeLastOutput: false };
    const { dialog } = await setup({
      kind: 'classifier',
      model: 'jev',
      question: 'Which outcome?',
      context,
      answer: { type: 'choice', options },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Remove options 1' }));
    expect(
      within(dialog).getByRole('region', { name: 'Remove connected route?' }),
    ).toHaveTextContent('ship-edge');
    act(() => store().removeEdge('review-edge'));
    expect(
      within(dialog).queryByRole('button', { name: 'Confirm change' }),
    ).not.toBeInTheDocument();
    expect(pick().config).toMatchObject({ answer: { options } });
    act(() => store().setFieldError('node:pick', 'context', held));
    await user.click(within(dialog).getByRole('radio', { name: 'llm' }));
    const review = within(dialog).getByRole('region', { name: 'Change decision kind?' });
    expect(review).not.toHaveTextContent('Unfinished input: context');
    await confirm(user, dialog);
    expect(pick().config).toMatchObject({ kind: 'llm', context, routes });
    expect(store().fieldErrors['node:pick']?.['context']?.text).toBe(held.text);
    expect(store().definition!.edges.map((edge) => edge.id)).toContain('ship-edge');
    act(() => store().undo());
    expect(pick().config).toMatchObject({ kind: 'classifier', context });
    expect(store().fieldErrors['node:pick']?.['context']?.text).toBe(held.text);
  });

  it('previews kind losses before writing; cancel preserves held text and confirm plus undo is atomic', async () => {
    const user = userEvent.setup();
    const { dialog } = await setup();
    act(() => store().setFieldError('node:pick', 'jsonata', held));
    const before = store().definition;
    const history = store().past.length;
    await user.click(within(dialog).getByRole('radio', { name: 'llm' }));
    const review = within(dialog).getByRole('region', { name: 'Change decision kind?' });
    expect(review).toHaveFocus();
    expect(review).toHaveTextContent('JSONata source');
    expect(review).toHaveTextContent('Unfinished input: jsonata');
    expect(store().definition).toBe(before);
    expect(store().past).toHaveLength(history);
    await user.click(within(review).getByRole('button', { name: 'Cancel change' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'expression' })).toHaveFocus(),
    );
    expect(store().fieldErrors['node:pick']?.['jsonata']).toEqual(held);
    expect(store().definition).toBe(before);
    await user.click(within(dialog).getByRole('radio', { name: 'llm' }));
    await confirm(user, dialog);
    expect(pick().config).toMatchObject({
      kind: 'llm',
      routes,
      instructions: '',
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
    });
    expect(store().definition!.edges).toEqual(before!.edges);
    expect(store().past).toHaveLength(history + 1);
    expect(store().fieldErrors['node:pick']?.['jsonata']).toBeUndefined();
    act(() => store().undo());
    expect(store().definition).toEqual(before);
    expect(store().fieldErrors['node:pick']?.['jsonata']).toEqual(held);
    act(() => store().redo());
    expect(pick().config).toMatchObject({ kind: 'llm' });
  });

  it('leaves new source unsaved, focuses its validation issue, then saves and reloads with edges', async () => {
    const user = userEvent.setup();
    const { api, loop, dialog, rendered } = await setup();
    await user.click(within(dialog).getByRole('radio', { name: 'llm' }));
    await confirm(user, dialog);
    const invalid = validateDraft(store().definition!);
    expect(invalid.schemaValid).toBe(false);
    const issue = invalid.issues.find((issue) => issue.path === 'config.instructions')!;
    expect(issue.nodeId).toBe('pick');
    act(() => store().openNode('pick', { field: issue.path }));
    await waitFor(() =>
      expect(dialog.querySelector('[data-field="instructions"]')).toContainElement(
        document.activeElement as HTMLElement,
      ),
    );
    await waitFor(() => expect(store().saveState).toBe('invalid'));
    expect(
      api.loops.get(loop.id)!.draft!.definition.nodes.find((node) => node.id === 'pick')!.config,
    ).toMatchObject({ kind: 'expression' });
    setCode(
      'Instructions',
      'Choose Ship if the work is complete; otherwise choose Review or Stop.',
    );
    await waitFor(() => expect(store().saveState).toBe('saved'), { timeout: 4000 });
    const saved = structuredClone(api.loops.get(loop.id)!.draft!.definition);
    rendered.unmount();
    act(() => store().reset());
    renderApp(`/loops/${loop.id}/edit`, api);
    await screen.findByRole('heading', { name: 'Decision authoring' });
    expect(pick().config).toEqual(saved.nodes.find((node) => node.id === 'pick')!.config);
    expect(store().definition!.edges).toEqual(saved.edges);
  });

  it('keeps row ownership through invalid ids, reorders and labels, and reviews removal before one undoable edit', async () => {
    const user = userEvent.setup();
    const { dialog } = await setup();
    const field = (path: string) =>
      dialog.querySelector<HTMLInputElement>(`[data-field="${path}"] input`)!;
    await user.clear(field('routes.0.id'));
    await user.type(field('routes.0.id'), 'review');
    await user.click(within(dialog).getByRole('button', { name: 'Move routes 1 down' }));
    expect(store().definition!.edges.find((edge) => edge.id === 'ship-edge')!.from.port).not.toBe(
      'review',
    );
    await user.clear(field('routes.1.id'));
    await user.type(field('routes.1.id'), 'ready');
    await user.clear(field('routes.1.label'));
    await user.type(field('routes.1.label'), 'Ready to ship');
    expect(store().definition!.edges.find((edge) => edge.id === 'ship-edge')!.from.port).toBe(
      'ready',
    );
    expect(store().definition!.edges.find((edge) => edge.id === 'review-edge')!.from.port).toBe(
      'review',
    );
    await user.clear(field('routes.1.id'));
    const before = store().definition;
    await user.click(within(dialog).getByRole('button', { name: 'Remove routes 2' }));
    const review = within(dialog).getByRole('region', { name: 'Remove connected route?' });
    expect(review).toHaveTextContent('ship-edge');
    expect(store().definition).toBe(before);
    await user.click(within(review).getByRole('button', { name: 'Cancel change' }));
    expect(store().definition).toBe(before);
    await user.click(within(dialog).getByRole('button', { name: 'Remove routes 2' }));
    await confirm(user, dialog);
    expect(store().definition!.edges.map((edge) => edge.id)).not.toContain('ship-edge');
    act(() => store().undo());
    expect(store().definition).toEqual(before);
    act(() => store().redo());
    expect(store().definition!.edges.map((edge) => edge.id)).not.toContain('ship-edge');
  });

  it('refuses a many-route Noul conversion, then preserves ids in an incomplete Score form', async () => {
    const user = userEvent.setup();
    const { dialog } = await setup({
      kind: 'classifier',
      model: 'jev',
      question: 'Which outcome?',
      answer: { type: 'choice', options },
    });
    const before = store().definition;
    await user.click(within(dialog).getByRole('radio', { name: 'Noul' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('exactly two routes');
    expect(
      within(dialog).queryByRole('button', { name: 'Confirm change' }),
    ).not.toBeInTheDocument();
    expect(store().definition).toBe(before);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel change' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Score' }));
    expect(
      within(dialog).getByRole('region', { name: 'Change classifier answer type?' }),
    ).toHaveTextContent('Route criteria');
    await confirm(user, dialog);
    expect(pick().config).toMatchObject({
      answer: { type: 'score', anchors: ['', ''], bands: routes },
    });
    expect(store().definition!.edges).toEqual(before!.edges);
    expect(validateDraft(store().definition!).schemaValid).toBe(false);
    act(() => store().undo());
    expect(store().definition).toEqual(before);
  });

  it('moves held band input with its row and restores it with undo', async () => {
    const user = userEvent.setup();
    const { dialog } = await setup({
      kind: 'classifier',
      model: 'jev',
      question: 'Grade.',
      answer: {
        type: 'score',
        anchors: ['Low', 'High'],
        bands: routes.map((route, index) => ({ ...route, min: index / 3, max: (index + 1) / 3 })),
      },
    });
    act(() =>
      store().setFieldError('node:pick', 'answer.bands.0.min', {
        text: '',
        message: 'Enter a complete number',
      }),
    );
    const edges = store().definition!.edges;
    await user.click(within(dialog).getByRole('button', { name: 'Move bands 1 down' }));
    expect(store().fieldErrors['node:pick']?.['answer.bands.1.min']?.message).toBe(
      'Enter a complete number',
    );
    expect(store().fieldErrors['node:pick']?.['answer.bands.0.min']).toBeUndefined();
    expect(store().definition!.edges).toEqual(edges);
    act(() => store().undo());
    expect(store().fieldErrors['node:pick']?.['answer.bands.0.min']?.message).toBe(
      'Enter a complete number',
    );
  });
});
