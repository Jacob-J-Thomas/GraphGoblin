import type { ModelCatalogEntry } from '@graphgoblin/contracts';
import { InferenceConfigSchema } from '@graphgoblin/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { NODE_FIELD_CONTROLS } from '../../editor/field-controls.js';
import { SchemaForm } from '../SchemaForm.js';
import { openAdvanced } from '../../__fixtures__/advanced.js';
import { catalogFingerprint } from '../../api/queries.js';

const model: ModelCatalogEntry = {
  harness: 'ollama',
  model: 'namespace/qwen:4b',
  source: 'harness',
  displayName: 'namespace/qwen:4b',
  efforts: ['none'],
  defaultEffort: 'none',
  enabled: true,
  availability: { state: 'available', checkedAt: '2026-11-07T12:00:00.000Z' },
};

function setup(entries: ModelCatalogEntry[], saved?: string, effort?: string) {
  const api = new FakeApi();
  api.catalog = entries;
  api.preflight = [{ harness: 'ollama', state: 'ready', ok: true, problems: [] }];
  const change = vi.fn();
  renderWith(
    <SchemaForm
      schema={InferenceConfigSchema}
      value={{
        harness: 'ollama',
        model: saved,
        effort,
        prompt: { template: 'Hi' },
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
      }}
      label="Inference"
      onChange={change}
      controls={NODE_FIELD_CONTROLS}
    />,
    '/',
    api,
  );
  openAdvanced();
  return { api, change };
}

describe('discovered Ollama model choices', () => {
  it('keeps exact names and offers only discovered effort controls without selecting a model', async () => {
    const { change } = setup([model]);
    const select = screen.getByLabelText('Model', { exact: true });
    await waitFor(() => expect(select).not.toHaveAttribute('aria-readonly'));
    expect(within(select).getByRole('option', { name: 'namespace/qwen:4b' })).toHaveValue(
      model.model,
    );
    expect(select).toHaveValue('');
    expect(
      within(screen.getByLabelText('Effort', { exact: true }))
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['', 'none']);
    expect(change).not.toHaveBeenCalled();
  });

  it.each(['missing', 'unsupported'] as const)(
    'retains an authored %s model and explains its availability',
    async (state) => {
      const unavailable = {
        ...model,
        efforts: state === 'unsupported' ? [] : model.efforts,
        availability: {
          ...model.availability!,
          state,
          reason: 'This model is unavailable on the configured service.',
        },
      };
      const { change } = setup(
        [unavailable, { ...model, model: 'ready:latest', displayName: 'Ready' }],
        model.model,
        'none',
      );
      const select = screen.getByLabelText('Model', { exact: true });
      await waitFor(() => expect(select).not.toHaveAttribute('aria-readonly'));
      expect(select).toHaveValue(model.model);
      expect(
        within(select).getByRole('option', {
          name: new RegExp(state === 'missing' ? 'missing on server' : 'unsupported'),
        }),
      ).toBeDisabled();
      expect(select).toHaveAccessibleDescription(
        state === 'missing'
          ? /This model is unavailable on the configured service/
          : /GraphGoblin can’t run this model yet: This model is unavailable/,
      );
      expect(within(select).getByRole('option', { name: 'Ready (ready:latest)' })).toBeEnabled();
      expect(change).not.toHaveBeenCalled();
    },
  );

  it('changes validation fingerprints on availability changes independently of enabled preferences', () => {
    const available = catalogFingerprint([model], []);
    expect(
      catalogFingerprint(
        [{ ...model, availability: { ...model.availability!, state: 'missing' } }],
        [],
      ),
    ).not.toBe(available);
    expect(catalogFingerprint([{ ...model, enabled: false }], [])).not.toBe(available);
    expect(
      catalogFingerprint(
        [
          {
            ...model,
            availability: { ...model.availability!, checkedAt: '2026-11-07T12:05:00.000Z' },
          },
        ],
        [],
      ),
    ).toBe(available);
  });
});
