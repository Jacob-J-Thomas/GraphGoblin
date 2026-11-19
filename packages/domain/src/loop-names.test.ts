import { describe, expect, it } from 'vitest';
import { loopNameKey } from './index.js';

describe('loop-name equivalence', () => {
  it('trims, collapses ECMAScript whitespace, and lowercases without changing the display name', () => {
    const name = ' \tÉcho\u00a0 \nBoard\ufeff';
    expect(loopNameKey(name)).toBe('écho board');
    expect(name).toBe(' \tÉcho\u00a0 \nBoard\ufeff');
    expect(loopNameKey('')).toBe('');
    expect(loopNameKey(' \t\n')).toBe('');
  });

  it.each([
    ['e\u0301', 'é'],
    ['Straße', 'STRASSE'],
    ['I', 'ı'],
    ['İ', 'i'],
    ['Nightly triage', 'Nightly-triage'],
    ['Twin\u200bBoard', 'Twin Board'],
  ])('keeps %s distinct from %s without normalization, full folding, or locale rules', (a, b) => {
    expect(loopNameKey(a)).not.toBe(loopNameKey(b));
  });
});
