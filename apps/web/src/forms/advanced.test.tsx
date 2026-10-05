import {
  NodeConfigSchemas,
  field,
  fieldMeta as contractsFieldMeta,
  type NodeKind,
} from '@graphgoblin/contracts';
import { everyFieldLoop } from '@graphgoblin/contracts/testing';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openAdvanced } from '../__fixtures__/advanced.js';
import { focusField } from '../editor/focus-field.js';
import { DefaultField, useField, type FieldControls, type FieldProps } from './fields.js';
import { shapeOf, unwrap, type Schema } from './introspect.js';
import type { ParseError } from './parse-errors.js';
import { SchemaForm } from './SchemaForm.js';

function Harness({
  schema,
  initial,
  controls,
  parseErrors,
  spy = () => undefined,
}: {
  schema: Schema;
  initial: unknown;
  controls?: FieldControls;
  parseErrors?: Record<string, ParseError>;
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
    'keeps every %s field editable once Advanced and collapsed items are open',
    async (kind) => {
      const user = userEvent.setup();
      for (const config of configsOf(kind)) {
        cleanup();
        render(<Harness schema={NodeConfigSchemas[kind]} initial={config} />);
        if (toggle()) openAdvanced();
        for (const item of screen.queryAllByRole('button', { name: /^\w[\w ]* \d+ / })) {
          if (item.getAttribute('aria-expanded') === 'false') await user.click(item);
        }
        for (const [key, schema] of Object.entries(objectOf(kind, config))) {
          if (key === 'subtype' || key === 'mode') continue;
          const base = shapeOf(unwrap(schema).base);
          // A split object's fields are each placed on their own.
          const paths =
            base.kind === 'object' &&
            Object.values(base.shape).some((f) => contractsFieldMeta(f).advanced)
              ? Object.keys(base.shape).map((child) => `${key}.${child}`)
              : [key];
          for (const path of paths) {
            const el = fieldAt(path);
            expect(el, `${kind} ${path}`).toBeDefined();
            expect(el!.closest('[hidden]'), `${kind} ${path} hidden`).toBeNull();
            const control = el!.querySelector(
              'input, select, textarea, [contenteditable="true"], button',
            );
            expect(control, `${kind} ${path} control`).not.toBeNull();
          }
        }
      }
    },
  );

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
    const value = useField(name);
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

  it('draws the default renderer when no controls are given', () => {
    render(<Harness schema={schema} initial={{}} />);
    expect(screen.queryByRole('button', { name: /^Pick/ })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Model' })).toBeInTheDocument();
  });
});
