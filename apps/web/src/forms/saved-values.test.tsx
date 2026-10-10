import { NodeConfigSchemas, type NodeKind } from '@graphgoblin/contracts';
import { FIXTURE_IDS } from '@graphgoblin/contracts/testing';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SchemaForm } from './SchemaForm.js';

/**
 * The same edits save the same config, wherever the form places a field. Each case makes edits
 * through the controls a user would use, found by their field path (`data-field`, which does not
 * depend on the layout), after opening the Advanced disclosure and any collapsed list item as a
 * user would. What the form reports is exactly the edits (no key more or less), and it parses to
 * the config those edits mean; the server stores the parsed config, so its key order is the
 * schema's whatever order the form lists the keys in.
 */

function Harness({ kind, initial }: { kind: NodeKind; initial: unknown }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <SchemaForm schema={NodeConfigSchemas[kind]} value={value} label="form" onChange={setValue} />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  );
}

/** The element marked with field path `path` (compared as a string, as focus-field does). */
function fieldAt(path: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[data-field]')].find(
    (el) => el.getAttribute('data-field') === path,
  );
  if (!found) throw new Error(`no field at ${path}`);
  return found;
}

/** Open what a user would open to reach every field: the Advanced disclosure, collapsed items. */
async function revealAll(user: UserEvent) {
  const advanced = screen.queryByRole('button', { name: /^Advanced/ });
  if (advanced) await user.click(advanced);
  for (const item of screen.queryAllByRole('button', { name: /^Operations \d/ })) {
    if (item.getAttribute('aria-expanded') === 'false') await user.click(item);
  }
}

const radio = (path: string, name: string) => within(fieldAt(path)).getByRole('radio', { name });

/** Render `kind`'s form with `initial`, make the edits, and check what it reports. */
async function expectSaved(
  kind: NodeKind,
  initial: unknown,
  edit: (user: UserEvent) => Promise<void>,
  expected: unknown,
) {
  cleanup();
  const user = userEvent.setup();
  render(<Harness kind={kind} initial={initial} />);
  await revealAll(user);
  await edit(user);
  const reported: unknown = JSON.parse(screen.getByTestId('value').textContent ?? '');
  expect(reported).toEqual(expected);
  const schema = NodeConfigSchemas[kind];
  // Parsed (or refused) the same way: the same data, or the same issues.
  const parsed = (value: unknown) => {
    const result = schema.safeParse(value);
    return JSON.stringify(result.success ? result.data : result.error.issues);
  };
  expect(parsed(reported)).toBe(parsed(expected));
}

describe('the same edits save the same config', () => {
  it('inference: basic, split, and advanced fields', async () => {
    await expectSaved(
      'inference',
      { prompt: { template: 'Hi' } },
      async (user) => {
        await user.type(within(fieldAt('model')).getByRole('textbox'), 'gpt-x');
        await user.selectOptions(within(fieldAt('effort')).getByRole('combobox'), 'high');
        await user.click(radio('harnessOptions.sandbox', 'read-only'));
        await user.click(radio('harnessOptions.approval', 'on-request'));
        await user.click(radio('harnessOptions.networkAccess', 'Yes'));
        await user.click(radio('output.toMessages', 'none'));
        await user.type(within(fieldAt('timeoutSeconds')).getByRole('spinbutton'), '90');
        await user.click(within(fieldAt('capabilities')).getByRole('button'));
      },
      {
        prompt: { template: 'Hi' },
        model: 'gpt-x',
        effort: 'high',
        harnessOptions: { sandbox: 'read-only', approval: 'on-request', networkAccess: true },
        capabilities: {},
        output: { toMessages: 'none' },
        timeoutSeconds: 90,
      },
    );
  });

  it('script', async () => {
    await expectSaved(
      'script',
      { command: 'node' },
      async (user) => {
        await user.type(within(fieldAt('cwd')).getByRole('textbox'), '/srv');
        await user.click(radio('stdin', 'none'));
        await user.click(radio('stdout', 'ignore'));
        await user.click(within(fieldAt('env')).getByRole('button', { name: 'Add entry' }));
        await user.type(screen.getByLabelText('Env value 1'), 'on');
        await user.type(within(fieldAt('timeoutSeconds')).getByRole('spinbutton'), '5');
      },
      {
        command: 'node',
        cwd: '/srv',
        env: { key1: 'on' },
        stdin: 'none',
        stdout: 'ignore',
        timeoutSeconds: 5,
      },
    );
  });

  it('decision', async () => {
    const answer = {
      type: 'choice',
      options: [
        { id: 'yes', label: 'Yes', criteria: 'Choose yes' },
        { id: 'no', label: 'No', criteria: 'Choose no' },
      ],
    };
    const evaluation = {
      kind: 'classifier',
      model: 'jev',
      question: 'q',
      context: {},
    };
    await expectSaved(
      'decision',
      { answer, evaluation, recordAlternatives: true },
      async (user) => {
        await user.click(within(fieldAt('recordAlternatives')).getByRole('switch'));
        await user.click(
          within(fieldAt('evaluation.context.includeLastOutput')).getByRole('switch'),
        );
        await user.click(
          within(fieldAt('evaluation.context.vars')).getByRole('button', { name: 'Add vars' }),
        );
        await user.type(screen.getByLabelText('Vars 1'), 'topic');
      },
      {
        answer,
        evaluation: {
          ...evaluation,
          context: { vars: ['topic'], includeLastOutput: false },
        },
        recordAlternatives: false,
      },
    );
  });

  it('subloop: the split input and output mappings', async () => {
    await expectSaved(
      'subloop',
      { loopRef: { loopId: FIXTURE_IDS.childLoop } },
      async (user) => {
        await user.click(radio('input.mode', 'project'));
        await user.click(within(fieldAt('input.exclude')).getByRole('checkbox', { name: 'vars' }));
        await user.click(radio('output.mode', 'merge'));
        await user.click(radio('output.usage', 'separate'));
        await user.click(within(fieldAt('output.resultTo.lastOutput')).getByRole('switch'));
        await user.type(within(fieldAt('depthLimitOverride')).getByRole('spinbutton'), '3');
      },
      {
        loopRef: { loopId: FIXTURE_IDS.childLoop },
        input: { mode: 'project', exclude: ['vars'] },
        output: { mode: 'merge', resultTo: { lastOutput: false }, usage: 'separate' },
        depthLimitOverride: 3,
      },
    );
  });

  it('mutate: collapsible operations', async () => {
    await expectSaved(
      'mutate',
      {
        operations: [
          { op: 'delete', path: '/vars/a' },
          { op: 'set', path: '/vars/b', value: { kind: 'literal', value: 1 } },
        ],
      },
      async (user) => {
        const path = within(fieldAt('operations.0.path')).getByRole('textbox');
        await user.clear(path);
        await user.type(path, '/vars/z');
        await user.click(screen.getByRole('button', { name: 'Add operations' }));
        await user.click(screen.getByRole('button', { name: 'Remove operations 2' }));
      },
      {
        operations: [
          { op: 'delete', path: '/vars/z' },
          { op: 'set', path: '', value: { kind: 'literal', value: null } },
        ],
      },
    );
  });

  it('trigger, wait, heartbeat, and exit', async () => {
    await expectSaved(
      'trigger',
      { subtype: 'manual' },
      async (user) => {
        await user.click(within(fieldAt('exposeTo')).getByRole('checkbox', { name: 'mcp' }));
      },
      { subtype: 'manual', exposeTo: ['ui', 'api'] },
    );
    await expectSaved(
      'wait',
      { mode: 'duration', seconds: 5 },
      async (user) => {
        await user.type(within(fieldAt('timeoutSeconds')).getByRole('spinbutton'), '9');
        await user.click(radio('onTimeout', 'fail-run'));
      },
      { mode: 'duration', seconds: 5, timeoutSeconds: 9, onTimeout: 'fail-run' },
    );
    await expectSaved(
      'heartbeat',
      { intervalSeconds: 5, maxBeats: 2 },
      async (user) => {
        await user.click(radio('record', 'full'));
      },
      { intervalSeconds: 5, maxBeats: 2, record: 'full' },
    );
    // `return` is an always-present object: its fields' bindings report it, as they always have.
    await expectSaved(
      'exit',
      {},
      async (user) => {
        await user.click(radio('default', 'loop-back'));
      },
      { default: 'loop-back', return: {} },
    );
  });
});
