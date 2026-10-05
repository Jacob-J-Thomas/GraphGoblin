import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FONT_PRELOADS, FONTS } from '../lib/font.js';

// Read from disk: Vitest replaces CSS imports (even ?raw) with empty modules (css: false).
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'fonts.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');
const publicFonts = join(here, '..', '..', 'public', 'fonts');

const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((match) => match[1] ?? '');
const urls = faces.map((face) => /url\('\/(fonts\/[\w-]+\.woff2)'\)/.exec(face)?.[1]);

/** The declarations of the rule whose selector list is exactly `selector`. */
function rule(selector: string): string | undefined {
  const escaped = selector.replace(/[[\]()'.*]/g, '\\$&');
  return new RegExp(`${escaped}\\s*{([^}]*)}`).exec(css)?.[1];
}

describe('fonts.css', () => {
  it('declares every face with a local woff2 file and font-display: swap', () => {
    expect(faces.length).toBeGreaterThanOrEqual(FONTS.length);
    faces.forEach((face, index) => {
      expect(face).toMatch(/font-display:\s*swap;/);
      expect(urls[index]).toBeDefined();
      expect(existsSync(join(publicFonts, '..', urls[index] ?? ''))).toBe(true);
    });
  });

  it('ships no font file it does not use, so the precached shell carries nothing extra', () => {
    const shipped = readdirSync(publicFonts).filter((file) => file.endsWith('.woff2'));
    expect(shipped.map((file) => `fonts/${file}`).sort()).toEqual([...new Set(urls)].sort());
  });

  it('preloads only files it declares', () => {
    for (const font of FONTS) {
      for (const path of FONT_PRELOADS[font]) expect(urls).toContain(path);
    }
  });

  it('maps every choice to both tokens, on <html> and on any element, and nothing else', () => {
    for (const font of FONTS) {
      const body = rule(`:root[data-font='${font}'],\n[data-font='${font}']`);
      expect(body, font).toBeDefined();
      const names = [...(body ?? '').matchAll(/(--[\w-]+):/g)].map((match) => match[1]);
      expect(names, font).toEqual(['--font-ui', '--font-display']);
    }
  });

  it('keeps Geist and the display token as the defaults in tokens.css', () => {
    expect(tokens).toMatch(/--font-sans: 'Geist', var\(--font-fallback\);/);
    expect(tokens).toMatch(/--font-ui: var\(--font-sans\);/);
    expect(tokens).toMatch(/--font-display: var\(--font-sans\);/);
    expect(tokens).toMatch(/--font-code: var\(--font-mono\);/);
  });

  it('sets headings in the display face', () => {
    expect(css).toMatch(
      /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*{\s*font-family: var\(--font-display\);/,
    );
  });

  it('keeps a licence text beside the files of every family', () => {
    const licences = readdirSync(publicFonts).filter((file) => /^OFL.*\.txt$/.test(file));
    const texts = licences.map((file) => readFileSync(join(publicFonts, file), 'utf8'));
    for (const holder of [
      'Vercel',
      'Space Grotesk Project Authors',
      'Chakra Petch Project Authors',
      'Atkinson Hyperlegible Next Project Authors',
      'Inter Project Authors',
      'Reserved Font Name OpenDyslexic',
    ]) {
      expect(
        texts.some((text) => text.includes(holder) && text.includes('SIL Open Font License')),
      ).toBe(true);
    }
  });
});
