import { describe, expect, it } from 'vitest';
import { ClaudeModelCapabilitySchema } from '@graphgoblin/contracts';
import {
  claudeCatalogModels,
  claudeModelCapabilities,
  CLAUDE_FABLE_MODEL,
  CLAUDE_HAIKU_MODEL,
  CLAUDE_MODEL,
  CLAUDE_SONNET_MODEL,
} from './models.js';
import { resolvedClaudeSettings } from './policy.js';

const VERIFIED_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

describe('exact Claude model capabilities', () => {
  it('admits every exact identity through the same model and effort checks', () => {
    const entries = claudeModelCapabilities();
    expect(entries.map((entry) => entry.model)).toEqual([
      CLAUDE_MODEL,
      CLAUDE_FABLE_MODEL,
      CLAUDE_SONNET_MODEL,
      CLAUDE_HAIKU_MODEL,
    ]);
    for (const entry of entries) {
      expect(ClaudeModelCapabilitySchema.parse(entry)).toEqual(entry);
      for (const effort of entry.efforts)
        expect(resolvedClaudeSettings({ model: entry.model, effort })).toEqual({
          model: entry.model,
          effort,
        });
      expect(() => resolvedClaudeSettings({ model: entry.model, effort: 'minimal' })).toThrow(
        /effort/,
      );
      expect(() => resolvedClaudeSettings({ model: entry.model })).toThrow(/effort/);
    }
    expect(() => resolvedClaudeSettings({ model: 'claude-unknown', effort: 'high' })).toThrow(
      /model/,
    );
    entries[0]!.efforts.length = 0;
    expect(claudeModelCapabilities()[0]!.efforts).toHaveLength(5);
  });

  it('declares the current Sonnet and Haiku ids with the efforts verified on the installed CLI', () => {
    expect(CLAUDE_SONNET_MODEL).toBe('claude-sonnet-5-5');
    expect(CLAUDE_HAIKU_MODEL).toBe('claude-haiku-5-5');
    const byModel = new Map(claudeCatalogModels().map((entry) => [entry.model, entry]));
    expect(byModel.get(CLAUDE_SONNET_MODEL)).toEqual({
      model: CLAUDE_SONNET_MODEL,
      displayName: 'Claude Sonnet 5.5',
      efforts: VERIFIED_EFFORTS,
    });
    expect(byModel.get(CLAUDE_HAIKU_MODEL)).toEqual({
      model: CLAUDE_HAIKU_MODEL,
      displayName: 'Claude Haiku 5.5',
      efforts: VERIFIED_EFFORTS,
    });
    // The older Haiku has no effort control in the installed CLI, and aliases are not exact ids.
    for (const model of ['claude-haiku-4-5-20251001', 'claude-haiku-4-5', 'sonnet', 'haiku'])
      expect(() => resolvedClaudeSettings({ model, effort: 'high' })).toThrow(/model/);
  });

  it('keeps catalog rows and preflight capabilities on one list with distinct display names', () => {
    const rows = claudeCatalogModels();
    expect(rows.map(({ model, efforts }) => ({ model, efforts }))).toEqual(
      claudeModelCapabilities(),
    );
    expect(new Set(rows.map((row) => row.displayName)).size).toBe(rows.length);
    rows[0]!.efforts.length = 0;
    rows[0]!.displayName = 'changed';
    expect(claudeCatalogModels()[0]).toMatchObject({
      displayName: 'Claude Opus 5.5',
      efforts: VERIFIED_EFFORTS,
    });
  });
});
