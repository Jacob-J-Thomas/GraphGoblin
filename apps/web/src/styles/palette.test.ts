import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { appChromeColors, tokenColor } from './palette.js';

// Read from disk: Vitest replaces CSS imports (even ?raw) with empty modules (css: false).
const tokens = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8');

describe('palette', () => {
  it('resolves semantic tokens through the primitive tier for each theme', () => {
    expect(tokenColor(tokens, 'dark', '--surface-inverse')).toBe(
      tokenColor(tokens, 'dark', '--grey-990'),
    );
    expect(tokenColor(tokens, 'light', '--surface-app')).toBe(
      tokenColor(tokens, 'light', '--grey-50'),
    );
    expect(tokenColor(tokens, 'dark', '--surface-app')).not.toBe(
      tokenColor(tokens, 'light', '--surface-app'),
    );
    expect(tokenColor(tokens, 'dark', '--accent')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('gives the app chrome the dark theme by default', () => {
    const dark = appChromeColors(tokens);
    expect(dark.themeColor).toBe(tokenColor(tokens, 'dark', '--grey-990'));
    expect(dark.backgroundColor).toBe(tokenColor(tokens, 'dark', '--grey-975'));
    expect(appChromeColors(tokens, 'light').backgroundColor).toBe(
      tokenColor(tokens, 'light', '--grey-50'),
    );
  });

  it('ignores comments and reports unknown or circular tokens', () => {
    const css = `
      /* :root { --a: var(--missing); } */
      :root { --a: var(--b); --b: var(--a); --c: var(--d); --e: red; }
      [data-theme='dark'] { --e: var(--f); }
      .other { --f: blue; }
    `;
    expect(() => tokenColor(css, 'light', '--a')).toThrow('refers to itself');
    expect(() => tokenColor(css, 'light', '--c')).toThrow('not declared');
    expect(() => tokenColor(css, 'light', '--nope')).toThrow('not declared');
    expect(tokenColor(css, 'light', '--e')).toBe('red');
    expect(() => tokenColor(css, 'dark', '--e')).toThrow('not declared');
  });
});
