import { NodeConfigSchemas, type NodeKind } from '@graphgoblin/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { NODE_FIELD_CONTROLS } from './field-controls.js';
import { focusIssuePath } from './focus-field.js';

/**
 * The paths the API's classifier issues carry (docs/07, Validation agreement), followed in a real
 * config form inside the node editor's config scope, as choosing the issue in a badge does.
 */
function body(kind: NodeKind, value: unknown) {
  renderWith(
    <section data-testid="body">
      <div data-field-scope="config">
        <SchemaForm
          schema={NodeConfigSchemas[kind]}
          value={value}
          label={`${kind} config`}
          controls={NODE_FIELD_CONTROLS}
          onChange={() => undefined}
        />
      </div>
    </section>,
    '/',
    new FakeApi(),
  );
  return screen.getByTestId('body');
}

const decision = (jev?: object) => ({
  routes: [
    { label: 'yes', description: 'Yes' },
    { label: 'no', description: 'No' },
  ],
  question: 'Which?',
  strategy: ['jev'],
  ...(jev ? { jev } : {}),
});

describe('classifier issue paths', () => {
  it('config.jev.model focuses the classifier picker', async () => {
    const root = body('decision', decision({ primitive: 'choice', model: 'gone' }));
    const picker = within(screen.getByRole('group', { name: 'Jev' })).getByRole('combobox', {
      name: 'Model',
    });
    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));
    expect(focusIssuePath(root, 'config.jev.model')).toBe(true);
    expect(picker).toHaveFocus();
  });

  it('config.jev.model without Jev options focuses the button that adds them', () => {
    const root = body('decision', decision());
    expect(focusIssuePath(root, 'config.jev.model')).toBe(true);
    expect(screen.getByRole('button', { name: 'Add jev' })).toHaveFocus();
  });

  it('config.criteria.N.strategy focuses that exit criterion’s chosen strategy', () => {
    const root = body('exit', {
      criteria: [
        { when: 'max-iterations', value: 3 },
        { when: 'predicate', strategy: 'jev', question: 'Done?', outcome: 'success' },
      ],
    });
    expect(focusIssuePath(root, 'config.criteria.1.strategy')).toBe(true);
    const focused = document.activeElement as HTMLInputElement;
    expect(focused).toHaveAttribute('type', 'radio');
    expect(focused).toBeChecked();
    expect(focused.value).toBe('jev');
    expect(focused.closest('[data-field]')).toHaveAttribute('data-field', 'criteria.1.strategy');
  });
});
