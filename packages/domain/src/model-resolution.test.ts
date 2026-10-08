import { describe, expect, it } from 'vitest';
import type { HarnessDefaults, ModelCatalogEntry } from '@graphgoblin/contracts';
import {
  resolveHarnessModel,
  validateHarnessDefaults,
  type HarnessModelResolutionInput,
} from './model-resolution.js';
const empty: HarnessDefaults = { byHarness: {} };
const catalog: ModelCatalogEntry[] = [
  {
    harness: 'codex',
    model: 'codex-model',
    displayName: 'Codex',
    source: 'harness',
    efforts: ['low', 'high'],
    defaultEffort: 'low',
    enabled: true,
  },
  {
    harness: 'other',
    model: 'other-model',
    displayName: 'Other',
    source: 'harness',
    efforts: ['high'],
    defaultEffort: 'high',
    enabled: true,
  },
];
const base: HarnessModelResolutionInput = {
  harness: 'codex',
  loopDefaults: empty,
  ownerDefaults: empty,
  processDefaults: { byHarness: { codex: { model: 'codex-model', effort: 'low' } } },
  catalog,
};
describe('harness model resolution', () => {
  it('resolves model and effort independently from node, loop, owner and process', () => {
    expect(resolveHarnessModel(base)).toEqual({
      status: 'ready',
      model: 'codex-model',
      effort: 'low',
    });
    expect(
      resolveHarnessModel({
        ...base,
        loopDefaults: { byHarness: { codex: { model: 'codex-model' } } },
        ownerDefaults: { byHarness: { codex: { effort: 'high' } } },
      }),
    ).toEqual({ status: 'ready', model: 'codex-model', effort: 'high' });
    expect(
      resolveHarnessModel({
        ...base,
        model: 'codex-model',
        effort: 'high',
        loopDefaults: { byHarness: { codex: { effort: 'low' } } },
      }),
    ).toEqual({ status: 'ready', model: 'codex-model', effort: 'high' });
    expect(
      resolveHarnessModel({
        ...base,
        processDefaults: empty,
        ownerDefaults: { byHarness: { codex: { model: 'codex-model', effort: 'high' } } },
      }),
    ).toMatchObject({ status: 'ready', effort: 'high' });
  });
  it.each([
    ['MODEL_UNRESOLVED', { processDefaults: empty }],
    ['EFFORT_UNRESOLVED', { processDefaults: { byHarness: { codex: { model: 'codex-model' } } } }],
    ['MODEL_NOT_IN_CATALOG', { model: 'invented' }],
    ['MODEL_HARNESS_MISMATCH', { model: 'other-model' }],
    ['EFFORT_UNSUPPORTED', { effort: 'max' }],
    ['MODEL_DISABLED', { catalog: [{ ...catalog[0]!, enabled: false }] }],
  ] as const)('rejects %s without inventing a model or effort', (code, overrides) => {
    expect(resolveHarnessModel({ ...base, ...overrides })).toMatchObject({
      code,
      status: code === 'MODEL_DISABLED' ? 'unavailable' : 'invalid',
    });
  });
  it('does not substitute catalog defaultEffort or skip invalid effective fields', () => {
    expect(resolveHarnessModel({ ...base, effort: 'max' })).toMatchObject({
      code: 'EFFORT_UNSUPPORTED',
    });
    expect(resolveHarnessModel({ ...base, model: 'invented' })).toMatchObject({
      code: 'MODEL_NOT_IN_CATALOG',
    });
  });
});
describe('every authored harness default', () => {
  it('admits partial and empty defaults, including known disabled shadowed models', () => {
    expect(validateHarnessDefaults(base)).toEqual([]);
    expect(
      validateHarnessDefaults({
        ...base,
        loopDefaults: { byHarness: { codex: { model: 'codex-model' } } },
        ownerDefaults: { byHarness: { codex: { effort: 'high' } } },
      }),
    ).toEqual([]);
    expect(
      validateHarnessDefaults({ ...base, catalog: [{ ...catalog[0]!, enabled: false }] }),
    ).toEqual([]);
    expect(
      validateHarnessDefaults({
        ...base,
        processDefaults: { byHarness: { codex: { model: 'codex-model' } } },
      }),
    ).toEqual([]);
  });
  it('rejects invalid authored defaults even when overridden by node/loop values', () => {
    expect(
      validateHarnessDefaults({
        ...base,
        loopDefaults: { byHarness: { codex: { model: 'codex-model', effort: 'low' } } },
        ownerDefaults: { byHarness: { codex: { model: 'missing' } } },
      }),
    ).toMatchObject([
      {
        level: 'owner',
        harness: 'codex',
        resolution: { code: 'MODEL_NOT_IN_CATALOG', path: 'model' },
      },
    ]);
    expect(
      validateHarnessDefaults({
        ...base,
        processDefaults: { byHarness: { codex: { model: 'other-model' } } },
      }),
    ).toMatchObject([{ level: 'process', resolution: { code: 'MODEL_HARNESS_MISMATCH' } }]);
    expect(
      validateHarnessDefaults({
        ...base,
        ownerDefaults: { byHarness: { codex: { effort: 'max' } } },
      }),
    ).toMatchObject([
      { level: 'owner', resolution: { code: 'EFFORT_UNSUPPORTED', path: 'effort' } },
    ]);
    expect(
      validateHarnessDefaults({
        ...base,
        processDefaults: { byHarness: { codex: { effort: 'high' } } },
      }),
    ).toMatchObject([
      { level: 'process', resolution: { code: 'MODEL_UNRESOLVED', path: 'model' } },
    ]);
  });
});

const opus: ModelCatalogEntry = {
  harness: 'claude',
  model: 'claude-opus-5-5',
  source: 'harness',
  displayName: 'Claude Opus 5.5',
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultEffort: 'high',
  enabled: true,
};
const claudeBase: HarnessModelResolutionInput = {
  ...base,
  harness: 'claude',
  catalog: [...catalog, opus],
  processDefaults: {
    byHarness: {
      codex: { model: 'codex-model', effort: 'low' },
      claude: { model: opus.model, effort: 'xhigh' },
    },
  },
};
describe('independent Claude model defaults', () => {
  it('uses exact family settings and never catalog guidance or another family fallback', () => {
    expect(resolveHarnessModel(claudeBase)).toEqual({
      status: 'ready',
      model: opus.model,
      effort: 'xhigh',
    });
    expect(
      resolveHarnessModel({ ...claudeBase, processDefaults: base.processDefaults }),
    ).toMatchObject({ code: 'MODEL_UNRESOLVED' });
    expect(
      resolveHarnessModel({
        ...claudeBase,
        model: opus.model,
        processDefaults: base.processDefaults,
      }),
    ).toMatchObject({ code: 'EFFORT_UNRESOLVED' });
    expect(resolveHarnessModel({ ...claudeBase, model: 'codex-model' })).toMatchObject({
      code: 'MODEL_HARNESS_MISMATCH',
    });
    expect(
      resolveHarnessModel({ ...base, catalog: claudeBase.catalog, model: opus.model }),
    ).toMatchObject({ code: 'MODEL_HARNESS_MISMATCH' });
    expect(resolveHarnessModel({ ...claudeBase, model: 'opus' })).toMatchObject({
      code: 'MODEL_NOT_IN_CATALOG',
    });
    expect(resolveHarnessModel({ ...claudeBase, effort: 'minimal' })).toMatchObject({
      code: 'EFFORT_UNSUPPORTED',
    });
    expect(
      resolveHarnessModel({ ...claudeBase, catalog: [{ ...opus, enabled: false }] }),
    ).toMatchObject({ code: 'MODEL_DISABLED' });
  });
  it.each(['loopDefaults', 'ownerDefaults', 'processDefaults'] as const)(
    'validates explicit values at %s even when overridden',
    (level) => {
      const defaults = {
        ...claudeBase,
        loopDefaults: { byHarness: { claude: { model: opus.model, effort: 'low' as const } } },
        [level]: { byHarness: { claude: { model: 'codex-model', effort: 'minimal' } } },
      };
      expect(validateHarnessDefaults(defaults)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            harness: 'claude',
            resolution: expect.objectContaining({ code: 'MODEL_HARNESS_MISMATCH' }),
          }),
        ]),
      );
      const effortDefaults = {
        ...claudeBase,
        [level]: { byHarness: { claude: { model: opus.model, effort: 'minimal' as const } } },
      };
      expect(validateHarnessDefaults(effortDefaults)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            harness: 'claude',
            resolution: expect.objectContaining({ code: 'EFFORT_UNSUPPORTED' }),
          }),
        ]),
      );
    },
  );
  it('independently resolves node and partial layered fields within Claude', () => {
    expect(
      resolveHarnessModel({
        ...claudeBase,
        effort: 'max',
        loopDefaults: { byHarness: { claude: { model: opus.model } } },
        ownerDefaults: { byHarness: { claude: { effort: 'medium' } } },
      }),
    ).toMatchObject({ status: 'ready', model: opus.model, effort: 'max' });
    expect(
      resolveHarnessModel({
        ...claudeBase,
        loopDefaults: { byHarness: { claude: { model: opus.model } } },
        ownerDefaults: { byHarness: { claude: { effort: 'medium' } } },
      }),
    ).toMatchObject({ status: 'ready', effort: 'medium' });
  });
});
