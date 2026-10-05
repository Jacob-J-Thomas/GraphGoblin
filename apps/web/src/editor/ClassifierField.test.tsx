import { NodeConfigSchemas } from '@graphgoblin/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BUILTIN_JEV, customClassifier, FakeApi, problem, TS } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { NODE_FIELD_CONTROLS } from './field-controls.js';

const ROUTES = [
  { label: 'yes', description: 'Yes' },
  { label: 'no', description: 'No' },
];

function decision(jev?: Record<string, unknown>, strategy = ['jev', 'expression']) {
  return {
    routes: ROUTES,
    question: 'Which?',
    strategy,
    expression: { jsonata: '"yes"' },
    ...(jev ? { jev } : {}),
  };
}

function api(): FakeApi {
  const fake = new FakeApi();
  fake.secretList = [{ name: 'jev-api-key', createdAt: TS, updatedAt: TS }];
  fake.classifiers = [
    BUILTIN_JEV,
    customClassifier({ id: 'kev', displayName: 'Kev 4B' }),
    customClassifier({ id: 'keyed', displayName: 'Keyed', secretRef: 'keyed-key' }),
    customClassifier({ id: 'off', displayName: 'Off', enabled: false }),
    customClassifier({ id: 'scorer', displayName: 'Scorer', primitives: ['score'] }),
  ];
  return fake;
}

/** A decision's config form with the node editor's controls; reports each change. */
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

function setup(initial: unknown, fake = api()) {
  const changes: unknown[] = [];
  renderWith(<Harness initial={initial} spy={(value) => changes.push(value)} />, '/', fake);
  const jevGroup = () => screen.getByRole('group', { name: 'Jev' });
  const picker = () => within(jevGroup()).getByRole('combobox', { name: 'Model' });
  const options = () =>
    within(picker())
      .getAllByRole('option')
      .map((o) => o.textContent);
  return { changes, picker, options, jevGroup, fake };
}

describe('ClassifierField', () => {
  it('offers the built-in default and the enabled Choice classifiers, by name and id', async () => {
    const { picker, options } = setup(decision({ primitive: 'choice' }));
    await waitFor(() =>
      expect(options()).toEqual([
        'Jev (jev), the default',
        'Kev 4B (kev)',
        'Keyed (keyed) (needs a key)',
      ]),
    );
    expect(picker()).toHaveValue('');
    expect(picker()).toHaveAccessibleDescription(
      'Classifier catalog id; built-in jev when omitted.',
    );
    expect(picker().closest('[data-field]')).toHaveAttribute('data-field', 'jev.model');
  });

  it('writes the chosen id, and choosing the default removes only jev.model', async () => {
    const user = userEvent.setup();
    const { picker, options, changes } = setup(
      decision({ primitive: 'choice', minConfidence: 0.6 }),
    );
    await waitFor(() => expect(options()).toHaveLength(3));
    await user.selectOptions(picker(), 'kev');
    expect(changes.at(-1)).toMatchObject({
      jev: { primitive: 'choice', model: 'kev', minConfidence: 0.6 },
    });
    expect(picker()).toHaveValue('kev');
    await user.selectOptions(picker(), '');
    expect(changes.at(-1)).toMatchObject({ jev: { primitive: 'choice', minConfidence: 0.6 } });
    expect((changes.at(-1) as { jev: object }).jev).not.toHaveProperty('model');
    expect(changes.at(-1)).toMatchObject({ strategy: ['jev', 'expression'] });
  });

  it('warns about a selected classifier that needs a key', async () => {
    const user = userEvent.setup();
    const { picker, options } = setup(decision({ primitive: 'choice' }));
    await waitFor(() => expect(options()).toHaveLength(3));
    await user.selectOptions(picker(), 'keyed');
    expect(picker()).toHaveAccessibleDescription(
      "Classifier catalog id; built-in jev when omitted. Keyed (keyed) needs a key, so this decision skips its Jev strategy until it is set. Missing or blank secret 'keyed-key'. Set it in Settings, Secrets.",
    );
  });

  it.each([
    [
      'off',
      'Off (off) (disabled)',
      'Off (off) is disabled, so this decision skips its Jev strategy. Enable it in Settings, Classifier models, or choose another model.',
    ],
    [
      'scorer',
      'Scorer (scorer) (no Choice)',
      'Scorer (scorer) cannot answer Choice decisions. The draft cannot be published until you choose a model with Choice / classification.',
    ],
    [
      'gone',
      'gone (not in catalog)',
      'gone is not in the classifier catalog. The draft cannot be published until you choose an available model, or register gone again in Settings, Classifier models.',
    ],
  ])('keeps the unavailable selection %s visible and never clears it', async (id, label, why) => {
    const { picker, options, changes } = setup(decision({ primitive: 'choice', model: id }));
    await waitFor(() =>
      expect(options()).toEqual([
        'Jev (jev), the default',
        label,
        'Kev 4B (kev)',
        'Keyed (keyed) (needs a key)',
      ]),
    );
    expect(picker()).toHaveValue(id);
    expect(picker()).toHaveAccessibleDescription(
      `Classifier catalog id; built-in jev when omitted. ${why}`,
    );
    expect(changes).toEqual([]);
  });

  it('marks the built-in default when it is disabled or needs a key', async () => {
    const fake = api();
    fake.classifiers = [{ ...BUILTIN_JEV, enabled: false }];
    const first = setup(decision({ primitive: 'choice' }), fake);
    await waitFor(() => expect(first.options()).toEqual(['Jev (jev), the default (disabled)']));
    expect(first.picker()).toHaveAccessibleDescription(
      /Jev \(jev\) is disabled, so this decision skips its Jev strategy/,
    );
  });

  it('marks a built-in default that needs a key', async () => {
    const fake = api();
    fake.secretList = [];
    const { options, picker } = setup(decision({ primitive: 'choice' }), fake);
    await waitFor(() => expect(options()[0]).toBe('Jev (jev), the default (needs a key)'));
    expect(picker()).toHaveAccessibleDescription(
      /Missing or blank secret 'jev-api-key'\. Set it in Settings, Secrets\.$/,
    );
  });

  it('shows an explicit jev as the default without rewriting it', async () => {
    const { picker, options, changes } = setup(decision({ primitive: 'choice', model: 'jev' }));
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(picker()).toHaveValue('');
    expect(changes).toEqual([]);
  });

  it('keeps the current id while the catalog loads or when it cannot be read', async () => {
    const fake = api();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.override('GET /classifier-models', async () => {
      await held;
      return problem(403, 'FORBIDDEN', 'this key lacks the "settings:read" scope');
    });
    const { picker, options, changes } = setup(
      decision({ primitive: 'choice', model: 'kev' }),
      fake,
    );
    expect(options()).toEqual(['Jev (jev), the default', 'kev']);
    expect(picker()).toHaveValue('kev');
    expect(picker()).toHaveAccessibleDescription(/Loading classifier models…$/);
    release();
    await waitFor(() =>
      expect(picker()).toHaveAccessibleDescription(
        /Classifier models could not be loaded: this key lacks the "settings:read" scope \(FORBIDDEN\)\. The current choice is kept\.$/,
      ),
    );
    expect(picker()).toHaveValue('kev');
    expect(changes).toEqual([]);
  });

  it('is drawn without Jev options, shows the default, and adds them only for another choice', async () => {
    const user = userEvent.setup();
    const { picker, options, changes, jevGroup } = setup(decision());
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(picker()).toHaveValue('');
    expect(within(jevGroup()).getByRole('button', { name: 'Add jev options' })).toBeInTheDocument();
    expect(within(jevGroup()).queryByLabelText('Min confidence')).not.toBeInTheDocument();
    // Re-choosing the default changes nothing: the decision stays without a jev block.
    picker().focus();
    await user.selectOptions(picker(), '');
    expect(changes).toEqual([]);
    await user.selectOptions(picker(), 'kev');
    expect(changes.at(-1)).toMatchObject({ jev: { model: 'kev' } });
    expect(within(jevGroup()).getByLabelText('Min confidence')).toBeInTheDocument();
    // Add jev options adds the block with its defaults and keeps the built-in default.
    await user.selectOptions(picker(), '');
    await user.click(within(jevGroup()).getByRole('button', { name: 'Remove jev' }));
    expect(changes.at(-1)).not.toHaveProperty('jev');
    await user.click(within(jevGroup()).getByRole('button', { name: 'Add jev options' }));
    expect(changes.at(-1)).toHaveProperty('jev');
    expect(picker()).toHaveValue('');
  });

  it.each([
    [
      'off',
      'Off (off) is disabled. Enable it in Settings, Classifier models, or choose another model, before adding Jev to the strategy.',
    ],
    [
      'gone',
      'gone is not in the classifier catalog. Choose an available model, or register gone again in Settings, Classifier models, before adding Jev to the strategy.',
    ],
    [
      'scorer',
      'Scorer (scorer) cannot answer Choice decisions. Choose a model with Choice / classification before adding Jev to the strategy.',
    ],
    [
      'keyed',
      "Keyed (keyed) needs a key, which the Jev strategy will need. Missing or blank secret 'keyed-key'. Set it in Settings, Secrets.",
    ],
  ])(
    'explains %s as a requirement for the Jev strategy when the strategy does not use it',
    async (id, why) => {
      const { picker } = setup(decision({ primitive: 'choice', model: id }, ['expression']));
      await waitFor(() =>
        expect(picker()).toHaveAccessibleDescription(
          `Classifier catalog id; built-in jev when omitted. ${why}`,
        ),
      );
    },
  );
});
