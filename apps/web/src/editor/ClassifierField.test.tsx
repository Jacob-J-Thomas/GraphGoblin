import { NodeConfigSchemas } from '@graphgoblin/contracts';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { customClassifier, FakeApi } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { NODE_FIELD_CONTROLS } from './field-controls.js';

const decision = (model = 'kev') => ({
  answer: {
    type: 'choice',
    options: [
      { id: 'yes', label: 'Yes', criteria: 'The answer is yes' },
      { id: 'no', label: 'No', criteria: 'The answer is no' },
    ],
  },
  evaluation: {
    kind: 'classifier',
    model,
    question: 'Which?',
    context: { messages: 'last', includeLastOutput: true },
  },
  recordAlternatives: true,
});

function api(): FakeApi {
  const fake = new FakeApi();
  fake.classifiers = [
    customClassifier({ id: 'kev', displayName: 'Kev 4B' }),
    customClassifier({ id: 'keyed', displayName: 'Keyed', secretRef: 'keyed-key' }),
    customClassifier({ id: 'off', displayName: 'Off', enabled: false }),
    customClassifier({ id: 'noul-only', displayName: 'Boolean Judge', primitives: ['noul'] }),
    customClassifier({ id: 'scorer', displayName: 'Scorer', primitives: ['score'] }),
  ];
  fake.secretList = [];
  return fake;
}

function Harness({ initial, spy }: { initial: unknown; spy: (value: unknown) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SchemaForm
      schema={NodeConfigSchemas.decision}
      value={value}
      label="Decision config"
      controls={NODE_FIELD_CONTROLS}
      onChange={(next) => {
        setValue(next);
        spy(next);
      }}
    />
  );
}

function setup(initial: unknown = decision(), fake = api()) {
  const changes: unknown[] = [];
  renderWith(<Harness initial={initial} spy={(value) => changes.push(value)} />, '/', fake);
  const picker = () => screen.getByRole('combobox', { name: 'Model' });
  return { changes, picker, fake };
}

describe('ClassifierField', () => {
  it('requires an explicit classifier and lists enabled Choice models by display name and ID', async () => {
    const initial = decision('');
    const { picker } = setup(initial);
    await waitFor(() =>
      expect(
        within(picker())
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['(choose a classifier)', 'Kev 4B (kev)', 'Keyed (keyed) (needs a key)']),
    );
    expect(picker()).toHaveAttribute('aria-required', 'true');
    expect(picker()).toHaveValue('');
    expect(picker()).toHaveAccessibleDescription(
      /Choose an enabled classifier that supports Choice\./,
    );
    expect(within(picker()).queryByRole('option', { name: /Off/ })).not.toBeInTheDocument();
    expect(within(picker()).queryByRole('option', { name: /Scorer/ })).not.toBeInTheDocument();
  });

  it('keeps a current catalog choice and commits a new explicit selection', async () => {
    const user = userEvent.setup();
    const { picker, changes } = setup();
    await waitFor(() => expect(picker()).toHaveValue('kev'));
    await user.selectOptions(picker(), 'keyed');
    expect(changes.at(-1)).toMatchObject({ evaluation: { kind: 'classifier', model: 'keyed' } });
  });

  it.each([
    ['off', 'Off (off) is disabled. Enable it in Settings or choose another classifier.'],
    [
      'scorer',
      'Scorer (scorer) cannot answer Choice decisions. Choose a Choice-capable classifier.',
    ],
    ['gone', 'gone is no longer in the classifier catalog. Choose an available classifier.'],
  ])(
    'preserves the saved but unavailable classifier %s with a clear reason',
    async (model, message) => {
      const { picker } = setup(decision(model));
      await waitFor(() => expect(picker()).toHaveValue(model));
      expect(picker()).toHaveAccessibleDescription(
        new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
      expect(within(picker()).getByRole('option', { name: new RegExp(model) })).toBeInTheDocument();
    },
  );

  it('explains when a selectable classifier still needs a secret', async () => {
    const { picker } = setup(decision('keyed'));
    await waitFor(() => expect(picker()).toHaveValue('keyed'));
    expect(picker()).toHaveAccessibleDescription(
      /Keyed \(keyed\) needs a key\. Configure it in Settings, Secrets\./,
    );
  });

  it('filters enabled classifiers by Noul and Score while retaining the Choice filter', async () => {
    const noul = {
      ...decision(''),
      answer: {
        type: 'noul',
        true: { id: 'true', label: 'True', criteria: 'True' },
        false: { id: 'false', label: 'False', criteria: 'False' },
      },
    };
    const noulPicker = setup(noul).picker();
    await waitFor(() => expect(noulPicker).toHaveValue(''));
    expect(within(noulPicker).getByRole('option', { name: /Boolean Judge/ })).toBeInTheDocument();
    expect(within(noulPicker).queryByRole('option', { name: /Scorer/ })).not.toBeInTheDocument();
    cleanup();

    const score = {
      ...decision(''),
      answer: {
        type: 'score',
        anchors: ['Low', 'High'],
        bands: [
          { id: 'low', label: 'Low', min: 0, max: 0.5 },
          { id: 'high', label: 'High', min: 0.5, max: 1 },
        ],
      },
    };
    const scorePicker = setup(score).picker();
    await waitFor(() => expect(scorePicker).toHaveValue(''));
    expect(within(scorePicker).getByRole('option', { name: /Scorer/ })).toBeInTheDocument();
    expect(within(scorePicker).queryByRole('option', { name: /Kev 4B/ })).not.toBeInTheDocument();
  });
});
