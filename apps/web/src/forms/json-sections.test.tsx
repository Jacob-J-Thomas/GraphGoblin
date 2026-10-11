import {
  DecisionAnswerSchema,
  DecisionEvaluationSchema,
  InferenceConfigSchema,
  SlugSchema,
  field,
} from '@graphgoblin/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { focusField } from '../editor/focus-field.js';
import { NODE_FIELD_CONTROLS } from '../editor/field-controls.js';
import { newLoopDefinition } from '../editor/model.js';
import { useEditorStore } from '../editor/store.js';
import { createDisclosureIdentities, type DisclosureStates } from './disclosures.js';
import { shapeOf, unwrap, type Schema } from './introspect.js';
import type { ParseError } from './parse-errors.js';
import { SchemaForm } from './SchemaForm.js';
import { VariableSuggestionsContext } from './fields/suggestions.js';
import { JsonApplyReviewContext } from './fields/json.js';

function object(schema: Schema) {
  const shape = shapeOf(schema);
  if (shape.kind !== 'object') throw new Error('object');
  return shape.shape;
}
const inference = InferenceConfigSchema.shape;
const choice = {
  type: 'choice',
  options: [
    { id: 'a', label: 'A', criteria: 'First\ncriterion' },
    { id: 'b', label: 'B', criteria: 'Second' },
  ],
};
const noul = {
  type: 'noul',
  true: { id: 'a', label: 'A', criteria: 'True\ncriterion' },
  false: { id: 'b', label: 'B', criteria: 'False' },
};
const score = {
  type: 'score',
  anchors: ['Low\nrubric', 'High'],
  bands: [{ id: 'all', label: 'All', min: 0, max: 1 }],
};
const sections: { name: string; schema: Schema; sample: unknown; empty: unknown }[] = [
  {
    name: 'input',
    schema: inference.input,
    sample: [
      { op: 'set', path: '/vars/topic', value: { kind: 'literal', value: { a: [1, true] } } },
    ],
    empty: [],
  },
  {
    name: 'output.transforms',
    schema: object(inference.output).transforms!,
    sample: [{ op: 'append-message', content: 'hello\nworld', role: 'note' }],
    empty: [],
  },
  {
    name: 'contextFiles',
    schema: inference.contextFiles,
    sample: [{ path: 'context.txt', template: '{{ vars.topic }}' }],
    empty: [],
  },
  {
    name: 'configOverrides',
    schema: object(inference.harnessOptions).configOverrides!,
    sample: { nested: { a: [1] } },
    empty: undefined,
  },
  {
    name: 'capabilities',
    schema: inference.capabilities,
    sample: { mcpServers: ['server'], plugins: ['plugin'], skills: ['skill'] },
    empty: undefined,
  },
  {
    name: 'choice routes',
    schema: DecisionAnswerSchema,
    sample: choice,
    empty: { ...choice, options: [] },
  },
  { name: 'noul routes', schema: DecisionAnswerSchema, sample: noul, empty: { type: 'noul' } },
  {
    name: 'score routes and rubric',
    schema: DecisionAnswerSchema,
    sample: score,
    empty: { ...score, anchors: [], bands: [] },
  },
  {
    name: 'provider context',
    schema: object(DecisionEvaluationSchema.options[1]).context!,
    sample: { messages: { where: 'role="note"' }, vars: ['topic'], includeLastOutput: false },
    empty: { messages: 'none', vars: [], includeLastOutput: true },
  },
];

function Harness({
  schema,
  initial,
  spy = vi.fn(),
}: {
  schema: Schema;
  initial: unknown;
  spy?: (value: unknown) => void;
}) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, ParseError>>({});
  return (
    <>
      <SchemaForm
        schema={schema}
        value={value}
        label="form"
        onChange={(next) => {
          setValue(next);
          spy(next);
        }}
        parseErrors={errors}
        onParseError={(path, error) =>
          setErrors((previous) => {
            const { [path]: _removed, ...rest } = previous;
            return error ? { ...rest, [path]: error } : rest;
          })
        }
      />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  );
}

describe('section JSON mode', () => {
  it('returns to structured fields when history restores descendant held input', () => {
    const schema = z.object({ section: z.array(z.unknown()).meta({ jsonEditor: true }) });
    const props = {
      schema,
      value: { section: [1] },
      label: 'form',
      onChange: vi.fn(),
      disclosures: {
        open: { 'section#json': true },
        setOpen: vi.fn(),
        identities: createDisclosureIdentities(),
      },
    };
    const view = render(<SchemaForm {...props} parseErrors={{}} />);
    expect(screen.getByLabelText('Section JSON')).toBeInTheDocument();
    view.rerender(
      <SchemaForm
        key="history-remount"
        {...props}
        parseErrors={{ 'section.0': { text: '{held', message: 'invalid JSON' } }}
      />,
    );
    expect(screen.queryByLabelText('Section JSON')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('section.0');
    expect(getCode('Section 1')).toBe('{held');
  });
  it('does not hold whitespace/key-order-only edits, while array order remains significant', async () => {
    render(
      <Harness
        schema={z.object({ section: z.unknown().meta({ jsonEditor: true }) })}
        initial={{ section: { a: 1, b: [2, 3] } }}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit as JSON: Section' }));
    setCode('Section JSON', ' { "b": [2,3], "a": 1 } ');
    expect(screen.queryByText(/Choose Apply JSON/)).not.toBeInTheDocument();
    setCode('Section JSON', '{"b":[3,2],"a":1}');
    expect(screen.getByText(/Choose Apply JSON/)).toBeInTheDocument();
    setCode('Section JSON', '{"a":1,"b":[2,3]}');
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Use structured editor for Section' }));
    expect(screen.queryByLabelText('Section JSON')).not.toBeInTheDocument();
  });

  it('requires a separate confirmation, rechecks changed consequences, and cancels review without applying', async () => {
    const spy = vi.fn();
    const review = vi.fn(() => [{ id: 'e1', description: 'old → target' }]);
    render(
      <JsonApplyReviewContext value={review}>
        <Harness
          schema={z.object({ section: z.array(z.number()).meta({ jsonEditor: true }) })}
          initial={{ section: [1] }}
          spy={spy}
        />
      </JsonApplyReviewContext>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit as JSON: Section' }));
    setCode('Section JSON', '[2]');
    await user.click(screen.getByRole('button', { name: 'Apply JSON' }));
    expect(screen.getByRole('group', { name: 'Confirm connection removal' })).toHaveTextContent(
      'old → target',
    );
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply JSON' }));
    expect(spy).not.toHaveBeenCalled();
    review.mockReturnValue([{ id: 'e2', description: 'old → other' }]);
    await user.click(screen.getByRole('button', { name: 'Confirm Apply JSON' }));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Confirm connection removal' })).toHaveTextContent(
      'old → other',
    );
    await user.click(screen.getByRole('button', { name: 'Keep editing JSON' }));
    expect(
      screen.queryByRole('group', { name: 'Confirm connection removal' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply JSON' }));
    setCode('Section JSON', '[3]');
    expect(
      screen.queryByRole('group', { name: 'Confirm connection removal' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply JSON' }));
    await user.click(screen.getByRole('button', { name: 'Cancel JSON' }));
    expect(spy).not.toHaveBeenCalled();
    setCode('Section JSON', '[4]');
    await user.click(screen.getByRole('button', { name: 'Apply JSON' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Apply JSON' }));
    expect(spy).toHaveBeenLastCalledWith({ section: [4] });
  });

  it('refuses JSON mode while descendants hold input, names them, and focuses the first through disclosures', async () => {
    const schema = z.object({
      section: z.array(z.unknown()).meta({ jsonEditor: true, collapseItems: true }),
    });
    render(
      <SchemaForm
        schema={schema}
        value={{ section: [1, 2] }}
        label="form"
        onChange={vi.fn()}
        parseErrors={{
          'section.0': { text: '{held', message: 'invalid JSON' },
          'section.1': { text: '[held', message: 'invalid JSON' },
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit as JSON: Section' }));
    expect(screen.queryByLabelText('Section JSON')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('section.0, section.1');
    await user.click(screen.getByRole('button', { name: 'Focus first held field' }));
    expect(screen.getByLabelText('Section 1')).toHaveFocus();
    expect(getCode('Section 1')).toBe('{held');
  });
  it('round trips a cleared optional child without exposing the internal unset marker', async () => {
    const spy = vi.fn();
    render(
      <Harness
        schema={z.object({
          section: z.object({ amount: z.number().optional() }).meta({ jsonEditor: true }),
        })}
        initial={{ section: { amount: 1 } }}
        spy={spy}
      />,
    );
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Amount'));
    expect(spy).toHaveBeenLastCalledWith({ section: {} });
    await user.click(screen.getByRole('button', { name: 'Edit as JSON: Section' }));
    expect(JSON.parse(getCode('Section JSON'))).toEqual({});
    await user.click(screen.getByRole('button', { name: 'Apply JSON' }));
    expect(spy).toHaveBeenLastCalledWith({ section: {} });
    await user.click(screen.getByRole('button', { name: 'Use structured editor for Section' }));
    expect(screen.getByLabelText('Amount')).toHaveValue(null);
  });
  it.each(sections)(
    'round trips $name without rewriting saved values and validates empty/absent input',
    async ({ schema: section, sample, empty }) => {
      const schema = z.object({
        section: section.meta({ context: false, advanced: false, jsonEditor: true }),
      });
      const spy = vi.fn();
      render(<Harness schema={schema} initial={{ section: sample }} spy={spy} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Edit as JSON: Section' }));
      expect(JSON.parse(getCode('Section JSON'))).toEqual(sample);
      if (unwrap(section).optional)
        expect(screen.getByLabelText('Section JSON')).not.toHaveAttribute('aria-required');
      else expect(screen.getByLabelText('Section JSON')).toHaveAttribute('aria-required', 'true');
      setCode('Section JSON', JSON.stringify(sample, null, 4));
      expect(spy).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Apply JSON' }));
      expect(spy).toHaveBeenLastCalledWith({ section: sample });
      await user.click(screen.getByRole('button', { name: 'Use structured editor for Section' }));
      expect(screen.queryByLabelText('Section JSON')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Edit as JSON: Section' }));
      expect(JSON.parse(getCode('Section JSON'))).toEqual(sample);
      spy.mockClear();
      setCode('Section JSON', empty === undefined ? '' : JSON.stringify(empty));
      if (section.safeParse(empty).success) {
        await user.click(screen.getByRole('button', { name: 'Apply JSON' }));
        expect(spy).toHaveBeenLastCalledWith(empty === undefined ? {} : { section: empty });
      } else {
        expect(screen.getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

  it('holds syntax/schema errors, blocks switching, cancels, and focuses nested issues in JSON', async () => {
    const spy = vi.fn();
    render(
      <Harness
        schema={z.object({
          section: z.array(z.object({ n: z.number().int().min(1) })).meta({ jsonEditor: true }),
        })}
        initial={{ section: [{ n: 2 }] }}
        spy={spy}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit as JSON: Section' }));
    setCode('Section JSON', '{held');
    expect(screen.getByText(/Invalid JSON/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Use structured editor for Section' }));
    expect(screen.getByText(/before switching editors/)).toBeVisible();
    expect(getCode('Section JSON')).toBe('{held');
    setCode('Section JSON', '[{"n":0.5}]');
    expect(screen.getByText(/0.n:/)).toBeVisible();
    expect(spy).not.toHaveBeenCalled();
    act(() => expect(focusField(screen.getByRole('form'), 'section.0.n')).toBe(true));
    expect(screen.getByLabelText('Section JSON')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel JSON' }));
    expect(JSON.parse(getCode('Section JSON'))).toEqual([{ n: 2 }]);
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use structured editor for Section' }));
    expect(screen.getByLabelText('N')).toHaveValue(2);
  });

  it.each([choice, noul, score])(
    'rejects a different answer type and cross-row schema errors for $type',
    async (answer) => {
      render(
        <Harness
          schema={z.object({ answer: DecisionAnswerSchema.meta({ jsonEditor: true }) })}
          initial={{ answer }}
        />,
      );
      await userEvent.setup().click(screen.getByRole('button', { name: 'Edit as JSON: Answer' }));
      setCode('Answer JSON', JSON.stringify(answer.type === 'choice' ? noul : choice));
      expect(screen.getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
      const invalid =
        answer.type === 'choice'
          ? { ...choice, options: [choice.options[0], choice.options[0]] }
          : answer.type === 'noul'
            ? { ...noul, false: noul.true }
            : { ...score, bands: [{ ...score.bands[0], max: 2 }] };
      setCode('Answer JSON', JSON.stringify(invalid));
      expect(screen.getByRole('button', { name: 'Apply JSON' })).toBeDisabled();
      expect(screen.getByTestId('value').textContent).toBe(JSON.stringify({ answer }));
    },
  );

  it('retains held text through Advanced, tabs, history and dialog-session remounts; Apply is one step', async () => {
    const definition = newLoopDefinition('json');
    definition.nodes.push({
      id: 'n',
      kind: 'inference',
      label: 'N',
      config: { prompt: { template: 'hi' }, contextFiles: [{ path: 'a.txt', template: 'hello' }] },
    });
    useEditorStore.getState().load('L1', definition);
    function StoreForm() {
      const config = useEditorStore(
        (state) => state.definition!.nodes.find((node) => node.id === 'n')!.config,
      );
      const epoch = useEditorStore((state) => state.historyEpoch);
      const errors = useEditorStore((state) => state.fieldErrors['node:n']);
      const [open, setOpen] = useState<DisclosureStates>({});
      const [identities] = useState(createDisclosureIdentities);
      const [session, setSession] = useState(0);
      return (
        <>
          <button onClick={() => setSession((previous) => previous + 1)}>Reopen</button>
          <SchemaForm
            key={`${epoch}:${session}`}
            schema={InferenceConfigSchema}
            value={config}
            label="form"
            disclosures={{ open, setOpen, identities }}
            parseErrors={errors}
            onChange={(next, change) =>
              useEditorStore.getState().updateNode('n', { config: next }, change)
            }
            onParseError={(path, error, reason, change) =>
              useEditorStore.getState().setFieldError('node:n', path, error, reason, change)
            }
          />
        </>
      );
    }
    render(<StoreForm />);
    const user = userEvent.setup();
    act(() => {
      focusField(screen.getByRole('form'), 'contextFiles');
    });
    await user.click(screen.getByRole('button', { name: 'Edit as JSON: Context files' }));
    setCode('Context files JSON', '{held');
    await user.click(screen.getByRole('button', { name: /^Advanced/ }));
    await user.click(screen.getByRole('tab', { name: /^Settings/ }));
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    act(() => {
      focusField(screen.getByRole('form'), 'contextFiles.0.path');
    });
    expect(getCode('Context files JSON')).toBe('{held');
    setCode('Context files JSON', '[{"path":"b.txt","template":"changed"}]');
    await user.click(screen.getByRole('button', { name: 'Apply JSON' }));
    expect(useEditorStore.getState().fieldErrors['node:n']).toBeUndefined();
    act(() => useEditorStore.getState().undo());
    expect(getCode('Context files JSON')).toContain('b.txt');
    expect(useEditorStore.getState().fieldErrors['node:n']).toHaveProperty('contextFiles');
    expect(
      useEditorStore.getState().definition!.nodes.find((node) => node.id === 'n')!.config,
    ).toHaveProperty('contextFiles', [{ path: 'a.txt', template: 'hello' }]);
    act(() => useEditorStore.getState().redo());
    expect(useEditorStore.getState().fieldErrors['node:n']).toBeUndefined();
    expect(getCode('Context files JSON')).toContain('b.txt');
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^Context/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });
});

describe('typed inputs', () => {
  it('shows capability availability once per section and never renders empty capability datalists', async () => {
    render(
      <SchemaForm
        schema={z.object({ capabilities: inference.capabilities.meta({ advanced: false }) })}
        value={{ capabilities: { mcpServers: ['server', 'another'], skills: ['skill', 'other'] } }}
        controls={NODE_FIELD_CONTROLS}
        onChange={vi.fn()}
        label="form"
      />,
    );
    expect(screen.getAllByText(/No resolved capability identifiers/)).toHaveLength(1);
    expect(document.querySelectorAll('datalist')).toHaveLength(0);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Edit as JSON: Capabilities' }));
    expect(screen.getAllByText(/No resolved capability identifiers/)).toHaveLength(1);
    expect(document.querySelectorAll('datalist')).toHaveLength(0);
  });
  it('keeps authored capability slugs editable and rejects malformed identifiers through the schema', async () => {
    render(
      <SchemaForm
        schema={z.object({ skills: z.array(SlugSchema.meta({ control: 'capability-skills' })) })}
        value={{ skills: ['authored'] }}
        controls={NODE_FIELD_CONTROLS}
        onChange={vi.fn()}
        label="form"
      />,
    );
    expect(screen.getByLabelText('Skills 1')).toHaveValue('authored');
    expect(screen.getByLabelText('Skills 1')).not.toHaveAttribute('list');
    fireEvent.change(screen.getByLabelText('Skills 1'), { target: { value: 'invalid slug!' } });
    expect(screen.getByRole('alert')).toHaveTextContent('must start with a letter');
    fireEvent.change(screen.getByLabelText('Skills 1'), { target: { value: 'another-authored' } });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it.each([z.number().int().min(1).max(10), z.number().min(0).max(1).multipleOf(0.25)])(
    'keeps invalid numbers out of saved values',
    (number) => {
      const spy = vi.fn();
      render(<Harness schema={z.object({ amount: number })} initial={{ amount: 1 }} spy={spy} />);
      const input = screen.getByLabelText('Amount');
      expect(input).toHaveAttribute(
        'min',
        String(shapeOf(number).kind === 'number' && number.safeParse(0).success ? 0 : 1),
      );
      for (const value of ['-1', '11', '0.3', '']) {
        fireEvent.change(input, { target: { value } });
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(spy).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(
          number.safeParse(value === '' ? undefined : Number(value)).error!.issues[0]!.message,
        );
      }
      fireEvent.change(input, { target: { value: '1' } });
      expect(spy).toHaveBeenLastCalledWith({ amount: 1 });
      expect(input).not.toHaveAttribute('aria-invalid');
    },
  );

  it('updates variable suggestions and accepts undeclared slugs exactly as the schema permits', () => {
    const spy = vi.fn();
    const schema = z.object({
      variable: SlugSchema.meta(field('Variable', { control: 'variable' })),
      path: z.string().meta({ control: 'variable-path' }),
    });
    const form = (variables: string[]) => (
      <VariableSuggestionsContext value={variables}>
        <SchemaForm
          schema={schema}
          value={{ variable: 'topic', path: '/vars/topic' }}
          controls={NODE_FIELD_CONTROLS}
          onChange={spy}
          label="form"
        />
      </VariableSuggestionsContext>
    );
    const { rerender } = render(form(['topic']));
    const input = screen.getByLabelText('Variable');
    expect(document.getElementById(input.getAttribute('list')!)!.tagName).toBe('DATALIST');
    expect(document.querySelector('option[value="topic"]')).toBeInTheDocument();
    expect(document.querySelector('option[value="/vars/topic"]')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'undeclared' } });
    expect(spy).toHaveBeenLastCalledWith(
      { variable: 'undeclared', path: '/vars/topic' },
      expect.anything(),
    );
    expect(schema.safeParse({ variable: 'undeclared', path: '/vars/topic' }).success).toBe(true);
    rerender(form(['count']));
    expect(document.querySelector('option[value="topic"]')).not.toBeInTheDocument();
    expect(document.querySelector('option[value="count"]')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'bad slug!' } });
    expect(
      screen.getByText(/must start with a letter/, { selector: '[role="alert"]' }),
    ).toBeInTheDocument();
  });

  it('keeps criterion/rubric newlines and schema-typed booleans/enums', async () => {
    render(
      <Harness
        schema={z.object({
          answer: DecisionAnswerSchema,
          enabled: z.boolean(),
          policy: z.enum(['a', 'b']),
        })}
        initial={{ answer: score, enabled: true, policy: 'a' }}
      />,
    );
    const anchor = screen.getByLabelText('Anchors 1');
    expect(anchor.tagName).toBe('TEXTAREA');
    fireEvent.change(anchor, { target: { value: 'First line\nSecond line' } });
    expect(screen.getByTestId('value')).toHaveTextContent('First line\\nSecond line');
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Enabled' }));
    expect(screen.getByTestId('value')).toHaveTextContent('"enabled":false');
    await userEvent.setup().click(screen.getByRole('radio', { name: 'b' }));
    expect(screen.getByTestId('value')).toHaveTextContent('"policy":"b"');
  });
});
