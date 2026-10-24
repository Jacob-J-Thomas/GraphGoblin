import type { HarnessDefaults } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { inheritedHarnessDefaults } from './index.js';

const empty: HarnessDefaults = { byHarness: {} };
const defaults = {
  loopDefaults: {
    byHarness: {
      codex: { model: 'codex-loop', effort: 'high' },
      claude: { model: 'claude-loop', effort: 'max' },
    },
  },
  ownerDefaults: {
    byHarness: {
      codex: { model: 'codex-owner', effort: 'medium' },
      claude: { model: 'claude-owner', effort: 'xhigh' },
    },
  },
  processDefaults: {
    byHarness: {
      codex: { model: 'codex-process', effort: 'low' },
      claude: { model: 'claude-process', effort: 'medium' },
    },
  },
} satisfies Record<string, HarnessDefaults>;

describe.each(['codex', 'claude'] as const)('%s inherited harness defaults', (harness) => {
  it.each([
    ['loop', defaults, defaults.loopDefaults],
    ['owner', { ...defaults, loopDefaults: empty }, defaults.ownerDefaults],
    [
      'process',
      { ...defaults, loopDefaults: empty, ownerDefaults: empty },
      defaults.processDefaults,
    ],
  ] as const)('takes model and effort from %s before lower levels', (_level, input, expected) => {
    expect(inheritedHarnessDefaults({ ...input, harness })).toEqual(expected.byHarness[harness]);
  });

  it('inherits effort independently when the loop only supplies a model', () => {
    expect(
      inheritedHarnessDefaults({
        ...defaults,
        harness,
        loopDefaults: { byHarness: { [harness]: { model: 'partial-loop' } } },
        ownerDefaults: { byHarness: { [harness]: { model: 'shadowed-owner' } } },
      }),
    ).toEqual({
      model: 'partial-loop',
      effort: defaults.processDefaults.byHarness[harness].effort,
    });
  });

  it('inherits model independently when the loop only supplies effort', () => {
    expect(
      inheritedHarnessDefaults({
        ...defaults,
        harness,
        loopDefaults: { byHarness: { [harness]: { effort: 'low' } } },
      }),
    ).toEqual({ model: defaults.ownerDefaults.byHarness[harness].model, effort: 'low' });
  });

  it('leaves missing fields unresolved instead of borrowing from another harness', () => {
    const other = harness === 'codex' ? 'claude' : 'codex';
    expect(
      inheritedHarnessDefaults({
        harness,
        loopDefaults: empty,
        ownerDefaults: empty,
        processDefaults: { byHarness: { [other]: { model: 'other-model', effort: 'high' } } },
      }),
    ).toEqual({ model: undefined, effort: undefined });
  });
});
