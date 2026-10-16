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
  recordAlternatives: true,
  kind: 'classifier',
  model,
  question: 'Which?',
  context: {},
  answer: {
    type: 'choice',
    options: [
      { id: 'yes', label: 'Yes', criteria: 'Choose yes' },
      { id: 'no', label: 'No', criteria: 'Choose no' },
    ],
  },
});

describe('classifier issue paths', () => {
  it('config.model focuses the classifier picker', async () => {
    const root = body('decision', decision('gone'));
    const picker = screen.getByRole('combobox', {
      name: 'Model',
    });
    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));
    expect(focusIssuePath(root, 'config.model')).toBe(true);
    expect(picker).toHaveFocus();
  });

  it('config.model with an empty catalog focuses the picker', () => {
    const api = new FakeApi();
    api.classifiers = [];
    const root = body('decision', decision('missing'), api);
    expect(focusIssuePath(root, 'config.model')).toBe(true);
    const picker = screen.getByRole('combobox', {
      name: 'Model',
    });
    expect(picker).toHaveFocus();
    expect(picker).toHaveValue('missing');
    // Without the node editor's custom picker, the whole union path names its method selector.
    picker.blur();
    expect(focusIssuePath(root, 'config.kind')).toBe(true);
    const method = screen.getAllByLabelText('Kind')[0];
    expect(method).toBeInTheDocument();
    expect(method).toHaveFocus();
  });

  it('config.maxPasses focuses the required gate limit', () => {
    const root = body('decision', {
      kind: 'expression',
      jsonata: '"repeat"',
      routes: [
        { id: 'repeat', label: 'Repeat', repeat: true },
        { id: 'done', label: 'Done' },
      ],
    });
    expect(focusIssuePath(root, 'config.maxPasses')).toBe(true);
    expect(screen.getByLabelText('Max passes')).toHaveFocus();
  });
});
