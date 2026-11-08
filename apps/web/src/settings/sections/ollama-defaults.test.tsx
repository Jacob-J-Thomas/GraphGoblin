import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeApi } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { DefaultsSection } from './DefaultsSection.js';

describe('Ollama owner defaults', () => {
  it('retains a configured model before its first discovery and offers a refresh action', async () => {
    const api = new FakeApi();
    api.settingsValues = {
      defaults: { byHarness: { ollama: { model: 'not-discovered:tag', effort: 'none' } } },
    };
    renderWith(<DefaultsSection />, '/', api);
    const select = await screen.findByLabelText('Default model (ollama)');
    await waitFor(() =>
      expect(select).toHaveAccessibleDescription(
        /Refresh Ollama models or choose an installed model/,
      ),
    );
    expect(select).toHaveValue('not-discovered:tag');
    expect(api.callsTo('PUT', '/settings')).toHaveLength(0);
  });
  it.each(['missing', 'unsupported'] as const)(
    'preserves a saved %s model while offering available models',
    async (state) => {
      const api = new FakeApi();
      api.catalog = [
        {
          harness: 'ollama',
          model: 'gone:4b',
          source: 'harness',
          displayName: 'Gone',
          efforts: ['none'],
          defaultEffort: 'none',
          enabled: true,
          availability: { state, checkedAt: '2026-11-07T12:00:00.000Z' },
        },
        {
          harness: 'ollama',
          model: 'namespace/qwen:4b',
          source: 'harness',
          displayName: 'Qwen',
          efforts: ['none'],
          defaultEffort: 'none',
          enabled: true,
          availability: { state: 'available', checkedAt: '2026-11-07T12:00:00.000Z' },
        },
      ];
      api.settingsValues = {
        defaults: { byHarness: { ollama: { model: 'gone:4b', effort: 'none' } } },
      };
      api.preflight = [{ harness: 'ollama', state: 'ready', ok: true, problems: [] }];
      renderWith(<DefaultsSection />, '/', api);
      const select = await screen.findByLabelText('Default model (ollama)');
      await waitFor(() =>
        expect(within(select).getByRole('option', { name: 'Qwen' })).toBeEnabled(),
      );
      expect(select).toHaveValue('gone:4b');
      expect(select).toHaveAccessibleDescription(
        state === 'missing'
          ? /Missing from the configured Ollama service/
          : /unsupported inference controls/,
      );
      expect(api.callsTo('PUT', '/settings')).toHaveLength(0);
    },
  );

  it('shows the exact reported unavailability reason', async () => {
    const api = new FakeApi();
    api.catalog = [
      {
        harness: 'ollama',
        model: 'namespace/qwen:4b',
        source: 'harness',
        displayName: 'Qwen',
        efforts: [],
        defaultEffort: 'none',
        enabled: true,
        availability: {
          state: 'unsupported',
          checkedAt: '2026-11-07T12:00:00.000Z',
          reason: 'This server cannot disable model thinking.',
        },
      },
    ];
    api.settingsValues = {
      defaults: { byHarness: { ollama: { model: 'namespace/qwen:4b', effort: 'none' } } },
    };
    renderWith(<DefaultsSection />, '/', api);
    const select = await screen.findByLabelText('Default model (ollama)');
    await waitFor(() =>
      expect(select).toHaveAccessibleDescription(/This server cannot disable model thinking/),
    );
    expect(api.callsTo('PUT', '/settings')).toHaveLength(0);
  });
});
