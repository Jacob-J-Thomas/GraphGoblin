import { expect, it } from 'vitest';
import { readinessAction, readinessDetail, readinessFailure } from './readiness.js';
import { resolveHarnessModel, validateHarnessDefaults } from './model-resolution.js';
import type { HarnessModelResolutionInput } from './model-resolution.js';
it('describes service readiness without CLI or login claims', () => {
  expect(readinessDetail('ollama', 'ready')).toContain('metadata probe');
  for (const state of [
    'unknown',
    'auth',
    'quota',
    'transport',
    'cli-missing',
    'cli-incompatible',
  ] as const) {
    expect(readinessDetail('ollama', state)).not.toMatch(/CLI|sign-in/);
    expect(readinessAction('ollama', state)).not.toMatch(/CLI|login/);
    expect(readinessFailure('ollama', state).ok).toBe(false);
  }
});
it('keeps unavailable discovery separate from owner enablement and honest none effort', () => {
  const input: HarnessModelResolutionInput = {
    harness: 'ollama',
    model: 'qwen:tag',
    effort: 'none',
    loopDefaults: { byHarness: {} },
    ownerDefaults: { byHarness: {} },
    processDefaults: { byHarness: {} },
    catalog: [
      {
        harness: 'ollama',
        model: 'qwen:tag',
        source: 'harness',
        displayName: 'Qwen',
        enabled: true,
        efforts: ['none'],
        defaultEffort: 'none',
        availability: { state: 'available', checkedAt: '2026-11-07T00:00:00.000Z' },
      },
    ],
  };
  expect(resolveHarnessModel(input)).toEqual({
    status: 'ready',
    model: 'qwen:tag',
    effort: 'none',
  });
  const row = input.catalog[0]!;
  for (const state of ['missing', 'unsupported'] as const)
    expect(
      resolveHarnessModel({
        ...input,
        catalog: [
          {
            ...row,
            availability: {
              state,
              checkedAt: '2026-11-07T00:00:00.000Z',
              reason: 'Restore the selected model',
            },
          },
        ],
      }),
    ).toMatchObject({
      status: 'unavailable',
      code: 'MODEL_UNAVAILABLE',
      message: 'Restore the selected model',
    });
  expect(
    resolveHarnessModel({
      ...input,
      catalog: [
        { ...row, availability: { state: 'missing', checkedAt: '2026-11-07T00:00:00.000Z' } },
      ],
    }),
  ).toMatchObject({ code: 'MODEL_UNAVAILABLE' });
});

it('defers only explicit Ollama process catalog checks while actual inference stays strict', () => {
  const catalog = [
    {
      harness: 'codex',
      model: 'same-name',
      source: 'harness' as const,
      displayName: 'Other harness',
      enabled: true,
      efforts: ['low' as const],
      defaultEffort: 'low' as const,
    },
  ];
  const base = {
    catalog,
    loopDefaults: { byHarness: {} },
    ownerDefaults: { byHarness: {} },
    processDefaults: { byHarness: { ollama: { model: 'same-name', effort: 'high' as const } } },
  };
  expect(validateHarnessDefaults(base)).toEqual([]);
  expect(resolveHarnessModel({ ...base, harness: 'ollama' })).toMatchObject({
    status: 'unavailable',
    code: 'MODEL_UNAVAILABLE',
  });
  expect(
    validateHarnessDefaults({
      ...base,
      processDefaults: { byHarness: { ollama: { effort: 'none' } } },
    }),
  ).toMatchObject([
    { level: 'process', harness: 'ollama', resolution: { code: 'MODEL_UNRESOLVED' } },
  ]);
  expect(
    validateHarnessDefaults({
      ...base,
      processDefaults: { byHarness: { ollama: { model: 'missing:tag' } } },
    }),
  ).toEqual([]);
  expect(
    validateHarnessDefaults({
      ...base,
      ownerDefaults: { byHarness: { ollama: { model: 'missing:tag' } } },
    }),
  ).toMatchObject([{ level: 'owner', resolution: { code: 'MODEL_NOT_IN_CATALOG' } }]);
  expect(
    validateHarnessDefaults({
      ...base,
      loopDefaults: { byHarness: { ollama: { model: 'same-name' } } },
    }),
  ).toMatchObject([{ level: 'loop', resolution: { code: 'MODEL_HARNESS_MISMATCH' } }]);
  expect(
    validateHarnessDefaults({
      ...base,
      processDefaults: { byHarness: { codex: { model: 'missing', effort: 'high' } } },
    }),
  ).toMatchObject([{ level: 'process', resolution: { code: 'MODEL_NOT_IN_CATALOG' } }]);
  const available = {
    harness: 'ollama',
    model: 'same-name',
    source: 'harness' as const,
    displayName: 'Exact model',
    enabled: true,
    efforts: ['none' as const],
    defaultEffort: 'none' as const,
  };
  expect(resolveHarnessModel({ ...base, catalog: [available], harness: 'ollama' })).toMatchObject({
    status: 'invalid',
    code: 'EFFORT_UNSUPPORTED',
  });
  for (const state of ['missing', 'unsupported'] as const) {
    const row = {
      ...available,
      efforts: [],
      availability: { state, checkedAt: '2026-11-07T00:00:00.000Z' },
    };
    expect(validateHarnessDefaults({ ...base, catalog: [row] })).toEqual([]);
    expect(
      validateHarnessDefaults({
        ...base,
        catalog: [row],
        ownerDefaults: { byHarness: { ollama: { model: 'same-name', effort: 'high' } } },
        loopDefaults: { byHarness: { ollama: { effort: 'high' } } },
      }),
    ).toEqual([]);
    expect(resolveHarnessModel({ ...base, catalog: [row], harness: 'ollama' })).toMatchObject({
      status: 'unavailable',
      code: 'MODEL_UNAVAILABLE',
    });
  }
  expect(
    resolveHarnessModel({
      ...base,
      catalog: [{ ...available, enabled: false }],
      processDefaults: { byHarness: { ollama: { model: 'same-name', effort: 'none' } } },
      harness: 'ollama',
    }),
  ).toMatchObject({ status: 'unavailable', code: 'MODEL_DISABLED' });
});
