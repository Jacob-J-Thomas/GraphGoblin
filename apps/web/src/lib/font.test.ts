import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyFont,
  currentFont,
  DEFAULT_FONT,
  FONT_PRELOADS,
  FONT_STORAGE_KEY,
  FONTS,
  fontBootScript,
  isFont,
  readStoredFont,
  setFont,
  subscribeFont,
  syncFontAcrossTabs,
  useFont,
  writeStoredFont,
} from './font.js';

/** Make every localStorage access throw, as blocked site data or a hostile accessor would. */
function blockStorage() {
  return vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
}

/** The preload links the boot script added, as their hrefs. */
function preloads(): string[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')].map((link) =>
    link.getAttribute('href'),
  ) as string[];
}

afterEach(() => {
  document.head.querySelectorAll('link[rel="preload"]').forEach((link) => link.remove());
  delete document.documentElement.dataset['font'];
});

describe('font storage', () => {
  it('defaults to Geist when nothing is stored', () => {
    expect(DEFAULT_FONT).toBe('geist');
    expect(FONTS[0]).toBe('geist');
    expect(readStoredFont()).toBe('geist');
  });

  it('reads a stored face and ignores values it does not know, leaving them stored', () => {
    localStorage.setItem(FONT_STORAGE_KEY, 'opendyslexic');
    expect(readStoredFont()).toBe('opendyslexic');
    for (const value of ['comic-sans', '', 'INTER', 'Inter', 'constructor', '__proto__']) {
      localStorage.setItem(FONT_STORAGE_KEY, value);
      expect(readStoredFont()).toBe('geist');
      expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe(value);
    }
    expect(isFont('inter')).toBe(true);
    expect(isFont('system')).toBe(false);
    expect(isFont(undefined)).toBe(false);
  });

  it('falls back to Geist and keeps working when storage throws', () => {
    const blocked = blockStorage();
    expect(readStoredFont()).toBe('geist');
    expect(writeStoredFont('inter')).toBe(false);
    expect(() => setFont('inter')).not.toThrow();
    expect(document.documentElement.dataset['font']).toBe('inter');
    blocked.mockRestore();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(readStoredFont()).toBe('geist');
    getItem.mockRestore();
  });

  it('writes the chosen face under one key', () => {
    expect(writeStoredFont('space-grotesk')).toBe(true);
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe('space-grotesk');
  });

  it('preloads at least one file for every face', () => {
    for (const font of FONTS) {
      expect(FONT_PRELOADS[font].length).toBeGreaterThan(0);
      for (const path of FONT_PRELOADS[font]) expect(path).toMatch(/^fonts\/[\w-]+\.woff2$/);
    }
  });
});

describe('applying a face', () => {
  it('sets data-font on <html>, and reports the shown face', () => {
    expect(currentFont()).toBe('geist');
    applyFont('atkinson-hyperlegible');
    expect(document.documentElement.dataset['font']).toBe('atkinson-hyperlegible');
    expect(currentFont()).toBe('atkinson-hyperlegible');
    document.documentElement.dataset['font'] = 'wingdings';
    expect(currentFont()).toBe('geist');
  });

  it('applies to another document when given one', () => {
    const other = document.implementation.createHTMLDocument('other');
    applyFont('inter', other);
    expect(other.documentElement.dataset['font']).toBe('inter');
    expect(document.documentElement.dataset['font']).toBeUndefined();
  });

  it('setFont shows, stores, and announces the choice', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFont(listener);
    setFont('chakra-petch');
    expect(currentFont()).toBe('chakra-petch');
    expect(localStorage.getItem(FONT_STORAGE_KEY)).toBe('chakra-petch');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setFont('geist');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('other tabs', () => {
  it('follows a face chosen elsewhere, and storage cleared elsewhere, but not other keys', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFont(listener);
    const stop = syncFontAcrossTabs();
    localStorage.setItem(FONT_STORAGE_KEY, 'inter');
    window.dispatchEvent(new StorageEvent('storage', { key: FONT_STORAGE_KEY }));
    expect(currentFont()).toBe('inter');
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'graphgoblin-theme' }));
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(currentFont()).toBe('geist');
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    localStorage.setItem(FONT_STORAGE_KEY, 'inter');
    window.dispatchEvent(new StorageEvent('storage', { key: FONT_STORAGE_KEY }));
    expect(currentFont()).toBe('geist');
    unsubscribe();
  });

  it('shows Geist when another tab stores a value this build does not know', () => {
    applyFont('inter');
    const stop = syncFontAcrossTabs();
    localStorage.setItem(FONT_STORAGE_KEY, 'papyrus');
    window.dispatchEvent(new StorageEvent('storage', { key: FONT_STORAGE_KEY }));
    expect(currentFont()).toBe('geist');
    stop();
  });
});

describe('useFont', () => {
  it('returns the shown face and re-renders when it changes', () => {
    const { result } = renderHook(() => useFont());
    expect(result.current[0]).toBe('geist');
    act(() => result.current[1]('space-grotesk'));
    expect(result.current[0]).toBe('space-grotesk');
    expect(document.documentElement.dataset['font']).toBe('space-grotesk');
  });
});

describe('boot script', () => {
  // The boot script is generated text that index.html runs inline; running it is the test.
  const boot = (base = '/app/') =>
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(fontBootScript(base)) as () => void;

  it('shows the stored face before the app loads and preloads its files under the base', () => {
    localStorage.setItem(FONT_STORAGE_KEY, 'chakra-petch');
    boot()();
    expect(document.documentElement.getAttribute('data-font')).toBe('chakra-petch');
    expect(preloads()).toEqual([
      '/app/fonts/Geist-Variable.woff2',
      '/app/fonts/ChakraPetch-SemiBold.woff2',
    ]);
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="preload"]');
    expect(link?.as).toBe('font');
    expect(link?.type).toBe('font/woff2');
    expect(link?.crossOrigin).toBe('anonymous');
  });

  it('preloads Geist and leaves no attribute for missing or unknown values', () => {
    boot()();
    expect(document.documentElement.hasAttribute('data-font')).toBe(false);
    expect(preloads()).toEqual(['/app/fonts/Geist-Variable.woff2']);
    document.head.querySelectorAll('link[rel="preload"]').forEach((link) => link.remove());
    localStorage.setItem(FONT_STORAGE_KEY, 'comic-sans');
    boot('/')();
    expect(document.documentElement.hasAttribute('data-font')).toBe(false);
    expect(preloads()).toEqual(['/fonts/Geist-Variable.woff2']);
  });

  it('marks a stored Geist, so the attribute always names a known face', () => {
    localStorage.setItem(FONT_STORAGE_KEY, 'geist');
    boot()();
    expect(document.documentElement.getAttribute('data-font')).toBe('geist');
  });

  it('tolerates storage that throws, still preloading Geist', () => {
    const blocked = blockStorage();
    expect(() => boot()()).not.toThrow();
    expect(document.documentElement.hasAttribute('data-font')).toBe(false);
    expect(preloads()).toEqual(['/app/fonts/Geist-Variable.woff2']);
    blocked.mockRestore();
    expect(fontBootScript('/app/')).toContain(JSON.stringify(FONT_STORAGE_KEY));
  });

  it('knows every face and its preloads', () => {
    for (const font of FONTS) {
      document.head.querySelectorAll('link[rel="preload"]').forEach((link) => link.remove());
      localStorage.setItem(FONT_STORAGE_KEY, font);
      boot()();
      expect(document.documentElement.getAttribute('data-font')).toBe(font);
      expect(preloads()).toEqual(FONT_PRELOADS[font].map((path) => `/app/${path}`));
    }
  });
});
