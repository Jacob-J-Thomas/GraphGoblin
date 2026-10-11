import { NodeConfigSchemas } from '@graphgoblin/contracts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { focusField } from '../editor/focus-field.js';
import { SchemaForm } from './SchemaForm.js';
import { createDisclosureIdentities, type DisclosureStates } from './disclosures.js';

const answer = {
  type: 'choice',
  options: [
    { id: 'a', label: 'A', criteria: 'A' },
    { id: 'b', label: 'B', criteria: 'B' },
  ],
};

describe('context placement', () => {
  it.each(['classifier', 'llm'] as const)(
    'keeps %s required inputs and answer routes on Settings',
    (kind) => {
      const evaluation =
        kind === 'classifier'
          ? { kind, model: 'jev', question: 'q', minConfidence: 0.5 }
          : {
              kind,
              harness: 'codex',
              model: { mode: 'inherit' },
              effort: { mode: 'inherit' },
              question: 'q',
            };
      render(
        <SchemaForm
          schema={NodeConfigSchemas.decision}
          value={{ answer, evaluation }}
          label="form"
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Question')).toBeVisible();
      expect(screen.getByRole('group', { name: 'Options' })).toBeVisible();
      expect(screen.getByRole('tab', { name: 'Context' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
      if (kind === 'classifier') {
        const field = document.querySelector('[data-field="evaluation.minConfidence"]')!;
        expect(field).not.toBeVisible();
        expect(field.closest('[data-disclosure-panel]')).not.toBeNull();
      } else {
        expect(screen.getByRole('group', { name: 'Model' })).toBeVisible();
        expect(screen.getByRole('group', { name: 'Effort' })).toBeVisible();
      }
    },
  );

  it('counts problems per panel and reveals Context and its Advanced group for issue focus', () => {
    render(
      <SchemaForm
        schema={NodeConfigSchemas.decision}
        value={{
          answer,
          evaluation: {
            kind: 'classifier',
            model: 'jev',
            question: 'q',
            context: { vars: ['bad value'] },
          },
        }}
        problems={['evaluation.context.vars.0', 'evaluation.question']}
        label="form"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Context 1 error' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings 1 error' })).toBeInTheDocument();
    act(() => {
      expect(focusField(screen.getByRole('form'), 'evaluation.context.vars.0')).toBe(true);
    });
    expect(screen.getByRole('tab', { name: 'Context 1 error' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('textbox', { name: 'Vars 1' })).toHaveFocus();
    expect(screen.getByRole('button', { name: /^Advanced/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('keeps unparsed context text through tab switches and remounts without changing saved values', async () => {
    const spy = vi.fn();
    const initial = {
      prompt: { template: 'hi' },
      input: [{ op: 'set', path: '/vars/a', value: { kind: 'literal', value: 1 } }],
    };
    function Harness() {
      const [open, setOpen] = useState<DisclosureStates>({});
      const [identities] = useState(createDisclosureIdentities);
      const [epoch, setEpoch] = useState(0);
      return (
        <>
          <button onClick={() => setEpoch((value) => value + 1)}>Remount</button>
          <SchemaForm
            key={epoch}
            schema={NodeConfigSchemas.inference}
            value={initial}
            label="form"
            disclosures={{ open, setOpen, identities }}
            onChange={spy}
            parseErrors={{ 'input.0.value.value': { message: 'Invalid JSON', text: '{held' } }}
          />
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    act(() => {
      focusField(screen.getByRole('form'), 'input.0.value.value');
    });
    expect(screen.getByLabelText('Value')).toHaveTextContent('{held');
    await user.click(screen.getByRole('tab', { name: /^Settings/ }));
    await user.click(screen.getByRole('tab', { name: /^Context/ }));
    expect(screen.getByLabelText('Value')).toHaveTextContent('{held');
    await user.click(screen.getByRole('button', { name: 'Remount' }));
    expect(screen.getByRole('tab', { name: /^Context/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Value')).toHaveTextContent('{held');
    expect(spy).not.toHaveBeenCalled();
    expect(within(screen.getByRole('form')).getByRole('tablist')).toBeInTheDocument();
  });
});
