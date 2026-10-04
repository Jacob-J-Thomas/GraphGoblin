import {
  NodeConfigSchemas,
  LoopSettingsSchema,
  ExpressionSchema,
  TemplateSchema,
  VariableDeclarationsSchema,
} from '@graphgoblin/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { SchemaForm } from './SchemaForm.js';
import type { Schema } from './introspect.js';

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
    <>
      <SchemaForm
        schema={schema}
        value={value}
        label="form"
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
          routes: [
            { label: 'yes', description: 'old' },
            { label: 'no', description: 'no' },
          ],
          question: 'choose',
          strategy: ['jev'],
        }}
        spy={spy}
      />,
    );
    const routes = screen.getByRole('group', { name: 'Routes' });
    const descriptions = within(routes).getAllByLabelText('Description');
    await user.clear(descriptions[0]!);
    await user.type(descriptions[0]!, 'edited');
    await user.click(within(routes).getByRole('button', { name: 'Add routes' }));
    expect((last(spy)['routes'] as unknown[])[0]).toEqual({ label: 'yes', description: 'edited' });
    await user.click(within(routes).getByRole('button', { name: 'Remove routes 2' }));
    expect((last(spy)['routes'] as unknown[])[0]).toEqual({ label: 'yes', description: 'edited' });
  });

  it.each(['template', 'expression'] as const)(
    'omits an empty optional %s preview but keeps required and malformed previews',
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
      expect(within(required as HTMLElement).getByTestId('preview')).toBeInTheDocument();
      if (kind === 'expression') {
        await waitFor(() =>
          expect(within(required as HTMLElement).getByTestId('preview')).toHaveTextContent(
            'failed to compile',
          ),
        );
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
  ] as const)(
    'treats optional node conditions as absent only when exactly empty',
    async (schema, initial, label) => {
      render(<Harness schema={schema} initial={initial} spy={vi.fn()} />);
      const field = screen.getByLabelText(label).closest('[data-field]') as HTMLElement;
      expect(within(field).queryByTestId('preview')).not.toBeInTheDocument();
      setCode(label, ' ');
      await waitFor(() =>
        expect(within(field).getByTestId('preview')).toHaveTextContent('failed to compile'),
      );
      setCode(label, 'true');
      await waitFor(() => expect(within(field).getByTestId('preview')).toHaveTextContent('true'));
      setCode(label, '');
      expect(within(field).queryByTestId('preview')).not.toBeInTheDocument();
    },
  );

  it.each([
    [
      NodeConfigSchemas.decision,
      {
        routes: [
          { label: 'yes', description: '' },
          { label: 'no', description: '' },
        ],
        question: 'choose',
        strategy: ['expression'],
        expression: { jsonata: '' },
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
      const field = screen.getByLabelText(label).closest('[data-field]') as HTMLElement;
      await waitFor(() =>
        expect(within(field).getByTestId('preview')).toHaveTextContent('failed to compile'),
      );
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
    const command = screen.getByLabelText('Command');
    await user.clear(command);
    await user.type(command, 'python');
    expect(last(spy)['command']).toBe('python');

    await user.type(screen.getByLabelText('Timeout seconds'), '30');
    expect(last(spy)['timeoutSeconds']).toBe(30);
    await user.clear(screen.getByLabelText('Timeout seconds'));
    expect(last(spy)['timeoutSeconds']).toBeUndefined();

    await user.selectOptions(screen.getByLabelText('Stdin'), 'none');
    expect(last(spy)['stdin']).toBe('none');
    // Defaults show through until the user sets a value.
    expect(screen.getByLabelText('Stdout')).toHaveValue('last-output');
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

  it('handles nested unions, optional objects, templates with preview, and issues', async () => {
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
          question: 'Is {{ vars.topic }} ok?',
          strategy: ['expression'],
        }}
        spy={spy}
      />,
    );
    // The superRefine issue is summarised.
    expect(
      await screen.findByText(/expression strategy requires an expression block/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByTestId('preview')[0]).toHaveTextContent('Is hello ok?'),
    );

    await user.click(screen.getByRole('button', { name: 'Add expression' }));
    expect(last(spy)['expression']).toEqual({ jsonata: 'true' });
    setCode('Jsonata', 'vars.count + 1');
    await waitFor(() => expect(screen.getAllByTestId('preview')[1]).toHaveTextContent('3'));
    await waitFor(() =>
      expect(screen.queryByText(/expression strategy requires/)).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Remove expression' }));
    expect(last(spy)['expression']).toBeUndefined();

    // Context messages: union of literals, a number, and an object.
    const kind = within(screen.getByRole('group', { name: 'Messages' })).getByLabelText('Kind');
    await user.selectOptions(kind, '3');
    expect((last(spy)['context'] as Record<string, unknown>)['messages']).toBe(1);
    await user.selectOptions(kind, '4');
    expect((last(spy)['context'] as Record<string, unknown>)['messages']).toEqual({
      where: 'true',
    });

    // Optional boolean renders as a tri-state select; optional enum offers "not set".
    await user.click(screen.getByRole('button', { name: 'Add codex' }));
    await user.selectOptions(screen.getByLabelText('Effort'), 'high');
    expect(last(spy)['codex']).toEqual({ effort: 'high' });
    await user.selectOptions(screen.getByLabelText('Effort'), '');
    expect(last(spy)['codex']).toEqual({});

    await user.click(screen.getByRole('button', { name: 'Add routes' }));
    expect((last(spy)['routes'] as unknown[]).length).toBe(3);
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
    await user.selectOptions(screen.getByLabelText('Network access'), 'true');
    expect((last(spy)['harnessOptions'] as Record<string, unknown>)['networkAccess']).toBe(true);
    await user.selectOptions(screen.getByLabelText('Network access'), '');
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
