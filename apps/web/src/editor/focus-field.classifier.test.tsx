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
function body(kind: NodeKind, value: unknown, api = new FakeApi()) {
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
    api,
  );
  return screen.getByTestId('body');
}

const decision = (model: string) => ({
  answer: {
    type: 'choice',
    options: [
      { id: 'yes', label: 'Yes', criteria: 'Choose yes' },
      { id: 'no', label: 'No', criteria: 'Choose no' },
    ],
  },
  evaluation: { kind: 'classifier', model, question: 'Which?', context: {} },
  recordAlternatives: true,
});

describe('classifier issue paths', () => {
  it('config.evaluation.model focuses the classifier picker', async () => {
    const root = body('decision', decision('gone'));
    const picker = within(screen.getByRole('group', { name: 'Evaluation' })).getByRole('combobox', {
      name: 'Model',
    });
    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));
    expect(focusIssuePath(root, 'config.evaluation.model')).toBe(true);
    expect(picker).toHaveFocus();
  });

  it('config.evaluation.model with an empty catalog focuses the picker', () => {
    const api = new FakeApi();
    api.classifiers = [];
    const root = body('decision', decision('missing'), api);
    expect(focusIssuePath(root, 'config.evaluation.model')).toBe(true);
    const picker = within(screen.getByRole('group', { name: 'Evaluation' })).getByRole('combobox', {
      name: 'Model',
    });
    expect(picker).toHaveFocus();
    expect(picker).toHaveValue('missing');
    // Without the node editor's custom picker, the whole union path names its method selector.
    picker.blur();
    expect(focusIssuePath(root, 'config.evaluation')).toBe(true);
    const evaluation = screen.getByRole('group', { name: 'Evaluation' });
    const method = evaluation.querySelector<HTMLSelectElement>(':scope > div select');
    expect(method).toBeInTheDocument();
    expect(method).toHaveFocus();
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
