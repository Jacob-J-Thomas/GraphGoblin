import {
  ExpressionSchema,
  NodeConfigSchemas,
  TemplateSchema,
  VariableDeclarationsSchema,
} from '@graphgoblin/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openAdvanced } from '../__fixtures__/advanced.js';
import { setCode } from '../__fixtures__/codemirror.js';
import { Row } from './fields/shared.js';
import { descriptionOf, type Schema } from './introspect.js';
import { SchemaForm } from './SchemaForm.js';

function Harness({
  schema,
  initial,
  spy,
}: {
  schema: Schema;
  initial: unknown;
  spy: (v: unknown) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SchemaForm
      schema={schema}
      value={value}
      label="form"
      onChange={(v) => {
        setValue(v);
        spy(v);
      }}
    />
  );
}

function last(spy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return spy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

/** The content element of the CodeMirror editor labelled `label`. */
function code(label: string): HTMLElement {
  return screen.getAllByLabelText(label).find((el) => el.classList.contains('cm-content'))!;
}

describe('form controls in the schema-driven form', () => {
  it('marks required fields and links help and errors to their controls', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const schema = z.object({
      name: z.string().min(1).describe('Shown in the loops list'),
      note: z.string().optional(),
      count: z.number().int().min(1),
      retries: z.number().int().default(3),
    });
    render(<Harness schema={schema} initial={{ name: 'x' }} spy={spy} />);
    const name = screen.getByLabelText('Name');
    expect(name).toBeRequired();
    expect(name).toHaveAccessibleDescription('Shown in the loops list');
    expect(screen.getByText('Name').nextElementSibling).toHaveTextContent('*');
    expect(screen.getByLabelText('Note')).not.toBeRequired();
    expect(screen.getByLabelText('Retries')).not.toBeRequired();
    expect(screen.getByLabelText('Retries')).toHaveAttribute('placeholder', '3');
    // A required number left empty: invalid, with its message announced and describing it.
    const count = screen.getByLabelText('Count');
    expect(count).toBeRequired();
    await waitFor(() => expect(count).toHaveAttribute('aria-invalid', 'true'));
    const alert = within(count.closest('[data-field]') as HTMLElement).getByRole('alert');
    expect(count).toHaveAccessibleDescription(alert.textContent ?? '');
    await user.type(count, '2');
    await waitFor(() => expect(count).not.toHaveAttribute('aria-invalid'));
    expect(count).not.toHaveAttribute('aria-describedby');
    await user.clear(name);
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription(/Shown in the loops list .+/);
    expect(last(spy)['count']).toBe(2);
  });

  it('draws booleans with a default as switches and optional ones as Not set / Yes / No', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Harness
        schema={NodeConfigSchemas.decision}
        initial={{
          routes: [
            { label: 'yes', description: '' },
            { label: 'no', description: '' },
          ],
          question: 'q',
          strategy: ['jev'],
        }}
        spy={spy}
      />,
    );
    // Record alternatives is an advanced field: under the collapsed Advanced disclosure.
    expect(screen.queryByRole('switch', { name: 'Record alternatives' })).toBeNull();
    openAdvanced();
    const record = screen.getByRole('switch', { name: 'Record alternatives' });
    expect(record).toBeChecked();
    await user.click(record);
    expect(last(spy)['recordAlternatives']).toBe(false);
    // The label toggles it too, and the keyboard.
    await user.click(screen.getByText('Record alternatives'));
    expect(last(spy)['recordAlternatives']).toBe(true);
    record.focus();
    await user.keyboard(' ');
    expect(last(spy)['recordAlternatives']).toBe(false);
    expect(record.closest('[data-field]')).toHaveAttribute('data-field', 'recordAlternatives');

    const spy2 = vi.fn();
    render(
      <Harness
        schema={z.object({ web: z.boolean().optional(), on: z.boolean() })}
        initial={{ web: false }}
        spy={spy2}
      />,
    );
    const web = screen.getByRole('radiogroup', { name: 'Web' });
    expect(within(web).getByRole('radio', { name: 'No' })).toBeChecked();
    await user.click(within(web).getByRole('radio', { name: 'Not set' }));
    expect(last(spy2)).not.toHaveProperty('web');
    expect(within(web).getByRole('radio', { name: 'Not set' })).toBeChecked();
    // A required boolean is a switch that says it is required.
    expect(screen.getByRole('switch', { name: 'On' })).toHaveAttribute('aria-required', 'true');
  });

  it('draws small enums as segmented controls and larger ones as selects', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const schema = z.object({
      outcome: z.enum(['success', 'failure']),
      target: z.enum(['messages', 'vars', 'all']).optional(),
      effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']),
      tag: z.literal(['a', 'b']).describe('Which tag'),
    });
    render(<Harness schema={schema} initial={{}} spy={spy} />);
    const outcome = screen.getByRole('radiogroup', { name: 'Outcome' });
    expect(outcome).toHaveAttribute('aria-required', 'true');
    // Required with no value yet: nothing chosen, no "Not set", and the error describes it.
    expect(within(outcome).queryByRole('radio', { name: 'Not set' })).toBeNull();
    expect(within(outcome).getByRole('radio', { name: 'success' })).not.toBeChecked();
    await waitFor(() => expect(outcome).toHaveAttribute('aria-invalid', 'true'));
    await user.click(within(outcome).getByRole('radio', { name: 'failure' }));
    expect(last(spy)['outcome']).toBe('failure');
    await user.keyboard('{ArrowLeft}');
    expect(last(spy)['outcome']).toBe('success');

    const target = screen.getByRole('radiogroup', { name: 'Target' });
    expect(within(target).getByRole('radio', { name: 'Not set' })).toBeChecked();
    await user.click(within(target).getByRole('radio', { name: 'vars' }));
    expect(last(spy)['target']).toBe('vars');
    await user.click(within(target).getByRole('radio', { name: 'Not set' }));
    expect(last(spy)).not.toHaveProperty('target');

    const effort = screen.getByLabelText('Effort');
    expect(effort.tagName).toBe('SELECT');
    expect(effort).toBeRequired();
    await user.selectOptions(effort, 'high');
    expect(last(spy)['effort']).toBe('high');
    // Help first, then the error while the required choice is missing.
    expect(screen.getByRole('radiogroup', { name: 'Tag' })).toHaveAccessibleDescription(
      /^Which tag Invalid option/,
    );
  });

  it('gives code fields the input frame, a language tag, and linked state', async () => {
    const schema = z.object({
      template: TemplateSchema,
      when: ExpressionSchema,
      data: z.unknown().default({ a: 1 }),
      variable: z.record(z.string(), z.unknown()),
    });
    render(<Harness schema={schema} initial={{ template: 'hi', when: '' }} spy={vi.fn()} />);
    const template = code('Template');
    expect(template).toHaveAttribute('aria-required', 'true');
    expect(
      within(template.closest('[data-field]') as HTMLElement).getByText('Liquid'),
    ).toBeTruthy();
    // A required expression left blank: its message describes the editor and marks it invalid.
    const when = code('When');
    expect(when).toHaveAttribute('aria-invalid', 'true');
    expect(when).toHaveAccessibleDescription(/./);
    expect(when.closest('.cm-editor')?.parentElement).toHaveAttribute('data-invalid', 'true');
    setCode('When', 'true');
    await waitFor(() => expect(code('When')).not.toHaveAttribute('aria-invalid'));
    // JSON: the tag, the default as a placeholder, and the parse error linked while it lasts.
    const data = code('Data');
    expect(within(data.closest('[data-field]') as HTMLElement).getByText('JSON')).toBeTruthy();
    expect(data).not.toHaveAttribute('aria-required');
    setCode('Data', '{oops');
    await waitFor(() => expect(code('Data')).toHaveAttribute('aria-invalid', 'true'));
    expect(code('Data')).toHaveAccessibleDescription(/Invalid JSON/);
    // Record rows sit on a rail, with Remove as an icon button and Add as a secondary button.
    const variable = screen.getByRole('group', { name: 'Variable' });
    const add = within(variable).getByRole('button', { name: 'Add entry' });
    expect(add).toHaveClass('bg-surface-control');
    expect(add.querySelector('svg[data-icon="plus"]')).not.toBeNull();
  });

  it('reads help from a schema description, through optional and default wrappers', () => {
    expect(descriptionOf(z.string().describe('Outer'))).toBe('Outer');
    expect(descriptionOf(z.string().describe('Inner').optional())).toBe('Inner');
    expect(descriptionOf(z.string())).toBeUndefined();
    // A description in the middle of the wrapper chain, which neither the outer schema nor the
    // base carries.
    expect(descriptionOf(z.string().default('').describe('Help').optional())).toBe('Help');
    expect(descriptionOf(z.string().describe('Base').default('').optional())).toBe('Base');
    expect(
      descriptionOf(
        z
          .string()
          .transform((s) => s.length)
          .describe('Piped'),
      ),
    ).toBe('Piped');
    expect(
      descriptionOf(
        z
          .string()
          .describe('Input')
          .transform((s) => s.length),
      ),
    ).toBe('Input');
    expect(descriptionOf(z.string().default('').optional())).toBeUndefined();
  });

  it('draws record values as fields: marked, linked to their error, and announced', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        schema={z.object({ variables: VariableDeclarationsSchema })}
        initial={{ variables: { first: { type: 'string' } } }}
        spy={vi.fn()}
      />,
    );
    const row = screen.getByLabelText('Variables key 1').closest('[data-collection-row]');
    // Captions over the key and the value; the value is required, so it carries the marker.
    expect(within(row as HTMLElement).getByText('Key').tagName).toBe('LABEL');
    expect(within(row as HTMLElement).getByText('Value').nextElementSibling).toHaveTextContent('*');
    const value = code('Variables value 1');
    expect(value).toHaveAttribute('aria-required', 'true');
    expect(value.closest('[data-field]')).toHaveAttribute('data-field', 'variables.first');
    // A JSON Schema must be an object: `[]` parses, so the schema's error is the value's own.
    setCode('Variables value 1', '[]');
    await waitFor(() => expect(code('Variables value 1')).toHaveAttribute('aria-invalid', 'true'));
    const field = value.closest('[data-field]') as HTMLElement;
    const alert = within(field).getByRole('alert');
    expect(code('Variables value 1')).toHaveAccessibleDescription(alert.textContent ?? '');
    setCode('Variables value 1', '{"type":"number"}');
    await waitFor(() => expect(code('Variables value 1')).not.toHaveAttribute('aria-invalid'));
    // Renaming the key moves the field's path with the row.
    await user.clear(screen.getByLabelText('Variables key 1'));
    await user.type(screen.getByLabelText('Variables key 1'), 'renamed');
    expect(code('Variables value 1').closest('[data-field]')).toHaveAttribute(
      'data-field',
      'variables.renamed',
    );
  });

  it('draws expression record values as required JSONata editors', async () => {
    const spy = vi.fn();
    render(
      <Harness
        schema={z.object({ vars: z.record(z.string(), ExpressionSchema) })}
        initial={{ vars: { score: 'vars.count + 1' } }}
        spy={spy}
      />,
    );
    const value = code('Vars value 1');
    expect(value).toHaveAttribute('aria-required', 'true');
    const field = value.closest('[data-field]') as HTMLElement;
    expect(within(field).getByText('JSONata')).toBeInTheDocument();
    setCode('Vars value 1', ' ');
    await waitFor(() => expect(code('Vars value 1')).toHaveAttribute('aria-invalid', 'true'));
    expect(within(field).getAllByRole('alert').length).toBeGreaterThan(0);
    setCode('Vars value 1', 'true');
    expect(last(spy)['vars']).toEqual({ score: 'true' });
  });

  it('marks required collections at the group, and says how many they need', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        schema={NodeConfigSchemas.decision}
        initial={{
          answer: {
            type: 'choice',
            options: [
              { id: 'yes', label: 'Yes', criteria: 'Choose yes' },
              { id: 'no', label: 'No', criteria: 'Choose no' },
            ],
          },
          evaluation: {
            kind: 'llm',
            harness: 'codex',
            model: { mode: 'inherit' },
            effort: { mode: 'inherit' },
            question: 'q',
            context: { vars: ['topic'] },
          },
        }}
        spy={vi.fn()}
      />,
    );
    const options = screen.getByRole('group', { name: 'Options' });
    expect(options.querySelector(':scope > legend span[aria-hidden="true"]')).not.toBeNull();
    expect(options).toHaveAccessibleDescription(
      'At least 2 items. Two to sixty-four uniquely labelled options, each with a stable id and a nonblank criterion.',
    );
    await user.click(within(options).getByRole('button', { name: 'Remove options 1' }));
    await waitFor(() => expect(within(options).getByRole('alert')).toHaveTextContent(/>=2 items/));
    expect(options).toHaveAccessibleDescription(/At least 2 items\..*>=2 items/);
    // Optional context variables carry no marker or collection rule, only their help.
    await user.click(screen.getByRole('tab', { name: /^Context/ }));
    openAdvanced();
    const vars = screen.getByRole('group', { name: 'Vars' });
    expect(vars.querySelector(':scope > legend span[aria-hidden="true"]')).toBeNull();
    expect(vars).toHaveAccessibleDescription(
      'Variable names included in provider state; omission includes all variables and does not restrict the question template.',
    );
  });

  it('keeps Row usable with plain children and no control id', () => {
    function Plain() {
      const form = useForm();
      return (
        <FormProvider {...form}>
          <Row label="Note" name="note" help="Free text">
            <span>static</span>
          </Row>
        </FormProvider>
      );
    }
    render(<Plain />);
    const row = screen.getByText('static').closest('[data-field]') as HTMLElement;
    expect(row).toHaveAttribute('data-field', 'note');
    expect(within(row).getByText('Note').tagName).toBe('LABEL');
    expect(within(row).getByText('Free text')).toBeInTheDocument();
  });
});
