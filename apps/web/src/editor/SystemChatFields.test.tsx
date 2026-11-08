import { NodeConfigSchemas, NodeSchema } from '@graphgoblin/contracts';
import { createSystemChatDefinition } from '@graphgoblin/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SchemaForm } from '../forms/SchemaForm.js';
import {
  SYSTEM_CHAT_SCRIPT_FIELDS,
  SYSTEM_CHAT_SUBLOOP_FIELDS,
  SYSTEM_CHAT_TRIGGER_FIELDS,
  SystemChatTriggerType,
} from './SystemChatFields.js';
import { createElement } from 'react';

describe('system chat fixed fields', () => {
  it('keeps native Manual trigger naming and selectable read-only input/exposure', () => {
    const definition = createSystemChatDefinition({ name: 'Gateway chat', harness: 'codex' });
    const trigger = NodeSchema.parse(definition.nodes[0]);
    if (trigger.kind !== 'trigger') throw new Error('fixture');
    const changed = vi.fn();
    render(
      <SchemaForm
        schema={NodeConfigSchemas.trigger}
        value={trigger.config}
        label="Chat trigger"
        onChange={changed}
        fieldOverrides={SYSTEM_CHAT_TRIGGER_FIELDS}
        unionPickers={{ '': SystemChatTriggerType }}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Trigger type' })).toHaveValue('Manual');
    expect(screen.getByRole('textbox', { name: 'Trigger type' })).toHaveAttribute('readonly');
    const advanced = screen.queryByRole('button', { name: /^Advanced/ });
    if (advanced) fireEvent.click(advanced);
    const schema = screen.getByRole('textbox', { name: 'Input schema' });
    expect(schema).toHaveAttribute('aria-readonly', 'true');
    expect(schema).toHaveAttribute('contenteditable', 'false');
    expect(changed).not.toHaveBeenCalled();
  });
  it('renders a stand-alone native type hint without a new trigger enum', () => {
    render(createElement(SystemChatTriggerType));
    expect(screen.getByText(/manual trigger/)).toBeVisible();
    expect(screen.queryByText('Type: Chat')).not.toBeInTheDocument();
  });
  it('locks the split Subloop output fields while leaving input mapping editable', () => {
    render(
      <SchemaForm
        schema={NodeConfigSchemas.subloop}
        value={{
          loopRef: { loopId: '01J00000000000000000000001' },
          output: { mode: 'result-only', resultTo: { lastOutput: true } },
        }}
        label="Normalizer"
        onChange={vi.fn()}
        fieldOverrides={SYSTEM_CHAT_SUBLOOP_FIELDS}
      />,
    );
    for (const button of screen.queryAllByRole('button', { name: /^Advanced/ }))
      fireEvent.click(button);
    expect(screen.queryByRole('combobox', { name: 'Output mode' })).not.toBeInTheDocument();
    for (const label of ['Output mode', 'Result to', 'Usage']) {
      expect(screen.getByRole('textbox', { name: label })).toHaveAttribute(
        'contenteditable',
        'false',
      );
    }
    expect(screen.getByRole('radio', { name: 'inherit' })).not.toBeDisabled();
  });
  it('locks Script routing policies while leaving its real command editable', () => {
    render(
      <SchemaForm
        schema={NodeConfigSchemas.script}
        value={{
          command: 'transcribe',
          stdin: 'thread',
          stdout: 'last-output',
          exitCodeRoutes: [{ code: 3, port: 'out' }],
        }}
        label="Normalizer"
        onChange={vi.fn()}
        fieldOverrides={SYSTEM_CHAT_SCRIPT_FIELDS}
      />,
    );
    for (const button of screen.queryAllByRole('button', { name: /^Advanced/ }))
      fireEvent.click(button);
    expect(screen.getByRole('textbox', { name: 'Command' })).not.toHaveAttribute('readonly');
    for (const label of ['Stdin', 'Stdout', 'Exit code routes'])
      expect(screen.getByRole('textbox', { name: label })).toHaveAttribute(
        'contenteditable',
        'false',
      );
  });
});
