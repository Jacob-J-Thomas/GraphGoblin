import {
  NodeConfigSchemas,
  LoopSettingsSchema,
  ExpressionSchema,
  TemplateSchema,
  VariableDeclarationsSchema,
  type NodeInput,
} from '@graphgoblin/contracts';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openAdvanced } from '../__fixtures__/advanced.js';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { NODE_FIELD_CONTROLS } from '../editor/field-controls.js';
import { historyClock } from '../editor/history.js';
import { newLoopDefinition } from '../editor/model.js';
import { useEditorStore } from '../editor/store.js';
import type { FieldControls } from './fields.js';
import { SchemaForm } from './SchemaForm.js';
import type { Schema } from './introspect.js';

function Harness({
  schema,
  initial,
  spy,
  fieldOrder,
}: {
  schema: Schema;
  initial: unknown;
  spy: (v: unknown) => void;
  fieldOrder?: readonly string[] | undefined;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SchemaForm
        schema={schema}
        value={value}
        label="form"
        fieldOrder={fieldOrder}
        onChange={(v) => {
          setValue(v);
          spy(v);
        }}
      />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  );
}

function last(spy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return spy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe('SchemaForm', () => {
  it('orders top-level fields without changing field paths or untouched values', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const answer = {
      type: 'choice' as const,
      options: [
        { id: 'ready', label: 'Ready', criteria: 'Choose ready' },
        { id: 'blocked', label: 'Blocked', criteria: 'Choose blocked' },
      ],
    };
    render(
      <Harness
        schema={NodeConfigSchemas.decision}
        initial={{
          answer,
          evaluation: {
            kind: 'llm',
            harness: 'codex',
            model: { mode: 'inherit' },
            effort: { mode: 'inherit' },
            question: 'Choose one',
            context: {},
          },
          recordAlternatives: true,
        }}
        spy={spy}
        fieldOrder={['evaluation', 'unknown-field', 'answer']}
      />,
    );
    const form = screen.getByRole('form', { name: 'form' });
    const evaluation = form.querySelector<HTMLElement>('[data-field="evaluation"]');
    const answerField = form.querySelector<HTMLElement>('[data-field="answer"]');
    if (!evaluation || !answerField) throw new Error('Decision fields were not rendered.');
    expect(
      evaluation.compareDocumentPosition(answerField) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    const evaluatorKind = within(evaluation).getAllByLabelText('Kind')[0];
    if (!evaluatorKind) throw new Error('Evaluation kind selector was not rendered.');
    await user.selectOptions(evaluatorKind, '0');
    await waitFor(() => expect(last(spy)['evaluation']).toMatchObject({ kind: 'expression' }));
    expect(last(spy)).toMatchObject({
      answer,
      evaluation: { kind: 'expression' },
    });
  });

  it.each([
    [z.object({ entries: z.record(z.string(), z.string()) }), { entries: { first: 'text' } }],
    [z.object({ entries: VariableDeclarationsSchema }), { entries: { first: { type: 'string' } } }],
  ] as const)(
    'tabs through record key, Remove, then value in visual order',
    async (schema, initial) => {
      const user = userEvent.setup();
      render(<Harness schema={schema} initial={initial} spy={vi.fn()} />);
      screen.getByLabelText('Entries key 1').focus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Remove entries first' })).toHaveFocus();
      await user.tab();
      expect(screen.getByLabelText('Entries value 1')).toHaveFocus();
      await user.tab({ shift: true });
      expect(screen.getByRole('button', { name: 'Remove entries first' })).toHaveFocus();
    },
  );

  it('keeps edited script args when adding and removing without remounting', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Harness
        schema={NodeConfigSchemas.script}
        initial={{ command: 'node', args: ['--version', 'old'] }}
        spy={spy}
      />,
    );
    setCode('Args 1', '{{ vars.value }}');
    setCode('Args 2', 'edited second');
    await user.click(screen.getByRole('button', { name: 'Add args' }));
    expect(last(spy)['args']).toEqual(['{{ vars.value }}', 'edited second', '']);
    expect(getCode('Args 1')).toBe('{{ vars.value }}');
    setCode('Args 3', 'third');
    await user.click(screen.getByRole('button', { name: 'Remove args 2' }));
    expect(last(spy)['args']).toEqual(['{{ vars.value }}', 'third']);
    expect(getCode('Args 2')).toBe('third');
  });

  it('keeps edited nested decision routes when adding and removing', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Harness
        schema={NodeConfigSchemas.decision}
        initial={{
          answer: {
            type: 'choice',
            options: [
              { id: 'yes', label: 'Yes', criteria: 'old criterion' },
              { id: 'no', label: 'No', criteria: 'no criterion' },
            ],
          },
          evaluation: {
            kind: 'llm',
            harness: 'codex',
            model: { mode: 'inherit' },
            effort: { mode: 'inherit' },
            question: 'choose',
            context: {},
          },
        }}
        spy={spy}
      />,
    );
    const options = screen.getByRole('group', { name: 'Options' });
    const criteria = within(options).getAllByLabelText('Criteria');
    await user.clear(criteria[0]!);
    await user.type(criteria[0]!, 'edited criterion');
    await user.click(within(options).getByRole('button', { name: 'Add options' }));
    expect(((last(spy)['answer'] as Record<string, unknown>)['options'] as unknown[])[0]).toEqual({
      id: 'yes',
      label: 'Yes',
      criteria: 'edited criterion',
    });
    await user.click(within(options).getByRole('button', { name: 'Remove options 2' }));
    expect(((last(spy)['answer'] as Record<string, unknown>)['options'] as unknown[])[0]).toEqual({
      id: 'yes',
      label: 'Yes',
      criteria: 'edited criterion',
    });
  });

  it.each(['template', 'expression'] as const)(
    'omits blank %s previews unless a required template, and keeps malformed previews',
    async (kind) => {
      const sourceSchema = kind === 'template' ? TemplateSchema : ExpressionSchema;
      render(
        <Harness
          schema={z.object({ optional: sourceSchema.optional(), required: sourceSchema })}
          initial={{ required: '' }}
          spy={vi.fn()}
        />,
      );
      const optional = screen.getByLabelText('Optional').closest('[data-field]')!;
      const required = screen.getByLabelText('Required').closest('[data-field]')!;
      expect(within(optional as HTMLElement).queryByTestId('preview')).not.toBeInTheDocument();
      if (kind === 'template') {
        expect(within(required as HTMLElement).getByTestId('preview')).toBeInTheDocument();
      } else {
        expect(within(required as HTMLElement).queryByTestId('preview')).not.toBeInTheDocument();
      }
      setCode('Optional', kind === 'template' ? '{% if %}' : '(');
      await waitFor(() =>
        expect(within(optional as HTMLElement).getByTestId('preview')).toHaveTextContent(/failed/),
      );
      setCode('Optional', '');
      expect(within(optional as HTMLElement).queryByTestId('preview')).not.toBeInTheDocument();
    },
  );

  it('keeps script env values through add, rename, and remove', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Harness
        schema={NodeConfigSchemas.script}
        initial={{ command: 'node', env: { FIRST: 'old', SECOND: 'keep' } }}
        spy={spy}
      />,
    );
    openAdvanced();
    const env = screen.getByRole('group', { name: 'Env' });
    await user.clear(screen.getByLabelText('Env value 1'));
    await user.type(screen.getByLabelText('Env value 1'), 'edited');
    await user.click(within(env).getByRole('button', { name: 'Add entry' }));
    await user.clear(screen.getByLabelText('Env key 1'));
    await user.type(screen.getByLabelText('Env key 1'), 'RENAMED');
    expect(last(spy)['env']).toEqual({ RENAMED: 'edited', SECOND: 'keep', key3: '' });
    await user.click(screen.getByRole('button', { name: 'Remove env SECOND' }));
    expect(last(spy)['env']).toEqual({ RENAMED: 'edited', key3: '' });
    expect(screen.getByLabelText('Env value 1')).toHaveValue('edited');
  });

  it('keeps the displayed variable schemas in sync when deleting an earlier row', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Harness
        schema={z.object({ variables: VariableDeclarationsSchema })}
        initial={{ variables: { first: { type: 'string' }, second: { type: 'number' } } }}
        spy={spy}
      />,
    );
    setCode('Variables value 2', '{"type":"boolean"}');
    await user.click(
      within(screen.getByRole('group', { name: 'Variables' })).getByRole('button', {
        name: 'Add entry',
      }),
    );
    expect(last(spy)['variables']).toMatchObject({ second: { type: 'boolean' } });
    await user.click(screen.getByRole('button', { name: 'Remove variables first' }));
    expect(last(spy)['variables']).toMatchObject({ second: { type: 'boolean' } });
    expect(JSON.parse(getCode('Variables value 1'))).toEqual({ type: 'boolean' });
  });

  it('keeps JSON values in array rows in sync after removal', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Harness
        schema={z.object({ items: z.array(z.unknown()) })}
        initial={{ items: [{ value: 'first' }, { value: 'second' }] }}
        spy={spy}
      />,
    );
    setCode('Items 2', '{"value":"edited"}');
    await user.click(screen.getByRole('button', { name: 'Remove items 1' }));
    expect(last(spy)['items']).toEqual([{ value: 'edited' }]);
    expect(JSON.parse(getCode('Items 1'))).toEqual({ value: 'edited' });
  });

  it('edits trigger input schema JSON and clears optional JSON without a preview or parse error', () => {
    const spy = vi.fn();
    render(
      <Harness
        schema={NodeConfigSchemas.trigger}
        initial={{ subtype: 'manual', inputSchema: { type: 'object' } }}
        spy={spy}
      />,
    );
    setCode(
      'Input schema',
      '{"type":"object","properties":{"items":{"type":"array","items":{"type":"string"}}}}',
    );
    expect(last(spy)['inputSchema']).toMatchObject({ properties: { items: { type: 'array' } } });
    setCode('Input schema', '{oops');
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
    setCode('Input schema', '');
    expect(last(spy)).not.toHaveProperty('inputSchema');
    expect(screen.queryByText(/Invalid JSON/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('preview')).not.toBeInTheDocument();
  });

  it.each([
    [NodeConfigSchemas.heartbeat, { intervalSeconds: 5, maxBeats: 2 }, 'Until'],
    [NodeConfigSchemas.wait, { mode: 'signal', name: 'go' }, 'Filter'],
    [NodeConfigSchemas.mutate, { operations: [{ op: 'truncate', keep: { last: 2 } }] }, 'Where'],
  ] as const)('treats blank optional node conditions as absent', async (schema, initial, label) => {
    render(<Harness schema={schema} initial={initial} spy={vi.fn()} />);
    const field = screen.getByLabelText(label).closest('[data-field]') as HTMLElement;
    expect(within(field).queryByTestId('preview')).not.toBeInTheDocument();
    setCode(label, ' ');
    expect(within(field).queryByTestId('preview')).not.toBeInTheDocument();
    setCode(label, 'true');
    await waitFor(() => expect(within(field).getByTestId('preview')).toHaveTextContent('true'));
    setCode(label, '');
    expect(within(field).queryByTestId('preview')).not.toBeInTheDocument();
  });

  it.each([
    [
      NodeConfigSchemas.decision,
      {
        answer: {
          type: 'choice',
          options: [
            { id: 'yes', label: 'Yes', criteria: 'Choose yes' },
            { id: 'no', label: 'No', criteria: 'Choose no' },
          ],
        },
        evaluation: { kind: 'expression', jsonata: '' },
      },
      'Jsonata',
    ],
    [
      NodeConfigSchemas.mutate,
      { operations: [{ op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '' } }] },
      'Jsonata',
    ],
    [NodeConfigSchemas.exit, { return: { mapping: '', channels: [{ kind: 'caller' }] } }, 'Value'],
  ] as const)(
    'keeps required mapping and decision expression errors',
    async (schema, initial, label) => {
      render(<Harness schema={schema} initial={initial} spy={vi.fn()} />);
      // A list item that collapses (a mutation) opens to show its fields.
      const item = screen.queryByRole('button', { name: /^Operations 1/ });
      if (item) await userEvent.setup().click(item);
      const field = screen.getByLabelText(label).closest('[data-field]') as HTMLElement;
      expect(within(field).queryByTestId('preview')).not.toBeInTheDocument();
      await waitFor(() => expect(within(field).getByRole('alert')).toBeInTheDocument());
      setCode(label, 'vars.');
      await waitFor(() =>
        expect(within(field).getByTestId('preview')).toHaveTextContent('failed to compile'),
      );
    },
  );

  it('renders strings, numbers, booleans, enums and reports changes', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness schema={NodeConfigSchemas.script} initial={{ command: 'node' }} spy={spy} />);
    openAdvanced();
    const command = screen.getByLabelText('Command');
    await user.clear(command);
    await user.type(command, 'python');
    expect(last(spy)['command']).toBe('python');

    await user.type(screen.getByLabelText('Timeout seconds'), '30');
    expect(last(spy)['timeoutSeconds']).toBe(30);
    await user.clear(screen.getByLabelText('Timeout seconds'));
    expect(last(spy)['timeoutSeconds']).toBeUndefined();

    const stdin = screen.getByRole('radiogroup', { name: 'Stdin' });
    await user.click(within(stdin).getByRole('radio', { name: 'none' }));
    expect(last(spy)['stdin']).toBe('none');
    // Defaults show through until the user sets a value.
    const stdout = screen.getByRole('radiogroup', { name: 'Stdout' });
    expect(within(stdout).getByRole('radio', { name: 'last-output' })).toBeChecked();
    expect(screen.getByLabelText('Cwd')).toHaveAttribute('placeholder', 'workspace');
  });

  it('edits arrays of strings and records', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness schema={NodeConfigSchemas.script} initial={{ command: 'node' }} spy={spy} />);
    await user.click(screen.getByRole('button', { name: 'Add args' }));
    expect(last(spy)['args']).toEqual(['']);
    setCode('Args 1', 'check.js');
    expect(last(spy)['args']).toEqual(['check.js']);
    await user.click(screen.getByRole('button', { name: 'Remove args 1' }));
    expect(last(spy)['args']).toEqual([]);

    openAdvanced();
    const routes = screen
      .getAllByRole('group')
      .find((g) => g.getAttribute('data-field') === 'exitCodeRoutes')!;
    await user.click(within(routes).getByRole('button', { name: 'Add entry' }));
    expect(last(spy)['exitCodeRoutes']).toEqual({ key1: '' });
    await user.clear(screen.getByLabelText('Exit code routes key 1'));
    await user.type(screen.getByLabelText('Exit code routes key 1'), '3');
    await user.type(screen.getByLabelText('Exit code routes value 1'), 'retry');
    expect(last(spy)['exitCodeRoutes']).toEqual({ '3': 'retry' });
    await user.click(within(routes).getByRole('button', { name: 'Add entry' }));
    expect(Object.keys(last(spy)['exitCodeRoutes'] as object)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Remove exit code routes 3' }));
    await user.click(screen.getByRole('button', { name: /Remove exit code routes key/ }));
    expect(last(spy)['exitCodeRoutes']).toBeUndefined();
  });

  it('switches a root discriminated union and shows literal and nested object fields', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Harness schema={NodeConfigSchemas.trigger} initial={{ subtype: 'manual' }} spy={spy} />,
    );
    expect(screen.getByRole('group', { name: 'Expose to' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'mcp' }));
    expect(last(spy)['exposeTo']).toEqual(['ui', 'api']);
    await user.click(screen.getByRole('checkbox', { name: 'mcp' }));
    expect(last(spy)['exposeTo']).toEqual(['ui', 'api', 'mcp']);

    await user.selectOptions(screen.getByLabelText('Subtype'), 'webhook');
    expect(last(spy)).toMatchObject({ subtype: 'webhook', signature: { scheme: 'hmac-sha256' } });
    expect(screen.getByText('hmac-sha256')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Secret ref'), 'hook-secret');
    expect(last(spy)).toMatchObject({ signature: { secretRef: 'hook-secret' } });

    await user.selectOptions(screen.getByLabelText('Subtype'), 'cron');
    await user.type(screen.getByLabelText('Expression'), '0 2 * * *');
    await user.click(screen.getByLabelText('Enabled'));
    expect(last(spy)).toMatchObject({ subtype: 'cron', expression: '0 2 * * *', enabled: false });
  });

  it('handles the decision evaluation union, context unions, option editing, and previews', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
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
            question: 'Is {{ vars.topic }} ok?',
            context: { messages: 'last' },
          },
          recordAlternatives: true,
        }}
        spy={spy}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByTestId('preview')[0]).toHaveTextContent('Is hello ok?'),
    );

    const evaluationGroup = screen.getByRole('group', { name: 'Evaluation' });
    const evaluationKind = within(evaluationGroup).getAllByLabelText('Kind')[0]!;
    await user.selectOptions(evaluationKind, '0');
    expect(last(spy)['evaluation']).toMatchObject({ kind: 'expression' });
    setCode('Jsonata', 'vars.count + 1');
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Jsonata').closest('[data-field]') as HTMLElement).getByTestId(
          'preview',
        ),
      ).toHaveTextContent('3'),
    );

    await user.selectOptions(evaluationKind, '2');
    // The context selector is a nested union with a literal, a number, and an object.
    const kind = within(screen.getByRole('group', { name: 'Messages' })).getByLabelText('Kind');
    await user.selectOptions(kind, '3');
    expect(
      ((last(spy)['evaluation'] as Record<string, unknown>)['context'] as Record<string, unknown>)[
        'messages'
      ],
    ).toBe(1);
    await user.selectOptions(kind, '4');
    expect(
      ((last(spy)['evaluation'] as Record<string, unknown>)['context'] as Record<string, unknown>)[
        'messages'
      ],
    ).toEqual({ where: 'true' });

    // The required evaluation changes with its radio; declared options remain independently editable.
    const options = screen.getByRole('group', { name: 'Options' });
    await user.click(within(options).getByRole('button', { name: 'Add options' }));
    expect(((last(spy)['answer'] as Record<string, unknown>)['options'] as unknown[]).length).toBe(
      3,
    );
  });

  it('edits JSON fields, optional unions, and tri-state booleans', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Harness
        schema={NodeConfigSchemas.inference}
        initial={{ prompt: { template: 'hi' }, harnessOptions: { configOverrides: { a: 1 } } }}
        spy={spy}
      />,
    );
    openAdvanced();
    const network = screen.getByRole('radiogroup', { name: 'Network access' });
    await user.click(within(network).getByRole('radio', { name: 'Yes' }));
    expect((last(spy)['harnessOptions'] as Record<string, unknown>)['networkAccess']).toBe(true);
    await user.click(within(network).getByRole('radio', { name: 'Not set' }));
    expect(
      (last(spy)['harnessOptions'] as Record<string, unknown>)['networkAccess'],
    ).toBeUndefined();

    expect(getCode('Config overrides value 1')).toBe('1');
    setCode('Config overrides value 1', '{"x": true}');
    expect((last(spy)['harnessOptions'] as Record<string, unknown>)['configOverrides']).toEqual({
      a: { x: true },
    });
    setCode('Config overrides value 1', '{oops');
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
    setCode('Config overrides value 1', '');
    expect(screen.queryByText(/Invalid JSON/)).not.toBeInTheDocument();

    await user.selectOptions(
      within(screen.getByRole('group', { name: 'Session' })).getByLabelText('Policy'),
      '2',
    );
    expect(last(spy)['session']).toEqual({ policy: 'resume-named', key: '' });

    await user.click(screen.getByRole('button', { name: 'Add schema' }));
    setCode('Json schema', '{"type":"object"}');
    expect((last(spy)['output'] as Record<string, unknown>)['schema']).toMatchObject({
      jsonSchema: { type: 'object' },
    });

    await user.click(screen.getByRole('button', { name: 'Add input' }));
    expect((last(spy)['input'] as unknown[])[0]).toMatchObject({
      op: 'set',
      path: '',
      value: { kind: 'literal', value: null },
    });
  });

  it('renders the other node kinds and loop settings without crashing', () => {
    const cases: [Schema, unknown][] = [
      [NodeConfigSchemas.mutate, { operations: [{ op: 'truncate', keep: { last: 2 } }] }],
      [NodeConfigSchemas.subloop, { loopRef: { loopId: 'x' } }],
      [NodeConfigSchemas.wait, { mode: 'signal', name: 'go' }],
      [NodeConfigSchemas.heartbeat, { intervalSeconds: 5 }],
      [
        NodeConfigSchemas.exit,
        { criteria: [{ when: 'predicate', strategy: 'expression', outcome: 'success' }] },
      ],
      [LoopSettingsSchema, {}],
      [z.object({ when: z.date(), tags: z.array(z.enum(['a', 'b'])).optional() }), {}],
    ];
    for (const [schema, initial] of cases) {
      const { unmount } = render(<Harness schema={schema} initial={initial} spy={vi.fn()} />);
      expect(screen.getByRole('form', { name: 'form' })).toBeInTheDocument();
      unmount();
    }
  });

  it('clears a field that had an initial value instead of restoring it', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness schema={LoopSettingsSchema} initial={{ maxIterations: 3 }} spy={spy} />);
    const input = screen.getByLabelText('Max iterations');
    await user.clear(input);
    expect(input).toHaveValue(null);
    expect(last(spy)).not.toHaveProperty('maxIterations');
    await user.type(input, '4');
    expect(last(spy)['maxIterations']).toBe(4);
  });

  it('disables adding past an array maximum and keeps non-object initial values', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const schema = z.object({
      items: z.array(z.number().min(2)).max(1),
      ratio: z.number().max(1).optional(),
    });
    render(<Harness schema={schema} initial={null} spy={spy} />);
    await user.click(screen.getByRole('button', { name: 'Add items' }));
    expect(last(spy)['items']).toEqual([2]);
    expect(screen.getByRole('button', { name: 'Add items' })).toBeDisabled();
  });
});

/**
 * A node's config form wired to the editor store as the node editor wires it: every change goes
 * to `updateNode` with the change the form reports, and an undo or redo remounts the form.
 */
function StoreForm({ schema, controls }: { schema: Schema; controls?: FieldControls }) {
  const config = useEditorStore((s) => s.definition?.nodes.find((n) => n.id === 'n')?.config);
  const epoch = useEditorStore((s) => s.historyEpoch);
  const parseErrors = useEditorStore((s) => s.fieldErrors['node:n']);
  return (
    <SchemaForm
      key={epoch}
      schema={schema}
      value={config}
      label="form"
      controls={controls}
      onChange={(next, change) =>
        useEditorStore.getState().updateNode('n', { config: next }, change)
      }
      parseErrors={parseErrors}
      onParseError={(path, error, reason, change) =>
        useEditorStore.getState().setFieldError('node:n', path, error, reason, change)
      }
    />
  );
}

describe('SchemaForm changes and undo steps', () => {
  const steps = () => useEditorStore.getState().past.length;
  const config = () =>
    useEditorStore.getState().definition!.nodes.find((n) => n.id === 'n')!.config as Record<
      string,
      unknown
    >;
  const undo = () => act(() => useEditorStore.getState().undo());
  beforeEach(() => {
    // Every change lands inside the merge window: only what the form reports keeps steps apart.
    vi.spyOn(historyClock, 'now').mockReturnValue(0);
  });
  afterEach(() => vi.restoreAllMocks());

  function load(config: Record<string, unknown>, kind: NodeInput['kind'] = 'mutate') {
    const definition = newLoopDefinition('steps');
    useEditorStore.getState().load('L1', {
      ...definition,
      nodes: [...definition.nodes, { id: 'n', kind, label: 'N', config } as NodeInput],
    });
  }

  it('makes three keystrokes one step, typing in another field another, and each toggle a step', async () => {
    const user = userEvent.setup();
    load({});
    render(
      <StoreForm
        schema={z.object({
          first: z.string().optional(),
          second: z.string().optional(),
          on: z.boolean().default(false),
        })}
      />,
    );
    await user.type(screen.getByLabelText('First'), 'abc');
    expect(config()['first']).toBe('abc');
    expect(steps()).toBe(1);
    await user.type(screen.getByLabelText('Second'), 'xy');
    expect(steps()).toBe(2);
    await user.click(screen.getByRole('switch', { name: 'On' }));
    await user.click(screen.getByRole('switch', { name: 'On' }));
    expect(config()['on']).toBe(false);
    expect(steps()).toBe(4);
    undo();
    expect(config()['on']).toBe(true);
    undo();
    expect(config()['on']).not.toBe(true);
    undo();
    expect(config()).not.toHaveProperty('second');
    expect(config()['first']).toBe('abc');
    undo();
    expect(config()).not.toHaveProperty('first');
    expect(screen.getByLabelText('First')).toHaveValue('');
  });

  it('makes the model and then the effort picker two steps', async () => {
    const user = userEvent.setup();
    load({ prompt: { template: 'hello' } }, 'inference');
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
    renderWith(
      <StoreForm schema={NodeConfigSchemas.inference} controls={NODE_FIELD_CONTROLS} />,
      '/',
      api,
    );
    const model = () => screen.getByLabelText('Model', { exact: true });
    const effort = () => screen.getByLabelText('Effort', { exact: true });
    await waitFor(() => expect(model()).not.toHaveAttribute('aria-readonly'));
    await user.selectOptions(model(), 'alpha');
    await user.selectOptions(effort(), 'high');
    expect(config()).toMatchObject({ model: 'alpha', effort: 'high' });
    expect(steps()).toBe(2);
    undo();
    expect(config()).toMatchObject({ model: 'alpha' });
    expect(config()).not.toHaveProperty('effort');
    expect(model()).toHaveValue('alpha');
    undo();
    expect(config()).not.toHaveProperty('model');
  });

  it('makes a row removal one step with the unparsed text it moves, apart from the typing', async () => {
    const user = userEvent.setup();
    load({ items: [1, 2, 3] });
    render(<StoreForm schema={z.object({ items: z.array(z.unknown()) })} />);
    // Text that does not parse, typed in the third row: one typing step.
    setCode('Items 3', '{"open');
    expect(useEditorStore.getState().fieldErrors['node:n']).toHaveProperty(['items.2']);
    expect(steps()).toBe(1);
    // Removing the first row moves the text up with its row and drops a value: one more step.
    await user.click(screen.getByRole('button', { name: 'Remove items 1' }));
    expect(config()['items']).toEqual([2, 3]);
    expect(useEditorStore.getState().fieldErrors['node:n']).toEqual({
      'items.1': expect.objectContaining({ text: '{"open' }),
    });
    expect(steps()).toBe(2);
    undo();
    expect(config()['items']).toEqual([1, 2, 3]);
    expect(useEditorStore.getState().fieldErrors['node:n']).toEqual({
      'items.2': expect.objectContaining({ text: '{"open' }),
    });
    expect(getCode('Items 3')).toBe('{"open');
    undo();
    expect(useEditorStore.getState().fieldErrors).toEqual({});
  });

  it('reports typing in a record value at its path, a key rename by its row, and Add as a commit', async () => {
    const user = userEvent.setup();
    const reports: unknown[] = [];
    render(
      <SchemaForm
        schema={z.object({ env: z.record(z.string(), z.string()) })}
        value={{ env: { HOME: '/home' } }}
        label="form"
        onChange={(_next, change) => reports.push(change)}
      />,
    );
    await user.type(screen.getByLabelText('Env value 1'), 'x');
    expect(reports.at(-1)).toMatchObject({ path: 'env.HOME', kind: 'typing' });
    await user.type(screen.getByLabelText('Env key 1'), 'Y');
    expect(reports.at(-1)).toMatchObject({ path: 'env#key0', kind: 'typing' });
    await user.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(reports.at(-1)).toMatchObject({ path: 'env', kind: 'commit' });
  });
});
