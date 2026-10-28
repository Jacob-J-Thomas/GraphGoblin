import { describe, expect, it } from 'vitest';
import { EffortSchema } from '@graphgoblin/contracts';
import { CODEX_EFFORT_FAMILIES, codexEffortName, type CodexEffortFamily } from './effort-names.js';

// The mapping itself, with a small supplied table: a hypothetical family that names the lowest
// level `minimal` beside one that names it `none`. The shipped table is fixed; the public harness
// tests (effort.test.ts) cover it through the real SDK and the fake CLI.
const table: readonly CodexEffortFamily[] = [
  { prefix: 'gpt-5-legacy', none: 'minimal' },
  { prefix: 'gpt-7', none: 'none' },
];

describe('codexEffortName with a supplied table', () => {
  it.each([
    ['gpt-5-legacy', 'minimal'],
    ['gpt-5-legacy-mini', 'minimal'],
    ['gpt-5-legacy.2', 'minimal'],
    ['gpt-5-legacyx', 'none'],
    ['gpt-5-legac', 'none'],
    ['gpt-7', 'none'],
    ['gpt-70', 'none'],
    ['house-model-7', 'none'],
  ])('sends none for %s as %s (a family matches whole name segments only)', (model, name) => {
    expect(codexEffortName(model, 'none', table)).toBe(name);
  });

  it.each(EffortSchema.options.filter((effort) => effort !== 'none'))(
    'passes %s through unchanged, even in a family that renames none',
    (effort) => {
      expect(codexEffortName('gpt-5-legacy-mini', effort, table)).toBe(effort);
    },
  );
});

describe('the shipped family table', () => {
  it('names none for GPT-6 and GPT-5.6, and no family that renames it', () => {
    expect(CODEX_EFFORT_FAMILIES).toEqual([
      { prefix: 'gpt-6', none: 'none' },
      { prefix: 'gpt-5.6', none: 'none' },
    ]);
    expect(codexEffortName('gpt-6.1-sol', 'none')).toBe('none');
    expect(codexEffortName('gpt-5.5', 'none')).toBe('none');
  });
});
