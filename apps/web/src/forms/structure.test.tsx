import {
  LoopDefinitionSchema,
  NodeConfigSchemas,
  VariableDeclarationsSchema,
} from '@graphgoblin/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { LOOP_PANEL_STORAGE_KEY } from '../editor/LoopPanel.js';
import { fieldErrorIssues, newLoopDefinition, validateDraft } from '../editor/model.js';
import { useEditorStore } from '../editor/store.js';
import { SchemaForm } from './SchemaForm.js';
import type { Schema } from './introspect.js';

beforeEach(() => useEditorStore.getState().reset());

function StoredForm({ schema, initial }: { schema: Schema; initial: unknown }) {
  const [value, setValue] = useState(initial);
  const errors = useEditorStore((s) => s.fieldErrors['test']);
  return (
    <SchemaForm
      schema={schema}
      value={value}
      label="form"
      onChange={setValue}
      parseErrors={errors}
      onParseError={(path, error) => useEditorStore.getState().setFieldError('test', path, error)}
    />
  );
}

it('removes unparsed array text without overwriting the next criterion', async () => {
  const user = userEvent.setup();
  const spy = vi.fn();
  render(
    <SchemaForm
      schema={NodeConfigSchemas.exit}
      label="form"
      onChange={spy}
      value={{
        criteria: [
          { when: 'last-output-matches', jsonSchema: { type: 'string' }, outcome: 'success' },
          { when: 'last-output-matches', jsonSchema: { type: 'number' }, outcome: 'success' },
        ],
      }}
    />,
  );
  setCode('Json schema', '{broken', 0);
  await user.click(screen.getByRole('button', { name: 'Remove criteria 1' }));
  expect(JSON.parse(getCode('Json schema'))).toEqual({ type: 'number' });
  expect(screen.queryByText(/Invalid JSON/)).not.toBeInTheDocument();
  expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({
    criteria: [{ jsonSchema: { type: 'number' } }],
  });
});

it('clears removed array errors and shifts surviving nested errors in the editor store', async () => {
  const user = userEvent.setup();
  render(
    <StoredForm
      schema={z.object({ items: z.array(z.object({ value: z.unknown() })) })}
      initial={{ items: [{ value: 1 }, { value: 2 }, { value: 3 }] }}
    />,
  );
  setCode('Value', '{removed', 0);
  setCode('Value', '{second', 1);
  setCode('Value', '{third', 2);
  await user.click(screen.getByRole('button', { name: 'Remove items 1' }));
  expect(useEditorStore.getState().fieldErrors['test']).toEqual({
    'items.0.value': { message: expect.any(String), text: '{second', input: 'unparsed text' },
    'items.1.value': { message: expect.any(String), text: '{third', input: 'unparsed text' },
  });
  expect(getCode('Value', 0)).toBe('{second');
  expect(getCode('Value', 1)).toBe('{third');
  setCode('Value', '4', 0);
  expect(fieldErrorIssues(useEditorStore.getState().fieldErrors)).toHaveLength(1);
});

it('removes an unparsed variable and clears its blocking issue', async () => {
  const user = userEvent.setup();
  render(
    <StoredForm
      schema={z.object({ variables: VariableDeclarationsSchema })}
      initial={{ variables: { first: { type: 'string' }, second: { type: 'number' } } }}
    />,
  );
  setCode('Variables value 1', '{broken');
  await user.click(screen.getByRole('button', { name: 'Remove variables first' }));
  expect(fieldErrorIssues(useEditorStore.getState().fieldErrors)).toEqual([]);
  expect(JSON.parse(getCode('Variables value 1'))).toEqual({ type: 'number' });
});

it('renames an unparsed variable without losing its text or leaving the old issue', async () => {
  const user = userEvent.setup();
  render(
    <StoredForm
      schema={z.object({ variables: VariableDeclarationsSchema })}
      initial={{ variables: { first: { type: 'string' } } }}
    />,
  );
  setCode('Variables value 1', '{keep');
  await user.clear(screen.getByLabelText('Variables key 1'));
  await user.type(screen.getByLabelText('Variables key 1'), 'renamed');
  expect(getCode('Variables value 1')).toBe('{keep');
  expect(Object.keys(useEditorStore.getState().fieldErrors['test'] ?? {})).toEqual([
    'variables.renamed',
  ]);
  expect(fieldErrorIssues(useEditorStore.getState().fieldErrors)[0]?.discard?.path).toBe(
    'variables.renamed',
  );
  await user.click(screen.getByRole('button', { name: 'Discard the unparsed text' }));
  expect(fieldErrorIssues(useEditorStore.getState().fieldErrors)).toEqual([]);
  expect(JSON.parse(getCode('Variables value 1'))).toEqual({ type: 'string' });
});

it('keeps errors under dotted record keys separate during removal and rename', async () => {
  const user = userEvent.setup();
  render(
    <StoredForm
      schema={z.object({ entries: z.record(z.string(), z.unknown()) })}
      initial={{ entries: { A: 1, 'A.more': 2 } }}
    />,
  );
  setCode('Entries value 1', '{first');
  setCode('Entries value 2', '{keep');
  await user.clear(screen.getByLabelText('Entries key 1'));
  await user.type(screen.getByLabelText('Entries key 1'), 'B');
  expect(Object.keys(useEditorStore.getState().fieldErrors['test'] ?? {}).sort()).toEqual([
    'entries.A.more',
    'entries.B',
  ]);
  await user.click(screen.getByRole('button', { name: 'Remove entries B' }));
  expect(getCode('Entries value 1')).toBe('{keep');
  expect(Object.keys(useEditorStore.getState().fieldErrors['test'] ?? {})).toEqual([
    'entries.A.more',
  ]);
});

it('retains an unparsed JSON value and its issue when a duplicate rename is refused', () => {
  render(
    <StoredForm
      schema={z.object({ variables: VariableDeclarationsSchema })}
      initial={{ variables: { A: { type: 'string' }, C: { type: 'number' } } }}
    />,
  );
  setCode('Variables value 2', '{keep');
  fireEvent.change(screen.getByLabelText('Variables key 2'), { target: { value: 'A' } });
  expect(getCode('Variables value 2')).toBe('{keep');
  expect(Object.keys(useEditorStore.getState().fieldErrors['test'] ?? {})).toEqual(['variables.C']);
  expect(screen.getByLabelText('Variables key 2')).toHaveAttribute('aria-invalid', 'true');
});

it('keeps a renamed numeric record key with its own JSON editor after key ordering changes', () => {
  render(
    <StoredForm
      schema={z.object({ entries: z.record(z.string(), z.unknown()) })}
      initial={{ entries: { 2: { value: 'two' }, 3: { value: 'three' } } }}
    />,
  );
  setCode('Entries value 2', '{keep');
  fireEvent.change(screen.getByLabelText('Entries key 2'), { target: { value: '1' } });
  expect(screen.getByLabelText('Entries key 1')).toHaveValue('1');
  expect(getCode('Entries value 1')).toBe('{keep');
  expect(JSON.parse(getCode('Entries value 2'))).toEqual({ value: 'two' });
  expect(Object.keys(useEditorStore.getState().fieldErrors['test'] ?? {})).toEqual(['entries.1']);
});

it('refuses a colliding record key while retaining the typed key and both values', async () => {
  const user = userEvent.setup();
  const spy = vi.fn();
  render(
    <SchemaForm
      schema={NodeConfigSchemas.script}
      label="form"
      onChange={spy}
      value={{ command: 'node', env: { A: 'one', C: 'three' } }}
    />,
  );
  const key = screen.getByLabelText('Env key 2');
  const calls = spy.mock.calls.length;
  fireEvent.change(key, { target: { value: 'A' } });
  expect(screen.getByLabelText('Env key 2')).toHaveValue('A');
  expect(screen.getByLabelText('Env key 2')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Env key 2')).toHaveAccessibleDescription(/already exists/);
  expect(spy.mock.calls).toHaveLength(calls);
  expect(screen.getByLabelText('Env value 1')).toHaveValue('one');
  expect(screen.getByLabelText('Env value 2')).toHaveValue('three');
  await user.type(screen.getByLabelText('Env key 2'), 'B');
  expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ env: { A: 'one', AB: 'three' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('focuses and announces an added array item', async () => {
  const user = userEvent.setup();
  render(
    <SchemaForm
      schema={NodeConfigSchemas.script}
      label="form"
      onChange={vi.fn()}
      value={{ command: 'node', args: ['one', 'two'] }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Add args' }));
  await waitFor(() => expect(screen.getByLabelText('Args 3')).toHaveFocus());
  expect(within(screen.getByRole('group', { name: 'Args' })).getByRole('status')).toHaveTextContent(
    'Added args 3',
  );
});

it.each([2, 3])(
  'removing array item %i leaves focus safely on Add, including a second Enter',
  async (index) => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <SchemaForm
        schema={NodeConfigSchemas.script}
        label="form"
        onChange={spy}
        value={{ command: 'node', args: ['one', 'two', 'three'] }}
      />,
    );
    screen.getByRole('button', { name: `Remove args ${index}` }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Add args' })).toHaveFocus();
    expect(
      within(screen.getByRole('group', { name: 'Args' })).getByRole('status'),
    ).toHaveTextContent(`Removed args ${index}`);
    await user.keyboard('{Enter}');
    expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({
      args: index === 2 ? ['one', 'three', ''] : ['one', 'two', ''],
    });
  },
);

it('focuses and announces added and removed record entries', async () => {
  const user = userEvent.setup();
  render(
    <SchemaForm
      schema={z.object({ variables: VariableDeclarationsSchema })}
      label="form"
      onChange={vi.fn()}
      value={{ variables: {} }}
    />,
  );
  const group = screen.getByRole('group', { name: 'Variables' });
  await user.click(within(group).getByRole('button', { name: 'Add entry' }));
  await waitFor(() => expect(screen.getByLabelText('Variables key 1')).toHaveFocus());
  expect(within(group).getByRole('status')).toHaveTextContent('Added variables key1');
  await user.click(screen.getByRole('button', { name: 'Remove variables key1' }));
  expect(within(group).getByRole('button', { name: 'Add entry' })).toHaveFocus();
  expect(within(group).getByRole('status')).toHaveTextContent('Removed variables key1');
});

it('uses the collection as a safe focus fallback when an invalid array still exceeds its maximum', async () => {
  const user = userEvent.setup();
  const spy = vi.fn();
  render(
    <SchemaForm
      schema={z.object({ items: z.array(z.string()).max(1) })}
      label="form"
      value={{ items: ['one', 'two', 'three'] }}
      onChange={spy}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Remove items 2' }));
  expect(screen.getByRole('group', { name: 'Items' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(spy.mock.calls.at(-1)?.[0]).toEqual({ items: ['one', 'three'] });
});

it('treats expression whitespace as blank and preserves template whitespace', async () => {
  const { ExpressionSchema, TemplateSchema } = await import('@graphgoblin/contracts');
  const spy = vi.fn();
  render(
    <SchemaForm
      schema={z.object({
        optional: ExpressionSchema.optional(),
        liquid: TemplateSchema.optional(),
        required: ExpressionSchema,
        template: TemplateSchema,
      })}
      label="form"
      onChange={spy}
      value={{ required: 'true', template: 'hello' }}
    />,
  );
  setCode('Optional', ' \t\n');
  setCode('Liquid', ' \t\n');
  expect(spy.mock.calls.at(-1)?.[0]).not.toHaveProperty('optional');
  expect(spy.mock.calls.at(-1)?.[0]).toHaveProperty('liquid', ' \t\n');
  expect(screen.queryAllByTestId('preview')).toHaveLength(3);
  setCode('Required', ' \t\n');
  setCode('Template', ' \t\n');
  expect(getCode('Required')).toBe(' \t\n');
  expect(getCode('Template')).toBe(' \t\n');
  expect(screen.queryByText('Required', { selector: '[role="alert"]' })).not.toBeInTheDocument();
  setCode('Template', ' hello ');
  expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ template: ' hello ' });
});

it('uses the shared blank-source rule in editor validation', () => {
  const def = newLoopDefinition('blank');
  def.nodes.splice(1, 0, {
    id: 'beat',
    kind: 'heartbeat',
    label: 'Beat',
    config: { intervalSeconds: 5, until: '\u00a0' },
  });
  expect(LoopDefinitionSchema.safeParse(def).success).toBe(true);
  expect(validateDraft(def).issues).toContainEqual(
    expect.objectContaining({ code: 'EXPRESSION_INVALID', nodeId: 'beat' }),
  );
});

it('S24: conflict reload replaces mounted Settings and Variables and later edits preserve the server values', async () => {
  localStorage.setItem(LOOP_PANEL_STORAGE_KEY, 'expanded');
  const user = userEvent.setup();
  const api = new FakeApi();
  const initial = {
    ...newLoopDefinition('mine'),
    settings: { maxIterations: 3 },
    variables: { old: { type: 'string' } },
  };
  const loop = api.addLoop(initial);
  renderApp(`/loops/${loop.id}/edit`, api);
  await screen.findByLabelText('Max iterations');
  setCode('Variables value 1', '{broken');
  api.saveDraftElsewhere(loop.id, {
    ...newLoopDefinition('server'),
    settings: { maxIterations: 7 },
    variables: { fresh: { type: 'number' } },
  });
  act(() => useEditorStore.getState().updateMeta({ description: 'local' }));
  await screen.findByText('The draft changed on the server', undefined, { timeout: 4000 });
  await user.click(screen.getByRole('button', { name: 'Reload server draft' }));
  await waitFor(() => expect(screen.getByLabelText('Max iterations')).toHaveValue(7));
  expect(screen.getByLabelText('Variables key 1')).toHaveValue('fresh');
  expect(JSON.parse(getCode('Variables value 1'))).toEqual({ type: 'number' });
  expect(useEditorStore.getState().fieldErrors).toEqual({});
  await user.clear(screen.getByLabelText('Max iterations'));
  await user.type(screen.getByLabelText('Max iterations'), '8');
  setCode('Variables value 1', '{"type":"boolean"}');
  expect(useEditorStore.getState().definition).toMatchObject({
    settings: { maxIterations: 8 },
    variables: { fresh: { type: 'boolean' } },
  });
});
