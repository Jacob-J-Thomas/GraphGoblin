import { describe, expect, it } from 'vitest';
import { ClaudeModelCapabilitySchema } from '@graphgoblin/contracts';
import { claudeModelCapabilities, CLAUDE_FABLE_MODEL, CLAUDE_MODEL } from './models.js';
import { resolvedClaudeSettings } from './policy.js';

describe('exact Claude model capabilities', () => {
  it('admits both exact identities through the same model and effort checks', () => {
    const entries = claudeModelCapabilities();
    expect(entries.map((entry) => entry.model)).toEqual([CLAUDE_MODEL, CLAUDE_FABLE_MODEL]);
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
});
