import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  currentTheme,
  DEFAULT_THEME,
  isTheme,
  readStoredTheme,
  setTheme,
  subscribeTheme,
  syncThemeAcrossTabs,
  THEME_STORAGE_KEY,
  themeBootScript,
  useTheme,
  writeStoredTheme,
} from './theme.js';

/** The theme-color meta tag the build adds, with each theme's colour (any strings do). */
function addThemeColorMeta(): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = 'dark-chrome';
  meta.dataset['dark'] = 'dark-chrome';
  meta.dataset['light'] = 'light-chrome';
  document.head.append(meta);
  return meta;
}

/** Make every localStorage access throw, as blocked site data or a hostile accessor would. */
function blockStorage() {
  return vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
}

beforeEach(() => {
  document.documentElement.dataset['theme'] = 'dark';
});

afterEach(() => {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  delete document.documentElement.dataset['theme'];
});

describe('theme storage', () => {
  it('defaults to dark when nothing is stored', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('reads a stored theme and ignores values it does not know, leaving them stored', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(readStoredTheme()).toBe('light');
    for (const value of ['system', 'purple', '', 'LIGHT']) {
      localStorage.setItem(THEME_STORAGE_KEY, value);
      expect(readStoredTheme()).toBe('dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(value);
    }
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('system')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });

  it('falls back to dark and keeps working when storage throws', () => {
    const blocked = blockStorage();
    expect(readStoredTheme()).toBe('dark');
    expect(writeStoredTheme('light')).toBe(false);
    expect(() => setTheme('light')).not.toThrow();
    expect(document.documentElement.dataset['theme']).toBe('light');
    blocked.mockRestore();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(readStoredTheme()).toBe('dark');
    getItem.mockRestore();
  });

  it('writes the chosen theme under one key', () => {
    expect(writeStoredTheme('light')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});

describe('applying a theme', () => {
  it('sets data-theme and the theme-color meta from its per-theme colours', () => {
    const meta = addThemeColorMeta();
    applyTheme('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(meta.content).toBe('light-chrome');
    applyTheme('dark');
    expect(meta.content).toBe('dark-chrome');
  });

  it('leaves a meta tag without per-theme colours alone, and works with none at all', () => {
    expect(() => applyTheme('light')).not.toThrow();
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = 'fixed';
    document.head.append(meta);
    applyTheme('light');
    expect(meta.content).toBe('fixed');
  });

  it('reports the shown theme, and the default for anything else', () => {
    document.documentElement.dataset['theme'] = 'light';
    expect(currentTheme()).toBe('light');
    document.documentElement.dataset['theme'] = 'sepia';
    expect(currentTheme()).toBe('dark');
  });

  it('setTheme shows, stores, and announces the choice', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    setTheme('light');
    expect(currentTheme()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setTheme('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('other tabs', () => {
  it('follows a theme chosen elsewhere, and storage cleared elsewhere, but not other keys', () => {
    const meta = addThemeColorMeta();
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    const stop = syncThemeAcrossTabs();
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(currentTheme()).toBe('light');
    expect(meta.content).toBe('light-chrome');
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'graphgoblin-api-key' }));
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(currentTheme()).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(currentTheme()).toBe('dark');
    unsubscribe();
  });
});

describe('useTheme', () => {
  it('returns the shown theme and re-renders when it changes', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('dark');
    act(() => result.current[1]('light'));
    expect(result.current[0]).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});

describe('boot script', () => {
  // The boot script is generated text that index.html runs inline; running it is the test.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const boot = () => new Function(themeBootScript()) as () => void;

  it('shows the stored theme and its chrome colour before the app loads', () => {
    const meta = addThemeColorMeta();
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    boot()();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(meta.content).toBe('light-chrome');
  });

  it('keeps the static dark default for missing or unknown values and without a meta tag', () => {
    boot()();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    boot()();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    boot()();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('tolerates storage that throws', () => {
    const blocked = blockStorage();
    expect(() => boot()()).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    blocked.mockRestore();
    expect(themeBootScript()).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });
});
