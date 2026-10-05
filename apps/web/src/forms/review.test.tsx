import { ExpressionSchema, NodeConfigSchemas, TemplateSchema } from '@graphgoblin/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openAdvanced } from '../__fixtures__/advanced.js';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { fieldErrorIssues } from '../editor/model.js';
import { useEditorStore } from '../editor/store.js';
import { CodeField } from './CodeField.js';
import { Field } from './fields.js';
import type { Schema } from './introspect.js';
import { SchemaForm } from './SchemaForm.js';

beforeEach(() => useEditorStore.getState().reset());

function StoredForm({ schema, initial }: { schema: Schema; initial: unknown }) {
  const [value, setValue] = useState(initial);
  const errors = useEditorStore((s) => s.fieldErrors['review']);
  return (
    <SchemaForm
      schema={schema}
      value={value}
      label="form"
      onChange={setValue}
      parseErrors={errors}
      onParseError={(path, error) => useEditorStore.getState().setFieldError('review', path, error)}
    />
  );
}

it.each(['', ' '])(
  'saves required templates exactly as typed (%j), without a Required message',
  async (text) => {
    const spy = vi.fn();
    render(
      <SchemaForm
        schema={z.object({ source: TemplateSchema, optional: TemplateSchema.optional() })}
        value={{ source: 'before' }}
        label="form"
        onChange={spy}
      />,
    );
    setCode('Source', text);
    expect(getCode('Source')).toBe(text);
    expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ source: text });
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
    setCode('Optional', ' ');
    expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ optional: ' ' });
    setCode('Optional', '');
    expect(spy.mock.calls.at(-1)?.[0]).not.toHaveProperty('optional');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  },
);

it('keeps typed expression whitespace in the view, omits optional blanks, and uses the schema error only', async () => {
  const spy = vi.fn();
  render(
    <SchemaForm
      schema={z.object({ source: ExpressionSchema, optional: ExpressionSchema.optional() })}
      value={{ source: 'true' }}
      label="form"
      onChange={spy}
    />,
  );
  setCode('Source', ' \t\n');
  expect(getCode('Source')).toBe(' \t\n');
  const row = screen.getByLabelText('Source').closest('[data-field]') as HTMLElement;
  expect(within(row).queryByTestId('preview')).not.toBeInTheDocument();
  await waitFor(() => expect(within(row).getAllByRole('alert')).toHaveLength(1));
  expect(within(row).getByRole('alert')).toHaveTextContent(
    ExpressionSchema.safeParse('').error!.issues[0]!.message,
  );
  expect(within(row).queryByText('Required')).not.toBeInTheDocument();
  setCode('Optional', '\u00a0');
  expect(spy.mock.calls.at(-1)?.[0]).not.toHaveProperty('optional');
});

it('keeps initial required-expression help quiet and alerts only after an edit', () => {
  render(<CodeField kind="expression" value="" onChange={vi.fn()} label="Source" id="source" />);
  expect(screen.queryByTestId('preview')).not.toBeInTheDocument();
  expect(screen.getByText('Required')).not.toHaveAttribute('role', 'alert');
  setCode('Source', ' ');
  expect(screen.getByText('Required')).toHaveAttribute('role', 'alert');
});

it('focuses a newly added code editor after StrictMode recreates its view', async () => {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <SchemaForm
        schema={NodeConfigSchemas.script}
        value={{ command: 'node', args: [] }}
        onChange={vi.fn()}
        label="form"
      />
    </StrictMode>,
  );
  await user.click(screen.getByRole('button', { name: 'Add args' }));
  await waitFor(() => expect(screen.getByLabelText('Args 1')).toHaveFocus());
  expect(within(screen.getByRole('group', { name: 'Args' })).getByRole('status')).toHaveTextContent(
    'Added args 1',
  );
});

it('rechecks a refused key when its conflicting row is removed', async () => {
  const user = userEvent.setup();
  render(
    <SchemaForm
      schema={NodeConfigSchemas.script}
      value={{ command: 'node', env: { A: 'one', C: 'three' } }}
      onChange={vi.fn()}
      label="form"
    />,
  );
  openAdvanced();
  fireEvent.change(screen.getByLabelText('Env key 2'), { target: { value: 'A' } });
  await user.click(screen.getByRole('button', { name: 'Remove env A' }));
  expect(screen.getByLabelText('Env key 1')).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
});

it('announces each collision transition once and includes the reason when reverting the key', () => {
  render(
    <StrictMode>
      <SchemaForm
        schema={NodeConfigSchemas.script}
        value={{ command: 'node', env: { A: 'one', AA: 'two', C: 'three' } }}
        onChange={vi.fn()}
        label="form"
      />
    </StrictMode>,
  );
  openAdvanced();
  const key = screen.getByLabelText('Env key 3');
  const status = within(screen.getByRole('group', { name: 'Env' })).getByRole('status');
  key.focus();
  fireEvent.change(key, { target: { value: 'A' } });
  expect(status).toHaveTextContent('Key "A" already exists');
  const firstAnnouncement = status.firstElementChild;
  expect(key).toHaveFocus();
  expect(key).toHaveAccessibleDescription('Key "A" already exists. Choose a unique key.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  // Another keystroke changes the colliding key, but the input remains in error.
  fireEvent.change(key, { target: { value: 'AA' } });
  expect(key).toHaveAttribute('aria-invalid', 'true');
  expect(status).toHaveTextContent('Key "A" already exists');
  expect(status.firstElementChild).toBe(firstAnnouncement);
  fireEvent.change(key, { target: { value: 'C' } });
  expect(key).not.toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(key, { target: { value: 'A' } });
  expect(status).toHaveTextContent('Key "A" already exists');
  expect(status.firstElementChild).not.toBe(firstAnnouncement);
  expect(key).toHaveFocus();
  fireEvent.blur(key);
  expect(key).toHaveValue('C');
  expect(status).toHaveTextContent('Reverted key to "C": "A" already exists');
  expect(key).not.toHaveAttribute('aria-describedby');
  expect(screen.getByLabelText('Env value 1')).toHaveValue('one');
  expect(screen.getByLabelText('Env value 2')).toHaveValue('two');
  expect(screen.getByLabelText('Env value 3')).toHaveValue('three');
});

it('reverts a still-refused key on blur and announces it without duplicating the error announcement', () => {
  const spy = vi.fn();
  render(
    <SchemaForm
      schema={NodeConfigSchemas.script}
      value={{ command: 'node', env: { A: 'one', C: 'three' } }}
      onChange={spy}
      label="form"
    />,
  );
  openAdvanced();
  const key = screen.getByLabelText('Env key 2');
  fireEvent.change(key, { target: { value: 'A' } });
  expect(key).toHaveAccessibleDescription('Key "A" already exists. Choose a unique key.');
  expect(screen.getByText('Key "A" already exists. Choose a unique key.')).not.toHaveAttribute(
    'role',
    'alert',
  );
  fireEvent.blur(key);
  expect(key).toHaveValue('C');
  expect(key).not.toHaveAttribute('aria-invalid', 'true');
  expect(within(screen.getByRole('group', { name: 'Env' })).getByRole('status')).toHaveTextContent(
    'Reverted key to "C": "A" already exists',
  );
  expect(spy).not.toHaveBeenCalled();
});

it('commits an available key draft on blur after its conflicting row disappears', () => {
  const spy = vi.fn();
  render(
    <SchemaForm
      schema={NodeConfigSchemas.script}
      value={{ command: 'node', env: { A: 'one', C: 'three' } }}
      onChange={spy}
      label="form"
    />,
  );
  openAdvanced();
  fireEvent.change(screen.getByLabelText('Env key 2'), { target: { value: 'A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove env A' }));
  fireEvent.blur(screen.getByLabelText('Env key 1'));
  expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ env: { A: 'three' } });
});

it('clears hidden parse errors when an optional union is unset', async () => {
  const user = userEvent.setup();
  render(
    <StoredForm
      schema={z.object({
        option: z.union([z.object({ value: z.unknown() }), z.literal('none')]).optional(),
      })}
      initial={{ option: { value: 1 } }}
    />,
  );
  setCode('Value', '{hidden');
  await user.selectOptions(screen.getByLabelText('Kind'), '');
  expect(fieldErrorIssues(useEditorStore.getState().fieldErrors)).toEqual([]);
});

it('retains identical unparsed text in a surviving nested array row after clearing and reusing its path', async () => {
  const user = userEvent.setup();
  render(
    <StoredForm
      schema={z.object({ items: z.array(z.object({ value: z.unknown() })) })}
      initial={{ items: [{ value: 1 }, { value: 2 }] }}
    />,
  );
  setCode('Value', '{same', 0);
  setCode('Value', '{same', 1);
  await user.click(screen.getByRole('button', { name: 'Remove items 1' }));
  expect(getCode('Value')).toBe('{same');
  expect(useEditorStore.getState().fieldErrors['review']).toEqual({
    'items.0.value': { message: expect.any(String), text: '{same' },
  });
  expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
});

it('clears hidden parse errors when a nested union switches variant, including switching back', async () => {
  const user = userEvent.setup();
  render(
    <StoredForm
      schema={NodeConfigSchemas.exit}
      initial={{ criteria: [{ when: 'last-output-matches', jsonSchema: { type: 'string' } }] }}
    />,
  );
  setCode('Json schema', '{hidden');
  await user.selectOptions(
    screen.getByLabelText('When'),
    screen.getByRole('option', { name: 'max-iterations' }),
  );
  expect(fieldErrorIssues(useEditorStore.getState().fieldErrors)).toEqual([]);
  await user.selectOptions(
    screen.getByLabelText('When'),
    screen.getByRole('option', { name: 'last-output-matches' }),
  );
  expect(getCode('Json schema')).not.toBe('{hidden');
});

it('clears descendant parse errors when an optional object is removed', async () => {
  const user = userEvent.setup();
  render(
    <StoredForm
      schema={z.object({ options: z.object({ value: z.unknown() }).optional() })}
      initial={{ options: { value: 1 } }}
    />,
  );
  setCode('Value', '{hidden');
  await user.click(screen.getByRole('button', { name: 'Remove options' }));
  expect(fieldErrorIssues(useEditorStore.getState().fieldErrors)).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Add options' }));
  expect(getCode('Value')).not.toBe('{hidden');
});

it('clears all parse errors when the root variant changes', async () => {
  const user = userEvent.setup();
  const schema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('json'), value: z.unknown() }),
    z.object({ kind: z.literal('plain'), text: z.string() }),
  ]);
  render(<StoredForm schema={schema} initial={{ kind: 'json', value: 1 }} />);
  setCode('Value', '{hidden');
  await user.selectOptions(screen.getByLabelText('Kind'), '1');
  expect(fieldErrorIssues(useEditorStore.getState().fieldErrors)).toEqual([]);
  await user.selectOptions(screen.getByLabelText('Kind'), '0');
  expect(getCode('Value')).not.toBe('{hidden');
});

it('resynchronizes row identities after an external reset grows and shrinks the array', async () => {
  function ResetForm() {
    const form = useForm({ defaultValues: { items: [1] } });
    return (
      <FormProvider {...form}>
        <button onClick={() => form.reset({ items: [1, 2, 3] })}>Grow</button>
        <button onClick={() => form.reset({ items: [4] })}>Shrink</button>
        <Field schema={z.array(z.unknown())} name="items" label="Items" />
      </FormProvider>
    );
  }
  const user = userEvent.setup();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<ResetForm />);
  await user.click(screen.getByRole('button', { name: 'Grow' }));
  const survivor = screen.getByLabelText('Items 2');
  setCode('Items 2', '{keep');
  await user.click(screen.getByRole('button', { name: 'Remove items 1' }));
  expect(screen.getByLabelText('Items 1')).toBe(survivor);
  expect(getCode('Items 1')).toBe('{keep');
  expect(screen.getByLabelText('Items 2').closest('[data-field]')).toHaveAttribute(
    'data-field',
    'items.1',
  );
  await user.click(screen.getByRole('button', { name: 'Shrink' }));
  await user.click(screen.getByRole('button', { name: 'Add items' }));
  expect(screen.getAllByLabelText(/^Items \d$/)).toHaveLength(2);
  expect(screen.getByLabelText('Items 2').closest('[data-field]')).toHaveAttribute(
    'data-field',
    'items.1',
  );
  expect(errors.mock.calls.filter(([message]) => String(message).includes('key'))).toEqual([]);
});
