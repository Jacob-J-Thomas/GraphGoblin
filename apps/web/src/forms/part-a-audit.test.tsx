import { NodeConfigSchemas, field } from '@graphgoblin/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { DefaultField, type FieldProps } from './fields.js';
import { isWithin, useAllProblemCount, useProblemCount } from './fields/shared.js';
import { SchemaForm } from './SchemaForm.js';

describe('Part A audit', () => {
  it.each([false, true])(
    'drops held JSON when switching schemas at the same union path (nested: %s)',
    async (nested) => {
      const union = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('first'), shared: z.unknown().default({ first: true }) }),
        z.object({ kind: z.literal('second'), shared: z.unknown().default(['second']) }),
      ]);
      render(
        <SchemaForm
          schema={nested ? z.object({ body: union }) : union}
          value={
            nested
              ? { body: { kind: 'first', shared: { first: true } } }
              : { kind: 'first', shared: { first: true } }
          }
          label="form"
          onChange={vi.fn()}
        />,
      );
      setCode('Shared', '{held');
      await userEvent.setup().selectOptions(screen.getByLabelText('Kind'), '1');
      expect(getCode('Shared')).toBe('');
      expect(screen.getByLabelText('Shared')).toHaveAttribute('data-language', 'json');
      expect(screen.queryByText(/Invalid JSON/)).not.toBeInTheDocument();
    },
  );
  it.each([false, true])('replaces local state in a union body (nested: %s)', async (nested) => {
    const union = z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('first'),
        shared: z.string().meta(field('first', { control: 'probe' })),
      }),
      z.object({
        kind: z.literal('second'),
        shared: z.number().meta(field('second', { control: 'probe' })),
      }),
    ]);
    function Probe({ schema }: FieldProps) {
      const [initial] = useState(() => (schema.safeParse(1).success ? 'number' : 'string'));
      return <p>{initial}</p>;
    }
    render(
      <SchemaForm
        schema={nested ? z.object({ body: union }) : union}
        value={nested ? { body: { kind: 'first', shared: 'a' } } : { kind: 'first', shared: 'a' }}
        label="form"
        onChange={vi.fn()}
        controls={{ probe: Probe }}
      />,
    );
    expect(screen.getByText('string')).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByLabelText('Kind'), '1');
    expect(screen.getByText('number')).toBeInTheDocument();
    expect(screen.queryByText('string')).not.toBeInTheDocument();
  });

  it.each(['inference', 'decision'] as const)(
    'does not render unrelated %s fields per keystroke',
    async (kind) => {
      const renders = vi.fn();
      function Probe(props: FieldProps) {
        renders();
        return <DefaultField {...props} />;
      }
      const initial =
        kind === 'inference'
          ? { prompt: { template: 'hello' } }
          : {
              answer: {
                type: 'noul',
                true: { id: 'yes', label: 'Yes', criteria: 'yes' },
                false: { id: 'no', label: 'No', criteria: 'no' },
              },
              evaluation: { kind: 'classifier', model: 'jev', question: 'hello' },
            };
      const overrides = kind === 'inference' ? { harness: Probe } : { 'answer.true.id': Probe };
      function Harness() {
        const [value, setValue] = useState<unknown>(initial);
        return (
          <SchemaForm
            schema={NodeConfigSchemas[kind]}
            value={value}
            label="form"
            onChange={setValue}
            fieldOverrides={overrides}
          />
        );
      }
      render(<Harness />);
      await waitFor(() => expect(screen.queryByLabelText('Config issues')).not.toBeInTheDocument());
      const before = renders.mock.calls.length;
      const editor = kind === 'inference' ? 'Template' : 'Question';
      act(() => setCode(editor, 'hello world'));
      act(() => setCode(editor, 'hello world again'));
      expect(renders.mock.calls.length - before).toBe(0);
    },
  );

  it('keeps empty-path field counts separate from explicit whole-form counts', () => {
    function Counts() {
      return (
        <p>
          {useProblemCount([''])}/{useAllProblemCount()}/{useProblemCount(['group'])}
        </p>
      );
    }
    render(
      <SchemaForm
        schema={z.object({ count: z.string().meta(field('count', { control: 'counts' })) })}
        value={{ count: 'ok' }}
        problems={['', 'group.child', 'other']}
        controls={{ counts: Counts }}
        label="form"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('1/3/1')).toBeInTheDocument();
    expect(isWithin('other', '')).toBe(false);
    expect(isWithin('grouped', 'group')).toBe(false);
  });
});
