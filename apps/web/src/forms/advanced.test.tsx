import { NodeConfigSchemas, field, type NodeKind } from '@graphgoblin/contracts';
import { everyFieldLoop } from '@graphgoblin/contracts/testing';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openAdvanced } from '../__fixtures__/advanced.js';
import { focusField } from '../editor/focus-field.js';
import { DefaultField, useField, type FieldControls, type FieldProps } from './fields.js';
import { matchOption, shapeOf, unwrap, type Schema } from './introspect.js';
import type { ParseError } from './parse-errors.js';
import { SchemaForm } from './SchemaForm.js';

function Harness({
  schema,
  initial,
  controls,
  parseErrors,
  problems,
  spy = () => undefined,
}: {
  schema: Schema;
  initial: unknown;
  controls?: FieldControls;
  parseErrors?: Record<string, ParseError>;
  problems?: readonly string[];
  spy?: (value: unknown) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SchemaForm
      schema={schema}
      value={value}
      label="form"
      controls={controls}
      parseErrors={parseErrors}
      problems={problems}
      onChange={(next) => {
        setValue(next);
        spy(next);
      }}
    />
  );
}

/** The element marked with field path `path`, or undefined. */
const fieldAt = (path: string, root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLElement>('[data-field]')].find(
    (el) => el.getAttribute('data-field') === path,
  );

/** Whether `path`'s field is drawn and not hidden (by a collapsed disclosure or otherwise). */
const shown = (path: string) => {
  const el = fieldAt(path);
  return el !== undefined && el.closest('[hidden]') === null;
};

/** The top-level field paths the form draws, in order (a split object's block counts once). */
const topLevelFields = () => [
  ...new Set(
    [...document.querySelectorAll('form [data-field]')]
      .map((el) => el.getAttribute('data-field')!)
      .filter((path) => !path.includes('.')),
  ),
];

/** Each config of a kind in the every-field loop, by kind: one per subtype or mode. */
const configsOf = (kind: NodeKind) =>
  everyFieldLoop()
    .nodes.filter((node) => node.kind === kind)
    .map((node) => node.config as Record<string, unknown>);

/** A config's schema object: the matching variant of a union, else the schema itself. */
function objectOf(kind: NodeKind, config: Record<string, unknown>): Record<string, Schema> {
  const shape = shapeOf(NodeConfigSchemas[kind]);
  if (shape.kind === 'object') return shape.shape;
  if (shape.kind !== 'union') throw new Error(kind);
  const option = shape.options.find((o) => o.safeParse(config).success)!;
  const variant = shapeOf(option);
  if (variant.kind !== 'object') throw new Error(kind);
  return variant.shape;
}

/** What a field path must show: a value control, any control (Add, a picker), or just be there. */
interface Expected {
  path: string;
  control: 'value' | 'any' | 'none';
}

const VALUE_CONTROL =
  'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="switch"]';
const ANY_CONTROL = `${VALUE_CONTROL}, button`;

const recordOf = (value: unknown) =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/**
 * Every field the form must draw for `value` under `schema` at `path`, down to the leaves: an
 * object's fields (an absent optional one is its Add button), each item of a list, each entry of a
 * record (its value is one field, a JSON editor when it is opaque), and the fields of the union
 * variant the value has. A JSON value is one editor, whatever it holds.
 */
function expectedFields(schema: Schema, value: unknown, path: string, out: Expected[]) {
  const { hasDefault, defaultValue, optional } = unwrap(schema);
  const current = value === undefined && hasDefault ? defaultValue : value;
  const shape = shapeOf(schema);
  switch (shape.kind) {
    case 'object':
      if (current === undefined && optional) {
        out.push({ path, control: 'any' });
        return;
      }
      out.push({ path, control: 'none' });
      for (const [key, child] of Object.entries(shape.shape)) {
        expectedFields(child, recordOf(current)[key], `${path}.${key}`, out);
      }
      return;
    case 'array':
      out.push({ path, control: 'any' });
      if (shapeOf(shape.element).kind === 'enum' || !Array.isArray(current)) return;
      current.forEach((item, index) =>
        expectedFields(shape.element, item, `${path}.${index}`, out),
      );
      return;
    case 'record':
      out.push({ path, control: 'any' });
      for (const key of Object.keys(recordOf(current))) {
        out.push({ path: `${path}.${key}`, control: 'value' });
      }
      return;
    case 'union': {
      out.push({ path, control: 'value' });
      if (current === undefined) return;
      const index = matchOption(shape.options, current, shape.discriminator);
      const option = shapeOf(shape.options[index]!);
      if (option.kind !== 'object') return;
      for (const [key, child] of Object.entries(option.shape)) {
        if (key === shape.discriminator) continue;
        expectedFields(child, recordOf(current)[key], `${path}.${key}`, out);
      }
      return;
    }
    case 'literal':
      out.push({ path, control: 'none' });
      return;
    default:
      out.push({ path, control: 'value' });
  }
}

/** Open the Advanced disclosure and every collapsed item, nested ones included. */
function openEverything() {
  const form = screen.getByRole('form', { name: 'form' });
  for (let round = 0; round < 5; round += 1) {
    const closed = [...form.querySelectorAll<HTMLElement>('button[aria-expanded="false"]')];
    if (closed.length === 0) return;
    for (const button of closed) fireEvent.click(button);
  }
}

const toggle = () => screen.queryByRole('button', { name: /^Advanced\b/ });

describe('basic fields first, advanced ones behind a disclosure', () => {
  it.each(['trigger', 'wait', 'heartbeat', 'exit'] as const)(
    '%s draws every field as before, in schema order, with no Advanced section',
    (kind) => {
      for (const config of configsOf(kind)) {
        cleanup();
        render(<Harness schema={NodeConfigSchemas[kind]} initial={config} />);
        expect(toggle()).toBeNull();
        const keys = Object.keys(objectOf(kind, config)).filter(
          (key) => key !== 'subtype' && key !== 'mode',
        );
        expect(topLevelFields()).toEqual(keys);
        for (const key of keys) expect(shown(key), `${kind}.${key}`).toBe(true);
      }
    },
  );

  it.each([
    [
      'inference',
      ['harness', 'model', 'effort', 'session', 'prompt', 'harnessOptions.sandbox'],
      [
        'input',
        'contextFiles',
        'harnessOptions.approval',
        'harnessOptions.networkAccess',
        'harnessOptions.webSearch',
        'harnessOptions.configOverrides',
        'capabilities',
        'output.captureTranscript',
        'output.toMessages',
        'output.transforms',
        'output.schema',
        'timeoutSeconds',
      ],
      ['Context', 'Harness options', 'Output', 'Limits'],
    ],
    [
      'decision',
      ['routes', 'question', 'strategy', 'jev', 'codex', 'expression'],
      ['context.messages', 'context.vars', 'context.includeLastOutput', 'recordAlternatives'],
      ['Context', 'Recording'],
    ],
    [
      'script',
      ['command', 'args', 'cwd'],
      ['env', 'stdin', 'stdout', 'exitCodeRoutes', 'timeoutSeconds'],
      ['Process', 'Input and output'],
    ],
    [
      'subloop',
      ['loopRef', 'input.mode', 'output.mode'],
      [
        'input.exclude',
        'input.vars',
        'input.messages',
        'input.artifacts',
        'input.inject',
        'input.trigger',
        'output.resultTo',
        'output.vars',
        'output.messages',
        'output.artifacts',
        'output.custom',
        'output.usage',
        'depthLimitOverride',
      ],
      ['Input mapping', 'Output mapping', 'Limits'],
    ],
  ] as const)(
    '%s shows its basic set, the rest under a collapsed Advanced',
    (kind, basic, advanced, groups) => {
      const [config] = configsOf(kind);
      render(<Harness schema={NodeConfigSchemas[kind]} initial={config} />);
      for (const path of basic) expect(shown(path), path).toBe(true);
      for (const path of advanced) {
        expect(fieldAt(path), path).toBeDefined();
        expect(shown(path), path).toBe(false);
      }
      const disclosure = toggle()!;
      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      // The basic fields come first: the disclosure follows the last of them.
      const lastBasic = fieldAt(basic.at(-1)!)!;
      expect(
        lastBasic.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      openAdvanced();
      for (const path of advanced) expect(shown(path), path).toBe(true);
      // Each group under a heading: a section fieldset named by its legend, in order.
      const panel = document.getElementById(disclosure.getAttribute('aria-controls')!)!;
      const sections = [...panel.querySelectorAll(':scope > fieldset')].map(
        (section) => section.querySelector(':scope > legend')?.textContent,
      );
      expect(sections).toEqual(groups);
      for (const group of groups)
        expect(within(panel).getByRole('group', { name: group })).toBeVisible();
    },
  );

  it('keeps mutate to its operations, with no Advanced section', () => {
    const [config] = configsOf('mutate');
    render(<Harness schema={NodeConfigSchemas.mutate} initial={config} />);
    expect(toggle()).toBeNull();
    expect(topLevelFields()).toEqual(['operations']);
  });

  it.each(Object.keys(NodeConfigSchemas) as NodeKind[])(
    'keeps every %s field editable, down to nested leaves, once Advanced and items are open',
    (kind) => {
      for (const config of configsOf(kind)) {
        cleanup();
        render(<Harness schema={NodeConfigSchemas[kind]} initial={config} />);
        openEverything();
        const expected: Expected[] = [];
        for (const [key, schema] of Object.entries(objectOf(kind, config))) {
          if (key === 'subtype' || key === 'mode') continue;
          expectedFields(schema, config[key], key, expected);
        }
        expect(expected.length, kind).toBeGreaterThan(0);
        for (const { path, control } of expected) {
          const el = fieldAt(path);
          expect(el, `${kind} ${path}`).toBeDefined();
          expect(el!.closest('[hidden]'), `${kind} ${path} hidden`).toBeNull();
          if (control === 'none') continue;
          const found = el!.querySelector(control === 'value' ? VALUE_CONTROL : ANY_CONTROL);
          expect(found, `${kind} ${path} ${control} control`).not.toBeNull();
        }
      }
    },
  );

  it('expects the nested leaves and variant fields, and would notice one not drawn', () => {
    const [config] = configsOf('inference');
    render(<Harness schema={NodeConfigSchemas.inference} initial={config} />);
    openEverything();
    const expected: Expected[] = [];
    expectedFields(NodeConfigSchemas.inference.shape.output, config!['output'], 'output', expected);
    expectedFields(NodeConfigSchemas.inference.shape.input, config!['input'], 'input', expected);
    expect(expected).toEqual(
      expect.arrayContaining([
        { path: 'output.schema.repair.maxAttempts', control: 'value' },
        { path: 'output.transforms.0.patterns', control: 'any' },
        { path: 'output.transforms.0.patterns.0', control: 'value' },
        { path: 'input.0.keep.last', control: 'value' },
        { path: 'input.0.where', control: 'value' },
      ]),
    );
    // A JSON value is one editor, whatever it holds.
    expect(expected.filter((e) => e.path.startsWith('output.schema.jsonSchema'))).toEqual([
      { path: 'output.schema.jsonSchema', control: 'value' },
    ]);
    // Removing a nested control leaves its field without one, which the walk checks.
    fieldAt('output.schema.repair.maxAttempts')!.querySelector('input')!.remove();
    expect(fieldAt('output.schema.repair.maxAttempts')!.querySelector(VALUE_CONTROL)).toBeNull();
  });

  it('labels split fields by their title, and shows descriptions as help with code', () => {
    const [config] = configsOf('subloop');
    render(<Harness schema={NodeConfigSchemas.subloop} initial={config} />);
    expect(screen.getByRole('radiogroup', { name: 'Input mode' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Output mode' })).toHaveAccessibleDescription(
      "Return only the child's result, merge its thread, or apply a custom patch.",
    );
    // A nested object shows its help under its legend; backticks mark code.
    const loopRef = screen.getByRole('group', { name: 'Loop ref' });
    expect(loopRef).toHaveAccessibleDescription(
      'The child loop and the version to pin (latest or a number).',
    );
    expect(within(loopRef).getByText('latest', { selector: 'code' })).toBeInTheDocument();
  });

  it('says how many advanced fields hold a value of their own, and follows edits', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        schema={NodeConfigSchemas.inference}
        initial={{
          prompt: { template: 'Hi' },
          // Equal to their defaults, empty, or added without a value: none of these is "set".
          input: [],
          contextFiles: [],
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          capabilities: {},
          output: { captureTranscript: 'artifact', toMessages: 'final' },
        }}
      />,
    );
    expect(toggle()).toHaveAccessibleName('Advanced');
    openAdvanced();
    await user.type(screen.getByRole('spinbutton', { name: 'Timeout seconds' }), '30');
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Approval' })).getByRole('radio', {
        name: 'on-request',
      }),
    );
    // Collapsed again, it still says so.
    await user.click(toggle()!);
    expect(toggle()).toHaveAccessibleName('Advanced 2 set');
    expect(within(toggle()!).getByText('2 set')).toBeInTheDocument();
    // A basic field does not count.
    await user.type(screen.getByRole('textbox', { name: 'Model' }), 'x');
    expect(toggle()).toHaveAccessibleName('Advanced 2 set');
  });

  it('flags problems inside a collapsed Advanced: issues and unparsed text', async () => {
    render(
      <Harness
        schema={NodeConfigSchemas.inference}
        initial={{
          prompt: { template: 'Hi' },
          timeoutSeconds: 0,
          harnessOptions: { sandbox: 'read-only', bogus: true },
          // A basic field's problem is not Advanced's.
          model: '',
        }}
        parseErrors={{ 'harnessOptions.configOverrides.a': { message: 'invalid JSON', text: '{' } }}
      />,
    );
    await waitFor(() => expect(toggle()).toHaveAccessibleName('Advanced 1 set 2 errors'));
    const badge = within(toggle()!).getByText('2 errors');
    expect(badge.closest('[class*="bg-status-bad-bg"]')).not.toBeNull();
    expect(badge.parentElement!.querySelector('svg[data-icon="alert"]')).not.toBeNull();
    // A split object's own message (an unknown key) shows with its basic fields, in sight.
    const block = fieldAt('harnessOptions')!;
    expect(block).toContainElement(screen.getByRole('radiogroup', { name: 'Sandbox' }));
    expect(within(block).getByRole('alert')).toHaveTextContent(/bogus/i);
  });

  it("flags an object's own problem when all its fields are advanced, and shows it there", async () => {
    render(
      <Harness
        schema={NodeConfigSchemas.decision}
        initial={{
          routes: [
            { label: 'a', description: '' },
            { label: 'b', description: '' },
          ],
          question: 'q',
          strategy: ['codex'],
          context: { bogus: 1 },
        }}
      />,
    );
    // Its fields are placed one by one, so the unknown key is a problem, not a value set.
    await waitFor(() => expect(toggle()).toHaveAccessibleName('Advanced 1 error'));
    openAdvanced();
    const block = fieldAt('context')!;
    expect(block.closest('[hidden]')).toBeNull();
    expect(within(block).getByRole('alert')).toHaveTextContent(/bogus/i);
  });

  it('counts errors found outside the form, such as an expression that does not compile', () => {
    render(
      <Harness
        schema={NodeConfigSchemas.inference}
        initial={{
          prompt: { template: 'Hi' },
          input: [{ op: 'drop', target: 'messages', where: 'vars.' }],
        }}
        // The loop's validation found it (EXPRESSION_INVALID at config.input.0.where); the
        // prompt's is a basic field's, not Advanced's.
        problems={['input.0.where', 'prompt.template']}
      />,
    );
    expect(toggle()).toHaveAccessibleName('Advanced 1 set 1 error');
    openAdvanced();
    // The collapsed operation says so too.
    expect(screen.getByRole('button', { name: /^Input 1 drop messages/ })).toHaveAccessibleName(
      'Input 1 drop messages 1 error',
    );
  });

  it('counts an explicitly empty JSON Schema as set: it turns structured output on', () => {
    render(
      <Harness
        schema={NodeConfigSchemas.inference}
        initial={{ prompt: { template: 'Hi' }, output: { schema: { jsonSchema: {} } } }}
      />,
    );
    expect(toggle()).toHaveAccessibleName('Advanced 1 set');
  });

  it('says "1 error" for one problem', async () => {
    render(
      <Harness
        schema={NodeConfigSchemas.script}
        initial={{ command: 'node', exitCodeRoutes: { '3': 'in' } }}
      />,
    );
    await waitFor(() => expect(toggle()).toHaveAccessibleName('Advanced 1 set 1 error'));
  });

  it('opens Advanced when an issue is followed to a field inside it', async () => {
    render(
      <Harness
        schema={NodeConfigSchemas.script}
        initial={{ command: 'node', stdin: 'none', timeoutSeconds: 0 }}
      />,
    );
    const form = screen.getByRole('form', { name: 'form' });
    act(() => {
      expect(focusField(form, 'stdin')).toBe(true);
    });
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radio', { name: 'none' })).toHaveFocus();
    // Closing it again from the toggle works: React's state followed the reveal.
    await userEvent.setup().click(toggle()!);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    act(() => {
      expect(focusField(form, 'timeoutSeconds')).toBe(true);
    });
    expect(screen.getByRole('spinbutton', { name: 'Timeout seconds' })).toHaveFocus();
  });
});

describe('advanced fields without a group', () => {
  it('sit in the panel without a heading, ahead of the groups that follow them', () => {
    const schema = z.object({
      name: z.string().meta(field('The name.')),
      note: z
        .string()
        .optional()
        .meta(field('A note.', { advanced: true })),
      limit: z
        .number()
        .optional()
        .meta(field('A limit.', { advanced: true, group: 'Limits' })),
    });
    render(<Harness schema={schema} initial={{ name: 'a' }} />);
    const panel = document.getElementById(openAdvanced().getAttribute('aria-controls')!)!;
    expect(panel.firstElementChild).toBe(fieldAt('note'));
    expect(within(panel).getByRole('group', { name: 'Limits' })).toContainElement(
      fieldAt('limit')!,
    );
  });
});

describe('collapsible operations', () => {
  const operations = [
    { op: 'set', path: '/vars/topic', value: { kind: 'literal', value: 'loops' } },
    { op: 'drop', target: 'messages', where: 'true' },
    { op: 'inject', position: 2, messages: [{ content: 'Hi' }] },
    { op: 'truncate', keep: { last: 2 } },
  ];

  it('shows each operation collapsed to its kind and path, and opens it on request', async () => {
    const user = userEvent.setup();
    render(<Harness schema={NodeConfigSchemas.mutate} initial={{ operations }} />);
    const first = screen.getByRole('button', { name: 'Operations 1 set /vars/topic' });
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Operations 2 drop messages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Operations 3 inject 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Operations 4 truncate' })).toBeInTheDocument();
    expect(within(first).getByText('set').tagName).toBe('CODE');
    // Remove sits beside each header, so it works on a collapsed item.
    expect(screen.getByRole('button', { name: 'Remove operations 1' })).toBeVisible();
    await user.click(first);
    // The item's group keeps its name for assistive technology, without a second visible legend.
    const group = screen.getByRole('group', { name: 'Operations 1' });
    expect(group.querySelector(':scope > legend')).toHaveClass('sr-only');
    expect(group).toHaveClass('border-0');
    // The summary follows edits.
    const path = within(group).getByRole('textbox', { name: 'Path' });
    await user.clear(path);
    await user.type(path, '/vars/other');
    expect(first).toHaveAccessibleName('Operations 1 set /vars/other');
  });

  it('opens an added operation with focus on its first control, and flags problems when collapsed', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        schema={NodeConfigSchemas.mutate}
        initial={{ operations: [{ op: 'delete', path: 'not-a-pointer' }] }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Operations 1 delete not-a-pointer/ }),
      ).toHaveAccessibleName('Operations 1 delete not-a-pointer 1 error'),
    );
    await user.click(screen.getByRole('button', { name: 'Add operations' }));
    const added = screen.getByRole('button', { name: /^Operations 2 set/ });
    expect(added).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: 'Operations 2' })).getByLabelText('Op'),
      ).toHaveFocus(),
    );
    // Following an issue into a collapsed operation opens it.
    const form = screen.getByRole('form', { name: 'form' });
    act(() => {
      expect(focusField(form, 'operations.0.path')).toBe(true);
    });
    expect(screen.getByRole('button', { name: /^Operations 1/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByDisplayValue('not-a-pointer')).toHaveFocus();
  });

  it('collapses the transforms of an inference node the same way', () => {
    render(
      <Harness
        schema={NodeConfigSchemas.inference}
        initial={{ prompt: { template: 'Hi' }, input: [{ op: 'delete', path: '/vars/a' }] }}
      />,
    );
    openAdvanced();
    expect(screen.getByRole('button', { name: 'Input 1 delete /vars/a' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('registered controls', () => {
  const schema = z.object({
    model: z
      .string()
      .optional()
      .meta(field('The model.', { control: 'model' })),
    other: z
      .string()
      .optional()
      .meta(field('Another.', { control: 'unregistered' })),
  });

  function ModelPicker({ schema: own, name, label }: FieldProps) {
    const value = useField(name, 'commit');
    return (
      <div data-field={name}>
        <button type="button" onClick={() => value.onChange('picked')}>
          Pick {label}
        </button>
        {/* A custom control may still draw the default one, for a raw-value toggle, say. */}
        <DefaultField schema={own} name={name} label={`${label} (raw)`} />
      </div>
    );
  }

  it('draws a field with the control registered under its metadata name, else as usual', async () => {
    const spy = vi.fn();
    render(<Harness schema={schema} initial={{}} controls={{ model: ModelPicker }} spy={spy} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pick Model' }));
    expect(spy).toHaveBeenLastCalledWith({ model: 'picked' });
    expect(screen.getByRole('textbox', { name: 'Model (raw)' })).toHaveValue('picked');
    // A control name nothing registered falls back to the default renderer.
    expect(screen.getByRole('textbox', { name: 'Other' })).toBeInTheDocument();
  });

  it('draws the default renderer for a name the registry only inherits, such as toString', () => {
    const inherited = z.object({
      name: z
        .string()
        .optional()
        .meta(field('A name.', { control: 'toString' })),
      other: z
        .string()
        .optional()
        .meta(field('Another.', { control: 'constructor' })),
    });
    render(<Harness schema={inherited} initial={{}} controls={{ model: ModelPicker }} />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Other' })).toBeInTheDocument();
    expect(screen.queryByText(/object Undefined/)).toBeNull();
  });

  it('draws the default renderer when no controls are given', () => {
    render(<Harness schema={schema} initial={{}} />);
    expect(screen.queryByRole('button', { name: /^Pick/ })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Model' })).toBeInTheDocument();
  });
});
