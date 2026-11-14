import { TemplateSchema } from '@graphgoblin/contracts';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import type { ParseError } from './parse-errors.js';
import { SchemaForm, type SchemaFormHandle } from './SchemaForm.js';

const schema = z.object({
  steps: z.array(z.object({ source: z.string(), note: z.string().optional() })),
  env: z.record(z.string(), z.string()),
  prompt: TemplateSchema,
  data: z.unknown().optional(),
});

const initial = {
  steps: [{ source: '/outputs/work/value', note: 'first' }],
  env: { 'a.b': '{{ outputs.work.value }}' },
  prompt: 'Read {{ outputs.work.value }}',
  data: { x: 1 },
};

/** The form over an owner that keeps what it reports, as the node editor does. */
function setup(value: unknown = initial, formSchema: z.ZodType = schema) {
  const ref = createRef<SchemaFormHandle>();
  const onChange = vi.fn();
  const onParseError = vi.fn();
  function Owner() {
    const [errors, setErrors] = useState<Record<string, ParseError>>({});
    return (
      <SchemaForm
        ref={ref}
        schema={formSchema}
        value={value}
        label="form"
        onChange={onChange}
        parseErrors={errors}
        onParseError={(path, error) => {
          onParseError(path, error);
          setErrors(({ [path]: _old, ...rest }) => (error ? { ...rest, [path]: error } : rest));
        }}
      />
    );
  }
  render(<Owner />);
  return { ref, onChange, onParseError };
}

function repair(apply: () => boolean | undefined) {
  let taken: boolean | undefined;
  act(() => {
    taken = apply();
  });
  return taken;
}

describe('SchemaForm applyRepair (#273)', () => {
  it('takes a string repair in place, reports nothing new, and later edits start from it', async () => {
    const user = userEvent.setup();
    const { ref, onChange, onParseError } = setup();
    // Held, unparsed text in one field and a cleared optional field: neither is the repair's.
    setCode('Data', '{oops');
    expect(onParseError).toHaveBeenLastCalledWith(
      'data',
      expect.objectContaining({ text: '{oops' }),
    );
    const note = screen.getByLabelText('Note');
    await user.clear(note);
    const previous = onChange.mock.calls.at(-1)![0] as typeof initial;
    expect(previous.steps).toEqual([{ source: '/outputs/work/value' }]);

    const source = screen.getByLabelText('Source');
    const entry = screen.getByLabelText('Env value 1');
    const repaired = {
      ...previous,
      steps: [{ source: '/outputs/worker/value' }],
      env: { 'a.b': '{{ outputs.worker.value }}' },
      prompt: 'Read {{ outputs.worker.value }}',
    };
    onChange.mockClear();
    onParseError.mockClear();
    expect(repair(() => ref.current?.applyRepair(previous, repaired))).toBe(true);

    expect(screen.getByLabelText('Source')).toBe(source);
    expect(source).toHaveValue('/outputs/worker/value');
    expect(screen.getByLabelText('Env value 1')).toBe(entry);
    expect(entry).toHaveValue('{{ outputs.worker.value }}');
    expect(getCode('Prompt')).toBe('Read {{ outputs.worker.value }}');
    expect(getCode('Data')).toBe('{oops');
    expect(note).toHaveValue('');
    // The owner already holds the repair; a field following it reports nothing else.
    for (const [value] of onChange.mock.calls) expect(value).toEqual(repaired);
    expect(onParseError).not.toHaveBeenCalled();

    await user.type(source, '/x');
    expect(onChange.mock.calls.at(-1)![0]).toEqual({
      ...repaired,
      steps: [{ source: '/outputs/worker/value/x' }],
    });
  });

  it('refuses anything but a string repair of the value it shows, changing nothing', () => {
    const { ref, onChange } = setup();
    const source = screen.getByLabelText('Source');
    const refused = [
      { ...initial, steps: [] },
      { ...initial, data: { x: 2 } },
      { ...initial, extra: 'x' },
    ];
    for (const next of refused)
      expect(repair(() => ref.current?.applyRepair(initial, next))).toBe(false);
    // A repair of a value the form no longer shows is not its own to take.
    const stale = { ...initial, env: { 'a.b': 'elsewhere' } };
    expect(
      repair(() =>
        ref.current?.applyRepair(stale, { ...stale, prompt: 'Read {{ outputs.x.value }}' }),
      ),
    ).toBe(false);
    expect(repair(() => ref.current?.applyRepair(initial, initial))).toBe(true);
    expect(screen.getByLabelText('Source')).toBe(source);
    expect(source).toHaveValue('/outputs/work/value');
    expect(getCode('Prompt')).toBe('Read {{ outputs.work.value }}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the variant it shows: a change of variant is no repair', () => {
    const union = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), text: z.string() }),
      z.object({ kind: z.literal('b'), text: z.string() }),
    ]);
    const shown = { kind: 'a', text: 'outputs.work' };
    const { ref, onChange } = setup(shown, union);
    expect(repair(() => ref.current?.applyRepair(shown, { kind: 'b', text: 'outputs.work' }))).toBe(
      false,
    );
    expect(screen.getByLabelText('Text')).toHaveValue('outputs.work');
    expect(
      repair(() => ref.current?.applyRepair(shown, { kind: 'a', text: 'outputs.worker' })),
    ).toBe(true);
    expect(screen.getByLabelText('Text')).toHaveValue('outputs.worker');
    expect(onChange).not.toHaveBeenCalled();
  });
});
